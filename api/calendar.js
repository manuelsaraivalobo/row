// =============================================================
// Vercel serverless function: read-only bridge to your calendars.
//
//   GET /api/calendar?start=<ISO>&end=<ISO>&tz=<IANA zone>
//     → { events: [{ id, title, location, allDay, start, end, calendar }] }
//
// Environment variables (Vercel → Settings → Environment Variables):
//   CALENDAR_ICS_URL    one or more secret iCal links, separated by
//                       spaces or commas (required)
//   DASHBOARD_PASSCODE  same passcode the Notion card uses (required)
// =============================================================

const { eventsInRange } = require('./_ics');

const MAX_RANGE_DAYS = 62;

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.CALENDAR_ICS_URL || !process.env.DASHBOARD_PASSCODE) {
    return res.status(503).json({ error: 'not-configured' });
  }
  if (req.headers['x-passcode'] !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).json({ error: 'bad-passcode' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const fromMs = Date.parse(q.start);
  const toMs = Date.parse(q.end);
  if (!isFinite(fromMs) || !isFinite(toMs) || toMs <= fromMs ||
      toMs - fromMs > MAX_RANGE_DAYS * 86400000) {
    return res.status(400).json({ error: 'bad-range' });
  }
  const tz = q.tz && validTz(q.tz) ? q.tz : 'UTC';

  const urls = process.env.CALENDAR_ICS_URL.split(/[\s,]+/).filter(Boolean)
    .map(u => u.replace(/^webcal:\/\//i, 'https://'));

  try {
    const lists = await Promise.all(urls.map(async (url, i) => {
      const r = await fetch(url, { headers: { 'Accept': 'text/calendar' } });
      if (!r.ok) {
        const err = new Error('Calendar responded ' + r.status);
        err.code = r.status === 404 || r.status === 403 || r.status === 401 ? 'calendar-bad-link' : 'calendar-error';
        throw err;
      }
      return eventsInRange(await r.text(), fromMs, toMs, tz, i);
    }));
    const events = [].concat(...lists).sort((a, b) =>
      a.start < b.start ? -1 : a.start > b.start ? 1 : (a.allDay ? -1 : 1));
    return res.status(200).json({ events });
  } catch (e) {
    return res.status(502).json({ error: e.code || 'calendar-error', message: e.message });
  }
};
