/* 主逻辑：路由、识别队列、记录弹窗、明细、设置 */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ── 设置 ── */
  const SET_KEY = 'ledger_settings_v1';
  let settings = { mode: 'local', apiKey: '', apiBase: '' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (_) { }
  function saveSettings() { localStorage.setItem(SET_KEY, JSON.stringify(settings)); }

  /* ── 状态 ── */
  const state = {
    view: 'record',
    listMonth: new Date(),
    filter: 'all',
    statsDim: 'day',
    formType: 'expense',
    formCat: '',
    formTxId: '',
    editingId: null,
    modalCtx: null,      // manual | edit | recognize
    pendingThumb: null
  };
  let modalResolve = null;

  /* ── 工具 ── */
  const p2 = n => (n < 10 ? '0' : '') + n;
  const money = v => {
    v = Math.round(v * 100) / 100;
    return v >= 10000 ? '¥' + (v / 10000).toFixed(2) + '万' : '¥' + v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  };
  const fullMoney = v => '¥' + (Math.round(v * 100) / 100).toFixed(2);
  const WEEKS = ['日', '一', '二', '三', '四', '五', '六'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dstr = t => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const tstr = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 2400);
  }

  /* ── 通用确认弹窗：返回 Promise<value> ── */
  let cfResolve = null;
  function confirmDialog(title, text, buttons) {
    return new Promise(resolve => {
      cfResolve = resolve;
      $('#cf-title').textContent = title;
      $('#cf-text').innerHTML = text;
      const box = $('#modal-confirm');
      const acts = box.querySelector('.modal-actions');
      acts.innerHTML = '';
      (buttons || [{ label: '取消', value: null, kind: 'light' }, { label: '确定', value: true, kind: 'primary' }]).forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-' + (b.kind || 'light');
        btn.textContent = b.label;
        btn.style.order = 2;
        if (b.kind === 'danger') btn.style.order = 0;
        btn.onclick = () => { box.classList.add('hidden'); resolve(b.value); };
        acts.appendChild(btn);
      });
      box.classList.remove('hidden');
    });
  }
  $('#cf-cancel').onclick = null; // 按钮动态生成，无需默认

  /* ═══════════ 路由 ═══════════ */
  function goto(view) {
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    window.scrollTo(0, 0);
    if (view === 'list') renderList();
    if (view === 'stats') { Charts.render(Store.all(), state.statsDim); }
    if (view === 'record') renderRecordPage();
    if (view === 'settings') renderSettings();
  }
  $$('.tab').forEach(t => t.onclick = () => goto(t.dataset.view));
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) goto(g.dataset.goto);
  });

  /* ═══════════ 记录弹窗 ═══════════ */
  function renderCatChips() {
    const list = state.formType === 'income' ? Cats.INCOME : Cats.EXPENSE;
    if (!state.formCat || !list.some(c => c.name === state.formCat)) state.formCat = list[list.length - 1].name;
    $('#rm-cats').innerHTML = list.map(c =>
      `<button class="cat-chip${c.name === state.formCat ? ' active' : ''}" data-cat="${esc(c.name)}">${c.icon} ${esc(c.name)}</button>`).join('');
  }
  $('#rm-cats').addEventListener('click', e => {
    const b = e.target.closest('.cat-chip');
    if (!b) return;
    state.formCat = b.dataset.cat;
    $$('#rm-cats .cat-chip').forEach(c => c.classList.toggle('active', c === b));
  });
  $('#rm-type').addEventListener('click', e => {
    const b = e.target.closest('.tt');
    if (!b) return;
    state.formType = b.dataset.t;
    $$('#rm-type .tt').forEach(x => x.classList.toggle('active', x === b));
    renderCatChips();
  });

  function fillForm(rec, defaults) {
    state.formType = rec.type || 'expense';
    state.formCat = rec.category || '';
    state.formTxId = rec.txId || '';
    $$('#rm-type .tt').forEach(x => x.classList.toggle('active', x.dataset.t === state.formType));
    renderCatChips();
    $('#rm-amount').value = rec.amount != null ? rec.amount : '';
    $('#rm-merchant').value = rec.merchant || '';
    const t = rec.time || Date.now();
    $('#rm-date').value = dstr(t);
    $('#rm-time').value = tstr(t);
    $('#rm-source').value = rec.source || 'manual';
    $('#rm-note').value = rec.note || '';

    const dup = rec._dup;
    const dw = $('#rm-dupwarn');
    if (dup) {
      dw.classList.remove('hidden');
      dw.textContent = `⚠️ 疑似重复：库中已有 ${new Date(dup.time).getMonth() + 1}月${new Date(dup.time).getDate()}日 ${tstr(dup.time)} 「${dup.merchant || '未命名'}」${fullMoney(dup.amount)}，请注意甄别`;
    } else dw.classList.add('hidden');

    const thumb = state.pendingThumb;
    $('#rm-thumb').classList.toggle('hidden', !thumb);
    if (thumb) $('#rm-thumb-img').src = thumb;

    $('#rm-delete').classList.toggle('hidden', state.modalCtx !== 'edit');
    $('#rm-skip').textContent = state.modalCtx === 'recognize' ? '跳过' : '取消';
    $('#rm-queue').classList.toggle('hidden', !rec._queuePos);
    if (rec._queuePos) $('#rm-queue').textContent = '批量识别 ' + rec._queuePos;
    $('#rm-title').textContent = rec._title || '记一笔';
    if (defaults) $('#rm-amount').focus();
  }

  function openModal(ctx, rec) {
    state.modalCtx = ctx;
    $('#modal-record').classList.remove('hidden');
    fillForm(rec || {});
  }
  function closeModal() {
    $('#modal-record').classList.add('hidden');
    state.pendingThumb = null;
  }
  function finishModal(action, savedRec) {
    closeModal();
    if (modalResolve) { const r = modalResolve; modalResolve = null; r({ action, savedRec }); }
  }
  $('#rm-close').onclick = () => finishModal('cancel');
  $('#rm-skip').onclick = () => finishModal('skip');
  $('#rm-delete').onclick = async () => {
    const yes = await confirmDialog('删除记录', '确定删除这条记录吗？删除后无法恢复。', [
      { label: '取消', value: false, kind: 'light' }, { label: '删除', value: true, kind: 'danger' }]);
    if (yes && state.editingId) {
      Store.remove(state.editingId);
      toast('已删除');
      finishModal('delete');
      refreshAll();
    }
  };
  $('#rm-save').onclick = () => {
    const amount = parseFloat($('#rm-amount').value);
    if (!(amount > 0)) { toast('请输入金额'); return; }
    const dv = $('#rm-date').value, tv = $('#rm-time').value || '00:00';
    const time = new Date(dv + 'T' + tv).getTime();
    if (!dv || isNaN(time)) { toast('请选择日期和时间'); return; }
    const rec = {
      type: state.formType,
      amount: Math.round(amount * 100) / 100,
      time,
      merchant: $('#rm-merchant').value.trim().slice(0, 40),
      category: state.formCat,
      source: $('#rm-source').value,
      note: $('#rm-note').value.trim().slice(0, 100),
      txId: state.formTxId
    };
    if (state.modalCtx === 'edit' && state.editingId) {
      Store.update(state.editingId, rec);
      toast('已保存修改');
      finishModal('save', rec);
    } else {
      const res = Store.add(rec, true); // 识别流程已在弹窗中提示过重复，这里强制保存
      if (res.ok) { toast('已记入 ✓'); finishModal('save', rec); }
      else { toast('保存失败'); }
    }
    refreshAll();
  };

  /* ═══════════ 记账页 ═══════════ */
  function monthRange(now) {
    now = now || new Date();
    return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()];
  }

  function renderRecordPage() {
    const d = new Date();
    $('#today-line').textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKS[d.getDay()]} · 记一笔，更懂自己的钱`;
    const [s, e] = monthRange();
    const recs = Store.all().filter(r => r.time >= s && r.time < e);
    const exp = recs.filter(r => r.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const inc = recs.filter(r => r.type === 'income').reduce((a, b) => a + b.amount, 0);
    $('#mm-expense').textContent = money(exp);
    $('#mm-income').textContent = money(inc);
    $('#mm-balance').textContent = money(inc - exp);

    const recent = Store.all().slice().sort((a, b) => b.time - a.time).slice(0, 3);
    $('#recent-list').innerHTML = recent.length ? recent.map(r => recRowHTML(r)).join('')
      : `<div class="empty" style="padding:26px 0"><div class="empty-icon">📝</div><p>还没有记录，从上传一张支付截图开始吧</p></div>`;
  }

  function recRowHTML(r) {
    const cat = Cats.find(r.type, r.category);
    const srcName = { wechat: '微信', alipay: '支付宝', boc: '中行', manual: '手动' }[r.source] || '';
    return `<button class="rec-item" data-id="${r.id}">
      <span class="rec-icon">${cat.icon}</span>
      <span class="rec-mid">
        <span class="rec-merchant">${esc(r.merchant) || cat.name}</span>
        <span class="rec-meta"><span class="rec-src">${srcName}</span><span>${new Date(r.time).getMonth() + 1}月${new Date(r.time).getDate()}日 ${tstr(r.time)}</span></span>
      </span>
      <span class="rec-amt ${r.type}">${fullMoney(r.amount)}</span>
    </button>`;
  }

  $('#upload-card').onclick = () => $('#file-input').click();
  $('#btn-camera').onclick = () => $('#camera-input').click();
  $('#btn-manual').onclick = () => {
    state.editingId = null;
    openModal('manual', { _title: '手动记一笔', time: Date.now(), source: 'manual' });
  };

  /* ── 识别流程 ── */
  $('#file-input').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
  $('#camera-input').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('读取图片失败'));
      fr.readAsDataURL(file);
    });
  }

  // 统一压缩到最长边 1600（保持清晰度，控制体积）
  async function compress(dataUrl) {
    const img = await OCR.loadImage(dataUrl);
    const max = 1600;
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const scale = Math.min(1, max / Math.max(w0, h0));
    if (scale === 1 && dataUrl.length < 3.5e6) return dataUrl;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w0 * scale); cv.height = Math.round(h0 * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.92);
  }

  let ocrBusy = false;
  async function handleFiles(files) {
    const imgs = [...files].filter(f => f.type && f.type.startsWith('image/'));
    if (!imgs.length || ocrBusy) return;
    ocrBusy = true;
    const badge = $('#upload-badge');
    badge.textContent = settings.mode === 'ai' ? 'AI 识别中…' : '本地识别中…';

    for (let i = 0; i < imgs.length; i++) {
      try {
        const raw = await fileToDataUrl(imgs[i]);
        const dataUrl = await compress(raw);
        state.pendingThumb = OCR.thumbDataUrl(await OCR.loadImage(dataUrl), 300);
        showOcr(i + 1, imgs.length);

        let result = null, err = null;
        try {
          if (settings.mode === 'ai') {
            setProgress('AI 识别中，请稍候…', 0.5);
            result = await AIOCR.recognize(dataUrl, settings.apiKey, settings.apiBase);
            result.category = Cats.auto(result.merchant, result.type);
          } else {
            const text = await OCR.recognize(dataUrl, (label, r) => setProgress(label, r));
            result = Parser.parse(text);
            if (result) result.category = Cats.auto(result.merchant, result.type);
          }
        } catch (e) { err = e; }

        hideOcr();
        if (!result) {
          toast(err ? ('识别失败：' + err.message) : '未能从截图中识别出账单信息，请手动填写', 3200);
          state.editingId = null;
          openModal('recognize', { _title: '识别失败 · 请手动填写', _queuePos: imgs.length > 1 ? `第 ${i + 1}/${imgs.length} 张` : '', time: Date.now(), source: 'manual' });
          await waitModal();
          continue;
        }

        const dup = Store.checkDup(result);
        state.editingId = null;
        openModal('recognize', Object.assign({}, result, {
          _title: '识别结果 · 请确认',
          _queuePos: imgs.length > 1 ? `第 ${i + 1}/${imgs.length} 张` : '',
          _dup: dup || null
        }));
        const act = await waitModal();
        if (act.action === 'save' && act.savedRec && dup && !act.forceIntent) {
          // 已强制保存（弹窗中已提示重复），无需额外处理
        }
      } catch (e) {
        hideOcr();
        toast('处理图片出错：' + (e.message || e), 3000);
      }
    }
    hideOcr();
    ocrBusy = false;
    badge.textContent = settings.mode === 'ai' ? 'AI 识别' : '本地识别 · 免费离线';
    refreshAll();
    if (imgs.length > 1) toast('本批截图处理完毕');
  }
  function waitModal() { return new Promise(r => modalResolve = r); }

  function showOcr(i, n) {
    $('#ocr-status').classList.remove('hidden');
    $('#ocr-thumb-img').src = state.pendingThumb;
    $('#ocr-status-sub').textContent = `第 ${i}/${n} 张`;
    setProgress('准备中…', 0);
  }
  function setProgress(label, r) {
    $('#ocr-status-title').textContent = label;
    $('#ocr-progress').style.width = Math.round(r * 100) + '%';
  }
  function hideOcr() { $('#ocr-status').classList.add('hidden'); }

  /* ═══════════ 明细页 ═══════════ */
  $('#list-prev').onclick = () => { state.listMonth.setMonth(state.listMonth.getMonth() - 1); renderList(); };
  $('#list-next').onclick = () => { state.listMonth.setMonth(state.listMonth.getMonth() + 1); renderList(); };
  $('#list-filter').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    state.filter = c.dataset.f;
    $$('#list-filter .chip').forEach(x => x.classList.toggle('active', x === c));
    renderList();
  });
  $('#record-list').addEventListener('click', e => {
    const item = e.target.closest('.rec-item');
    if (!item) return;
    const rec = Store.all().find(r => r.id === item.dataset.id);
    if (!rec) return;
    state.editingId = rec.id;
    openModal('edit', Object.assign({}, rec, { _title: '编辑记录' }));
  });
  $('#recent-list').addEventListener('click', e => {
    const item = e.target.closest('.rec-item');
    if (!item) return goto('list');
    const rec = Store.all().find(r => r.id === item.dataset.id);
    if (!rec) return;
    state.editingId = rec.id;
    openModal('edit', Object.assign({}, rec, { _title: '编辑记录' }));
  });

  function renderList() {
    const m = state.listMonth;
    const now = new Date();
    const isCur = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
    $('#list-month').textContent = `${m.getFullYear()}年${m.getMonth() + 1}月`;
    $('#list-next').style.visibility = isCur ? 'hidden' : 'visible';

    const s = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
    const e = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
    let recs = Store.all().filter(r => r.time >= s && r.time < e);
    if (state.filter !== 'all') recs = recs.filter(r => r.type === state.filter);
    recs.sort((a, b) => b.time - a.time);

    const exp = recs.filter(r => r.type === 'expense').reduce((a, b) => a + b.amount, 0);
    const inc = recs.filter(r => r.type === 'income').reduce((a, b) => a + b.amount, 0);
    $('#list-summary').innerHTML = `
      <div class="ls-item"><div class="ls-label">支出</div><div class="ls-val expense">${money(exp)}</div></div>
      <div class="ls-item"><div class="ls-label">收入</div><div class="ls-val income">${money(inc)}</div></div>
      <div class="ls-item"><div class="ls-label">结余</div><div class="ls-val">${money(inc - exp)}</div></div>`;

    // 按日分组
    const groups = new Map();
    for (const r of recs) {
      const k = dstr(r.time);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let html = '';
    for (const [k, list] of groups) {
      const d = new Date(list[0].time);
      const de = list.filter(r => r.type === 'expense').reduce((a, b) => a + b.amount, 0);
      const di = list.filter(r => r.type === 'income').reduce((a, b) => a + b.amount, 0);
      html += `<div class="rec-group-date"><b>${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKS[d.getDay()]}</b>
        <span>${de ? '支 ' + money(de) : ''}${di ? ' 收 ' + money(di) : ''}</span></div>`;
      html += list.map(r => recRowHTML(r)).join('');
    }
    $('#record-list').innerHTML = html;
    $('#list-empty').classList.toggle('hidden', recs.length > 0);
  }

  /* ═══════════ 统计页 ═══════════ */
  $('#stats-dim').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.statsDim = b.dataset.d;
    $$('#stats-dim .seg-btn').forEach(x => x.classList.toggle('active', x === b));
    $('#bar-sub').textContent = state.statsDim === 'day' ? '近 14 天' : state.statsDim === 'week' ? '近 8 周' : '近 12 个月';
    Charts.render(Store.all(), state.statsDim);
    renderStatCards();
  });

  function renderStatCards() {
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const ws = new Date(t0); ws.setDate(ws.getDate() - (ws.getDay() + 6) % 7);
    const [m0, m1] = monthRange(now);
    const stat = (s, e) => {
      const rs = Store.all().filter(r => r.time >= s && r.time < e);
      return {
        exp: rs.filter(r => r.type === 'expense').reduce((a, b) => a + b.amount, 0),
        inc: rs.filter(r => r.type === 'income').reduce((a, b) => a + b.amount, 0)
      };
    };
    const t = stat(t0, t0 + 86400e3), w = stat(ws.getTime(), t0 + 86400e3), m = stat(m0, m1);
    $('#sc-today-exp').textContent = money(t.exp); $('#sc-today-inc').textContent = '收 ' + money(t.inc);
    $('#sc-week-exp').textContent = money(w.exp); $('#sc-week-inc').textContent = '收 ' + money(w.inc);
    $('#sc-month-exp').textContent = money(m.exp); $('#sc-month-inc').textContent = '收 ' + money(m.inc);
  }

  /* ═══════════ 设置页 ═══════════ */
  const AB = window.AndroidStore || null; // 安卓 App 注入的通知记账桥
  function renderAutoBill() {
    if (!AB) return;
    let enabled = false;
    try { enabled = JSON.parse(AB.listenerEnabled() || '{}').enabled === true; } catch (_) { }
    $('#ab-status').textContent = enabled
      ? '✓ 通知监听已开启：付款后将自动记入账本'
      : '⚠️ 尚未开启「通知使用权」，自动记账不生效。点下方按钮到系统设置 → 特殊应用权限 → 通知使用权 → 允许「智能记账」。';
    $('#btn-listener').classList.toggle('hidden', enabled);
    let items = [];
    try { items = JSON.parse(AB.recentCaptures() || '{"items":[]}').items || []; } catch (_) { }
    $('#ab-recent').innerHTML = items.length
      ? '<h3 class="card-title" style="margin-top:12px">最近捕获</h3>' + items.map(it => {
        const t = new Date(it.at);
        const act = it.action === 'added' ? '<span class="ok">已记录</span>'
          : it.action === 'dup' ? '<span>重复跳过</span>'
            : it.action === 'ignored' ? '<span>与支付无关</span>' : '<span class="err">未识别</span>';
        const amt = it.amount ? (it.type === 'income' ? '+' : '−') + fullMoney(it.amount) : '';
        return `<div class="ab-item"><span class="ab-time">${p2(t.getMonth() + 1)}-${p2(t.getDate())} ${tstr(it.at)}</span><span class="ab-title">${esc(it.title || '')}</span><span class="ab-amt">${amt}</span>${act}</div>`;
      }).join('')
      : '';
  }
  function renderSettings() {
    $$('input[name="ocr-mode"]').forEach(r => r.checked = r.value === settings.mode);
    $('#ai-key').value = settings.apiKey || '';
    $('#ai-base').value = settings.apiBase || '';
    $('#ai-config').classList.toggle('open', settings.mode === 'ai');
    const n = Store.all().length;
    const size = Math.round(JSON.stringify(Store.all()).length / 1024);
    $('#data-stat').textContent = `当前共 ${n} 条记录，约占存储 ${size} KB`;
    $('#upload-badge').textContent = settings.mode === 'ai' ? 'AI 识别' : '本地识别 · 免费离线';
    $('#card-autobill').classList.toggle('hidden', !AB);
    if (AB) renderAutoBill();
  }
  $$('input[name="ocr-mode"]').forEach(r => r.onchange = () => {
    if (r.checked) {
      settings.mode = r.value;
      saveSettings();
      renderSettings();
      if (r.value === 'ai' && !settings.apiKey) toast('请填写智谱 API Key 后再使用 AI 识别');
    }
  });
  $('#ai-key').onchange = () => { settings.apiKey = $('#ai-key').value.trim(); saveSettings(); };
  $('#ai-base').onchange = () => {
    let v = $('#ai-base').value.trim().replace(/\/+$/, '');
    settings.apiBase = v; saveSettings();
  };
  $('#btn-test-ai').onclick = async () => {
    const key = $('#ai-key').value.trim();
    if (!key) { toast('请先填写 API Key'); return; }
    settings.apiKey = key;
    settings.apiBase = $('#ai-base').value.trim().replace(/\/+$/, '');
    saveSettings();
    $('#btn-test-ai').textContent = '测试中…';
    const r = await AIOCR.testKey(key, settings.apiBase);
    $('#btn-test-ai').textContent = '测试';
    $('#ai-test-ok').classList.toggle('hidden', !r.ok);
    $('#ai-test-err').classList.toggle('hidden', !!r.ok);
    if (!r.ok) $('#ai-test-err').textContent = '✗ ' + r.msg;
    toast(r.ok ? '连接成功 ✓' : '连接失败');
  };

  $('#btn-export').onclick = () => {
    const data = Store.exportJSON();
    if (!data.count) { toast('还没有可导出的记录'); return; }
    const d = new Date();
    const name = `智能记账备份_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.json`;
    if (AB) { // App 内：写文件到手机"下载"目录
      try {
        const r = JSON.parse(AB.export(JSON.stringify(data, null, 2), name) || '{}');
        toast(r.ok ? `已导出 ${data.count} 条 → ${r.path}` : ('导出失败：' + (r.msg || '')), 4000);
      } catch (e) { toast('导出失败：' + (e.message || e), 3000); }
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已导出 ${data.count} 条记录`);
  };

  $('#btn-import').onclick = () => $('#import-input').click();
  $('#import-input').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (_) { toast('文件不是有效的 JSON'); return; }

    const cnt = Array.isArray(data) ? data.length : (data.records ? data.records.length : 0);
    const mode = await confirmDialog('导入备份',
      `文件中检测到 <b>${cnt}</b> 条记录。<br><br><b>合并</b>：与现有记录自动去重后追加（推荐）<br><b>覆盖</b>：清空现有数据，完全以备份为准`,
      [
        { label: '取消', value: null, kind: 'light' },
        { label: '覆盖', value: 'overwrite', kind: 'danger' },
        { label: '合并', value: 'merge', kind: 'primary' }
      ]);
    if (!mode) return;
    const r = Store.importJSON(data, mode);
    if (r.ok) {
      toast(`导入完成：新增 ${mode === 'overwrite' ? r.added : r.added} 条${mode === 'merge' && (cnt - r.added) > 0 ? `，${cnt - r.added} 条已存在跳过` : ''}`, 3200);
      refreshAll();
    } else toast(r.msg || '导入失败');
  };

  $('#btn-clear').onclick = async () => {
    const yes = await confirmDialog('清空全部数据', `将删除全部 ${Store.all().length} 条记录，<b>删除前请确认已导出备份</b>，此操作不可恢复。`,
      [{ label: '取消', value: false, kind: 'light' }, { label: '确认清空', value: true, kind: 'danger' }]);
    if (!yes) return;
    Store.clearAll();
    toast('已清空');
    refreshAll();
  };

  // 通知自动记账按钮（仅 App 内可见）
  if (AB) {
    $('#btn-listener').onclick = () => AB.openListenerSettings();
    $('#btn-ab-refresh').onclick = () => { renderSettings(); toast('已刷新'); };
  }

  /* ═══════════ 刷新 ═══════════ */
  function refreshAll() {
    renderRecordPage();
    if (state.view === 'list') renderList();
    if (state.view === 'stats') { Charts.render(Store.all(), state.statsDim); renderStatCards(); }
    if (state.view === 'settings') renderSettings();
  }

  /* ═══════════ 安卓 App 钩子（网页版不受影响） ═══════════ */
  // 后台通知记账成功后由 App 调用：参数为 {ok,type,amount,merchant} 对象字面量
  window.__onAutoBill = function (p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { p = null; } }
    Store._reload();
    refreshAll();
    if (p && p.ok) {
      toast('✓ 已自动记账 ' + (p.type === 'income' ? '+' : '−') + fullMoney(p.amount) + (p.merchant ? ' ' + p.merchant : ''), 3400);
    }
  };
  // App 回到前台时调用（例如从系统授权设置页返回）
  window.__onResume = function () {
    Store._reload();
    refreshAll();
  };

  /* ═══════════ 启动 ═══════════ */
  renderRecordPage();
  renderStatCards();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
