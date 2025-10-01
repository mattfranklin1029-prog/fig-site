// public/js/helpers.js
(() => {
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Image fallback chain ---
  const EXT_CHAIN = ['avif','webp','jpg','png','jpeg','jfif'];
  function applyFallback(img) {
    const base = img.dataset.base || (img.currentSrc || img.src).replace(/\.(avif|webp|jfif|jpeg|jpg|png)(\?.*)?$/i, '');
    let i = 0;
    const currentExtMatch = (img.getAttribute('src') || '').match(/\.(\w+)$/);
    if (currentExtMatch) {
      const ext = currentExtMatch[1].toLowerCase();
      const idx = EXT_CHAIN.indexOf(ext);
      if (idx > -1) i = idx;
    }
    function tryNext() {
      if (i >= EXT_CHAIN.length) return;
      const nextSrc = `${base}.${EXT_CHAIN[i++]}`;
      const probe = new Image();
      probe.onload = () => { img.src = nextSrc; img.removeAttribute('data-fallback-active'); };
      probe.onerror = tryNext;
      img.setAttribute('data-fallback-active','1');
      probe.src = nextSrc + (nextSrc.includes('?') ? '&' : '?') + 'v=' + EXT_CHAIN[i-1];
    }
    img.addEventListener('error', function onerr() {
      img.removeEventListener('error', onerr);
      tryNext();
    }, { once:true });
    if (!img.hasAttribute('loading')) img.loading = 'lazy';
  }

  // Apply fallback to key images
  $$('.lb-thumb, .ba-wrap img, .hero-img, img[data-base], .modal img').forEach(applyFallback);

  // --- Footer years (y, y2, y3, y4) ---
  ['y','y2','y3','y4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = new Date().getFullYear();
  });

  // --- Animated counters ---
  (function initCounters() {
    const counters = $$('.counter'); if (!counters.length) return;
    if (prefersReduced) { counters.forEach(el => el.textContent = el.dataset.target || '0'); return; }
    const ob = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.target || '0', 10);
        const dur = parseInt(el.dataset.duration || '900', 10);
        const start = performance.now();
        function tick(t) {
          const p = Math.min(1, (t - start) / dur);
          el.textContent = Math.round(target * p);
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        ob.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(c => ob.observe(c));
  })();

  // --- Before/After slider ---
  (function initBA() {
    const wrap = $('.ba-wrap'); if (!wrap) return;
    const topLayer = wrap.querySelector('.ba-top');
    const handle = wrap.querySelector('.ba-handle');
    const line = wrap.querySelector('.ba-line');
    let dragging = false;
    function setPct(pct) {
      pct = Math.max(0, Math.min(100, pct));
      topLayer.style.width = pct + '%';
      handle.style.left = pct + '%';
      line.style.left = pct + '%';
      handle.setAttribute('aria-valuenow', Math.round(pct));
    }
    function clientXToPct(clientX) {
      const r = wrap.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * 100;
    }
    function onMove(e) {
      if (!dragging) return;
      const cX = e.touches ? e.touches[0].clientX : e.clientX;
      setPct(clientXToPct(cX));
      e.preventDefault();
    }
    function onDown(e){ dragging = true; onMove(e); }
    function onUp(){ dragging = false; }
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove, { passive:false });
    window.addEventListener('mouseup', onUp);
    handle.addEventListener('touchstart', onDown, { passive:true });
    window.addEventListener('touchmove', onMove, { passive:false });
    window.addEventListener('touchend', onUp);
    handle.addEventListener('keydown', (e) => {
      const cur = parseFloat(handle.style.left) || 50;
      if (e.key === 'ArrowLeft')  setPct(cur - 2);
      if (e.key === 'ArrowRight') setPct(cur + 2);
    });
    let lastPct = parseFloat(handle.style.left) || 50;
    window.addEventListener('resize', () => setPct(lastPct));
    setPct(isNaN(lastPct) ? 50 : lastPct);
  })();

  // --- Lightbox ---
  (function initLightbox() {
    const lb = document.getElementById('lightbox'); if (!lb) return;
    const lbImg = document.getElementById('lb-img');
    const prevBtn = lb.querySelector('.lb-prev');
    const nextBtn = lb.querySelector('.lb-next');
    const closeBtn = lb.querySelector('.lb-close');
    const thumbs = $$('.lb-thumb'); if (!thumbs.length) return;
    thumbs.forEach(applyFallback);
    let idx = -1, touchStartX = 0;
    function srcFor(i) {
      const t = thumbs[i];
      return (t.dataset.src || t.currentSrc || t.src);
    }
    function updateLB() {
      if (idx < 0) return;
      lbImg.src = srcFor(idx);
      lbImg.alt = thumbs[idx].alt || '';
      [ (idx+1)%thumbs.length, (idx-1+thumbs.length)%thumbs.length ].forEach(j => {
        const p = new Image(); p.src = srcFor(j);
      });
    }
    function openLB(i) {
      idx = i; updateLB();
      lb.classList.add('open');
      lb.setAttribute('aria-hidden','false');
      closeBtn.focus();
      document.body.style.overflow = 'hidden';
    }
    function closeLB() {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    }
    thumbs.forEach((t,i)=> t.addEventListener('click', () => openLB(i)));
    prevBtn.addEventListener('click', () => { idx = (idx - 1 + thumbs.length) % thumbs.length; updateLB(); });
    nextBtn.addEventListener('click', () => { idx = (idx + 1) % thumbs.length; updateLB(); });
    closeBtn.addEventListener('click', closeLB);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLB(); });
    window.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLB();
      if (e.key === 'ArrowRight') nextBtn.click();
      if (e.key === 'ArrowLeft')  prevBtn.click();
    });
    lb.addEventListener('touchstart', (e)=> { touchStartX = e.touches[0].clientX; }, {passive:true});
    lb.addEventListener('touchend', (e)=> {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 30) (dx < 0 ? nextBtn : prevBtn).click();
    }, {passive:true});
  })();

  // --- Project Modals ---
  (function initModals() {
    const triggers = $$('.project-trigger'); if (!triggers.length) return;
    const modals = { p1: $('#modal-p1'), p2: $('#modal-p2'), p3: $('#modal-p3') };
    let lastFocus = null;
    function openModal(id) {
      const m = modals[id]; if (!m) return;
      lastFocus = document.activeElement;
      m.classList.add('open');
      const closer = m.querySelector('.close-modal'); closer && closer.focus();
      document.body.style.overflow = 'hidden';
      function trap(e) {
        if (!m.classList.contains('open')) return window.removeEventListener('focusin', trap);
        if (!m.contains(e.target)) closer && closer.focus();
      }
      window.addEventListener('focusin', trap);
      m._trap = trap;
    }
    function closeModal(m) {
      if (!m) return;
      m.classList.remove('open');
      document.body.style.overflow = '';
      window.removeEventListener('focusin', m._trap || (()=>{}));
      lastFocus && lastFocus.focus();
    }
    triggers.forEach(btn => btn.addEventListener('click', () => openModal(btn.dataset.project)));
    $$('.modal').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
      const closeBtn = m.querySelector('.close-modal');
      closeBtn && closeBtn.addEventListener('click', () => closeModal(m));
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      $$('.modal.open').forEach(m => closeModal(m));
    });
  })();

})(); 
