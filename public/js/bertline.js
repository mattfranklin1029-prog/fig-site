// /public/js/bertline.js
// Live AG Charts wired to /api/bertline/it-health + /api/bertline/stream (SSE)
// Adds: compare toggle, KPI sparklines, ROI widget, safer formatting/theme.

(function () {
  if (window.__bertInit) return; window.__bertInit = true;

  // ---------- Formatters & Theme ----------
  const fmt = {
    kwh:    new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }),
    money0: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
    money2: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
    pct0:   new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }),
    pct1:   new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }),
  };

  const THEME = {
    axesCommon: {
      label: { color: '#CBD5E1', fontSize: 11 },
      gridStyle: [{ stroke: 'rgba(255,255,255,0.06)' }],
    },
    colors: {
      primary: '#5B7CFF',
      savings: '#10B981',
      gray:    '#94A3B8',
      warning: '#F59E0B',
    }
  };

  // ---------- UI state ----------
  let compareMode = 'both';    // 'baseline' | 'post' | 'both'
  let liveEnabled = true;
  let pricePerKwh = 0.16;
  let lastAirBaseRows = null;

  // ---------- Bootstrap ----------
  (async function init() {
    // Ensure AG Charts UMD
    if (!(window.agCharts && window.agCharts.AgCharts)) {
      try { await loadScript('https://cdn.jsdelivr.net/npm/ag-charts-community/dist/umd/ag-charts-community.min.js'); } catch {}
    }
    if (!(window.agCharts && window.agCharts.AgCharts)) {
      console.warn('AG Charts failed to load');
      return;
    }
    const A = agCharts.AgCharts;

    // Footer year
    const y = document.getElementById('y'); if (y) y.textContent = new Date().getFullYear();

    // Seed data
    const initial = normalize(await fetchOrDemo('/api/bertline/it-health'));

    // Charts + KPIs
    const charts = createCharts(A, initial);
    applyKpis(initial);
    seedSparklines(A);
    updateCompareVisibility(charts);
    updateWeekdayDeltaBadge(charts, initial);

    // Live badge
    const live = makeLiveBadge();

    // Controls
    wireCompare(charts);
    wireLiveToggle();
    wireRoi(charts);        // robust ROI; runs immediately

    // SSE updates
    connectSSE(({ state }) => {
      if (!liveEnabled) return;
      const s = normalize(state);
      applyKpisFromState(s);
      smoothReplace(charts, s);
      updateCompareVisibility(charts);
      updateWeekdayDeltaBadge(charts, s);
      recalcAirWithPrice(charts); // keep air chart scaled to slider
      pulse();
      live.ok();
    }, live.err);

    // Expose for debug
    window.__bertCharts = charts;
  })();

  // ---------- Charts ----------
  function createCharts(A, data) {
    const charts = {};
    const anim = { enabled: true, duration: 600 };

    // Weekday Baseline vs Post-BERT
    const baselineEl = document.getElementById('baseline-chart');
    if (baselineEl) {
      charts.baseline = A.create({
        container: baselineEl,
        data: data.baselineWeek,
        animation: anim,
        background: { visible: false },
        axes: [
          { type: 'category', position: 'bottom', ...THEME.axesCommon },
          { type: 'number', position: 'left', ...THEME.axesCommon,
            title: { text: 'kWh (per day)' },
            label: { formatter: ({ value }) => fmt.kwh.format(value) + ' kWh', color: '#CBD5E1', fontSize: 11 } }
        ],
        series: [
          { type: 'line', xKey: 'day', yKey: 'baseline', yName: 'Baseline',
            stroke: THEME.colors.gray, strokeWidth: 2, marker: { size: 3, fill: THEME.colors.gray } },
          { type: 'line', xKey: 'day', yKey: 'post', yName: 'Post-BERT',
            stroke: THEME.colors.savings, strokeWidth: 3, marker: { size: 0 } },
        ],
        legend: { position: 'bottom', item: { label: { color: '#E2E8F0' } } }
      });
    }

    // Overnight vs Daytime (stacked)
    const overnightEl = document.getElementById('overnight-chart');
    if (overnightEl) {
      charts.overnight = A.create({
        container: overnightEl,
        data: data.loadSplit,
        animation: anim,
        background: { visible: false },
        axes: [
          { type: 'category', position: 'bottom', ...THEME.axesCommon },
          { type: 'number', position: 'left', ...THEME.axesCommon,
            title: { text: 'Share of total (%)' },
            label: { formatter: ({ value }) => value + '%', color: '#CBD5E1', fontSize: 11 } }
        ],
        series: [
          { type: 'bar', xKey: 'label', yKey: 'overnight', yName: 'Overnight', stacked: true,
            fills: [THEME.colors.gray], strokes:[THEME.colors.gray], cornerRadius: 6 },
          { type: 'bar', xKey: 'label', yKey: 'daytime', yName: 'Daytime', stacked: true,
            fills: [THEME.colors.primary], strokes:[THEME.colors.primary], cornerRadius: 6 },
        ],
        legend: { position: 'bottom', item: { label: { color: '#E2E8F0' } } }
      });
    }

    // Air-cleaner (grouped bars) — rescaled by ROI slider
    const airEl = document.getElementById('aircleaner-chart');
    if (airEl) {
      lastAirBaseRows = (data.airCleanerCosts || []).map(r => ({ cfm: r.cfm, before: r.before, after: r.after }));
      charts.air = buildAirChart(A, lastAirBaseRows);
    }

    // Temperature with set-point guides
    const tempEl = document.getElementById('temp-chart');
    if (tempEl) {
      charts.temp = A.create({
        container: tempEl,
        data: data.tempSeries,
        animation: anim,
        background: { visible: false },
        series: [
          { type: 'line', xKey: 'ts', yKey: 'temp', yName: 'Room Temp (°F)',
            stroke: THEME.colors.primary, strokeWidth: 2, marker: { size: 2 } },
          { type: 'line', xKey: 'ts', yKey: 'on',   yName: 'ON set-point',
            stroke: THEME.colors.gray, strokeWidth: 1.5, lineDash:[6,6], marker:{ enabled:false } },
          { type: 'line', xKey: 'ts', yKey: 'off',  yName: 'OFF set-point',
            stroke: THEME.colors.gray, strokeWidth: 1.5, lineDash:[6,6], marker:{ enabled:false } },
        ],
        axes: [
          { type: 'time', position: 'bottom', ...THEME.axesCommon,
            label: { format: '%I:%M:%S %p', color: '#CBD5E1', fontSize: 11 } },
          { type: 'number', position: 'left', ...THEME.axesCommon,
            title: { text: '°F' }, min: 69, max: 81,
            label: { formatter: ({ value }) => `${Math.round(value)}°F`, color: '#CBD5E1', fontSize: 11 } },
        ],
        legend: { position: 'bottom', item: { label: { color: '#E2E8F0' } } }
      });
    }

    return charts;
  }

  function buildAirChart(A, rows) {
    return A.create({
      container: document.getElementById('aircleaner-chart'),
      data: rows,
      animation: { enabled: true, duration: 500 },
      background: { visible: false },
      axes: [
        { type: 'category', position: 'bottom', ...THEME.axesCommon, title: { text: 'Unit size (CFM)' } },
        { type: 'number',   position: 'left',   ...THEME.axesCommon, title: { text: 'Annual $' },
          label: { formatter: ({ value }) => fmt.money0.format(value), color: '#CBD5E1', fontSize: 11 } }
      ],
      series: [
        { type: 'bar', xKey: 'cfm', yKey: 'before', yName: 'Before',
          fills: [THEME.colors.gray], strokes:[THEME.colors.gray], cornerRadius: 6 },
        { type: 'bar', xKey: 'cfm', yKey: 'after',  yName: 'After (60h/wk)',
          fills: [THEME.colors.savings], strokes:[THEME.colors.savings], cornerRadius: 6 },
      ],
      legend: { position: 'bottom', item: { label: { color: '#E2E8F0' } } }
    });
  }

  // ---------- Live data → repaint ----------
  function smoothReplace(charts, s) {
    if (charts.baseline && s.baselineWeek) charts.baseline.data = s.baselineWeek.map(d => ({ ...d }));
    if (charts.overnight && s.loadSplit)   charts.overnight.data = s.loadSplit.map(d => ({ ...d }));
    if (charts.air && s.airCleanerCosts) {
      lastAirBaseRows = s.airCleanerCosts.map(r => ({ cfm: r.cfm, before: r.before, after: r.after }));
      charts.air.data = scaleAirRows(lastAirBaseRows, pricePerKwh);
    }
    if (charts.temp && s.tempSeries) charts.temp.data = s.tempSeries.map(d => ({ ...d }));
  }

  // ---------- KPIs ----------
  function applyKpis(seed) {
    const k = seed.kpi || { overnightReductionPct: 64, payback: '< 4 mo', localLogDays: 14, deviceScale: 1000 };
    setText('#kpi-overnight', `${k.overnightReductionPct}%`);
    setText('#kpi-payback',   k.payback);
    setText('#kpi-log',       `${k.localLogDays} days`);
    setText('#kpi-scale',     `${k.deviceScale}`);
  }
  function applyKpisFromState(state) { if (state?.kpi) applyKpis(state); }

  // KPI sparklines (tiny lines; no axes)
  function seedSparklines(A) {
    const cfgs = [
      ['#kpi-overnight-spark', [64, 65, 66, 67, 66, 68, 70]],
      ['#kpi-payback-spark',   [6, 5, 5, 4, 4, 4, 3.8]],
      ['#kpi-log-spark',       [10, 12, 12, 13, 13, 14, 14]],
      ['#kpi-scale-spark',     [800, 850, 900, 950, 1000, 1050, 1100]],
    ];
    cfgs.forEach(([sel, arr]) => {
      const el = qs(sel); if (!el) return;
      A.create({
        container: el, axes: [], legend: { enabled: false }, background: { visible: false },
        series: [{ type: 'line', data: arr.map((y,i)=>({x:i,y})),
          xKey:'x', yKey:'y', stroke: THEME.colors.savings, strokeWidth: 2, marker: { size: 0 } }],
        height: el.clientHeight || 40, padding: { top: 0, right: 0, bottom: 0, left: 0 }
      });
    });
  }

  // ---------- Compare toggle ----------
  function wireCompare(charts) {
    const buttons = [
      ['#btn-compare-baseline', 'baseline'],
      ['#btn-compare-post',     'post'],
      ['#btn-compare-both',     'both']
    ];
    buttons.forEach(([sel, mode]) => {
      const el = qs(sel); if (!el) return;
      el.addEventListener('click', () => {
        compareMode = mode;
        buttons.forEach(([s2, m2]) => { const b = qs(s2); if (b) b.dataset.active = (m2 === mode); });
        updateCompareVisibility(charts);
      });
    });
  }

