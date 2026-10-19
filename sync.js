// =============================================================
// Cloud sync for the app's saved data (goals, finance, debts…).
// Load this first on every page, before any page script:
//     <script src="sync.js"></script>
//
// Pages keep reading and writing localStorage exactly as before. This
// watches writes to the keys below, pushes them to /api/state (Supabase
// behind the dashboard passcode) a moment later, and on open pulls any
// newer copies from other devices. Last write wins per key. If another
// device changed something this page shows, the page reloads once.
// Without a passcode, or before Supabase is set up, it does nothing.
// =============================================================
(function () {
  'use strict';

  const SYNCED = /^(goals:\d{4}-\d{2}-\d{2}|goal_streak_v1|nw:[a-z]+|nw_currency|subs|wishlist|debts_v1)$/;
  const PASS_KEY = 'notion:passcode';
  const META_KEY = '__sync_meta';       // { key: last-change time (ms) }
  const PENDING_KEY = '__sync_pending'; // { key: 1 } not yet in the cloud
  const RELOAD_KEY = '__sync_reloaded';
  const PUSH_DELAY = 1500;

  const store = window.localStorage;
  const rawSet = Storage.prototype.setItem;
  const rawRemove = Storage.prototype.removeItem;
  const rawGet = Storage.prototype.getItem;
  let applying = false;
  let pushTimer = null;
  let disabled = false;

  function readJson(key, fallback) {
    try { return JSON.parse(rawGet.call(store, key)) || fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { rawSet.call(store, key, JSON.stringify(value)); } catch (e) {}
  }
  function passcode() {
    try { return rawGet.call(store, PASS_KEY) || ''; } catch (e) { return ''; }
  }

  function markChanged(key) {
    const meta = readJson(META_KEY, {});
    meta[key] = Date.now();
    writeJson(META_KEY, meta);
    const pending = readJson(PENDING_KEY, {});
    pending[key] = 1;
    writeJson(PENDING_KEY, pending);
    schedulePush();
  }

  // Pages write empty defaults when they open (e.g. "[]" for today's goals).
  // Those aren't real changes and must never beat data from another device.
  function isEmptyValue(v) {
    return v === null || v === '' || v === '[]' || v === '{}' || v === 'null';
  }

  // Watch the pages' own writes; only real changes are synced.
  Storage.prototype.setItem = function (key, value) {
    const watched = this === store && !applying && SYNCED.test(key);
    const before = watched ? rawGet.call(this, key) : null;
    rawSet.call(this, key, value);
    const after = String(value);
    if (watched && after !== before && !(isEmptyValue(after) && isEmptyValue(before))) markChanged(key);
  };
  Storage.prototype.removeItem = function (key) {
    const watched = this === store && !applying && SYNCED.test(key);
    const before = watched ? rawGet.call(this, key) : null;
    rawRemove.call(this, key);
    if (watched && !isEmptyValue(before)) markChanged(key);
  };

  async function api(method, body, keepalive) {
    const res = await fetch('/api/state', {
      method,
      keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json', 'x-passcode': passcode() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 || res.status === 401) disabled = true; // not set up / wrong passcode
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // Write a cloud copy into this device. Returns true if anything changed.
  function applyRemote(row) {
    const meta = readJson(META_KEY, {});
    const localMs = meta[row.key] || 0;
    if (Number(row.updated_ms) <= localMs) return false;
    const current = rawGet.call(store, row.key);
    const incoming = row.data === null || row.data === undefined ? null : JSON.stringify(row.data);
    // Keep a copy of data that was never synced before it gets replaced.
    if (!localMs && current !== null && current !== incoming) {
      try { rawSet.call(store, '__sync_backup:' + row.key, current); } catch (e) {}
    }
    applying = true;
    try {
      if (incoming === null) rawRemove.call(store, row.key);
      else rawSet.call(store, row.key, incoming);
    } finally { applying = false; }
    meta[row.key] = Number(row.updated_ms);
    writeJson(META_KEY, meta);
    const pending = readJson(PENDING_KEY, {});
    delete pending[row.key];
    writeJson(PENDING_KEY, pending);
    return current !== incoming;
  }

  function schedulePush() {
    if (disabled || !passcode()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { push(false); }, PUSH_DELAY);
  }

  async function push(keepalive) {
    if (disabled || !passcode()) return;
    const pending = readJson(PENDING_KEY, {});
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const meta = readJson(META_KEY, {});
    const changes = keys.map(key => {
      const raw = rawGet.call(store, key);
      let data = null;
      try { data = raw === null ? null : JSON.parse(raw); } catch (e) { data = raw; }
      return { key, data, updated_ms: meta[key] || Date.now() };
    });
    try {
      const result = await api('POST', { changes }, keepalive);
      const now = readJson(META_KEY, {});
      const left = readJson(PENDING_KEY, {});
      (result.accepted || []).forEach(key => {
        // Only clear it if nothing changed again while we were sending.
        if ((now[key] || 0) === (meta[key] || 0)) delete left[key];
      });
      writeJson(PENDING_KEY, left);
      let changed = false;
      (result.newer || []).forEach(row => { if (applyRemote(row)) changed = true; });
      if (changed) reloadOnce();
    } catch (e) { /* offline or not set up: stays pending, retried later */ }
  }

  async function pull() {
    if (disabled || !passcode()) return;
    try {
      const result = await api('GET');
      const rows = result.rows || [];
      let changed = false;
      rows.forEach(row => { if (applyRemote(row)) changed = true; });

      // Anything saved here that the cloud doesn't have yet gets sent up.
      const inCloud = new Set(rows.map(r => r.key));
      const meta = readJson(META_KEY, {});
      const pending = readJson(PENDING_KEY, {});
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!SYNCED.test(key) || inCloud.has(key) || isEmptyValue(rawGet.call(store, key))) continue;
        if (!meta[key]) meta[key] = Date.now();
        pending[key] = 1;
      }
      writeJson(META_KEY, meta);
      writeJson(PENDING_KEY, pending);

      if (changed) reloadOnce();
      else push(false);
    } catch (e) { /* offline or not set up */ }
  }

  // Show the other device's changes: reload, but never twice in a row.
  function reloadOnce() {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 15000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    location.reload();
  }

  pull();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) push(true);
    else pull();
  });
  window.addEventListener('pagehide', () => { push(true); });
  window.addEventListener('online', () => { push(false); });

  // Let the pages trigger a sync right after the passcode is entered.
  window.lobosSync = { pull: () => { disabled = false; return pull(); }, push: () => push(false) };
})();
