// =============================================================
// Persistent dashboard tab bar (bottom of the screen, iOS style).
// Drop this on any page with:
//     <script src="topbar.js" defer></script>
// It self-injects HTML + CSS, reads progress from the same
// localStorage keys the dashboard's tabs already use.
// =============================================================
(function () {
  'use strict';

  // -------- CSS --------
  const css = `
.topbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  display: flex; justify-content: center; gap: 8px;
  padding: 6px max(16px, env(safe-area-inset-left)) calc(6px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));
  /* Frosted white, like the iOS tab bar. */
  background: rgba(255, 255, 255, 0.86);
  -webkit-backdrop-filter: saturate(1.8) blur(20px);
  backdrop-filter: saturate(1.8) blur(20px);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif;
}
.topbar-tab {
  flex: 1 1 0; max-width: 160px;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 5px 8px 3px;
  border-radius: 12px;
  text-decoration: none;
  color: #AEAEB2;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s;
}
.topbar-tab:hover { color: #6E6E73; }
.topbar-tab.active { color: #1D1D1F; }
.topbar-icon { position: relative; width: 26px; height: 26px; }
.topbar-icon svg { width: 26px; height: 26px; display: block; }
.topbar-label { font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }
.topbar-badge {
  position: absolute; top: -4px; left: 17px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px;
  border: 2px solid #FFFFFF;
  background: #FF9500; color: #FFFFFF;
  font-size: 11px; font-weight: 700; line-height: 14px; text-align: center;
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
}
.topbar-badge[hidden] { display: none; }
.topbar-tab.miss .topbar-badge { background: #FF3B30; }

/* Room so the last bit of every page can scroll above the bar. */
html body { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }

/* === Global mobile lockdown ===
   1) Hide the right-side scrollbar on phones (iOS uses overlay scrollbars anyway).
   2) Stop iOS auto-text-size-adjust.
   3) touch-action: pan-y prevents pinch-zoom while still allowing vertical scroll.
   4) overscroll-behavior on every common modal class stops scroll chaining —
      scrolling inside a settings popup won't drag the page behind it.
   5) When body has .topbar-modal-open, the page can't scroll at all (locked).
*/
html, body {
  -webkit-text-size-adjust: 100%;
}
@media (max-width: 768px) {
  html { touch-action: pan-y; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html, body { scrollbar-width: none; -ms-overflow-style: none; }
}
.modal-bg, .modal {
  overscroll-behavior: contain;
}
body.topbar-modal-open {
  overflow: hidden;
  touch-action: none;
}
/* On phones, blow the modals up to full screen and let them be the only
   scrolling element. Way less "is this scrolling the page or the modal?"
   confusion. */
@media (max-width: 480px) {
  .modal-bg {
    padding: 0 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .modal {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    height: 100vh !important;
    border-radius: 0 !important;
    padding-top: max(20px, env(safe-area-inset-top)) !important;
    padding-bottom: max(28px, env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
}
`;

  // -------- HTML --------
  const html = `
<nav class="topbar" id="topbar" aria-label="Pages">
  <a href="index.html" class="topbar-tab" id="topbarGoals" data-pages="/,/index.html,/brief.html">
    <span class="topbar-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16.5 9.5"/></svg>
      <span class="topbar-badge" id="topbarGoalsBadge" hidden></span>
    </span>
    <span class="topbar-label">Goals</span>
  </a>
  <a href="finance.html" class="topbar-tab" id="topbarFinance" data-pages="/finance.html">
    <span class="topbar-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6l9-3 2 3"/></svg>
    </span>
    <span class="topbar-label">Finance</span>
  </a>
</nav>
`;

  function injectStyleAndHTML() {
    if (document.getElementById('topbar')) return; // already injected
    const style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    document.body.appendChild(wrap.firstChild);

    // Highlight the tab for the page we're on.
    const here = location.pathname.replace(/^.*\//, '/') || '/';
    document.querySelectorAll('.topbar-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.pages.split(',').indexOf(here) !== -1);
    });
  }

  // -------- Active-date helpers (match the goals page 6 AM rollover) --------
  function activeDateKey() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // -------- Read progress from localStorage --------
  function getGoalsProgress() {
    const key = 'goals:' + activeDateKey();
    let goals = [];
    try { goals = JSON.parse(localStorage.getItem(key)) || []; } catch (e) {}
    const total = Array.isArray(goals) ? goals.length : 0;
    const done = total ? goals.filter(g => g && g.done).length : 0;
    return { done, total };
  }

  function classifyStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    // Past 6pm and still under half → flag as missed
    const h = new Date().getHours();
    if (h >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }

  function setTabStatus(tabEl, status) {
    tabEl.classList.remove('good', 'warn', 'miss');
    if (status === 'warn' || status === 'miss') tabEl.classList.add(status);
  }

  function render() {
    const goalsEl = document.getElementById('topbarGoals');
    if (!goalsEl) return; // not injected yet

    const g = getGoalsProgress();
    const left = g.total - g.done;
    const badge = document.getElementById('topbarGoalsBadge');
    badge.hidden = left <= 0;
    badge.textContent = left > 9 ? '9+' : String(left);
    goalsEl.setAttribute('aria-label', 'Goals, ' + (g.total ? g.done + ' of ' + g.total + ' done' : 'none set'));
    setTabStatus(goalsEl, classifyStatus(g.done, g.total));
  }

  // -------- Mobile lockdown helpers --------
  // Belt-and-suspenders zoom prevention — iOS Safari sometimes ignores
  // user-scalable=no, so we also kill the gesture events directly.
  function blockGesture(e) { e.preventDefault(); }
  function lockGestures() {
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });
    // Also kill the iOS double-tap-to-zoom on any tap.
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  // Watch every known modal-bg / overlay class — when any one of them
  // gets `.show` or `.is-open`, lock the body scroll. When the last
  // one closes, unlock.
  function startModalLock() {
    const MODAL_SELECTORS = ['.modal-bg'];
    function anyOpen() {
      for (const sel of MODAL_SELECTORS) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.classList.contains('show') || el.classList.contains('is-open')) {
            return true;
          }
        }
      }
      return false;
    }
    function sync() {
      document.body.classList.toggle('topbar-modal-open', anyOpen());
    }
    const observer = new MutationObserver(sync);
    // Observe class changes anywhere in body — modal toggles are rare so
    // a global subtree observer is cheap.
    observer.observe(document.body, {
      attributes: true, attributeFilter: ['class'], subtree: true
    });
    sync();
  }

  // -------- Boot --------
  function boot() {
    injectStyleAndHTML();
    render();
    lockGestures();
    startModalLock();

    // Re-render when localStorage changes from another tab/window OR when
    // the page becomes visible (sync may have pulled in the background).
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // Periodic refresh so counts stay current after midnight rollover etc.
    setInterval(render, 30 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
