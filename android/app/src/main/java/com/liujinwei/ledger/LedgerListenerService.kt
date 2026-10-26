package com.liujinwei.ledger

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * 付款通知监听（系统「通知使用权」绑定，随开机自动恢复）。
 * 捕获 → 解析 → 写 pending 表 → 若页面在前台则推送刷新。
 */
class LedgerListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val pkg = sbn.packageName
        if (!NotifParser.isWatched(pkg) || sbn.isOngoing) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        var text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        if (!big.isNullOrBlank() && big.length > text.length) text = big
        // 聚合服务号通知（Service Accounts）可能用 MessagingStyle，正文在各条消息里
        @Suppress("DEPRECATION", "UNCHECKED_CAST")
        val msgs = extras.getParcelableArrayList<android.os.Parcelable>(Notification.EXTRA_MESSAGES)
        if (msgs != null) {
            val msgText = msgs.filterIsInstance<Notification.MessagingStyle.Message>()
                .joinToString("\n") { it.text?.toString() ?: "" }
            if (msgText.length > text.length) text = msgText
        }
        if (title.isBlank() && text.isBlank()) return

        val source = when (pkg) {
            NotifParser.PKG_WECHAT -> "wechat"
            NotifParser.PKG_ALIPAY -> "alipay"
            else -> "boc"
        }

        val bill = NotifParser.parse(pkg, title, text, sbn.postTime)
        if (bill == null) {
            // 有支付字样但解不出金额 → 记"未识别"（附通知原文片段，便于定位新格式）；普通聊天/营销推送静默忽略
            val hinted = listOf("支付", "付款", "收款", "消费", "动账", "退款").any { (title + text).contains(it) }
            if (hinted) Db.log(this, "parse_fail", title + "｜" + text.take(60), null, null, null, source)
            return
        }

        // 同一条通知常被系统重复推送（内容更新/重发）：会话内按键去重，跨重启由 DB 去重兜底
        if (!seenKeys.add(bill.dupKey())) {
            Db.log(this, "dup", title, bill.amount, bill.type, bill.merchant, source)
            return
        }
        if (seenKeys.size > 500) seenKeys.clear()

        Db.insert(this, "pending", bill)
        Db.log(this, "added", title, bill.amount, bill.type, bill.merchant, source)
        Hub.notifyAutoBill(bill)
    }

    companion object {
        private val seenKeys = LinkedHashSet<String>()
    }
}
