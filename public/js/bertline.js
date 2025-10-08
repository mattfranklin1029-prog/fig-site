// /public/js/bertline.js
// Live AG Charts wired to /api/bertline/it-health + /api/bertline/stream (SSE)

(function () {
  if (window.__bertInit) return; window.__bertInit = true;

  (async function init() {
    // Ensure AG Charts UMD
    if (!(window.agCharts && window.agCharts.AgCharts)) {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/ag-charts-community/dist/umd/ag-charts-community.min.js');
      } catch {}
    }
    if (!(window.agCharts && window.agCharts.AgCharts)) {
      console.warn('AG Charts failed to load');
      return;
    }
    const A = agCharts.AgCharts;

    // Initial data (API → demo)
    const initial = normalize(await fetchOrDemo('/api/bertline/it-health'));
    const charts  = createCharts(A, initial);
    applyKpis(initial);

    // Live badge
    const live = makeLiveBadge();

    // SSE updates
    connectSSE(({ state }) => {
      const s = normalize(state);
      applyKpisFromState(s);
      smoothReplace(charts, s);
      pulse();
      live.ok();
    }, live.err);

    // Expose for debugging
    window.__bertCharts = charts;
  })();

  /* -------------------- Chart creation -------------------- */
  function createCharts(A, data) {
    const charts = {};
    const anim = { enabled: true, duration: 700 };

    // Baseline vs Post-BERT (line + area)
    const baselineEl = document.getElementById('baseline-chart');
    if (baselineEl) {
      charts.baseline = A.create({
        container: baselineEl,
        data: data.baselineWeek,
        animation: anim,
        series: [
          { type: 'line', xKey: 'day', yKey: 'baseline', yName: 'Baseline', marker: { enabled: true } },
          { type: 'area', xKey: 'day', yKey: 'post',     yName: 'Post-BERT' }
        ],
        axes: [
          { type: 'category', position: 'bottom' },
          { type: 'number', position: 'left', title: { text: 'kWh (per day)' } },
        ],
        legend: { position: 'bottom' },
      });
    }

    // Load split (stacked bars)
    const overnightEl = document.getElementById('overnight-chart');
    if (overnightEl) {
      charts.overnight = A.create({
        container: overnightEl,
        data: data.loadSplit,
        animation: anim,
        series: [
          { type: 'bar', xKey: 'label', yKey: 'overnight', yName: 'Overnight', stacked: true },
          { type: 'bar', xKey: 'label', yKey: 'daytime',   yName: 'Daytime',   stacked: true },
        ],
        axes: [
          { type: 'category', position: 'bottom' },
          { type: 'number', position: 'left', title: { text: 'Share of total (%)' } },
        ],
        legend: { position: 'bottom' },
      });
    }

    // Air-cleaner costs (grouped bars)
    const airEl = document.getElementById('aircleaner-chart');
    if (airEl) {
      charts.air = A.create({
        container: airEl,
        data: data.airCleanerCosts,
        animation: anim,
        series: [
          { type: 'bar', xKey: 'cfm', yKey: 'before', yName: 'Before' },
          { type: 'bar', xKey: 'cfm', yKey: 'after',  yName: 'After (60h/wk)' },
        ],
        axes: [
          { type: 'category', position: 'bottom', title: { text: 'Unit size (CFM)' } },
          { type: 'number', position: 'left', title: { text: 'Annual $' } },
        ],
        legend: { position: 'bottom' },
      });
    }

    // Temperature time series (time axis + fixed y domain for visibility)
    const tempEl = document.getElementById('temp-chart');
    if (tempEl) {
      charts.temp = A.create({
        container: tempEl,
        data: data.tempSeries,
        animation: anim,
        series: [
          { type: 'line', xKey: 'ts', yKey: 'temp', yName: 'Room Temp (°F)', marker: { enabled: true } },
          { type: 'line', xKey: 'ts', yKey: 'on',   yName: 'ON set-point',   marker: { enabled: false } },
          { type: 'line', xKey: 'ts', yKey: 'off',  yName: 'OFF set-point',  marker: { enabled: false } },
        ],
        axes: [
          { type: 'time', position: 'bottom', label: { format: '%I:%M:%S %p' } },
          { type: 'number', position: 'left', title: { text: '°F' }, min: 69, max: 81 },
        ],
        legend: { position: 'bottom' },
        tooltip: {
          renderer: ({ datum }) => ({
            title: new Date(datum.ts).toLocaleTimeString(),
            content: `Temp: ${datum.temp}°F`,
          }),
        },
      });
    }

    return charts;
  }

  /* -------------------- Live data → repaint -------------------- */
  function smoothReplace(charts, s) {
    if (charts.baseline && s.baselineWeek)   charts.baseline.data   = s.baselineWeek.map(d => ({ ...d }));
    if (charts.overnight && s.loadSplit)     charts.overnight.data  = s.loadSplit.map(d => ({ ...d }));
    if (charts.air && s.airCleanerCosts)     charts.air.data        = s.airCleanerCosts.map(d => ({ ...d }));
    if (charts.temp && s.tempSeries)         charts.temp.data       = s.tempSeries.map(d => ({ ...d }));
  }

  /* -------------------- KPIs -------------------- */
  function applyKpis(seed) {
    const k = seed.kpi || { overnightReductionPct: 64, payback: '< 4 mo', localLogDays: 14, deviceScale: 1000 };
    set('#kpi-overnight', `${k.overnightReductionPct}%`);
    set('#kpi-payback',   k.payback);
    set('#kpi-log',       `${k.localLogDays} days`);
    set('#kpi-scale',     `${k.deviceScale}`);
  }
  function applyKpisFromState(state) { if (state?.kpi) applyKpis(state); }

  /* -------------------- SSE client -------------------- */
  function connectSSE(onData, onErr) {
    let es = null, backoff = 1000, lastLog = 0;

    const start = () => {
      if (document.hidden) { setTimeout(start, 800); return; }
      es = new EventSource('/api/bertline/stream');

      es.onopen = () => { backoff = 1000; onErr && onErr(false); };

      es.onmessage = (ev) => {
        const now = performance.now();
        if (now - lastLog > 4000) { console.log('SSE tick', ev.data.slice(0, 100) + '…'); lastLog = now; }
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

  /* -------------------- Data helpers -------------------- */
  function normalize(s) {
    if (!s || typeof s !== 'object') return s;
    const out = { ...s };

    // Ensure tempSeries has { ts:number, temp,on,off }
    if (Array.isArray(out.tempSeries)) {
      out.tempSeries = out.tempSeries.map(d => {
        if (d && d.ts == null && d.time) {
          // fallback if server sent label strings
          const ts = Date.now();
          return { ts, temp: d.temp, on: d.on, off: d.off };
        }
        return d;
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
    const tempSeries = Array.from({ length: 15 }, (_, i) => {
      const ts = now - (14 - i) * 5000;
      const wave = 75 + 3.5 * Math.sin(ts / 2500);
      const noise = (Math.random() - 0.5) * 0.8;
      const temp = Math.round(Math.max(69, Math.min(81, wave + noise)));
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

  /* -------------------- UI helpers -------------------- */
  function set(sel, val) { const el = document.querySelector(sel); if (el) el.textContent = val; }

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
