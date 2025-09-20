// server.js (drop-in)
// Express site + Contact form -> Microsoft Graph (app-only)
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('isomorphic-fetch');

// Graph v3 imports
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { body, validationResult } = require('express-validator');

const app = express();

// --- Core runtime + proxies ---
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:' + PORT;

// Optional Slack webhook
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

// --- Logging ---
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// --- Security headers ---
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'", "data:"],
      "form-action": ["'self'"],
      "connect-src": ["'self'", "https://hooks.slack.com"],
      "upgrade-insecure-requests": []
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// --- Compression + parsers ---
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

// --- Health check ---
app.get(['/healthz', '/_health'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, env: NODE_ENV, time: new Date().toISOString() });
});

// --- Helpers ---
const sanitize = (s = '') => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

async function postToSlack({ name, email, message }) {
  if (!SLACK_WEBHOOK_URL) return;
  const payload = {
    text: `📩 New website lead: ${name} (${email})`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "📩 New Website Lead", emoji: true } },
      { type: "section", fields: [
          { type: "mrkdwn", text: `*Name:*\n${sanitize(name)}` },
          { type: "mrkdwn", text: `*Email:*\n${sanitize(email)}` }
      ]},
      { type: "section", text: { type: "mrkdwn", text: `*Message:*\n${sanitize(message)}` } }
    ]
  };
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn('Slack notify failed (non-blocking).');
  }
}

// --- Graph v3 client (app-only) ---
const credential = new ClientSecretCredential(
  process.env.GRAPH_TENANT_ID,
  process.env.GRAPH_CLIENT_ID,
  process.env.GRAPH_CLIENT_SECRET
);
const authProvider = new TokenCredentialAuthenticationProvider(credential, {
  scopes: ['https://graph.microsoft.com/.default']
});
const graph = Client.initWithMiddleware({ authProvider });

async function sendGraphMail({ subject, html, replyTo }) {
  const fromAddress = process.env.GRAPH_SENDER; // e.g., admin@franklininnovationgroup.com
  const toAddress = process.env.GRAPH_TO_EMAIL || fromAddress;
  if (!fromAddress) throw new Error('GRAPH_SENDER not set');

  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: toAddress } }],
      replyTo: replyTo ? [{ emailAddress: { address: replyTo } }] : undefined
    },
    saveToSentItems: true
  };

  await graph.api(`/users/${encodeURIComponent(fromAddress)}/sendMail`).post(payload);
}

// --- Rate limit contact ---
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Contact endpoint ---
app.post(
  '/api/contact',
  contactLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('message').trim().isLength({ min: 5, max: 5000 }),
    body('_gotcha').optional().isLength({ max: 0 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).send('Invalid submission.');
    }

    const { name = '', email = '', message = '' } = req.body || {};
    const redirectTo = req.body._redirect || '/thank-you.html';
    const subject = `FIG Website Contact — ${sanitize(name)}`;
    const html = `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif">
        <h2 style="margin:0 0 8px">New Website Inquiry</h2>
        <p><strong>Name:</strong> ${sanitize(name)}</p>
        <p><strong>Email:</strong> ${sanitize(email)}</p>
        <p><strong>Message:</strong></p>
        <div style="white-space:pre-wrap">${sanitize(message)}</div>
        <hr><p style="color:#6b7280">Sent from franklininnovationgroup.com</p>
      </div>`;

    try {
      await sendGraphMail({ subject, html, replyTo: email });
      postToSlack({ name, email, message }).catch(() => {});
      return res.redirect(303, redirectTo);
    } catch (err) {
      console.error('Graph sendMail error:', err?.response?.data || err);
      return res.status(502).send('Unable to send message right now.');
    }
  }
);

// --- 404 ---
app.use((req, res) => {
  res.status(404);
  if (req.accepts('html')) return res.sendFile(path.join(__dirname, 'public', '404.html'));
  if (req.accepts('json')) return res.json({ error: 'Not found' });
  return res.type('txt').send('Not found');
});

// --- Error handler ---
app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: NODE_ENV === 'production' ? 'Server error' : String(err) });
});

app.listen(PORT, () => {
  console.log(`FIG site listening on ${BASE_URL} (env: ${NODE_ENV})`);
});
