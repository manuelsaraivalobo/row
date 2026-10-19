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

## Morning brief (optional)

The yellow card at the top shows today's brief: headline, the day in three parts, and *Needs attention* items with **+ Today** buttons. A weekday Claude scheduled task writes it as a JSON code block on a Notion page; [api/brief.js](api/brief.js) reads that page with the same `NOTION_TOKEN` (share the page with your integration). Set `NOTION_BRIEF_PAGE_ID` to use a different page.

## Sync across devices (optional)

Everything the pages save (goals, finance, debts…) lives in each device's `localStorage`. [sync.js](sync.js), loaded first on every page, copies changes to Supabase through [api/state.js](api/state.js) (behind `DASHBOARD_PASSCODE`) and pulls newer copies from other devices; last change wins per item. Without the variables below it does nothing.

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_KEY` | The project's secret / `service_role` key |

Create the table once in Supabase → SQL editor:

```sql
create table app_state (key text primary key, data jsonb, updated_ms bigint not null default 0);
alter table app_state enable row level security;
```

## Calendar (optional)

The home page shows **Today** (your events, with now / next) and **This week** (one row per day with busy blocks). [api/calendar.js](api/calendar.js) reads your calendar's secret iCal link — read-only — using the same `DASHBOARD_PASSCODE`.

| Name | Value |
|---|---|
| `CALENDAR_ICS_URL` | Google Calendar → Settings → your calendar → *Secret address in iCal format*. Several links can be separated by spaces. |

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.
