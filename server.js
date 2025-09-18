// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();

// --- Core runtime + proxies (Azure sits behind a proxy) ---
app.set('trust proxy', 1); // respect X-Forwarded-* headers from Azure
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:' + PORT;

// --- Minimal logging (skip noisy assets in prod) ---
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req) => NODE_ENV === 'production' && req.path.startsWith('/assets/')
}));

// --- Security headers ---
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // allow your JS
      "script-src": ["'self'", "'unsafe-inline'"],     // keep if you have inline scripts
      "script-src-attr": ["'unsafe-inline'"],          // allow onclick= etc. if you use them
      // allow inline <style> blocks or style="" used by theme toggler
      "style-src": ["'self'", "'unsafe-inline'"],
      // (optional) if the toggler injects <style> tags specifically
      "style-src-elem": ["'self'", "'unsafe-inline'"],
      // assets
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "upgrade-insecure-requests": []
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));


// --- Enforce HTTPS + optional canonical host ---
const CANONICAL_HOST = process.env.CANONICAL_HOST; // e.g. "www.franklininnovationgroup.com"
app.use((req, res, next) => {
  // force https
  if (NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    const url = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, url);
  }
  // optional canonical host redirect
  if (NODE_ENV === 'production' && CANONICAL_HOST && req.headers.host !== CANONICAL_HOST) {
    const url = `https://${CANONICAL_HOST}${req.url}`;
    return res.redirect(301, url);
  }
  next();
});

// --- Compression + parsers ---
app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// --- Static files with solid caching ---
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  // cache fingerprinted assets longer; others shorter
  setHeaders: (res, filePath) => {
    if (/\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    }
  }
}));

// --- Health check (Azure “Health check” feature, uptime checks, etc.) ---
app.get(['/healthz', '/_health'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, env: NODE_ENV, time: new Date().toISOString() });
});

// --- Rate limit the contact form /api/contact ---
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/contact', contactLimiter, async (req, res, next) => {
  try {
    const { name = '', email = '', message = '' } = req.body || {};

    // basic validation
    if (!name.trim() || !email.includes('@') || !message.trim()) {
      return res.status(400).json({ ok: false, error: 'Please provide name, valid email, and a message.' });
    }

    // optional simple honeypot field
    if (req.body.company || req.body.website) {
      return res.status(200).json({ ok: true }); // silently drop bots
    }

    // Choose your mailer: Microsoft Graph (your graphMail.js) or Nodemailer SMTP.
    const method = (process.env.MAIL_METHOD || 'graph').toLowerCase();

    if (method === 'smtp') {
      // --- Nodemailer path ---
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.CONTACT_FROM || process.env.SMTP_USER,
        to: process.env.CONTACT_TO,
        subject: `FIG website contact: ${name}`,
        replyTo: email,
        text: message,
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p>${message.replace(/\n/g, '<br>')}</p>`
      });
    } else {
      // --- Microsoft Graph path ---
      // expects you already have graphMail.js wired to send using app registration
      const { sendGraphMail } = require('./graphMail.js'); // adapt export if needed
      await sendGraphMail({
        to: process.env.CONTACT_TO,
        subject: `FIG website contact: ${name}`,
        replyTo: email,
        text: message
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- 404 for anything not caught (let your /public/404.html handle pretty page) ---
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
