// Shared Notion helpers for the api/ functions (files starting with "_"
// are not exposed as endpoints).

const NOTION_VERSION = '2022-06-28';

function notion(path, method, body) {
  return fetch('https://api.notion.com/v1/' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + process.env.NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// 401 = the key is wrong; 403/404 = the key can't see the page or database
// (not shared with the integration).
function notionError(status) {
  const err = new Error('Notion responded ' + status);
  err.code = status === 401 ? 'notion-bad-token'
           : status === 403 || status === 404 ? 'notion-no-access'
           : 'notion-error';
  return err;
}

module.exports = { notion, notionError };
