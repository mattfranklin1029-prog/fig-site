const form = document.getElementById("contact-form");
const statusEl = document.getElementById("form-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "Sending...";

  try {
    const body = new URLSearchParams(new FormData(form)).toString();

    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });


    if (res.status === 204) {              // honeypot tripped
      statusEl.textContent = "Thanks!";
      form.reset();
      return;
    }

    const text = await res.text();
    statusEl.textContent =
      text || (res.ok ? "Thanks! We’ll be in touch soon." : "Failed to send.");
    if (res.ok) form.reset();
  } catch (err) {
    console.error("Contact form error:", err);
    statusEl.textContent = "Failed to send. Please try again.";
  }
});
