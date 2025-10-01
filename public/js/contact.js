// public/contact.js
(function () {
  // --- small helpers moved from inline (Edge CSP-safe) ---
  document.addEventListener('DOMContentLoaded', () => {
    const y = document.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();

    const msg = document.getElementById('msg');
    const count = document.getElementById('msg-count');
    if (msg && count) {
      const update = () => { count.textContent = msg.value.length; };
      msg.addEventListener('input', update);
      update();
    }
  });

  const form = document.getElementById("contact-form");
  if (!form) return;

  const submitBtn = document.getElementById("contact-submit");
  const statusEl = document.getElementById("form-status");

  // Status helpers
  const setStatus = (msg, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("text-red-600", isError);
    statusEl.classList.toggle("text-green-600", !isError);
  };

  const setBusy = (busy) => {
    if (submitBtn) submitBtn.disabled = busy;
    if (busy) setStatus("Sending…");
  };

  // Client-side validation (slightly stricter)
  function validate(fields) {
    const errors = [];
    const name = fields.get("name")?.toString().trim();
    const email = fields.get("email")?.toString().trim();
    const message = fields.get("message")?.toString().trim();
    const subject = fields.get("subject")?.toString().trim();
    const phone = fields.get("phone")?.toString().trim();

    if (!name || name.length < 2) errors.push("Please enter your name.");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push("Please enter a valid email.");
    if (!subject) errors.push("Please choose a subject.");
    if (!message || message.length < 1) errors.push("Please enter a message.");
    if (phone && !/^[0-9\-\+\(\)\s\.]{7,20}$/.test(phone))
      errors.push("Please enter a valid phone (digits and ()-+ . only).");

    return errors;
  }

  async function postWithTimeout(url, body, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);

    // Honeypot quick exit (pretend success)
    if ((formData.get("_gotcha") || "").toString().length > 0) {
      setStatus("Thanks!");
      form.reset();
      return;
    }

    // Client-side validate
    const errors = validate(formData);
    if (errors.length) {
      setStatus(errors[0], true);
      return;
    }

    setBusy(true);

    try {
      // Send as x-www-form-urlencoded (matches your Express handler)
      const body = new URLSearchParams(formData).toString();
      const res = await postWithTimeout(form.action || "/api/contact", body, 15000);

      // Your server 303-redirects when _redirect is present; emulate it in fetch world
      const redirectTo = formData.get("_redirect");
      if (res.ok) {
        const loc = res.headers.get("Location");
        if (redirectTo && (res.status === 303 || loc)) {
          window.location.href = loc || redirectTo;
          return;
        }
        const text = await res.text().catch(() => "");
        setStatus(text || "✅ Thanks! We’ll be in touch soon.");
        form.reset();
      } else if (res.status === 204) {
        setStatus("Thanks!");
        form.reset();
      } else {
        const text = await res.text().catch(() => "");
        setStatus(text || "❌ Failed to send. Please try again.", true);
      }
    } catch (err) {
      console.error("Contact submission error:", err);
      setStatus("❌ Network error. Please try again.", true);
    } finally {
      setBusy(false);
    }
  });
})();
