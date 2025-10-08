// routes/bertline-stream.js  — CommonJS, SSE demo data for Bertline
const express = require('express');
const router = express.Router();

// --- tiny helper
function jitter(v, amt, min = -Infinity, max = Infinity) {
  const j = v + (Math.random() * 2 - 1) * amt;
  return Math.max(min, Math.min(max, Math.round(j)));
}

// --- seed state (incl. time-based temp series)
const now = Date.now();
let state = {
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

  // 15 points spaced 5s apart so the time axis has history on load
  tempSeries: Array.from({ length: 15 }, (_, i) => {
    const ts = now - (14 - i) * 5000;                 // 5 sec spacing
    const wave = 75 + 3.5 * Math.sin(ts / 2500);      // ~71.5..78.5
    const noise = (Math.random() - 0.5) * 0.8;
    const temp = Math.round(Math.max(69, Math.min(81, wave + noise)));
    return { ts, temp, on: 79, off: 73 };
  }),
};

// --- update loop: make things “breathe”
function tick() {
  const t = Date.now();
  const wave3s = Math.sin(t / 3000);   // -1..1
  const wave2s = Math.sin(t / 2000);   // -1..1 (faster)

  // 1) Baseline vs Post — move Fri "post" so the area chart visibly changes
  const i = state.baselineWeek.length - 1;
  const basePost = 20;
  const swingPost = 5;
  const noisyPost = basePost + swingPost * wave3s + (Math.random() - 0.5) * 1.2;
  state.baselineWeek = state.baselineWeek.map((d, idx, arr) =>
    idx === i ? { ...d, post: Math.round(Math.max(10, Math.min(32, noisyPost))) } : d
  );

  // 2) Load split — “With BERT” breathes more than Typical
  state.loadSplit = state.loadSplit.map((d, idx) => {
    const isWithBert = idx === 1;
    const base  = isWithBert ? 18 : 40;
    const swing = isWithBert ? 8  : 5;
    const overnight = Math.round(
      Math.max(8, Math.min(70, base + swing * wave3s + (Math.random() - 0.5) * 1.5))
    );
    const daytime = Math.max(0, Math.min(100, 100 - overnight));
    return { ...d, overnight, daytime };
  });

  // 3) Temperature rolling time series (use ts for time axis)
  const wave = 75 + 4.5 * wave2s;        // ~70.5..79.5
  const noise = (Math.random() - 0.5) * 1.0;
  const nextTemp = Math.round(Math.max(69, Math.min(81, wave + noise)));
  const nextTs = t;

  state.tempSeries = [
    ...state.tempSeries.slice(-119),      // keep last 120 points max
    { ts: nextTs, temp: nextTemp, on: 79, off: 73 },
  ];

  // 4) KPI — let it move a little so the header looks alive
  const kBase = 64;
  const kSwing = 3; // 61–67%
  state.kpi.overnightReductionPct = Math.round(kBase + kSwing * wave3s);
}

// --- Initial JSON snapshot (used by client at page load)
router.get('/api/bertline/it-health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    kpi: state.kpi,
    baselineWeek: state.baselineWeek,
    loadSplit: state.loadSplit,
    airCleanerCosts: state.airCleanerCosts,
    tempSeries: state.tempSeries,
  });
});

// --- Server-Sent Events live stream
router.get('/api/bertline/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders?.();

  // Send an initial snapshot immediately
  res.write(`data: ${JSON.stringify({ type: 'snapshot', state })}\n\n`);

  // Push updates ~every 1.2s
  const id = setInterval(() => {
    tick();
    res.write(`data: ${JSON.stringify({ type: 'tick', state })}\n\n`);
  }, 1200);

  // Clean up when client disconnects
  req.on('close', () => clearInterval(id));
});

module.exports = router;