function updateCompareVisibility(charts) {
  if (!charts || !charts.baseline || !charts.baseline.series) return; // ✅ safety guard

  const base = charts.baseline;
  base.series.forEach(s => {
    if (s.yName === 'Baseline')  s.visible = (compareMode !== 'post');
    if (s.yName === 'Post-BERT') s.visible = (compareMode !== 'baseline');
  });

  const badge = qs('#baseline-badge');
  const data = base.data || [];
  if (badge && data.length) {
    const sum = (k) => data.reduce((a,b)=>a + (Number(b[k])||0), 0);
    const b = sum('baseline'), p = sum('post');
    const delta = b ? (p - b) / b : 0;
    badge.textContent = (delta < 0 ? 'Savings ' : 'Increase ') + fmt.pct0.format(Math.abs(delta));
    badge.className = 'kpi-badge ' + (delta < 0 ? 'kpi-good' : 'kpi-bad');
    badge.hidden = false;
  }
}


  function updateWeekdayDeltaBadge(charts, s) {
    const d = (s.baselineWeek || charts.baseline?.data || []);
    if (!d.length) return;
    const sum = (k) => d.reduce((a,b)=>a + (Number(b[k])||0), 0);
    const b = sum('baseline'), p = sum('post');
    const delta = b ? (p - b) / b : 0;
    setText('#delta-weekday', fmt.pct1.format(Math.abs(delta)) + (delta < 0 ? ' ↓' : ' ↑'));
  }

  // ---------- ROI widget ----------
  function wireRoi(charts) {
    const price    = qs('#inp-price');
    const devices  = qs('#inp-devices');
    const kwh      = qs('#inp-kwh');
    const out      = qs('#roi-savings');
    const lblP     = qs('#val-price');
    const lblD     = qs('#val-devices');
    const lblK     = qs('#val-kwh');
    const priceTag = qs('#price-kwh-label');

    if (!out) return; // widget not present → skip

    const read = () => ({
      price:   num(price?.value ?? 0.16, 0.16),
      devices: Math.round(num(devices?.value ?? 100, 100)),
      perDay:  num(kwh?.value ?? 1.2, 1.2),
    });

    const updateLabels = (st) => {
      if (lblP)     lblP.textContent = st.price.toFixed(2);
      if (lblD)     lblD.textContent = String(st.devices);
      if (lblK)     lblK.textContent = st.perDay.toFixed(1);
      if (priceTag) priceTag.textContent = `$${st.price.toFixed(2)}/kWh`;
    };

    const calc = () => {
      const st = read();
      pricePerKwh = st.price;
      updateLabels(st);

      const dollars = st.devices * st.perDay * 365 * st.price * 0.40; // 40% midpoint
      out.textContent = fmt.money0.format(dollars);

      recalcAirWithPrice(charts);
    };

    ['input', 'change'].forEach(evt => {
      if (price)   price.addEventListener(evt, calc);
      if (devices) devices.addEventListener(evt, calc);
      if (kwh)     kwh.addEventListener(evt, calc);
    });

    calc();               // immediately
    setTimeout(calc, 50); // run again after layout
  }

  function scaleAirRows(baseRows, price) {
    if (!Array.isArray(baseRows) || !baseRows.length) return [];
    const scale = (num(price, 0.16) / 0.16) || 1;
    return baseRows.map(r => ({
      cfm: r.cfm,
      before: num(r.before, 0) * scale,
      after:  num(r.after,  0) * scale
    }));
  }

  function recalcAirWithPrice(charts) {
    if (!charts.air || !lastAirBaseRows) return;
    charts.air.data = scaleAirRows(lastAirBaseRows, pricePerKwh);
  }

  // ---------- Live toggle ----------
  function wireLiveToggle() {
    const btn = qs('#btn-live'); if (!btn) return;
    btn.addEventListener('click', () => {
      liveEnabled = !liveEnabled;
      btn.dataset.active = liveEnabled ? 'true' : 'false';
      btn.textContent = liveEnabled ? 'Pause Live' : 'Resume Live';
    });
  }

  // ---------- SSE ----------
  function connectSSE(onData, onErr) {
    let es = null, backoff = 1000, lastLog = 0;

    const start = () => {
      if (document.hidden) { setTimeout(start, 800); return; }
      es = new EventSource('/api/bertline/stream');

      es.onopen = () => { backoff = 1000; onErr && onErr(false); };

      es.onmessage = (ev) => {
        const now = performance.now();
        if (now - lastLog > 4000) { console.log('SSE tick', (ev.data||'').slice(0, 100) + '…'); lastLog = now; }
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.state) onData(msg);
        } catch { /* ignore */ }
      };

      es.onerror = () => {
        try { es.close(); } catch {}
        onErr && onErr(true);
        setTimeout(start, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
    };

    document.addEventListener('visibilitychange', () => {
      if (!es) return;
      if (document.hidden) { try { es.close(); } catch {} }
      else { start(); }
    });

    start();
  }

  // ---------- Data helpers ----------
  function normalize(s) {
    if (!s || typeof s !== 'object') return s;
    const out = { ...s };

    if (Array.isArray(out.tempSeries)) {
      out.tempSeries = out.tempSeries.map(d => {
        if (d && d.ts == null && d.time) {
          const ts = Date.now();
          return { ts, temp: d.temp, on: d.on ?? 79, off: d.off ?? 73 };
        }
        return { on: 79, off: 73, ...d };
      });
    }
    return out;
  }

  async function fetchOrDemo(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('bad ' + r.status);
      const json = await r.json();
      return { ...buildDemo(), ...normalize(json) };
    } catch {
      return buildDemo();
    }
  }

  function buildDemo() {
    const now = Date.now();
    const tempSeries = Array.from({ length: 30 }, (_, i) => {
      const ts = now - (29 - i) * 5000;
      const wave = 75 + 2.5 * Math.sin(i / 6);
      const noise = (Math.random() - 0.5) * 0.8;
      const temp = Math.max(69, Math.min(81, Math.round(wave + noise)));
      return { ts, temp, on: 79, off: 73 };
    });

    return {
      kpi: { overnightReductionPct: 64, payback: '< 4 mo', localLogDays: 14, deviceScale: 1000 },
      baselineWeek: [
        { day: 'Mon', baseline: 42, post: 22 },
        { day: 'Tue', baseline: 40, post: 21 },
        { day: 'Wed', baseline: 44, post: 23 },
        { day: 'Thu', baseline: 41, post: 22 },
        { day: 'Fri', baseline: 38, post: 20 },
      ],
      loadSplit: [
        { label: 'Typical (before)', overnight: 40, daytime: 60 },
        { label: 'With BERT',        overnight: 18, daytime: 82 },
      ],
      airCleanerCosts: [
        { cfm: '400',  before: 355,  after: 127 },
        { cfm: '800',  before: 709,  after: 253 },
        { cfm: '1200', before: 1112, after: 397 },
        { cfm: '1500', before: 1934, after: 692 },
      ],
      tempSeries,
    };
  }

  // ---------- UI helpers ----------
  function setText(sel, val) { const el = document.querySelector(sel); if (el) el.textContent = val; }
  function qs(sel) { return document.querySelector(sel); }
  function num(val, fallback = 0) {
    const n = (typeof val === 'number') ? val : parseFloat(String(val).trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function makeLiveBadge() {
    const el = document.createElement('div');
    el.textContent = 'Live';
    el.style.cssText =
      'position:fixed;top:10px;right:10px;padding:6px 10px;border-radius:999px;' +
      'font:600 12px system-ui;color:#fff;background:#dc2626;z-index:9999;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25)';
    document.body.appendChild(el);

    let to = null;
    const ok  = () => { el.style.background = '#16a34a'; clearTimeout(to); to = setTimeout(() => { el.style.background = '#dc2626'; }, 5000); };
    const err = (isErr) => { if (isErr) el.style.background = '#dc2626'; };
    return { ok, err };
  }

  function pulse() {
    const root = document.querySelector('#bertline-root') || document.body;
    root.animate([{ opacity: 0.98 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
})();
