package com.liujinwei.ledger

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * 手机本地 SQLite，数据 100% 留在本机：
 *  - bills        账本（与网页 Store 内存缓存全量同步）
 *  - pending      后台通知捕获的账单，网页加载时经去重合并进 bills
 *    （独立成表是为了防止"页面未加载时通知入库"与"页面旧缓存整表覆盖"互相丢数据）
 *  - capture_log  通知捕获日志（设置页"最近捕获"展示，仅保留最近 50 条）
 */
object Db {

    private const val DB_NAME = "ledger.db"
    private const val DB_VERSION = 1
    private const val COLS = "id,type,amount,time,merchant,category,source,txId,note,createdAt"

    private class Helper(ctx: Context) : SQLiteOpenHelper(ctx.applicationContext, DB_NAME, null, DB_VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            val cols = "(id TEXT PRIMARY KEY, type TEXT NOT NULL, amount REAL NOT NULL, time INTEGER NOT NULL," +
                " merchant TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT ''," +
                " source TEXT NOT NULL DEFAULT 'manual', txId TEXT NOT NULL DEFAULT ''," +
                " note TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL DEFAULT 0)"
            db.execSQL("CREATE TABLE IF NOT EXISTS bills $cols")
            db.execSQL("CREATE TABLE IF NOT EXISTS pending $cols")
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_bills_time ON bills(time)")
            db.execSQL("CREATE TABLE IF NOT EXISTS capture_log (at INTEGER NOT NULL, action TEXT NOT NULL," +
                " title TEXT NOT NULL DEFAULT '', amount REAL, type TEXT, merchant TEXT, source TEXT)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }

    @Volatile
    private var helper: Helper? = null

    private fun h(ctx: Context): Helper =
        helper ?: synchronized(this) { helper ?: Helper(ctx).also { helper = it } }

    private fun cv(b: Bill): ContentValues = ContentValues().apply {
        put("id", b.id); put("type", b.type); put("amount", b.amount); put("time", b.time)
        put("merchant", b.merchant); put("category", b.category); put("source", b.source)
        put("txId", b.txId); put("note", b.note); put("createdAt", b.createdAt)
    }

    private fun Cursor.toBill(): Bill = Bill(
        id = getString(0), type = getString(1), amount = getDouble(2), time = getLong(3),
        merchant = getString(4) ?: "", category = getString(5) ?: "",
        source = getString(6) ?: "manual", txId = getString(7) ?: "",
        note = getString(8) ?: "", createdAt = getLong(9)
    )

    fun insert(ctx: Context, table: String, bill: Bill) {
        h(ctx).writableDatabase.insertWithOnConflict(table, null, cv(bill), SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun allBills(ctx: Context): List<Bill> {
        val out = ArrayList<Bill>()
        h(ctx).readableDatabase.rawQuery("SELECT $COLS FROM bills ORDER BY time ASC", null).use { c ->
            while (c.moveToNext()) out.add(c.toBill())
        }
        return out
    }

    /** 网页 Store.save 的全量覆盖写（网页内存缓存即全部数据） */
    fun replaceBills(ctx: Context, bills: List<Bill>) {
        val db = h(ctx).writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM bills")
            for (b in bills) db.insertWithOnConflict("bills", null, cv(b), SQLiteDatabase.CONFLICT_IGNORE)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** 把 pending 合并进 bills（按与网页一致的去重键），返回合并条数。页面每次加载数据时调用。 */
    fun mergePending(ctx: Context): Int {
        val db = h(ctx).writableDatabase
        var merged = 0
        db.beginTransaction()
        try {
            val keys = HashSet<String>()
            db.rawQuery("SELECT $COLS FROM bills", null).use { c ->
                while (c.moveToNext()) keys.add(c.toBill().dupKey())
            }
            val pending = ArrayList<Bill>()
            db.rawQuery("SELECT $COLS FROM pending", null).use { c ->
                while (c.moveToNext()) pending.add(c.toBill())
            }
            for (b in pending) {
                if (keys.add(b.dupKey())) {
                    db.insertWithOnConflict("bills", null, cv(b), SQLiteDatabase.CONFLICT_IGNORE)
                    merged++
                }
            }
            db.execSQL("DELETE FROM pending")
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return merged
    }

    fun log(ctx: Context, action: String, title: String, amount: Double?, type: String?, merchant: String?, source: String?) {
        val db = h(ctx).writableDatabase
        db.execSQL(
            "INSERT INTO capture_log (at, action, title, amount, type, merchant, source) VALUES (?,?,?,?,?,?,?)",
            arrayOf<Any?>(System.currentTimeMillis(), action, title.take(80), amount, type, merchant?.take(40), source)
        )
        db.execSQL("DELETE FROM capture_log WHERE at NOT IN (SELECT at FROM capture_log ORDER BY at DESC LIMIT 50)")
    }

    fun recentLog(ctx: Context, limit: Int = 8): JSONArray {
        val arr = JSONArray()
        h(ctx).readableDatabase.rawQuery(
            "SELECT at, action, title, amount, type, merchant, source FROM capture_log ORDER BY at DESC LIMIT $limit", null
        ).use { c ->
            while (c.moveToNext()) {
                arr.put(JSONObject().apply {
                    put("at", c.getLong(0))
                    put("action", c.getString(1))
                    put("title", c.getString(2))
                    if (!c.isNull(3)) put("amount", c.getDouble(3))
                    if (!c.isNull(4)) put("type", c.getString(4))
                    if (!c.isNull(5)) put("merchant", c.getString(5))
                    if (!c.isNull(6)) put("source", c.getString(6))
                })
            }
        }
        return arr
    }
}
