// public/js/theme.js
(function () {
  // ----- THEME TOGGLER -----
  const KEY = 'fig-theme'; // '', 'theme-emerald', 'theme-plum', 'theme-light'
  const CYCLE = ['', 'theme-emerald', 'theme-plum', 'theme-light']; // default navy = ''

  function getSaved() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }

  function applyTheme(theme, btn) {
    const b = document.body;
    b.classList.remove('theme-emerald', 'theme-plum', 'theme-light');
    if (theme) b.classList.add(theme);

    if (btn) {
      btn.textContent =
        theme === 'theme-emerald' ? '💚' :
        theme === 'theme-plum'    ? '🍇' :
        theme === 'theme-light'   ? '☀️' :
                                    '🌗';
    }

    try { localStorage.setItem(KEY, theme); } catch {}
  }

  function currentFromBody() {
    const c = document.body.classList;
    if (c.contains('theme-emerald')) return 'theme-emerald';
    if (c.contains('theme-plum'))    return 'theme-plum';
    if (c.contains('theme-light'))   return 'theme-light';
    return '';
  }

  function wireTheme() {
    const btn = document.getElementById('themeToggle') || document.querySelector('[data-theme-toggle]');
    const initial = getSaved() || currentFromBody();
    applyTheme(initial, btn);

    if (btn) {
      btn.addEventListener('click', () => {
        const cur = getSaved() || currentFromBody();
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        applyTheme(next, btn);
      });
    }

    // optional explicit pickers e.g. <button data-theme-pick="theme-plum">
    document.querySelectorAll('[data-theme-pick]').forEach(el => {
      el.addEventListener('click', () => applyTheme(el.getAttribute('data-theme-pick') || '', btn));
    });
  }

  // ----- FOOTER YEAR -----
  function setFooterYear() {
    const y = document.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();
  }

  // ----- FORMSPREE UX (status & fallback) -----
  function wireFormspreeStatus() {
    const form = document.querySelector('form[action^="https://formspree.io"]');
    const status = document.getElementById('formStatus');
    if (!form || !status) return;

    form.addEventListener('submit', () => {
      status.textContent = 'Sending…';
      // If the browser blocks redirect/pop, give a friendly nudge
      setTimeout(() => {
        if (status.textContent === 'Sending…') {
          status.textContent = 'If nothing happens, your browser blocked the redirect. You can email me directly instead.';
        }
      }, 6000);
    });
  }

  // ----- INIT -----
  function init() {
    wireTheme();
    setFooterYear();
    wireFormspreeStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
