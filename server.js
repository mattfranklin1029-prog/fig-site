// server.js
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { sendMailViaGraph } = require("./graphMail");

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- middleware -------------------- */
app.use(helmet());
app.use(compression());

// support both form posts and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// serve static site from /public
app.use(express.static(path.join(__dirname, "public")));

// throttle the contact endpoint (anti-spam)
const contactLimiter = rateLimit({ windowMs: 60_000, max: 5 });

/* -------------------- routes -------------------- */

// POST /contact — form submission -> send mail via Microsoft Graph
app.post("/contact", contactLimiter, async (req, res) => {
  console.log("CONTACT body:", req.body); // keep during testing

  try {
    // Honeypot: hidden checkbox must remain unchecked
    if (req.body.hp_chk === "on") {
      return res.sendStatus(204); // silently ignore bots
    }

    const { name, email, message } = req.body || {};
    if (!name || !email) {
      return res.status(400).send("Name and email are required.");
    }

    const result = await sendMailViaGraph({
      from: process.env.GRAPH_SENDER, // licensed mailbox UPN in your tenant
      to: process.env.GRAPH_TO_EMAIL || process.env.GRAPH_SENDER,
      replyTo: email,
      subject: `New contact from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message || ""}`,
    });

    if (!result.ok) {
      console.error("Graph send failed:", result.error);
      return res
        .status(500)
        .send("Sorry, we couldn’t send your message right now.");
    }

    return res.send("✅ Thanks for reaching out — we’ll be in touch soon!");
  } catch (err) {
    console.error("Route error:", err);
    return res
      .status(500)
      .send("Unexpected error while sending your message.");
  }
});

// GET /test-mail — quick sanity test that bypasses the form
app.get("/test-mail", async (_req, res) => {
  const result = await sendMailViaGraph({
    from: process.env.GRAPH_SENDER,
    to: process.env.GRAPH_TO_EMAIL || process.env.GRAPH_SENDER,
    replyTo: "test@example.com",
    subject: "Graph test",
    text: "Hello from Graph test route",
  });

  if (!result.ok) {
    console.error("Graph test failed:", result.error);
    return res.status(500).send(result.error);
  }

  res.send("Test mail sent — check the sender's Sent Items.");
});

// 404 for anything else
app.use((_, res) => res.status(404).send("404: Not found"));

/* -------------------- start -------------------- */
app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
