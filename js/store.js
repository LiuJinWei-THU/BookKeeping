/* 数据层：localStorage 持久化、去重、导入导出；安卓 App 内自动切换为 App 私有 SQLite（JS 桥） */
window.Store = (function () {
  const KEY = 'ledger_records_v1';
  // 安卓 App 的 WebView 在页面加载前注入 window.AndroidStore（addJavascriptInterface 同步桥）。
  // 存在时数据读写委托给 App 的 SQLite；App 侧另有 pending 表暂存后台通知捕获的账单，
  // AndroidStore.all() 每次会把 pending 合并进来，因此后台记账不会因页面缓存而丢失。
  const BRIDGE = (typeof window !== 'undefined' && window.AndroidStore) ? window.AndroidStore : null;

  function load() {
    if (BRIDGE) {
      try {
        const arr = JSON.parse(BRIDGE.all() || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch (e) { console.error('读取 App 数据库失败', e); return []; }
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { console.error('读取数据失败', e); return []; }
  }

  function save(records) {
    if (BRIDGE) {
      try { return BRIDGE.save(JSON.stringify(records || [])) === true; }
      catch (e) { console.error('写入 App 数据库失败', e); return false; }
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
      return true;
    } catch (e) {
      alert('保存失败：浏览器存储空间不足，请导出备份后清理部分数据。');
      return false;
    }
  }

  let cache = null;
  function all() {
    if (!cache) cache = load();
    return cache;
  }
  function flush() { save(cache); }

  function uuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // 去重键：交易单号优先，否则 金额+分钟级时间+商户
  function dupKey(r) {
    if (r.txId && String(r.txId).length >= 15) return 'tx:' + r.txId;
    return 'h:' + Math.round(Number(r.amount) * 100) + '|' + Math.floor((r.time || 0) / 60000) + '|' + (r.merchant || '');
  }

  function add(rec) {
    const r = Object.assign({ id: uuid(), note: '', txId: '', createdAt: Date.now() }, rec);
    const key = dupKey(r);
    const dup = all().find(x => dupKey(x) === key);
    if (dup) return { ok: false, dup: true, record: dup };
    cache.push(r);
    flush();
    return { ok: true, record: r };
  }

  function update(id, patch) {
    const r = all().find(x => x.id === id);
    if (!r) return false;
    Object.assign(r, patch);
    flush();
    return true;
  }

  function remove(id) {
    cache = all().filter(x => x.id !== id);
    flush();
  }

  function checkDup(rec) {
    const key = dupKey(rec);
    return all().find(x => dupKey(x) === key) || null;
  }

  // ── 备份 ──
  function exportJSON() {
    const records = all().slice().sort((a, b) => a.time - b.time);
    return {
      app: 'smart-ledger',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      records
    };
  }

  // 导入：merge=按去重键合并；overwrite=整体替换。返回统计
  function importJSON(data, mode) {
    let incoming = [];
    if (Array.isArray(data)) incoming = data;
    else if (data && Array.isArray(data.records)) incoming = data.records;
    else return { ok: false, msg: '文件格式不正确' };

    const valid = incoming.filter(r =>
      r && (r.type === 'expense' || r.type === 'income') &&
      isFinite(Number(r.amount)) && Number(r.amount) > 0 && Number(r.time) > 0
    ).map(r => ({
      id: r.id || uuid(),
      type: r.type,
      amount: Math.round(Number(r.amount) * 100) / 100,
      time: Number(r.time),
      merchant: String(r.merchant || '').slice(0, 60),
      category: r.category || '其他',
      source: ['wechat', 'alipay', 'boc', 'manual'].includes(r.source) ? r.source : 'manual',
      txId: r.txId ? String(r.txId).slice(0, 40) : '',
      note: r.note ? String(r.note).slice(0, 200) : '',
      createdAt: r.createdAt || Date.now()
    }));

    if (!valid.length) return { ok: false, msg: '文件中没有有效记录' };
    const skipped = incoming.length - valid.length;

    if (mode === 'overwrite') {
      cache = valid;
      flush();
      return { ok: true, added: valid.length, merged: 0, skipped };
    }

    const existing = new Set(all().map(dupKey));
    let added = 0;
    for (const r of valid) {
      const k = dupKey(r);
      if (existing.has(k)) continue;
      existing.add(k);
      cache.push(r);
      added++;
    }
    flush();
    return { ok: true, added, skipped };
  }

  function clearAll() { cache = []; flush(); }

  return { all, add, update, remove, checkDup, dupKey, exportJSON, importJSON, clearAll, _reload: () => { cache = null; } };
})();
