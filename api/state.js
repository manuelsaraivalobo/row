// =============================================================
// Vercel serverless function: sync the app's saved data through Supabase.
//
//   GET  /api/state                 → { rows: [{ key, data, updated_ms }] }
//   POST /api/state { changes: [{ key, data, updated_ms }] }
//        → { accepted: [key], newer: [{ key, data, updated_ms }] }
//
// Each row is one localStorage key (e.g. "debts_v1", "goals:2026-10-19").
// Last write wins per key: a change is only stored if it's newer than
// what Supabase has; otherwise the newer cloud copy is sent back.
// data = null means the key was deleted.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   SUPABASE_URL          https://<project>.supabase.co (required)
//   SUPABASE_SERVICE_KEY  the project's service_role secret (required)
//   DASHBOARD_PASSCODE    same passcode as the other functions (required)
// Table (run once in Supabase → SQL editor):
//   create table app_state (key text primary key, data jsonb,
//     updated_ms bigint not null default 0);
//   alter table app_state enable row level security;
// =============================================================

const KEY_PATTERN = /^(goals:\d{4}-\d{2}-\d{2}|goal_streak_v1|nw:[a-z]+|nw_currency|subs|wishlist|debts_v1)$/;
const MAX_CHANGES = 300;

function supabase(path, init) {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  const auth = { 'apikey': key };
  // Legacy service_role keys are JWTs and also go in Authorization;
  // the newer "sb_secret_…" keys must only be sent as apikey.
  if (!/^sb_/.test(key)) auth['Authorization'] = 'Bearer ' + key;
  return fetch(base + '/rest/v1/' + path, Object.assign({}, init, {
    headers: Object.assign(auth, { 'Content-Type': 'application/json' }, (init && init.headers) || {})
  }));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function supabaseError(status) {
  const err = new Error('Supabase responded ' + status);
  err.code = status === 401 || status === 403 ? 'supabase-bad-key'
           : status === 404 ? 'supabase-no-table'
           : 'supabase-error';
  return err;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.DASHBOARD_PASSCODE) {
    return res.status(503).json({ error: 'not-configured' });
  }
  if (req.headers['x-passcode'] !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).json({ error: 'bad-passcode' });
  }

  try {
    if (req.method === 'GET') {
      const r = await supabase('app_state?select=key,data,updated_ms', { method: 'GET' });
      if (!r.ok) throw supabaseError(r.status);
      const rows = (await r.json()).filter(row => KEY_PATTERN.test(row.key));
      return res.status(200).json({ rows });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const changes = (Array.isArray(body.changes) ? body.changes : [])
        .filter(c => c && typeof c.key === 'string' && KEY_PATTERN.test(c.key) && Number.isFinite(c.updated_ms))
        .slice(0, MAX_CHANGES);
      if (!changes.length) return res.status(200).json({ accepted: [], newer: [] });

      // What the cloud has for these keys right now.
      const list = changes.map(c => '"' + c.key + '"').join(',');
      const r = await supabase('app_state?select=key,data,updated_ms&key=in.(' + encodeURIComponent(list) + ')', { method: 'GET' });
      if (!r.ok) throw supabaseError(r.status);
      const current = {};
      (await r.json()).forEach(row => { current[row.key] = row; });

      const toWrite = [], newer = [];
      changes.forEach(c => {
        const cur = current[c.key];
        if (cur && Number(cur.updated_ms) >= c.updated_ms) newer.push(cur);
        else toWrite.push({ key: c.key, data: c.data === undefined ? null : c.data, updated_ms: Math.round(c.updated_ms) });
      });
      if (toWrite.length) {
        const w = await supabase('app_state?on_conflict=key', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(toWrite)
        });
        if (!w.ok) throw supabaseError(w.status);
      }
      return res.status(200).json({ accepted: toWrite.map(c => c.key), newer });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  } catch (e) {
    return res.status(502).json({ error: e.code || 'supabase-error', message: e.message });
  }
};
