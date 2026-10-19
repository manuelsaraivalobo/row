// =============================================================
// Vercel serverless function: today's morning brief for the home page.
//
//   GET /api/brief → { brief: { date, headline, acts[], attention[], briefUrl } }
//
// The weekday "Morning brief" scheduled task writes the brief as a JSON
// code block on a Notion page; this reads that block. Same NOTION_TOKEN and
// DASHBOARD_PASSCODE as /api/notion.
//   NOTION_BRIEF_PAGE_ID  optional, defaults to the page below
// =============================================================

const { notion, notionError } = require('./_notion');

const DEFAULT_BRIEF_PAGE_ID = '3fe4ff525bb181e0a0d1dcdba2d3db91';

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function httpsUrl(v) {
  return typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim().slice(0, 2000) : '';
}

// Keep only the fields the dashboard shows, as plain strings.
function clean(raw) {
  const acts = Array.isArray(raw.acts) ? raw.acts : [];
  const attention = Array.isArray(raw.attention) ? raw.attention : [];
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : '',
    headline: str(raw.headline, 200),
    acts: acts.slice(0, 3).map(a => ({ time: str(a && a.time, 40), text: str(a && a.text, 280) }))
      .filter(a => a.time || a.text),
    attention: attention.slice(0, 5).map(a => ({
      title: str(a && a.title, 120), text: str(a && a.text, 400), url: httpsUrl(a && a.url)
    })).filter(a => a.title),
    briefUrl: httpsUrl(raw.briefUrl)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.NOTION_TOKEN || !process.env.DASHBOARD_PASSCODE) {
    return res.status(503).json({ error: 'not-configured' });
  }
  if (req.headers['x-passcode'] !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).json({ error: 'bad-passcode' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const pageId = (process.env.NOTION_BRIEF_PAGE_ID || DEFAULT_BRIEF_PAGE_ID).replace(/-/g, '');
  try {
    const r = await notion('blocks/' + pageId + '/children?page_size=50', 'GET');
    if (!r.ok) throw notionError(r.status);
    const data = await r.json();
    const block = (data.results || []).find(b => b.type === 'code');
    if (!block) return res.status(200).json({ brief: null });
    const text = (block.code.rich_text || []).map(t => t.plain_text).join('');
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return res.status(200).json({ brief: null, error: 'bad-json' }); }
    return res.status(200).json({ brief: clean(raw || {}) });
  } catch (e) {
    return res.status(502).json({ error: e.code || 'notion-error', message: e.message });
  }
};
