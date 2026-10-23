/* 统计图表：ECharts 收支柱状图 / 分类环形图 / 结余趋势 */
window.Charts = (function () {
  let bar = null, donut = null, line = null;
  let inited = false;
  const C = { expense: '#f04461', income: '#0e9f6e' };
  const PALETTE = ['#0e9f6e', '#f79009', '#7a5af8', '#17b2c3', '#f33d7e', '#53b1fd', '#9e77ed', '#fab249', '#667085', '#f97066', '#12b76a', '#6e839e'];

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function init() {
    if (inited) return true;
    if (!window.echarts) return false;
    inited = true;
    const tc = cssVar('--text-2') || '#667085';
    const lineC = cssVar('--line') || '#eef0f5';
    const base = {
      textStyle: { color: tc, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: cssVar('--card') || '#fff',
        borderColor: lineC, textStyle: { color: cssVar('--text') || '#1c2333', fontSize: 12 },
        confine: true
      }
    };
    bar = echarts.init(document.getElementById('chart-bar'));
    donut = echarts.init(document.getElementById('chart-donut'));
    line = echarts.init(document.getElementById('chart-line'));
    window.addEventListener('resize', () => { bar && bar.resize(); donut && donut.resize(); line && line.resize(); });
    return true;
  }

  function weekStart(d) {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    dt.setDate(dt.getDate() - (dt.getDay() + 6) % 7);
    return dt;
  }

  /* 按日(近14天)/周(近8周)/月(近12月)聚合 */
  function aggregate(records, dim) {
    const count = dim === 'day' ? 14 : dim === 'week' ? 8 : 12;
    const now = new Date();
    const buckets = [];
    if (dim === 'day') {
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        buckets.push({ start: d.getTime(), end: d.getTime() + 86400e3, label: (d.getMonth() + 1) + '/' + d.getDate(), income: 0, expense: 0 });
      }
    } else if (dim === 'week') {
      const ws = weekStart(now);
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(ws); d.setDate(d.getDate() - 7 * i);
        buckets.push({ start: d.getTime(), end: d.getTime() + 7 * 86400e3, label: (d.getMonth() + 1) + '/' + d.getDate(), income: 0, expense: 0 });
      }
    } else {
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ start: d.getTime(), end: e.getTime(), label: (d.getMonth() + 1) + '月', income: 0, expense: 0 });
      }
    }
    for (const r of records) {
      for (let i = buckets.length - 1; i >= 0; i--) {
        const b = buckets[i];
        if (r.time >= b.start && r.time < b.end) { b[r.type === 'income' ? 'income' : 'expense'] += r.amount; break; }
      }
    }
    return buckets;
  }

  function shortNum(v) {
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(v);
  }
  const money = v => '¥' + (Math.round(v * 100) / 100).toFixed(2);

  function monthDonutData(records) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const map = {};
    for (const r of records) {
      if (r.type === 'expense' && r.time >= start && r.time < end) map[r.category] = (map[r.category] || 0) + r.amount;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
  }

  function render(records, dim) {
    if (!init()) return;
    const tc = cssVar('--text-2') || '#667085';
    const lineC = cssVar('--line') || '#eef0f5';
    const aggr = aggregate(records, dim);

    // ── 柱状图 ──
    bar.setOption({
      textStyle: { fontFamily: 'inherit' },
      grid: { left: 6, right: 6, top: 32, bottom: 2, containLabel: true },
      legend: { top: 0, right: 4, itemWidth: 10, itemHeight: 10, textStyle: { color: tc, fontSize: 11 } },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: cssVar('--card') || '#fff', borderColor: lineC,
        textStyle: { color: cssVar('--text') || '#1c2333', fontSize: 12 },
        formatter: ps => {
          let h = ps[0].axisValue + (dim === 'week' ? ' 起' : '');
          ps.forEach(p => { h += '<br/>' + p.marker + p.seriesName + '：' + money(p.value || 0); });
          return h;
        }, confine: true
      },
      xAxis: {
        type: 'category', data: aggr.map(b => b.label),
        axisTick: { show: false }, axisLine: { lineStyle: { color: lineC } },
        axisLabel: { fontSize: 10, color: tc, interval: dim === 'day' ? 1 : 0 }
      },
      yAxis: {
        type: 'value', splitLine: { lineStyle: { color: lineC } },
        axisLabel: { fontSize: 10, color: tc, formatter: shortNum }
      },
      series: [
        { name: '支出', type: 'bar', data: aggr.map(b => round2(b.expense)), itemStyle: { color: C.expense, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 14 },
        { name: '收入', type: 'bar', data: aggr.map(b => round2(b.income)), itemStyle: { color: C.income, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 14 }
      ]
    }, true);

    // ── 环形图 ──
    const dd = monthDonutData(records);
    const total = dd.reduce((s, x) => s + x.value, 0);
    document.getElementById('donut-empty').classList.toggle('hidden', dd.length > 0);
    if (dd.length) {
      donut.setOption({
        textStyle: { fontFamily: 'inherit' },
        tooltip: {
          backgroundColor: cssVar('--card') || '#fff', borderColor: lineC,
          textStyle: { color: cssVar('--text') || '#1c2333', fontSize: 12 },
          formatter: p => p.name + '：' + money(p.value) + '（' + p.percent + '%）', confine: true
        },
        title: {
          text: money(total), subtext: '本月支出', left: 'center', top: '40%',
          textStyle: { color: cssVar('--text') || '#1c2333', fontSize: 17, fontWeight: 800 },
          subtextStyle: { color: tc, fontSize: 11 }
        },
        series: [{
          type: 'pie', radius: ['55%', '76%'], center: ['50%', '50%'],
          itemStyle: { borderColor: cssVar('--card') || '#fff', borderWidth: 2, borderRadius: 5 },
          label: { color: tc, fontSize: 11, formatter: '{b}\n{d}%' },
          labelLine: { length: 8, length2: 8, lineStyle: { color: lineC } },
          data: dd.map((x, i) => ({ ...x, itemStyle: { color: PALETTE[i % PALETTE.length] } }))
        }]
      }, true);
    }

    // ── 结余趋势（区间结余累计） ──
    let cum = 0;
    const cumData = aggr.map(b => { cum += b.income - b.expense; return round2(cum); });
    line.setOption({
      textStyle: { fontFamily: 'inherit' },
      grid: { left: 6, right: 12, top: 20, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis', backgroundColor: cssVar('--card') || '#fff', borderColor: lineC,
        textStyle: { color: cssVar('--text') || '#1c2333', fontSize: 12 },
        formatter: ps => {
          const i = ps[0].dataIndex, b = aggr[i];
          return ps[0].axisValue + (dim === 'week' ? ' 起' : '') +
            '<br/>收入：' + money(b.income) + '<br/>支出：' + money(b.expense) +
            '<br/>累计结余：' + money(cumData[i]);
        }, confine: true
      },
      xAxis: {
        type: 'category', boundaryGap: false, data: aggr.map(b => b.label),
        axisTick: { show: false }, axisLine: { lineStyle: { color: lineC } },
        axisLabel: { fontSize: 10, color: tc, interval: dim === 'day' ? 1 : 0 }
      },
      yAxis: {
        type: 'value', splitLine: { lineStyle: { color: lineC } },
        axisLabel: { fontSize: 10, color: tc, formatter: shortNum }
      },
      series: [{
        type: 'line', data: cumData, smooth: true, symbolSize: 5,
        lineStyle: { width: 3, color: C.income }, itemStyle: { color: C.income },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(14,159,110,.22)' }, { offset: 1, color: 'rgba(14,159,110,0)' }] } }
      }]
    }, true);

    resizeAll();
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function resizeAll() {
    if (!inited) return;
    setTimeout(() => { bar && bar.resize(); donut && donut.resize(); line && line.resize(); }, 60);
  }

  return { render, resizeAll };
})();
