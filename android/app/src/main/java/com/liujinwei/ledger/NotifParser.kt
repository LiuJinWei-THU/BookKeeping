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

    /** 支付特征词（中英文，小写匹配）：命中任一才继续解析 */
    private val PAY_HINT = listOf(
        "支付", "付款", "收款", "消费", "到账", "动账", "退款", "收入", "转出", "转入", "扣款", "已收钱", "账单",
        "paid", "payment", "refund", "receiv", "transfer", "transaction", "purchase", "debit", "credit", "spent"
    )

    /** 微信通知的官方名（标题命中，或正文以「微信支付：」等明确官方格式开头） */
    private val WECHAT_BRAND = listOf("微信支付", "微信收款", "收款助手", "财付通", "WeChat Pay")

    /** 聚合服务号正文开头的官方格式：官方名后必须跟冒号/空白（"微信支付了xx"这种好友口吻不算） */
    private val WECHAT_TEXT_ANCHOR =
        Regex("""^\s*(?:【(?:微信支付|微信收款|收款助手|财付通)】|(?:微信支付|微信收款|收款助手|财付通|WeChat\s*Pay)\s*[:\s])""", RegexOption.IGNORE_CASE)

    /** 官方通知里必然出现的资金动作词（中英文），与开头格式双保险 */
    private val WECHAT_STATUS = Regex("""支付|付款|收款|扣款|退款|到账|零钱|paid|payment|refund|receiv|transfer|wallet""", RegexOption.IGNORE_CASE)

    /** 支付宝官方通知特征（标题命中，或正文以官方句式开头，中英文） */
    private val ALIPAY_TITLE = listOf(
        "支付宝", "支付", "付款", "收款", "账单", "花呗", "余额宝", "alipay", "payment", "paid", "received", "refund", "transaction", "transfer"
    )
    private val ALIPAY_BRAND = listOf("支付宝", "alipay")
    private val ALIPAY_TEXT_ANCHOR = Regex(
        """^\s*(支付宝|你有一笔|支付成功|付款成功|收款到账|收款成功|已到账|转账到账|花呗|余额宝|alipay|you\s+(?:paid|received|have|got)|payment\s+|transaction\s+)""",
        RegexOption.IGNORE_CASE
    )

    /**
     * 是否官方付款通知。微信会把服务号消息（含「微信支付」）合入「服务号 / Service Accounts」
     * 聚合通知——此时标题不是官方名、正文以「微信支付：…」开头，因此标题与正文开头都要检查；
     * 正文路径要求官方名+分隔符+资金动作词，避免好友发"微信支付了100元""已支付99元"这类消息被误记。
     */
    private fun isOfficial(source: String, titleNorm: String, textNorm: String): Boolean = when (source) {
        "wechat" ->
            WECHAT_BRAND.any { titleNorm.contains(it, ignoreCase = true) }
                || (WECHAT_TEXT_ANCHOR.containsMatchIn(textNorm) && WECHAT_STATUS.containsMatchIn(textNorm))
        "alipay" ->
            ALIPAY_TITLE.any { titleNorm.contains(it, ignoreCase = true) }
                || ALIPAY_BRAND.any { textNorm.contains(it, ignoreCase = true) }
                || ALIPAY_TEXT_ANCHOR.containsMatchIn(textNorm)
        else -> true
    }

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
        val textNorm = normalize(text ?: "")
        val body = normalize((title ?: "") + "\n" + (text ?: ""))
        if (body.isBlank()) return null

        val source = when {
            pkg == PKG_WECHAT -> "wechat"
            pkg == PKG_ALIPAY -> "alipay"
            else -> "boc"
        }

        if (!isOfficial(source, titleNorm, textNorm)) return null

        val bodyLc = body.lowercase()
        if (PAY_HINT.none { bodyLc.contains(it) }) return null
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

    /* ── 金额：优先带 ¥/$ 或 "元"/货币代码(CNY 68.10)的小数写法；无小数时接受 "3元" 整数写法；
          避免把版本号/日期当金额；同分取先出现的 ── */
    private val AMT_RE = Regex("""(?i)(?:cny|rmb|usd|hkd|eur|gbp|jpy)?\s*[¥￥$]?\s*([0-9][0-9,]{0,9})\s*[.．]\s*([0-9]{1,2})\s*(元)?""")
    private val AMT_INT_RE = Regex("""(?<![.\d])([0-9][0-9,]{0,5})\s*元""")
    private val CUR_CODE = Regex("""(?i)^(?:cny|rmb|usd|hkd|eur|gbp|jpy)""")

    fun findAmount(t: String): Double? {
        var bestV = 0.0
        var bestScore = -1
        for (m in AMT_RE.findAll(t)) {
            val v = (m.groupValues[1].replace(",", "") + "." + m.groupValues[2]).toDoubleOrNull() ?: continue
            if (v < 0.01 || v > 5_000_000) continue
            val score = when {
                m.value.contains("¥") || m.value.contains("￥") || m.value.contains("$") -> 3
                m.groupValues[3] == "元" -> 2
                CUR_CODE.containsMatchIn(m.value) -> 2
                else -> 0
            }
            if (score < 2) continue // 必须带货币符、"元"或货币代码
            if (score > bestScore) { bestScore = score; bestV = v }
        }
        if (bestScore >= 2) return Math.round(bestV * 100) / 100.0
        // 整数金额兜底："收款3元"（未被上游官方/关键词过滤放行的营销文案走不到这里）
        for (m in AMT_INT_RE.findAll(t)) {
            val v = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: continue
            if (v < 0.01 || v > 100_000) continue
            return v
        }
        return null
    }

    /* ── 收支方向：先剥掉标题里的官方名（"支付宝通知""微信支付"自带"支付"字样）再统计；
          同分时收入词优先（微信收款助手文案里常含"消费"） ── */
    private val INC_WORDS = listOf("收款", "已收钱", "到账", "收入", "转入", "退款", "退回", "返还", "红包")
    private val EXP_WORDS = listOf("支付", "付款", "消费", "支出", "转出", "扣款")
    private val INC_WORDS_EN = listOf("received", "refund", "credited", "income")
    private val EXP_WORDS_EN = listOf("paid", "payment", "spent", "purchase", "debited", "charged")

    fun detectType(t: String): String {
        val s = t.replace("支付宝", "")
            .replace("微信支付", "")
            .replace("Alipay", "", ignoreCase = true)
            .replace("WeChat Pay", "", ignoreCase = true)
            .lowercase()
        val inc = INC_WORDS.count { s.contains(it) } + INC_WORDS_EN.count { s.contains(it) }
        val exp = EXP_WORDS.count { s.contains(it) } + EXP_WORDS_EN.count { s.contains(it) }
        val hasIncomeWord = (INC_WORDS + INC_WORDS_EN).any { s.contains(it) }
        return when {
            inc > exp -> "income"
            exp > inc -> "expense"
            hasIncomeWord -> "income"
            else -> "expense"
        }
    }

    /* ── 商户/对方：通知大多不带商户名，尽量从固定句式里提取（中英文） ── */
    private val MERCHANT_RES = listOf(
        Regex("""(?:在|于)([^\s,，。;；:：]{2,20})(?:消费|支付|付款|购物)"""),
        Regex("""(?:付款给|转给|付给|付至)([^\s,，。;；:：]{2,20})"""),
        Regex("""元[（(]([^（）()]{2,24})[）)]"""),
        Regex("""(?:对方账户|对方名称|对方)[:：]\s*([^\s,，。;；]{2,24})"""),
        Regex("""(?:商户|店铺|收款方)(?:名称)?[:：]\s*([^\s,，。;；]{2,24})"""),
        Regex("""(?i)(?:paid|payment)\s+to\s+([A-Za-z][\w&'.·-]*(?:\s+[A-Za-z][\w&'.·-]*){0,3})"""),
        Regex("""(?i)\b(?:at|in|to|from)\s+([A-Z][\w&'.·-]*(?:\s+[A-Za-z][\w&'.·-]*){0,3})\b(?![\d:])""")
    )

    fun findMerchant(t: String): String {
        for (re in MERCHANT_RES) {
            val m = re.find(t) ?: continue
            val v = m.groupValues.getOrNull(1)?.trim() ?: continue
            if (v.length >= 2) return v.take(30)
        }
        return ""
    }

    /* ── 交易单号：通知里偶有（如动账短信带流水号），中英文标签 ── */
    private val TX_LABEL = Regex("""(?i)(?:交易单号|转账单号|交易号|订单号|流水号|transaction\s*id|transaction\s*number|order\s*(?:number|id)|reference\s*(?:no|number)?)\s*[:：]?\s*([0-9]{15,32})""")

    fun findTxId(t: String): String {
        TX_LABEL.find(t)?.groupValues?.get(1)?.let { return it }
        Regex("""\b(420[0-9]{16,26})\b""").find(t)?.groupValues?.get(1)?.let { return it }
        return ""
    }
}
