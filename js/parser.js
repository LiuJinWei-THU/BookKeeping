/* 支付截图 OCR 文本解析器：支持 微信支付 / 支付宝 / 中国银行动账通知，中英文标签兼容 */
window.Parser = (function () {

  /* ── 文本规范化 ── */
  function normalize(raw) {
    let t = raw || '';
    t = t.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); // 全角→半角
    t = t.replace(/[\u3000\u00A0]/g, ' ');
    t = t.replace(/\r/g, '');
    // OCR 数字修复：日期 3 位（235日→23日）、小时 3 位（135:57→13:57）
    t = t.replace(/([0-9OoIl]{3})日/g, (m, d) => {
      const c = cleanDigits(d);
      return (parseInt(c.slice(0, 2), 10) <= 31 ? c.slice(0, 2) : c.slice(1)) + '日';
    });
    t = t.replace(/([0-9OoIl]{3}):([0-9OoIl]{2})/g, (m, h, mi) => cleanDigits(h).slice(0, 2) + ':' + cleanDigits(mi));
    return t;
  }

  /* ── 数字串清洗（仅对已捕获的疑似数字做，不影响正文）── */
  function cleanDigits(s) {
    return (s || '')
      .replace(/[Oo○〇]/g, '0')
      .replace(/[lI|ｌ]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[，、]/g, ',')
      .replace(/\s+/g, '');
  }

  function toAmount(intPart, decPart) {
    const i = cleanDigits(intPart).replace(/[^0-9]/g, '');
    const d = cleanDigits(decPart).replace(/[^0-9]/g, '');
    if (!i || i.length > 9) return null;
    const v = parseFloat(i + '.' + (d || '0'));
    if (!isFinite(v) || v < 0.01 || v > 5000000) return null;
    return Math.round(v * 100) / 100;
  }

  /* ── 来源识别（打分制，兼容中英文界面）── */
  const FEATURES = {
    boc: [
      [2, /动账通知|借记卡动账|交易\s*账号|动账类型/],
      [1, /交易金额|人民币|尾号|转出|转入|活钱宝|我要转账/]
    ],
    wechat: [
      [2, /交易单号|Transaction\s*ID|商户全称|Merchant\s*full|收单机构|Acquirer|WeChat\s*Pay|微信支付|微信红包|420[0-9OolI]{16,26}/],
      [1, /当前状态|Current\s*Status|账单详情|Transaction\s*Details|转账单号|商户单号|支付成功|Payment\s*successful|付款时间|Payment\s*Time/]
    ],
    alipay: [
      [2, /花呗|Huabei|支付宝|Alipay|余额宝|商家订单号|淘宝|Taobao|蚂蚁|收款码|收钱码|交易详情/],
      [1, /订单详情|支付方式|付款方式|Payment\s*[Mm]ethod|创建时间|付款成功|交易成功|付款时间|Payment\s*time|交易号/]
    ]
  };

  function detectSource(t) {
    const scores = {};
    for (const src in FEATURES) {
      scores[src] = 0;
      for (const [w, re] of FEATURES[src]) if (re.test(t)) scores[src] += w;
    }
    let best = null, max = 0;
    for (const src in scores) if (scores[src] > max) { max = scores[src]; best = src; }
    return max >= 2 ? best : 'other';
  }

  /* ── 金额提取 ── */
  // 必须带小数点 + 1~2 位小数，排除时间(冒号)、单号(无小数点)、百分比等干扰
  const AMT_RE = /([+-])?\s*[¥￥]?\s*([0-9OoIl|，,][0-9OoIl|，,]{0,9})\s*[.．]\s*([0-9OolI|]{1,2})(?![0-9.])/g;

  function findAmounts(t) {
    const out = [];
    let m;
    AMT_RE.lastIndex = 0;
    while ((m = AMT_RE.exec(t)) !== null) {
      let intPart = m[2].replace(/[，,]/g, '');
      const v = toAmount(intPart, m[3]);
      if (v !== null) out.push({ sign: m[1] || '', amount: v, index: m.index, text: m[0] });
    }
    return out;
  }

  /* ── 时间提取 ── */
  function parseTimeStr(y, mo, d, h, mi, s) {
    const Y = parseInt(cleanDigits(y), 10);
    const res = [Y, parseInt(cleanDigits(mo), 10), parseInt(cleanDigits(d), 10),
      parseInt(cleanDigits(h), 10), parseInt(cleanDigits(mi), 10), parseInt(cleanDigits(s || '0'), 10)];
    const [yy, mm, dd, hh, mmm, ss] = res;
    if (!(yy >= 2015 && yy <= 2099 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 &&
      hh <= 23 && mmm <= 59 && ss <= 59)) return null;
    const dt = new Date(yy, mm - 1, dd, hh, mmm, ss);
    return isNaN(dt.getTime()) ? null : dt.getTime();
  }

  // 三种格式：2026/10/23 12:58:27 · 2026-10-22 19:45:22 · 2026年10月23日 13:57:06（含 OCR 混淆字符与漏分隔符）
  const D = '[0-9OoIl]';
  const SEP = '[/.' + '\\' + '-]';
  const TIME_RES = [
    new RegExp(`(${D}{4})${SEP}(${D}{1,2})${SEP}(${D}{1,2})\\s+(${D}{1,2}):(${D}{2})(?::(${D}{2}))?`, 'g'),
    new RegExp(`(${D}{4})年(${D}{1,2})月(${D}{1,2})日\\s*(${D}{1,2}):(${D}{2})(?::(${D}{2}))?`, 'g'),
    // 兜底：月日间分隔符被 OCR 吞掉/误读成数字（如 2026/10123 12:58:27），年 + 3~5 位月日串 + 时间锚
    new RegExp(`(${D}{4})${SEP}?(${D}{3,5})\\s+(${D}{1,2}):(${D}{2})(?::(${D}{2}))?`, 'g')
  ];

  // 3~5 位月日数字串拆分：1023→10/23 · 10123→10/23(跳过噪声位) · 123→1/23
  function splitMonthDay(raw) {
    const s = cleanDigits(raw).replace(/[^0-9]/g, '');
    const tries = [];
    if (s.length === 5) { tries.push([s.slice(0, 2), s.slice(3, 5)], [s.slice(0, 2), s.slice(2, 4)]); }
    if (s.length === 4) { tries.push([s.slice(0, 2), s.slice(2, 4)]); }
    if (s.length === 3) { tries.push([s.slice(0, 1), s.slice(1, 3)], [s.slice(0, 2), s.slice(2, 3)]); }
    for (const [mo, dd] of tries) {
      const m = parseInt(mo, 10), d = parseInt(dd, 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return [m, d];
    }
    return null;
  }

  function findTime(t, preferLabelled) {
    // 优先：带标签的时间（付款时间/交易时间/Payment time 等），标签与值允许分行
    const labelRe = /(?:交易时间|付款时间|支付时间|创建时间|Transaction\s*time|Payment\s*[Tt]ime)\s*[：:]?\s*\n?\s*([^\n]{4,32})/g;
    const labelled = [];
    let m;
    while ((m = labelRe.exec(t)) !== null) {
      const ts = tryTimeStr(m[1]);
      if (ts) labelled.push(ts);
    }
    // 全部时间：标准两条正则，再 blob 兜底
    const all = [];
    for (const re of TIME_RES.slice(0, 2)) {
      re.lastIndex = 0;
      while ((m = re.exec(t)) !== null) {
        const ts = parseTimeStr(m[1], m[2], m[3], m[4], m[5], m[6]);
        if (ts) all.push(ts);
      }
    }
    if (!all.length) {
      const re = TIME_RES[2];
      while ((m = re.exec(t)) !== null) {
        const md = splitMonthDay(m[2]);
        if (md) { const ts = parseTimeStr(m[1], String(md[0]), String(md[1]), m[3], m[4], m[5]); if (ts) all.push(ts); }
      }
    }
    all.sort((a, b) => a - b);
    // 未来时间（>1小时后）丢弃，OCR 年份错误常见
    const now = Date.now();
    const valid = all.filter(x => x < now + 3600e3);
    if (labelled.length && valid.includes(labelled[0])) return labelled[0];
    if (preferLabelled && labelled.length && labelled[0] < now + 3600e3) return labelled[0];
    return valid[0] || labelled[0] || null;
  }

  function tryTimeStr(s) {
    for (const re of TIME_RES.slice(0, 2)) {
      const m = re.exec(s);
      re.lastIndex = 0;
      if (m) return parseTimeStr(m[1], m[2], m[3], m[4], m[5], m[6]);
    }
    const re = TIME_RES[2];
    const m = re.exec(s);
    re.lastIndex = 0;
    if (m) {
      const md = splitMonthDay(m[2]);
      if (md) return parseTimeStr(m[1], String(md[0]), String(md[1]), m[3], m[4], m[5]);
    }
    return null;
  }

  /* ── 微信单号 ── */
  function findTxId(t) {
    const m = t.match(/(?:交易单号|转账单号|Transaction\s*ID|Transaction\s*number|交易号|订单号)\s*[：:\s]*([0-9OolI]{15,32})/i);
    if (m) {
      const id = cleanDigits(m[1]).replace(/[^0-9]/g, '');
      if (id.length >= 15) return id;
    }
    const m2 = t.match(/\b(420[0-9OolI]{16,26})\b/);
    if (m2) {
      const id = cleanDigits(m2[1]).replace(/[^0-9]/g, '');
      if (id.length >= 19) return id;
    }
    return '';
  }

  /* ── 商户/对方名 ── */
  function linesOf(t) { return t.split('\n').map(l => l.trim()).filter(Boolean); }

  const NOISE_WORDS = /^(transaction|all|view|current|status|payment|time|method|merchant|order|more|back|detail|transactions|details|wallet|bill|records|related|全部|账单|交易|明细|支付|付款|收款|当前|状态|时间|方式|商户|订单|查看|更多|返回|成功|已收|待付|退款|红包|转账|账目|记录|优惠|积分|会员|卡|尾号|¥|￥|-|\+|\d)/i;

  // 顶部商户名：主金额所在行的上方，找第一行不像标签/状态的短文本
  function topMerchant(lines, amtLineIdx) {
    for (let i = amtLineIdx - 1; i >= 0 && i >= amtLineIdx - 5; i--) {
      const l = lines[i].replace(/[|_•·]+/g, '').trim();
      if (l.length < 2 || l.length > 28) continue;
      if (/^\d{1,2}:\d{2}/.test(l)) continue;                 // 状态栏时间
      if (/[%KB\/5G]|电池|信号|蓝牙|Wi-?Fi/i.test(l)) continue; // 状态栏
      if (NOISE_WORDS.test(l)) continue;
      if (/[0-9OoIl|]\s*[.．]\s*[0-9OolI]{2}/.test(l)) continue; // 别的金额行
      return l.replace(/[+~_·#]+$/, '').replace(/\*{2,}$/, '*'); // 尾部杂符（脱敏名保留一个*）
    }
    return '';
  }

  function fieldAfter(t, labelRe) {
    const m = t.match(labelRe);
    if (!m) return '';
    let v = (m[1] || '').trim();
    v = v.replace(/^[-—_:：\s]+/, '');
    return v.split('\n')[0].trim();
  }

  // 中行金额串：去千分位逗号后解析
  function bocAmount(s) {
    const cs = cleanDigits(s).replace(/,/g, '');
    const parts = cs.match(/^([0-9]+)(?:[.]([0-9]{1,2}))?/);
    return parts ? toAmount(parts[1], parts[2] || '') : null;
  }

  function cleanBocMerchant(v) {
    let s = v.trim();
    s = s.replace(/[A-Z]{0,3}\d{2,4}\*{2,}[\dA-Z*]{2,}$/g, ''); // 完整单号形态 Z202****018N
    // OCR 截断的字母数字尾巴（如 专卖店Z2），仅当去掉后剩余中文主体足够长
    const tail = s.match(/[A-Za-z][\dA-Za-z*]{1,8}$/);
    if (tail) {
      const rest = s.slice(0, s.length - tail[0].length).replace(/[-—\s]+$/, '');
      if (/[\u4e00-\u9fa5]/.test(rest) && rest.replace(/[^\u4e00-\u9fa5]/g, '').length >= 3) s = rest;
    }
    s = s.replace(/[-—\s]+$/, '').trim();
    const ch = s.match(/^(抖音支付|微信支付|财付通|支付宝|网易支付|壹钱包|银联|云闪付)[-—](.+)$/);
    if (ch) s = ch[2].trim();
    return s.slice(0, 30);
  }

  /* ── 主入口 ── */
  function parse(rawText) {
    const t = normalize(rawText);
    if (!t || t.length < 10) return null;

    const source = detectSource(t);
    const amounts = findAmounts(t);
    if (!amounts.length) return null;

    let type = null, amount = null, txId = '', merchant = '', time = null;
    let merchantLineIdx = -1;

    if (source === 'boc') {
      // 【支出】68.10 / 【收入】xxx / 交易金额：人民币 68.10
      const m1 = t.match(/【\s*(支出|收入|转入|转出|收款|付款)\s*】\s*[¥￥]?\s*([0-9OoIl|，,.]{2,15})/);
      let dirWord = '';
      if (m1) { dirWord = m1[1]; amount = bocAmount(m1[2]); }
      if (amount === null) {
        const m2 = t.match(/交易金额\s*[：:\s]*人民币\s*([0-9OoIl|，,.]{2,15})/);
        if (m2) amount = bocAmount(m2[1]);
      }
      if (amount === null) amount = amounts[0].amount;
      const incomeWord = /收入|转入|收款/.test(dirWord);
      const expenseWord = /支出|转出|付款/.test(dirWord);
      type = incomeWord ? 'income' : 'expense';
      if (!dirWord && amounts[0].sign === '+') type = 'income';
      merchant = cleanBocMerchant(fieldAfter(t, /对方账户?\s*[：:]?\s*\n?\s*([^\n]+)/));
      time = findTime(t, true);
      return pack({ source, type, amount, time, merchant, txId: '', raw: t });
    }

    // 微信 / 支付宝 / 未知：顶部大金额模式
    const first = amounts[0];
    amount = first.amount;
    type = first.sign === '+' ? 'income' : 'expense';
    // 收款截图特征（支付宝收钱码/微信收款）
    if (/已收钱|收款成功|已收款|Received|已存入零钱/.test(t)) type = 'income';

    // 定位主金额所在行，向上找顶部商户名
    const lines = linesOf(t);
    const amtLineIdx = lines.findIndex(l => l.includes(first.text.replace(/\s+/g, '')) || /[0-9OoIl|]\s*[.．]\s*[0-9OolI]{1,2}/.test(l) && Math.abs(parseFloat(l.replace(/[^0-9.]/g, '')) - amount) < 0.005);
    merchant = topMerchant(lines, amtLineIdx >= 0 ? amtLineIdx : 1);

    // 字段兜底
    if (!merchant) {
      merchant = fieldAfter(t, /(?:商户全称|Merchant\s*(?:full\s*name)?|对方(?:账户|名称|昵称))\s*[：:\s]*([^\n]+)/i) || merchant;
    }
    txId = findTxId(t);
    time = findTime(t, true);

    return pack({ source, type, amount, time, merchant, txId, raw: t });
  }

  function pack(o) {
    // source 未识别但字段齐全时按 'other' 保留
    if (o.amount === null || o.amount === undefined) return null;
    if (!o.time) o.time = Date.now();
    if (!o.merchant) o.merchant = '';
    o.ok = true;
    return o;
  }

  return { parse, detectSource, _test: { normalize, findAmounts, findTime, cleanDigits } };
})();
