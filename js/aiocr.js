/* AI 识别：智谱 GLM-4V-Flash（免费视觉模型）。
   注意：智谱官方接口不允许浏览器直连（无 CORS 头），AI 模式需经自建代理（如 Cloudflare Worker，见 README） */
window.AIOCR = (function () {
  const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4';

  const PROMPT = `你是一个支付账单截图解析助手。请从这张支付截图（微信支付/支付宝/中国银行等App的账单详情或动账通知页）中提取信息，严格只输出一个 JSON 对象，不要输出任何其他文字：
{"type":"expense或income","amount":金额数字(元,不含符号),"time":"YYYY-MM-DD HH:mm:ss","merchant":"商户或对方名称,尽量简短","txId":"交易单号,没有则空字符串","source":"wechat或alipay或boc或other"}
判断规则：金额带负号或为支付/支出/转出→expense；带正号或为收入/退款/转入/收款→income。time 用截图中显示的交易时间，若看不出则用空字符串。`;

  function endpoint(base) {
    return (base || DEFAULT_BASE).replace(/\/+$/, '') + '/chat/completions';
  }

  function extractJson(text) {
    if (!text) throw new Error('AI 未返回内容');
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI 返回格式异常');
    return JSON.parse(s.slice(start, end + 1));
  }

  function parseTime(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  /**
   * 识别截图，返回与 Parser.parse 相同结构的对象
   * @param {string} dataUrl 图片
   * @param {string} apiKey 智谱 API Key
   * @param {string} [apiBase] 接口地址（默认官方；浏览器直连需填自建代理，见 README）
   */
  async function recognize(dataUrl, apiKey, apiBase) {
    if (!apiKey) throw new Error('请先在设置中填写 API Key');
    let res;
    try {
      res = await fetch(endpoint(apiBase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'glm-4v-flash',
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: PROMPT }
            ]
          }]
        })
      });
    } catch (e) {
      throw new Error('网络请求失败（跨域受限或断网）：浏览器无法直连智谱官方接口，请在设置中填写 Cloudflare Worker 代理地址（README 有部署教程），或改用本地识别');
    }
    if (!res.ok) {
      let msg = 'API 错误 ' + res.status;
      try {
        const err = await res.json();
        if (err.error && err.error.message) msg = 'API 错误：' + err.error.message;
      } catch (_) { }
      if (res.status === 401) msg = 'API Key 无效，请检查设置';
      throw new Error(msg);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const j = extractJson(content);

    const amount = Math.round(parseFloat(j.amount) * 100) / 100;
    if (!isFinite(amount) || amount <= 0) throw new Error('AI 未能识别出金额');
    let type = String(j.type || 'expense').toLowerCase();
    if (type !== 'income') type = 'expense';
    const src = ['wechat', 'alipay', 'boc'].includes(j.source) ? j.source : 'other';
    return {
      ok: true,
      source: src,
      type,
      amount,
      time: parseTime(j.time) || Date.now(),
      merchant: String(j.merchant || '').slice(0, 40),
      txId: String(j.txId || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 40)
    };
  }

  /* 用最小请求验证 Key 与代理连通性 */
  async function testKey(apiKey, apiBase) {
    let res;
    try {
      res = await fetch(endpoint(apiBase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'glm-4v-flash',
          max_tokens: 8,
          messages: [{ role: 'user', content: '你好' }]
        })
      });
    } catch (e) {
      return { ok: false, msg: '无法访问接口：智谱官方不允许浏览器直连（跨域限制）。请按 README 部署免费 Cloudflare Worker 代理，并在下方"代理地址"填入 Worker 地址；或改用本地识别' };
    }
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, msg: 'API Key 无效，请重新复制' };
    return { ok: false, msg: '接口返回 ' + res.status };
  }

  return { recognize, testKey };
})();
