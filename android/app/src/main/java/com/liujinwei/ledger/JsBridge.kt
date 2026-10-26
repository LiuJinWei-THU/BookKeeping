package com.liujinwei.ledger

import android.content.Intent
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * 注入 WebView 的同步 JS 桥（网页里通过 window.AndroidStore 调用）。
 * 方法均在 WebView 的 JavaBridge 线程执行，SQLite 操作线程安全；
 * 与 UI 相关的（跳系统设置等）已内部切到主线程或用 NEW_TASK。
 */
class JsBridge(private val activity: MainActivity) {

    /** 读取全部账单；同时把后台通知捕获的 pending 合并进来（页面每次加载都会调用） */
    @JavascriptInterface
    fun all(): String {
        Db.mergePending(activity)
        val arr = JSONArray()
        Db.allBills(activity).forEach { arr.put(it.toJson()) }
        return arr.toString()
    }

    /** 网页内存缓存全量落库（Store.save 调用） */
    @JavascriptInterface
    fun save(json: String?): Boolean {
        if (json == null) return false
        return try {
            val arr = JSONArray(json)
            val bills = ArrayList<Bill>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                Bill.fromJson(o)?.let { bills.add(it) }
            }
            Db.replaceBills(activity, bills)
            true
        } catch (_: Exception) {
            false
        }
    }

    /** 导出备份 JSON 到手机"下载"目录 */
    @JavascriptInterface
    fun export(json: String?, fileName: String?): String {
        val res = JSONObject()
        try {
            if (json.isNullOrEmpty()) throw IllegalStateException("没有可导出的内容")
            val name = if (!fileName.isNullOrBlank()) fileName
            else "智能记账备份_${System.currentTimeMillis()}.json"
            val path = activity.writeBackupToDownloads(name, json)
            res.put("ok", true).put("path", path)
        } catch (e: Exception) {
            res.put("ok", false).put("msg", e.message ?: "写入失败")
        }
        return res.toString()
    }

    /** 「通知使用权」是否已授予本应用 */
    @JavascriptInterface
    fun listenerEnabled(): String {
        val flat = Settings.Secure.getString(activity.contentResolver, "enabled_notification_listeners") ?: ""
        val pkg = activity.packageName
        val enabled = flat.split(':').any {
            it.equals(pkg, ignoreCase = true) || it.startsWith("$pkg/") || it.startsWith("$pkg.")
        }
        return JSONObject().put("enabled", enabled).toString()
    }

    /** 跳到系统「通知使用权」设置页 */
    @JavascriptInterface
    fun openListenerSettings() {
        activity.startActivity(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /** 最近的通知捕获日志（设置页展示） */
    @JavascriptInterface
    fun recentCaptures(): String = JSONObject().put("items", Db.recentLog(activity)).toString()
}
