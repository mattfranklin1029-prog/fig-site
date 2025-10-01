// public/contact.js
(function () {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const submitBtn = document.getElementById("contact-submit");
  const statusEl = document.getElementById("form-status");

  // Simple client-side validation
  function validate(fields) {
    const errors = [];
    const name = fields.get("name")?.trim();
    const email = fields.get("email")?.trim();
    const message = fields.get("message")?.trim();

    if (!name || name.length < 2) errors.push("Please enter your name.");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push("Please enter a valid email.");
    if (!message || message.length < 1)
      errors.push("Please enter a message.");

    return errors;
  }

  // Small helpers
  const setBusy = (busy) => {
    if (submitBtn) submitBtn.disabled = busy;
    if (busy) {
      setStatus("Sending…");
    }
  };

  const setStatus = (msg, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("text-red-600", isError);
    statusEl.classList.toggle("text-green-600", !isError);
  };

  async function postWithTimeout(url, body, timeoutMs = 10000) {
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

      // If backend responds with a redirect (e.g., 303) the browser won't auto-follow on fetch.
      // Your server returns a 303 when _redirect is present; emulate it:
      const redirectTo = formData.get("_redirect");

      if (res.ok) {
        // If you want to follow server-provided Location header instead:
        const loc = res.headers.get("Location");
        if (redirectTo && (res.status === 303 || loc)) {
          window.location.href = loc || redirectTo;
          return;
        }
        // Otherwise show a friendly message
        const text = await res.text().catch(() => "");
        setStatus(text || "✅ Thanks! We’ll be in touch soon.");
        form.reset();
      } else if (res.status === 204) {
        // Honeypot path (shouldn’t happen here, but keep for parity)
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
