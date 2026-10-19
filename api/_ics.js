// =============================================================
// Minimal iCalendar (.ics) reader for the calendar function.
// Handles what Google / iCloud / Outlook feeds actually use:
// time zones (TZID), all-day events, RRULE (daily / weekly /
// monthly / yearly with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY),
// EXDATE, moved or cancelled single occurrences (RECURRENCE-ID).
// Files starting with "_" in api/ are not exposed as endpoints.
// =============================================================

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_DAYS_SCANNED = 20000; // ~55 years of daily steps, a safety stop

// ---------- time zones ----------
const offsetFormatters = {};
function tzOffsetMs(utcMs, tz) {
  let f = offsetFormatters[tz];
  if (!f) {
    f = offsetFormatters[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  const p = {};
  f.formatToParts(new Date(utcMs)).forEach(x => { p[x.type] = x.value; });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
}

// Wall-clock time in `tz` → UTC milliseconds (DST-correct).
function zonedToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let utc = guess - tzOffsetMs(guess, tz);
  const again = guess - tzOffsetMs(utc, tz);
  if (again !== utc) utc = again;
  return utc;
}

// ---------- parsing ----------
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseLine(line) {
  const colon = findValueColon(line);
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const params = {};
  parts.slice(1).forEach(p => {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  });
  return { name: parts[0].toUpperCase(), params, value };
}

// The first ":" that is not inside a quoted parameter value.
function findValueColon(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) return i;
  }
  return -1;
}

// "20261019", "20261019T080000", "20261019T080000Z"
function parseDateValue(value, params, defaultTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  if (params.VALUE === 'DATE' || !m[4]) return { allDay: true, wall };
  if (m[7]) return { allDay: false, wall, tz: 'UTC' };
  const tz = params.TZID && validTz(params.TZID) ? params.TZID : defaultTz;
  return { allDay: false, wall, tz };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = ((+(m[2] || 0)) * 7 * 86400 + (+(m[3] || 0)) * 86400 +
              (+(m[4] || 0)) * 3600 + (+(m[5] || 0)) * 60 + (+(m[6] || 0))) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRRule(v) {
  const r = {};
  v.split(';').forEach(kv => {
    const [k, val] = kv.split('=');
    if (k && val !== undefined) r[k.toUpperCase()] = val;
  });
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL || null,
    byDay: r.BYDAY ? r.BYDAY.split(',').map(s => {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s.trim().toUpperCase());
      return m ? { n: m[1] ? parseInt(m[1], 10) : 0, day: DAY_CODES.indexOf(m[2]) } : null;
    }).filter(Boolean) : null,
    byMonthDay: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(n => parseInt(n, 10)) : null,
    byMonth: r.BYMONTH ? r.BYMONTH.split(',').map(n => parseInt(n, 10)) : null,
    wkst: r.WKST ? DAY_CODES.indexOf(r.WKST.toUpperCase()) : 1
  };
}

function parseCalendar(text, fallbackTz) {
  const lines = unfold(text).split('\n');
  let calTz = fallbackTz;
  const events = [];
  let cur = null;
  let depth = 0; // nested components inside VEVENT (VALARM)
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    const prop = parseLine(line);
    if (!prop) continue;
    if (!cur) {
      if (prop.name === 'X-WR-TIMEZONE' && validTz(prop.value.trim())) calTz = prop.value.trim();
      continue;
    }
    if (prop.name === 'BEGIN') { depth++; continue; }
    if (prop.name === 'END') { depth--; continue; }
    if (depth > 0) continue;
    switch (prop.name) {
      case 'UID': cur.uid = prop.value.trim(); break;
      case 'SUMMARY': cur.title = unescapeText(prop.value).trim(); break;
      case 'LOCATION': cur.location = unescapeText(prop.value).trim(); break;
      case 'STATUS': cur.status = prop.value.trim().toUpperCase(); break;
      case 'DTSTART': cur.dtstartRaw = prop; break;
      case 'DTEND': cur.dtendRaw = prop; break;
      case 'DURATION': cur.duration = parseDuration(prop.value); break;
      case 'RRULE': cur.rrule = parseRRule(prop.value); break;
      case 'EXDATE': cur.exdates.push(prop); break;
      case 'RECURRENCE-ID': cur.recurrenceIdRaw = prop; break;
    }
  }
  // Resolve dates once the calendar's own time zone is known.
  events.forEach(e => {
    e.dtstart = e.dtstartRaw ? parseDateValue(e.dtstartRaw.value, e.dtstartRaw.params, calTz) : null;
    e.dtend = e.dtendRaw ? parseDateValue(e.dtendRaw.value, e.dtendRaw.params, calTz) : null;
    e.recurrenceId = e.recurrenceIdRaw
      ? parseDateValue(e.recurrenceIdRaw.value, e.recurrenceIdRaw.params, calTz) : null;
    e.exdateList = [];
    e.exdates.forEach(p => p.value.split(',').forEach(v => {
      const d = parseDateValue(v, p.params, calTz);
      if (d) e.exdateList.push(d);
    }));
  });
  return { events: events.filter(e => e.dtstart), tz: calTz };
}

