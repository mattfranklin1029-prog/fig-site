// server.js — Express + Microsoft Graph (v3) + Slack webhook
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
// IMPORTANT for express-rate-limit v7:
const { rateLimit } = require('express-rate-limit');
const morgan = require('morgan');
require('isomorphic-fetch'); // fetch for Node

// --- Slack notify (Incoming Webhook) ---
async function sendSlackNotification({ name, email, phone, subject, message, ip, ua }) {
  const url = (process.env.SLACK_WEBHOOK_URL || '').trim();
  if (!url) return; // silently skip if not configured

  const blocks = [
    { type: "header", text: { type: "plain_text", text: "📬 New FIG Contact", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Name:*\n${name || "—"}` },
        { type: "mrkdwn", text: `*Email:*\n${email || "—"}` },
        { type: "mrkdwn", text: `*Phone:*\n${phone || "—"}` },
        { type: "mrkdwn", text: `*Subject:*\n${subject || "—"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Message:*\n${message || "—"}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `IP: ${ip || "—"}  |  UA: ${ua || "—"}` }] },
  ];

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `New contact from ${name || "Unknown"}`, blocks })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("Slack webhook error:", resp.status, body);
  }
}

// --- Graph v3
const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const { TokenCredentialAuthenticationProvider } =
  require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { body, validationResult } = require('express-validator');

// --- Import the SSE route (CommonJS)
const bertlineStream = require('./routes/bertline-stream.js');

const app = express();

// --- Runtime ---
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// --- Logging ---
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// --- Security headers ---
// NOTE: allow jsDelivr for AG Charts, and keep connect-src 'self' for SSE
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      "script-src-elem": ["'self'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'", "data:"],
      "form-action": ["'self'"],
      "connect-src": ["'self'"], // SSE is same-origin: /api/bertline/stream
      "upgrade-insecure-requests": []
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// --- Compression + parsers ---
// Skip compression for SSE to avoid buffering the stream.
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/api/bertline/stream') return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
  }
}));

// --- Health check ---
app.get(['/healthz', '/_health'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, env: NODE_ENV, time: new Date().toISOString() });
});

// --- Helpers ---
const sanitize = (s = '') => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// --- Graph v3 client (app-only) with safe initialization ---
const requiredGraphKeys = ['GRAPH_TENANT_ID','GRAPH_CLIENT_ID','GRAPH_CLIENT_SECRET','GRAPH_SENDER'];
const hasGraphConfig = requiredGraphKeys.every(k => !!process.env[k]);

let graph = null;
if (hasGraphConfig) {
  const credential = new ClientSecretCredential(
    process.env.GRAPH_TENANT_ID,
    process.env.GRAPH_CLIENT_ID,
    process.env.GRAPH_CLIENT_SECRET
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });
  graph = Client.initWithMiddleware({ authProvider });
} else {
  console.warn('Microsoft Graph not configured; missing:', requiredGraphKeys.filter(k => !process.env[k]).join(', '));
}

async function sendGraphMail({ subject, html, replyTo }) {
  if (!graph) throw new Error('Graph not configured');
  const fromAddress = process.env.GRAPH_SENDER;
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
  legacyHeaders: false
});

// --- Contact endpoint ---
app.post(
  '/api/contact',
  contactLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('name'),
    body('email').isEmail().normalizeEmail().withMessage('email'),
    body('message').trim().isLength({ min: 1, max: 5000 }).withMessage('message'),
    body('_gotcha').optional().isLength({ max: 0 }).withMessage('honeypot')
  ],
  async (req, res) => {
    try {
      const b = req.body || {};
      console.log('CONTACT SUBMIT', {
        hasBody: !!req.body,
        nameLen: (b.name || '').length,
        emailPresent: !!b.email,
        msgLen: (b.message || '').length,
        redirect: !!b._redirect
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.error('Validation errors:', errors.array().map(e => e.msg || e.param));
        if (b._redirect) return res.status(400).send('Invalid submission.');
        return res.status(400).json({ ok: false, error: 'Invalid submission.' });
      }

      const name = (b.name || '').trim();
      const email = (b.email || '').trim();
      const phone = (b.phone || '').trim();
      const message = (b.message || '').trim();
      const redirectTo = b._redirect || '/thank-you.html';

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

      // 1) Primary delivery via Graph
      await sendGraphMail({ subject, html, replyTo: email });

      // 2) Slack ping
      await sendSlackNotification({
        name,
        email,
        phone,
        subject,
        message,
        ip: req.ip,
        ua: req.get('user-agent')
      });

      // 3) Respond
      if (redirectTo) return res.redirect(303, redirectTo);
      return res.json({ ok: true, message: 'Thanks! Your message has been sent.' });

    } catch (err) {
      console.error('CONTACT SEND FAIL', {
        status: err?.status || err?.statusCode,
        code: err?.code,
        message: err?.message,
        graphBody: err?.response?.data || err?.body
      });
      if (req.body?._redirect) return res.status(502).send('Unable to send message right now.');
      return res.status(502).json({ ok: false, error: 'Unable to send message right now.' });
    }
  }
);

// --- Simple Slack test route ---
app.get('/_test/slack', async (req, res) => {
  try {
    await sendSlackNotification({
      name: 'Test',
      email: 'test@example.com',
      phone: '',
      subject: 'Slack test',
      message: 'Hello from FIG server ✅',
      ip: req.ip,
      ua: req.get('user-agent')
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Slack test failed:', e);
    res.status(500).json({ ok: false });
  }
});

// --- Mount the SSE route (AFTER compression filter is set up, BEFORE 404) ---
app.use(bertlineStream);

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

// --- Startup env sanity ---
console.log('ENV CHECK', {
  slackSet: !!(process.env.SLACK_WEBHOOK_URL || '').trim(),
  port: PORT,
  hasEnvFile: fs.existsSync(path.join(__dirname, '.env'))
});

// Bind to 0.0.0.0 for Azure Linux containers
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
