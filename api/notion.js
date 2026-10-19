// =============================================================
// Vercel serverless function: bridge between the dashboard and the
// Notion "Task List" database. Runs on Vercel, so the Notion key never
// reaches the browser.
//
//   GET  /api/notion                      → open tasks as suggestions
//   POST /api/notion  { id, status }      → set a task's Status
//
// Environment variables (set in Vercel → Settings → Environment Variables):
//   NOTION_TOKEN        Notion integration secret (required)
//   DASHBOARD_PASSCODE  passcode the dashboard must send (required)
//   NOTION_DATABASE_ID  optional, defaults to the Task List below
// =============================================================

const { notion, notionError } = require('./_notion');

const DEFAULT_DATABASE_ID = '0d17ef02b86c4df59ed7d9a50e6d3cf3';

const OPEN_STATUSES = ['Today', 'Doing', 'Started', 'To Do'];
const SETTABLE_STATUSES = ['Today', 'Doing', 'Started', 'To Do', 'Done 🙌'];
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

function toTask(page) {
  const p = page.properties || {};
  const title = ((p.Task && p.Task.title) || []).map(t => t.plain_text).join('').trim();
  return {
    id: page.id,
    url: page.url,
    title: title || 'Untitled',
    status: p.Status && p.Status.select ? p.Status.select.name : null,
    priority: p.Priority && p.Priority.select ? p.Priority.select.name : null,
    due: p['Due Date'] && p['Due Date'].date ? p['Due Date'].date.start : null,
    tags: ((p.Tags && p.Tags.multi_select) || []).map(t => t.name)
  };
}

// Today/Doing/Started first, then To Do; within each, High → Low, then soonest due.
function compareTasks(a, b) {
  const sa = OPEN_STATUSES.indexOf(a.status) === 3 ? 1 : 0;
  const sb = OPEN_STATUSES.indexOf(b.status) === 3 ? 1 : 0;
  if (sa !== sb) return sa - sb;
  const pa = a.priority in PRIORITY_RANK ? PRIORITY_RANK[a.priority] : 3;
  const pb = b.priority in PRIORITY_RANK ? PRIORITY_RANK[b.priority] : 3;
  if (pa !== pb) return pa - pb;
  if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  return a.due ? -1 : b.due ? 1 : 0;
}

async function listTasks(databaseId) {
  const tasks = [];
  let cursor;
  do {
    const r = await notion('databases/' + databaseId + '/query', 'POST', {
      filter: { or: OPEN_STATUSES.map(s => ({ property: 'Status', select: { equals: s } })) },
      page_size: 100,
      start_cursor: cursor
    });
    if (!r.ok) throw notionError(r.status);
    const data = await r.json();
    data.results.forEach(page => tasks.push(toTask(page)));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && tasks.length < 300);
  return tasks.sort(compareTasks);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.NOTION_TOKEN || !process.env.DASHBOARD_PASSCODE) {
    return res.status(503).json({ error: 'not-configured' });
  }
  if (req.headers['x-passcode'] !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).json({ error: 'bad-passcode' });
  }

  const databaseId = process.env.NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ tasks: await listTasks(databaseId) });
    }

    if (req.method === 'POST') {
      const { id, status } = await readJson(req);
      if (typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id)) {
        return res.status(400).json({ error: 'bad-id' });
      }
      if (SETTABLE_STATUSES.indexOf(status) === -1) {
        return res.status(400).json({ error: 'bad-status' });
      }
      // Only touch pages that live in the Task List database.
      const page = await notion('pages/' + id, 'GET');
      if (!page.ok) return res.status(404).json({ error: 'not-found' });
      const pageData = await page.json();
      const parentId = ((pageData.parent && pageData.parent.database_id) || '').replace(/-/g, '');
      if (parentId !== databaseId.replace(/-/g, '')) {
        return res.status(403).json({ error: 'wrong-database' });
      }
      const r = await notion('pages/' + id, 'PATCH', {
        properties: { Status: { select: { name: status } } }
      });
      if (!r.ok) throw notionError(r.status);
      return res.status(200).json({ task: toTask(await r.json()) });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method-not-allowed' });
  } catch (e) {
    return res.status(502).json({ error: e.code || 'notion-error', message: e.message });
  }
};