// ---------- recurrence ----------
function dayNumber(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
function fromDayNumber(n) {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function matchesRule(rule, start, y, m, d, dn, startDn) {
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (rule.byMonth && rule.byMonth.indexOf(m) === -1) return false;
  switch (rule.freq) {
    case 'DAILY':
      if ((dn - startDn) % rule.interval !== 0) return false;
      if (rule.byDay && !rule.byDay.some(b => b.day === weekday)) return false;
      return true;
    case 'WEEKLY': {
      const days = rule.byDay ? rule.byDay.map(b => b.day)
                              : [new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay()];
      if (days.indexOf(weekday) === -1) return false;
      const weekStart = (n) => {
        const wd = new Date(n * 86400000).getUTCDay();
        return n - ((wd - rule.wkst + 7) % 7);
      };
      const weeks = Math.round((weekStart(dn) - weekStart(startDn)) / 7);
      return weeks % rule.interval === 0;
    }
    case 'MONTHLY': {
      const months = (y - start.y) * 12 + (m - start.m);
      if (months % rule.interval !== 0) return false;
      if (rule.byMonthDay) {
        const dim = daysInMonth(y, m);
        return rule.byMonthDay.some(n => (n > 0 ? n : dim + n + 1) === d);
      }
      if (rule.byDay) {
        const dim = daysInMonth(y, m);
        return rule.byDay.some(b => {
          if (b.day !== weekday) return false;
          if (!b.n) return true;
          const nth = Math.floor((d - 1) / 7) + 1;
          const nthFromEnd = Math.floor((dim - d) / 7) + 1;
          return b.n > 0 ? nth === b.n : nthFromEnd === -b.n;
        });
      }
      return d === start.d;
    }
    case 'YEARLY': {
      if ((y - start.y) % rule.interval !== 0) return false;
      if (!rule.byMonth && m !== start.m) return false;
      if (rule.byMonthDay) return rule.byMonthDay.indexOf(d) !== -1;
      return d === start.d;
    }
    default:
      return false;
  }
}

function instantKey(dt, tz) {
  return dt.allDay
    ? 'D' + dt.wall.y + '-' + dt.wall.m + '-' + dt.wall.d
    : 'T' + zonedToUtc(dt.wall, dt.tz || tz);
}

// Expand one event into concrete occurrences overlapping [fromMs, toMs).
// All-day events are placed in `viewTz` so they line up with the viewer's days.
function expandEvent(e, fromMs, toMs, viewTz) {
  const start = e.dtstart;
  const tz = start.tz || viewTz;
  const startUtc = start.allDay ? zonedToUtc(start.wall, viewTz) : zonedToUtc(start.wall, tz);

  let durationMs;
  if (e.dtend) {
    const endUtc = e.dtend.allDay ? zonedToUtc(e.dtend.wall, viewTz) : zonedToUtc(e.dtend.wall, e.dtend.tz || tz);
    durationMs = Math.max(0, endUtc - startUtc);
  } else if (e.duration) {
    durationMs = e.duration;
  } else {
    durationMs = start.allDay ? 86400000 : 0;
  }

  const make = (wall) => {
    const s = start.allDay ? zonedToUtc(wall, viewTz) : zonedToUtc(wall, tz);
    return { start: s, end: s + durationMs, wall };
  };

  if (!e.rrule || !e.rrule.freq) {
    const occ = make(start.wall);
    return occ.end > fromMs && occ.start < toMs || (occ.start === occ.end && occ.start >= fromMs && occ.start < toMs)
      ? [occ] : [];
  }

  const rule = e.rrule;
  let untilMs = Infinity;
  if (rule.until) {
    const u = parseDateValue(rule.until, {}, 'UTC');
    if (u) untilMs = u.allDay ? zonedToUtc(Object.assign({}, u.wall, { h: 23, mi: 59, s: 59 }), tz) : zonedToUtc(u.wall, 'UTC');
  }
  const exKeys = new Set(e.exdateList.map(x => instantKey(x, tz)));
  const startDn = dayNumber(start.wall.y, start.wall.m, start.wall.d);
  const lastDn = Math.floor((toMs + 86400000) / 86400000);
  const out = [];
  let count = 0;
  for (let dn = startDn, steps = 0; dn <= lastDn && steps < MAX_DAYS_SCANNED; dn++, steps++) {
    const { y, m, d } = fromDayNumber(dn);
    if (!matchesRule(rule, start.wall, y, m, d, dn, startDn)) continue;
    const wall = { y, m, d, h: start.wall.h, mi: start.wall.mi, s: start.wall.s };
    const occ = make(wall);
    if (occ.start > untilMs) break;
    count++;
    if (rule.count && count > rule.count) break;
    const key = start.allDay ? 'D' + y + '-' + m + '-' + d : 'T' + occ.start;
    if (exKeys.has(key)) continue;
    if (occ.end > fromMs && occ.start < toMs) out.push(occ);
  }
  return out;
}

// Public: all occurrences in [fromMs, toMs) across one calendar's text.
function eventsInRange(text, fromMs, toMs, viewTz, calendarIndex) {
  const { events, tz } = parseCalendar(text, viewTz);
  const overrides = new Map(); // uid → Set of overridden instance keys
  events.forEach(e => {
    if (e.recurrenceId && e.uid) {
      if (!overrides.has(e.uid)) overrides.set(e.uid, new Set());
      overrides.get(e.uid).add(instantKey(e.recurrenceId, tz));
    }
  });

  const out = [];
  events.forEach(e => {
    const masterOverrides = !e.recurrenceId && e.uid ? overrides.get(e.uid) : null;
    expandEvent(e, fromMs, toMs, viewTz).forEach(occ => {
      if (masterOverrides) {
        const key = e.dtstart.allDay
          ? 'D' + occ.wall.y + '-' + occ.wall.m + '-' + occ.wall.d
          : 'T' + occ.start;
        if (masterOverrides.has(key)) return; // replaced by its own VEVENT
      }
      if (e.status === 'CANCELLED') return;
      out.push({
        id: (e.uid || 'event') + '@' + occ.start,
        title: e.title || 'Busy',
        location: e.location || '',
        allDay: !!e.dtstart.allDay,
        start: new Date(occ.start).toISOString(),
        end: new Date(occ.end).toISOString(),
        calendar: calendarIndex
      });
    });
  });
  return out;
}

module.exports = { eventsInRange, zonedToUtc };
