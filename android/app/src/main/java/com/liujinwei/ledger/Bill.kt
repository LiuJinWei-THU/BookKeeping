package com.liujinwei.ledger

import org.json.JSONObject
import kotlin.random.Random

/**
 * 账单记录：字段与网页版 js/store.js 的 schema 完全一致，
 * 保证 App 与网页（含 GitHub Pages 版备份文件）互通。
 */
data class Bill(
    val id: String,
    val type: String,      // expense | income
    val amount: Double,    // 元，两位小数
    val time: Long,        // epoch ms
    val merchant: String,
    val category: String,
    val source: String,    // wechat | alipay | boc | manual
    val txId: String,
    val note: String,
    val createdAt: Long
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("type", type)
        put("amount", amount)
        put("time", time)
        put("merchant", merchant)
        put("category", category)
        put("source", source)
        put("txId", txId)
        put("note", note)
        put("createdAt", createdAt)
    }

    /** 去重键，逻辑与网页 Store.dupKey 一致：交易单号优先，否则 金额+分钟+商户 */
    fun dupKey(): String {
        if (txId.length >= 15) return "tx:$txId"
        return "h:" + Math.round(amount * 100) + "|" + (time / 60000L) + "|" + merchant
    }

    companion object {
        private const val ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"

        fun genId(): String =
            System.currentTimeMillis().toString(36) + (1..8).map { ID_CHARS.random() }.joinToString("")

        /** 宽松反序列化：字段缺失/非法返回 null（导入与网页写入都过这里校验） */
        fun fromJson(o: JSONObject): Bill? {
            val type = o.optString("type")
            val amount = if (o.has("amount") && !o.isNull("amount")) o.optDouble("amount") else Double.NaN
            val time = o.optLong("time", 0L)
            if ((type != "expense" && type != "income") || amount.isNaN() || amount <= 0.0 || time <= 0L) return null
            val id = o.optString("id")
            return Bill(
                id = if (id.isNotEmpty()) id else genId(),
                type = type,
                amount = Math.round(amount * 100) / 100.0,
                time = time,
                merchant = o.optString("merchant").take(60),
                category = o.optString("category").ifEmpty { "其他" }.take(20),
                source = if (SOURCE_SET.contains(o.optString("source"))) o.optString("source") else "manual",
                txId = o.optString("txId").take(40),
                note = o.optString("note").take(200),
                createdAt = if (o.has("createdAt") && !o.isNull("createdAt")) o.optLong("createdAt") else System.currentTimeMillis()
            )
        }

        private val SOURCE_SET = setOf("wechat", "alipay", "boc", "manual")
    }
}
