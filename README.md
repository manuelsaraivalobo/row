# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Goals tracker (Day Ring, Goal Ticker, To Do list) — the home page |
| [health.html](health.html) | Supplement / daily stack tracker |
| [finance.html](finance.html) | Finances |
| [topbar.js](topbar.js) | Shared top bar — auto-injected into pages that `<script src="topbar.js">` |

Each app stores its own state in browser `localStorage`. No accounts, no server.

## Notion tasks (optional)

The home page shows open tasks from a Notion "Task List" database under **From Notion**. Tap **+ Today** to add one to today's list (sets it to *Today* in Notion); ticking it off sets it to *Done 🙌*.

[api/notion.js](api/notion.js) is a Vercel function that holds the Notion key. In Vercel → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `NOTION_TOKEN` | Secret from a Notion integration that has access to the Task List |
| `DASHBOARD_PASSCODE` | Any passcode; you type it once per device on the dashboard |
| `NOTION_DATABASE_ID` | Optional, to use a different database |

It only works on Vercel (or `vercel dev`); opening `index.html` directly shows the card but can't reach Notion.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.
