package com.liujinwei.ledger

/**
 * 付款通知文本解析器（纯 JVM，可单测）。
 * 规则与网页版 js/parser.js 同源，并针对通知栏短文本补充格式（¥12.50 / 3.00元 / 动账短信式长文本）。
 */
object NotifParser {

    const val PKG_WECHAT = "com.tencent.mm"
    const val PKG_ALIPAY = "com.eg.android.AlipayGphone"

    /** 银行动账 App 包名（目前支持中国银行）；加新银行时在此追加 */
    val BANK_PKGS = listOf("com.chinamworld.main", "com.chinamworld.bocmbci")

    private val PAY_HINT = listOf(
        "支付", "付款", "收款", "消费", "到账", "动账", "退款", "收入", "转出", "转入", "扣款", "已收钱", "账单"
    )

    /** 微信通知必须来自官方服务号（标题含以下字样），避免把好友聊天里的"我支付了xx"记成账单 */
    private val WECHAT_OFFICIAL = listOf("微信支付", "微信收款", "收款助手", "财付通", "WeChat Pay")

    /** 支付宝官方通知标题特征 */
    private val ALIPAY_OFFICIAL = listOf("支付宝", "支付", "收款", "账单", "花呗", "余额宝", "Alipay")

    fun isWatched(pkg: String?): Boolean {
        if (pkg.isNullOrEmpty()) return false
        if (pkg == PKG_WECHAT || pkg == PKG_ALIPAY) return true
        return BANK_PKGS.any { pkg == it || pkg.startsWith("$it.") }
    }

    /**
     * 解析一条通知。返回 null 表示不是付款通知（或解不出金额，调用方可结合支付关键词记"未识别"日志）。
     * @param postTime 通知的系统时间戳（sbn.postTime），账单时间优先取它
     */
    fun parse(pkg: String?, title: String?, text: String?, postTime: Long, now: Long = System.currentTimeMillis()): Bill? {
        if (!isWatched(pkg)) return null
        val titleNorm = normalize(title ?: "")
        val body = normalize((title ?: "") + "\n" + (text ?: ""))
        if (body.isBlank()) return null

        val source = when {
            pkg == PKG_WECHAT -> "wechat"
            pkg == PKG_ALIPAY -> "alipay"
            else -> "boc"
        }

        // 只认官方服务号/官方通知，过滤聊天消息与营销推送
        when (source) {
            "wechat" -> if (WECHAT_OFFICIAL.none { titleNorm.contains(it, ignoreCase = true) }) return null
            "alipay" -> if (ALIPAY_OFFICIAL.none { titleNorm.contains(it, ignoreCase = true) }) return null
        }

        if (PAY_HINT.none { body.contains(it) }) return null
        val amount = findAmount(body) ?: return null
        val type = detectType(body)
        val merchant = findMerchant(body)
        return Bill(
            id = Bill.genId(),
            type = type,
            amount = amount,
            time = if (postTime > 0) postTime else now,
            merchant = merchant,
            category = Cats.auto(merchant, type),
            source = source,
            txId = findTxId(body),
            note = "",
            createdAt = now
        )
    }

    /** 全角→半角、统一空白；￥(U+FFE5) 不在全角区段内，单独替换 */
    fun normalize(raw: String): String = buildString {
        for (c in raw) {
            append(
                when {
                    c.code in 0xFF01..0xFF5E -> (c.code - 0xFEE0).toChar()
                    c == '　' || c == '\u00A0' -> ' '
                    else -> c
                }
            )
        }
    }.replace("￥", "¥")

    /* ── 金额：要求带 ¥ 或 "元"，避免把版本号/日期当金额；同分取先出现的 ── */
    private val AMT_RE = Regex("""[¥￥]?\s*([0-9][0-9,]{0,9})\s*[.．]\s*([0-9]{1,2})\s*(元)?""")

    fun findAmount(t: String): Double? {
        var bestV = 0.0
        var bestScore = -1
        for (m in AMT_RE.findAll(t)) {
            val v = (m.groupValues[1].replace(",", "") + "." + m.groupValues[2]).toDoubleOrNull() ?: continue
            if (v < 0.01 || v > 5_000_000) continue
            val score = (if (m.value.contains("¥")) 3 else 0) + (if (m.groupValues[3] == "元") 2 else 0)
            if (score < 2) continue // 必须带货币符或"元"
            if (score > bestScore) { bestScore = score; bestV = v }
        }
        if (bestScore < 0) return null
        return Math.round(bestV * 100) / 100.0
    }

    /* ── 收支方向：命中计数，同分时收款/退款字样优先（微信收款助手文案里常含"消费"） ── */
    fun detectType(t: String): String {
        val inc = listOf("收款", "已收钱", "到账", "收入", "转入", "退款", "退回", "返还", "红包").count { t.contains(it) }
        val exp = listOf("支付", "付款", "消费", "支出", "转出", "扣款").count { t.contains(it) }
        return when {
            inc > exp -> "income"
            exp > inc -> "expense"
            listOf("收款", "已收钱", "到账", "退款", "红包").any { t.contains(it) } -> "income"
            else -> "expense"
        }
    }

    /* ── 商户/对方：通知大多不带商户名，尽量从固定句式里提取 ── */
    private val MERCHANT_RES = listOf(
        Regex("""(?:在|于)([^\s,，。;；:：]{2,20})(?:消费|支付|付款|购物)"""),
        Regex("""(?:付款给|转给|付给|付至)([^\s,，。;；:：]{2,20})"""),
        Regex("""元[（(]([^（）()]{2,24})[）)]"""),
        Regex("""(?:对方账户|对方名称|对方)[:：]\s*([^\s,，。;；]{2,24})"""),
        Regex("""(?:商户|店铺|收款方)(?:名称)?[:：]\s*([^\s,，。;；]{2,24})""")
    )

    fun findMerchant(t: String): String {
        for (re in MERCHANT_RES) {
            val m = re.find(t) ?: continue
            val v = m.groupValues.getOrNull(1) ?: continue
            if (v.isNotEmpty()) return v.take(30)
        }
        return ""
    }

    /* ── 交易单号：通知里偶有（如动账短信带流水号） ── */
    fun findTxId(t: String): String {
        Regex("""(?:交易单号|转账单号|交易号|订单号|流水号)\s*[:：]?\s*([0-9]{15,32})""")
            .find(t)?.groupValues?.get(1)?.let { return it }
        Regex("""\b(420[0-9]{16,26})\b""").find(t)?.groupValues?.get(1)?.let { return it }
        return ""
    }
}
