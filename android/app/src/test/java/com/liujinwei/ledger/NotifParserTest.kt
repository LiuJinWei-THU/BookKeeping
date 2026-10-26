package com.liujinwei.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 通知解析器单测：样例取自 微信支付/微信收款助手/支付宝/中国银行 的真实通知文案 */
class NotifParserTest {

    private val t0 = 1_700_000_000_000L

    private fun wechat(title: String, text: String) = NotifParser.parse(NotifParser.PKG_WECHAT, title, text, t0)

    private fun alipay(title: String = "支付宝通知", text: String) = NotifParser.parse(NotifParser.PKG_ALIPAY, title, text, t0)

    @Test
    fun `微信支付_带货币符`() {
        val b = wechat("微信支付", "已支付¥12.50")
        assertNotNull(b)
        assertEquals("expense", b!!.type)
        assertEquals(12.50, b.amount, 1e-9)
        assertEquals("wechat", b.source)
        assertEquals(t0, b.time)
    }

    @Test
    fun `微信支付_全角符号与金额标签`() {
        val b = wechat("微信支付", "当前状态：支付成功，付款金额￥128.00。")
        assertNotNull(b)
        assertEquals(128.00, b!!.amount, 1e-9)
        assertEquals("expense", b.type)
    }

    @Test
    fun `微信收款助手_收款`() {
        val b = wechat("微信收款助手", "收款3.00元，朋友到店铺消费。")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(3.00, b.amount, 1e-9)
    }

    @Test
    fun `微信退款`() {
        val b = wechat("微信支付", "你收到一笔退款45.00元")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(45.00, b.amount, 1e-9)
    }

    @Test
    fun `微信红包收款`() {
        val b = wechat("微信支付", "你已收款 0.01 元，已存入零钱")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(0.01, b.amount, 1e-9)
    }

    @Test
    fun `支付宝_消费`() {
        val b = alipay(text = "你有一笔12.50元的消费")
        assertNotNull(b)
        assertEquals("expense", b!!.type)
        assertEquals(12.50, b.amount, 1e-9)
        assertEquals("alipay", b.source)
    }

    @Test
    fun `支付宝_收入到余额`() {
        val b = alipay(text = "你有一笔58.00元的收入，已存入余额")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(58.00, b.amount, 1e-9)
    }

    @Test
    fun `支付宝_括号内商户名`() {
        val b = alipay(text = "支付成功：45.80元（美团平台-XX餐厅）")
        assertNotNull(b)
        assertEquals("expense", b!!.type)
        assertEquals(45.80, b.amount, 1e-9)
        assertTrue("商户名应包含美团，实得：${b.merchant}", b.merchant.contains("美团"))
        assertEquals("餐饮", b.category)
    }

    @Test
    fun `中国银行_动账通知`() {
        val pkg = NotifParser.BANK_PKGS.first()
        val b = NotifParser.parse(
            pkg, "中国银行",
            "您尾号1234的账户于10月26日14:32发生动账，支出68.10元，余额1000.00元，对方：美团外卖。",
            t0
        )
        assertNotNull(b)
        assertEquals("expense", b!!.type)
        assertEquals(68.10, b.amount, 1e-9)
        assertEquals("boc", b.source)
        assertTrue(b.merchant.contains("美团外卖"))
    }

    @Test
    fun `好友聊天不记录`() {
        assertNull(wechat("张三", "今晚一起吃饭吗？"))
    }

    @Test
    fun `聊天中提到支付也不记录`() {
        // 只有官方服务号（标题为微信支付等）才记账，好友消息即使提到"微信支付"也忽略
        assertNull(wechat("李四", "我刚才微信支付了100.00元给你，记得查收"))
    }

    @Test
    fun `服务号聚合通知_ServiceAccounts标题_官方名在正文`() {
        // 真机反馈：微信把服务号消息合入「Service Accounts」聚合通知，标题不含官方名
        val b = wechat("Service Accounts", "微信支付：已支付¥12.50")
        assertNotNull(b)
        assertEquals("expense", b!!.type)
        assertEquals(12.50, b.amount, 1e-9)
        assertEquals("wechat", b.source)
    }

    @Test
    fun `服务号聚合通知_退款`() {
        val b = wechat("Service Accounts", "微信支付：你收到一笔退款45.00元")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(45.00, b.amount, 1e-9)
    }

    @Test
    fun `服务号聚合通知_整数金额`() {
        val b = wechat("Service Accounts", "微信支付：收款3元")
        assertNotNull(b)
        assertEquals("income", b!!.type)
        assertEquals(3.0, b.amount, 1e-9)
    }

    @Test
    fun `服务号聚合通知_无金额不记录`() {
        assertNull(wechat("Service Accounts", "微信支付：您有一条新的服务通知，点击查看"))
    }

    @Test
    fun `好友模仿官方口吻仍被过滤`() {
        assertNull(wechat("李四", "微信支付了100.00元给你，查收"))
        assertNull(wechat("王五", "已支付99.90元给我，谢谢"))
    }

    @Test
    fun `官方通知无金额不记录`() {
        assertNull(wechat("微信支付", "点击查看账单详情"))
    }

    @Test
    fun `非监听App忽略`() {
        assertNull(NotifParser.parse("com.android.systemui", "支付宝", "支付10.00元", t0))
        assertNull(NotifParser.parse(null, "微信支付", "支付10.00元", t0))
    }

    @Test
    fun `版本号不被当成金额`() {
        val b = alipay(title = "支付宝", text = "账单提醒：打开最新版 v8.0.75 查看详情")
        assertNull(b)
    }

    @Test
    fun `去重键_交易单号优先`() {
        val a = Bill("id1", "expense", 12.5, 1000L, "", "餐饮", "wechat", "4200001234567890123", "", 1L)
        val b = Bill("id2", "expense", 12.5, 2000L, "", "餐饮", "wechat", "4200001234567890123", "", 2L)
        assertEquals(a.dupKey(), b.dupKey())
    }

    @Test
    fun `去重键_分钟级时间区分`() {
        val c = Bill("id3", "expense", 12.5, 60_000L, "美团", "餐饮", "wechat", "", "", 3L)
        val d = Bill("id4", "expense", 12.5, 120_000L, "美团", "餐饮", "wechat", "", "", 4L)
        assertNotEquals(c.dupKey(), d.dupKey())
    }

    @Test
    fun `JSON往返与网页schema一致`() {
        val b = Bill("id1", "income", 3.0, 1_698_000_000_000L, "微信红包", "红包", "wechat", "", "备注", 1L)
        assertEquals(b, Bill.fromJson(b.toJson()))
        // 非法记录被拒绝
        assertNull(Bill.fromJson(org.json.JSONObject().put("type", "expense").put("amount", -5).put("time", 1L)))
        assertNull(Bill.fromJson(org.json.JSONObject().put("type", "bad").put("amount", 5).put("time", 1L)))
    }

    @Test
    fun `分类自动匹配`() {
        assertEquals("餐饮", Cats.auto("肯德基", "expense"))
        assertEquals("交通", Cats.auto("滴滴出行", "expense"))
        assertEquals("退款", Cats.auto("淘宝退款", "income"))
        assertEquals("其他", Cats.auto("", "expense"))
        assertEquals("其他收入", Cats.auto("", "income"))
    }
}
