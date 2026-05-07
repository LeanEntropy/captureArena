// /stats — minimal self-hosted analytics dashboard.
//
// Five routes:
//   GET /              — single-page dark-theme dashboard (Chart.js)
//   GET /api/visitors-daily  — 30-day distinct sessions per day (event=pageview)
//   GET /api/countries       — top 15 countries by distinct sessions, last 30d
//   GET /api/modes           — solo vs online mode_pick counts, last 30d
//   GET /api/sources         — counts per traffic source, last 30d
//
// Each /api/* endpoint runs ONE prepared SQL statement and caches the JSON
// payload for 30 seconds in process memory.

import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { db } from "./db.js";
import { getCurrentRoom } from "../rooms/registry.js";

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

// ── prepared statements ──────────────────────────────────────────────────────

const stmtVisitorsDaily = db.prepare<[number]>(`
  SELECT
    strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS date,
    COUNT(DISTINCT session_id) AS sessions
  FROM events
  WHERE event = 'pageview' AND ts >= ?
  GROUP BY date
  ORDER BY date ASC
`);

const stmtCountries = db.prepare<[number]>(`
  SELECT country, COUNT(DISTINCT session_id) AS sessions
  FROM events
  WHERE country IS NOT NULL AND ts >= ?
  GROUP BY country
  ORDER BY sessions DESC
  LIMIT 15
`);

const stmtModes = db.prepare<[number]>(`
  SELECT
    COALESCE(mode, json_extract(detail, '$.mode')) AS m,
    COUNT(*) AS n
  FROM events
  WHERE event = 'mode_pick' AND ts >= ?
  GROUP BY m
`);

const stmtSources = db.prepare<[number]>(`
  SELECT source, COUNT(DISTINCT session_id) AS sessions
  FROM events
  WHERE source IS NOT NULL AND ts >= ?
  GROUP BY source
  ORDER BY sessions DESC
`);

const stmtTopReferrers = db.prepare<[number]>(`
  SELECT referrer_host AS host, COUNT(DISTINCT session_id) AS sessions
  FROM events
  WHERE referrer_host IS NOT NULL AND ts > ?
  GROUP BY referrer_host
  ORDER BY sessions DESC
  LIMIT 15
`);

const stmtPlatforms = db.prepare<[number]>(`
  SELECT COALESCE(platform, 'unknown') AS platform, COUNT(DISTINCT session_id) AS sessions
  FROM events
  WHERE ts > ?
  GROUP BY COALESCE(platform, 'unknown')
  ORDER BY sessions DESC
`);

// ── new statements ───────────────────────────────────────────────────────────

const stmtPeakConcurrent = db.prepare(`
  SELECT
    MAX(CAST(json_extract(detail, '$.onlineNow') AS INTEGER)) AS peak,
    ts AS ts
  FROM events
  WHERE event = 'concurrent_sample'
`);

// `peak` is the max — but to fetch the corresponding ts, we need a second
// statement. Cheaper than a window function for this row count.
const stmtPeakWhen = db.prepare<[number]>(`
  SELECT ts
  FROM events
  WHERE event = 'concurrent_sample'
    AND CAST(json_extract(detail, '$.onlineNow') AS INTEGER) = ?
  ORDER BY ts DESC
  LIMIT 1
`);

const stmtRecentMatches = db.prepare(`
  SELECT ts, detail
  FROM events
  WHERE event = 'match_end'
  ORDER BY ts DESC
  LIMIT 20
`);

const stmtGamesPerDay = db.prepare<[number]>(`
  SELECT
    strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS date,
    COALESCE(mode, json_extract(detail, '$.mode')) AS m,
    COUNT(*) AS n
  FROM events
  WHERE event = 'game_start' AND ts >= ?
  GROUP BY date, m
  ORDER BY date ASC
`);

const stmtPlaytimeDay = db.prepare<[number]>(`
  SELECT
    strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS period,
    COALESCE(mode, json_extract(detail, '$.mode')) AS m,
    SUM(CAST(json_extract(detail, '$.durationMs') AS INTEGER)) AS ms
  FROM events
  WHERE event = 'game_end' AND ts >= ?
  GROUP BY period, m
  ORDER BY period ASC
`);

const stmtPlaytimeWeek = db.prepare<[number]>(`
  SELECT
    strftime('%Y-W%W', ts / 1000, 'unixepoch') AS period,
    COALESCE(mode, json_extract(detail, '$.mode')) AS m,
    SUM(CAST(json_extract(detail, '$.durationMs') AS INTEGER)) AS ms
  FROM events
  WHERE event = 'game_end' AND ts >= ?
  GROUP BY period, m
  ORDER BY period ASC
`);

const stmtPlaytimeMonth = db.prepare<[number]>(`
  SELECT
    strftime('%Y-%m', ts / 1000, 'unixepoch') AS period,
    COALESCE(mode, json_extract(detail, '$.mode')) AS m,
    SUM(CAST(json_extract(detail, '$.durationMs') AS INTEGER)) AS ms
  FROM events
  WHERE event = 'game_end' AND ts >= ?
  GROUP BY period, m
  ORDER BY period ASC
`);

// Top players today: the day starts at local midnight UTC for simplicity (the
// dashboard caches for 30s anyway). Group game_start by player_token, count
// games and sum game_end durations for the same token over the same window.
const stmtTopDailyTokens = db.prepare<[number]>(`
  SELECT player_token AS pt, COUNT(*) AS games
  FROM events
  WHERE event = 'game_start'
    AND player_token IS NOT NULL
    AND ts >= ?
  GROUP BY player_token
  ORDER BY games DESC
  LIMIT 10
`);

const stmtTopDailyMinutes = db.prepare<[number, string]>(`
  SELECT
    COALESCE(SUM(CAST(json_extract(detail, '$.durationMs') AS INTEGER)), 0) AS ms
  FROM events
  WHERE event = 'game_end'
    AND ts >= ?
    AND player_token = ?
`);

const stmtTopDailyName = db.prepare<[string]>(`
  SELECT detail
  FROM events
  WHERE player_token = ?
    AND json_extract(detail, '$.playerName') IS NOT NULL
  ORDER BY ts DESC
  LIMIT 1
`);

// ── 30s in-memory cache per endpoint ────────────────────────────────────────

type CacheEntry = { ts: number; payload: unknown };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

function cached(key: string, build: () => unknown): unknown {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_MS) return hit.payload;
  const payload = build();
  cache.set(key, { ts: now, payload });
  return payload;
}

function send(res: Response, key: string, build: () => unknown): void {
  try {
    res.json(cached(key, build));
  } catch (err) {
    console.error(`[stats] /api/${key} failed:`, err);
    res.status(500).json({ error: "internal" });
  }
}

function since30d(): number {
  return Date.now() - 30 * DAY_MS;
}

function safeJsonParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ── API routes ───────────────────────────────────────────────────────────────

router.get("/api/visitors-daily", (_req: Request, res: Response) => {
  send(res, "visitors-daily", () => stmtVisitorsDaily.all(since30d()));
});

router.get("/api/countries", (_req: Request, res: Response) => {
  send(res, "countries", () => stmtCountries.all(since30d()));
});

router.get("/api/modes", (_req: Request, res: Response) => {
  send(res, "modes", () => {
    const rows = stmtModes.all(since30d()) as Array<{ m: string | null; n: number }>;
    let solo = 0;
    let online = 0;
    for (const r of rows) {
      if (r.m === "solo") solo += r.n;
      else if (r.m === "online") online += r.n;
    }
    return { solo, online };
  });
});

router.get("/api/sources", (_req: Request, res: Response) => {
  send(res, "sources", () => stmtSources.all(since30d()));
});

router.get("/api/top-referrers", (_req: Request, res: Response) => {
  send(res, "top-referrers", () => stmtTopReferrers.all(since30d()));
});

router.get("/api/platforms", (_req: Request, res: Response) => {
  send(res, "platforms", () => stmtPlatforms.all(since30d()));
});

// ── new endpoints ────────────────────────────────────────────────────────────

router.get("/api/online-now", (_req: Request, res: Response) => {
  // No DB — real-time read from the live room. No cache (always fresh).
  try {
    const room = getCurrentRoom();
    res.json({ onlineNow: room?.clients.length ?? 0 });
  } catch (err) {
    console.error("[stats] /api/online-now failed:", err);
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/peak-concurrent", (_req: Request, res: Response) => {
  send(res, "peak-concurrent", () => {
    const row = stmtPeakConcurrent.get() as { peak: number | null } | undefined;
    const peak = row?.peak ?? 0;
    if (!peak) return { peak: 0, when: null };
    const whenRow = stmtPeakWhen.get(peak) as { ts: number } | undefined;
    return { peak, when: whenRow ? new Date(whenRow.ts).toISOString() : null };
  });
});

router.get("/api/recent-matches", (_req: Request, res: Response) => {
  send(res, "recent-matches", () => {
    const rows = stmtRecentMatches.all() as Array<{ ts: number; detail: string | null }>;
    return rows.map(r => {
      const parsed = safeJsonParse(r.detail);
      const players = Array.isArray(parsed.players) ? parsed.players : [];
      return {
        ts: r.ts,
        durationMs: parsed.durationMs ?? 0,
        factionWinner: parsed.factionWinner ?? null,
        playerNames: players.map((p: any) => p?.name ?? "").filter(Boolean),
        playerCount: players.length,
      };
    });
  });
});

router.get("/api/games-per-day", (_req: Request, res: Response) => {
  send(res, "games-per-day", () => {
    const rows = stmtGamesPerDay.all(since30d()) as Array<{
      date: string; m: string | null; n: number;
    }>;
    const byDate = new Map<string, { date: string; solo: number; online: number }>();
    for (const r of rows) {
      let bucket = byDate.get(r.date);
      if (!bucket) {
        bucket = { date: r.date, solo: 0, online: 0 };
        byDate.set(r.date, bucket);
      }
      if (r.m === "solo") bucket.solo += r.n;
      else if (r.m === "online") bucket.online += r.n;
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
});

function aggregatePlaytime(rows: Array<{ period: string; m: string | null; ms: number | null }>): Array<{ period: string; solo_minutes: number; online_minutes: number }> {
  const byPeriod = new Map<string, { period: string; solo_minutes: number; online_minutes: number }>();
  for (const r of rows) {
    let bucket = byPeriod.get(r.period);
    if (!bucket) {
      bucket = { period: r.period, solo_minutes: 0, online_minutes: 0 };
      byPeriod.set(r.period, bucket);
    }
    const minutes = (r.ms ?? 0) / 60000;
    if (r.m === "solo") bucket.solo_minutes += minutes;
    else if (r.m === "online") bucket.online_minutes += minutes;
  }
  return [...byPeriod.values()]
    .map(b => ({
      period: b.period,
      solo_minutes: Math.round(b.solo_minutes * 10) / 10,
      online_minutes: Math.round(b.online_minutes * 10) / 10,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

type PlaytimeRow = { period: string; m: string | null; ms: number | null };

router.get("/api/playtime", (_req: Request, res: Response) => {
  send(res, "playtime", () => ({
    day: aggregatePlaytime(stmtPlaytimeDay.all(since30d()) as PlaytimeRow[]),
    week: aggregatePlaytime(stmtPlaytimeWeek.all(Date.now() - 12 * 7 * DAY_MS) as PlaytimeRow[]),
    month: aggregatePlaytime(stmtPlaytimeMonth.all(Date.now() - 12 * 31 * DAY_MS) as PlaytimeRow[]),
  }));
});

router.get("/api/top-daily-players", (_req: Request, res: Response) => {
  send(res, "top-daily-players", () => {
    // "Today" = last 24h. Simpler than UTC midnight, matches the 30s cache.
    const since = Date.now() - DAY_MS;
    const tokens = stmtTopDailyTokens.all(since) as Array<{ pt: string; games: number }>;
    return tokens.map(t => {
      const minutesRow = stmtTopDailyMinutes.get(since, t.pt) as { ms: number } | undefined;
      const totalMinutes = Math.round(((minutesRow?.ms ?? 0) / 60000) * 10) / 10;
      const nameRow = stmtTopDailyName.get(t.pt) as { detail: string | null } | undefined;
      const parsed = safeJsonParse(nameRow?.detail ?? null);
      const mostRecentName = typeof parsed.playerName === "string" ? parsed.playerName : null;
      return {
        playerToken: t.pt,
        mostRecentName,
        gamesPlayed: t.games,
        totalMinutes,
      };
    });
  });
});

const stmtPrivateRoomsCounts = db.prepare<[number]>(`
  SELECT
    SUM(CASE WHEN event = 'room_created' THEN 1 ELSE 0 END) AS created,
    SUM(CASE WHEN event = 'room_started' THEN 1 ELSE 0 END) AS started,
    SUM(CASE WHEN event = 'room_expired' AND json_extract(detail, '$.started') = 0 THEN 1 ELSE 0 END) AS expired_unstarted
  FROM events
  WHERE event IN ('room_created', 'room_started', 'room_expired') AND ts >= ?
`);

const stmtPrivateRoomsAvgHumans = db.prepare<[number]>(`
  SELECT AVG(json_extract(detail, '$.humansAtStart')) AS avg_humans
  FROM events
  WHERE event = 'room_started' AND ts >= ?
`);

const stmtPrivateRoomsTopConfigs = db.prepare<[number]>(`
  SELECT
    json_extract(detail, '$.factions') AS factions,
    json_extract(detail, '$.botsPerFaction') AS bpf,
    json_extract(detail, '$.minHumans') AS min_h,
    COUNT(*) AS n
  FROM events
  WHERE event = 'room_created' AND ts >= ?
  GROUP BY factions, bpf, min_h
  ORDER BY n DESC
  LIMIT 10
`);

const stmtPrivateRoomsMedianDurationApprox = db.prepare<[number]>(`
  SELECT json_extract(detail, '$.durationMs') AS dur
  FROM events
  WHERE event = 'room_expired' AND json_extract(detail, '$.started') = 1 AND ts >= ?
  ORDER BY dur ASC
`);

router.get("/api/private-rooms", (_req: Request, res: Response) => {
  send(res, "private-rooms", () => {
    const since = since30d();
    const counts = stmtPrivateRoomsCounts.get(since) as { created: number; started: number; expired_unstarted: number } | undefined;
    const avg = stmtPrivateRoomsAvgHumans.get(since) as { avg_humans: number | null } | undefined;
    const top = stmtPrivateRoomsTopConfigs.all(since) as Array<{ factions: number; bpf: number; min_h: number; n: number }>;
    const durs = (stmtPrivateRoomsMedianDurationApprox.all(since) as Array<{ dur: number }>).map(r => r.dur);
    const median = durs.length === 0 ? 0 : durs[Math.floor(durs.length / 2)];
    return {
      created: counts?.created ?? 0,
      started: counts?.started ?? 0,
      expired_unstarted: counts?.expired_unstarted ?? 0,
      avg_humans_at_start: avg?.avg_humans ?? 0,
      top_configs: top,
      median_duration_ms: median,
    };
  });
});

// ── HTML dashboard ───────────────────────────────────────────────────────────

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Land Capture — Stats</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    background: #0e1117; color: #e6edf3;
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 13px;
  }
  h1 { font-size: 18px; margin: 0 0 16px; letter-spacing: 2px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 720px) {
    .grid { grid-template-columns: 1fr; }
  }
  .card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 14px;
  }
  .card h2 {
    font-size: 12px; margin: 0 0 10px; letter-spacing: 1px;
    color: #8b949e; text-transform: uppercase;
  }
  .card canvas { max-height: 260px; }
  .tile-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }
  @media (max-width: 720px) {
    .tile-row { grid-template-columns: 1fr; }
  }
  .tile {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 18px;
  }
  .tile h2 {
    font-size: 11px; margin: 0 0 8px; letter-spacing: 1px;
    color: #8b949e; text-transform: uppercase;
  }
  .tile .big {
    font-size: 36px; font-weight: 600; letter-spacing: 1px;
    color: #c9d1d9;
  }
  .tile .big.live { color: #3fb950; }
  .tile .sub { font-size: 11px; color: #8b949e; margin-top: 4px; }
  .table-wrap { max-height: 280px; overflow-y: auto; }
  table.tbl {
    width: 100%; border-collapse: collapse; font-size: 11px;
  }
  table.tbl th, table.tbl td {
    text-align: left; padding: 6px 8px;
    border-bottom: 1px solid #21262d;
  }
  table.tbl th {
    color: #8b949e; text-transform: uppercase; letter-spacing: 1px;
    font-size: 10px; font-weight: normal;
    position: sticky; top: 0; background: #161b22;
  }
  table.tbl td.names { color: #8b949e; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .tab-btn {
    background: #0e1117; border: 1px solid #30363d; color: #8b949e;
    padding: 4px 10px; font-family: inherit; font-size: 11px; cursor: pointer;
    border-radius: 4px; letter-spacing: 1px; text-transform: uppercase;
  }
  .tab-btn.active { color: #58a6ff; border-color: #58a6ff; }
  .grid-mb { margin-bottom: 16px; }
  footer {
    margin-top: 22px; font-size: 11px; color: #8b949e;
    text-align: center; line-height: 1.6;
  }
  footer a { color: #58a6ff; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>LAND CAPTURE — STATS (last 30 days)</h1>

<div class="tile-row">
  <div class="tile">
    <h2>Online now</h2>
    <div id="t-online" class="big">—</div>
    <div class="sub">Refreshes every 30s</div>
  </div>
  <div class="tile">
    <h2>Peak concurrent</h2>
    <div id="t-peak" class="big">—</div>
    <div id="t-peak-when" class="sub">—</div>
  </div>
</div>

<div class="grid grid-mb">
  <div class="card">
    <h2>Recent matches</h2>
    <div class="table-wrap"><table class="tbl" id="t-matches">
      <thead><tr><th>When</th><th>Players</th><th>Names</th><th>Winner</th><th>Duration</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>
  <div class="card"><h2>Games per day</h2><canvas id="c-gpd"></canvas></div>
  <div class="card">
    <h2>Playtime</h2>
    <div class="tabs">
      <button class="tab-btn active" data-tab="day">Day</button>
      <button class="tab-btn" data-tab="week">Week</button>
      <button class="tab-btn" data-tab="month">Month</button>
    </div>
    <canvas id="c-playtime"></canvas>
  </div>
  <div class="card">
    <h2>Top players (last 24h)</h2>
    <div class="table-wrap"><table class="tbl" id="t-top">
      <thead><tr><th>#</th><th>Name</th><th>Games</th><th>Minutes</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>
</div>

<div class="grid">
  <div class="card"><h2>Daily visitors</h2><canvas id="c-visitors"></canvas></div>
  <div class="card"><h2>Top countries</h2><canvas id="c-countries"></canvas></div>
  <div class="card"><h2>Platform (last 30 days)</h2><canvas id="c-platforms"></canvas></div>
  <div class="card"><h2>Mode picks</h2><canvas id="c-modes"></canvas></div>
  <div class="card"><h2>Traffic sources</h2><canvas id="c-sources"></canvas></div>
  <div class="card">
    <h2>Top referrers (last 30 days)</h2>
    <div class="table-wrap"><table class="tbl" id="t-referrers">
      <thead><tr><th>Host</th><th>Sessions</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>
</div>
<div class="card grid-mb" style="margin-top:16px">
  <h2>Private Rooms (last 30 days)</h2>
  <div class="tile-row" style="margin-bottom:10px">
    <div class="tile">
      <h2>Rooms created</h2>
      <div id="pr-created" class="big">—</div>
    </div>
    <div class="tile">
      <h2>Rooms started</h2>
      <div id="pr-started" class="big">—</div>
    </div>
    <div class="tile">
      <h2>Expired unstarted</h2>
      <div id="pr-expired" class="big">—</div>
    </div>
    <div class="tile">
      <h2>Avg humans at start</h2>
      <div id="pr-avg-humans" class="big">—</div>
    </div>
    <div class="tile">
      <h2>Median duration</h2>
      <div id="pr-median-dur" class="big">—</div>
    </div>
  </div>
  <div class="table-wrap"><table class="tbl" id="t-pr-top">
    <thead><tr><th>Factions</th><th>Bots/faction</th><th>Min humans</th><th>Count</th></tr></thead>
    <tbody></tbody>
  </table></div>
</div>
<footer>
  Anonymous play stats logged. &middot;
  IP geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a>.
</footer>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
  const PALETTE = [
    "#58a6ff", "#3fb950", "#f85149", "#d29922", "#a371f7",
    "#39c5cf", "#ff7b72", "#bc8cff", "#7ee787", "#ffa657",
    "#ff9492", "#79c0ff", "#56d364", "#f0883e", "#b392f0"
  ];
  const TEXT = "#c9d1d9";
  const GRID = "rgba(139,148,158,0.18)";
  const baseOpts = (extra) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: TEXT, font: { family: "monospace", size: 11 } } },
    },
    scales: {
      x: { ticks: { color: TEXT }, grid: { color: GRID } },
      y: { ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: true },
    },
    ...extra,
  });
  const noScales = (extra) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: TEXT, font: { family: "monospace", size: 11 } } } },
    ...extra,
  });

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  function relTime(ms) {
    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + " sec ago";
    const min = Math.floor(sec / 60);
    if (min < 60) return min + " min ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + " hr ago";
    return Math.floor(hr / 24) + " days ago";
  }
  function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return min + ":" + String(sec).padStart(2, "0");
  }
  function truncate(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "...";
  }

  async function refreshTiles() {
    try {
      const [now, peak] = await Promise.all([
        getJSON("/stats/api/online-now"),
        getJSON("/stats/api/peak-concurrent"),
      ]);
      const elNow = document.getElementById("t-online");
      elNow.textContent = String(now.onlineNow ?? 0);
      elNow.classList.toggle("live", (now.onlineNow ?? 0) > 0);
      const elPeak = document.getElementById("t-peak");
      const elWhen = document.getElementById("t-peak-when");
      elPeak.textContent = String(peak.peak ?? 0);
      elWhen.textContent = peak.when
        ? new Date(peak.when).toLocaleString()
        : "no samples yet";
    } catch (e) { console.error(e); }
  }

  let playtimeChart = null;
  let playtimeData = { day: [], week: [], month: [] };
  function renderPlaytime(tab) {
    const rows = playtimeData[tab] || [];
    const labels = rows.map(r => r.period);
    const solo = rows.map(r => r.solo_minutes);
    const online = rows.map(r => r.online_minutes);
    if (playtimeChart) playtimeChart.destroy();
    playtimeChart = new Chart(document.getElementById("c-playtime"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Solo (min)", data: solo, backgroundColor: "#3fb950" },
          { label: "Online (min)", data: online, backgroundColor: "#58a6ff" },
        ],
      },
      options: baseOpts({
        scales: {
          x: { stacked: true, ticks: { color: TEXT }, grid: { color: GRID } },
          y: { stacked: true, ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: true },
        },
      }),
    });
  }

  (async function () {
    refreshTiles();
    setInterval(refreshTiles, 30000);

    try {
      const matches = await getJSON("/stats/api/recent-matches");
      const tbody = document.querySelector("#t-matches tbody");
      tbody.innerHTML = "";
      for (const m of matches) {
        const tr = document.createElement("tr");
        const names = (m.playerNames || []).join(", ");
        tr.innerHTML =
          "<td>" + relTime(m.ts) + "</td>" +
          "<td>" + (m.playerCount ?? 0) + "</td>" +
          "<td class=\\"names\\" title=\\"" + names.replace(/"/g, "&quot;") + "\\">" + truncate(names, 80) + "</td>" +
          "<td>" + (m.factionWinner ?? "—") + "</td>" +
          "<td>" + fmtDuration(m.durationMs ?? 0) + "</td>";
        tbody.appendChild(tr);
      }
    } catch (e) { console.error(e); }

    try {
      const gpd = await getJSON("/stats/api/games-per-day");
      new Chart(document.getElementById("c-gpd"), {
        type: "bar",
        data: {
          labels: gpd.map(r => r.date),
          datasets: [
            { label: "Solo", data: gpd.map(r => r.solo), backgroundColor: "#3fb950" },
            { label: "Online", data: gpd.map(r => r.online), backgroundColor: "#58a6ff" },
          ],
        },
        options: baseOpts({
          scales: {
            x: { stacked: true, ticks: { color: TEXT }, grid: { color: GRID } },
            y: { stacked: true, ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: true },
          },
        }),
      });
    } catch (e) { console.error(e); }

    try {
      playtimeData = await getJSON("/stats/api/playtime");
      renderPlaytime("day");
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          renderPlaytime(btn.dataset.tab);
        });
      });
    } catch (e) { console.error(e); }

    try {
      const top = await getJSON("/stats/api/top-daily-players");
      const tbody = document.querySelector("#t-top tbody");
      tbody.innerHTML = "";
      top.forEach((p, i) => {
        const tr = document.createElement("tr");
        const name = p.mostRecentName || ("token:" + (p.playerToken || "").slice(0, 8));
        tr.innerHTML =
          "<td>" + (i + 1) + "</td>" +
          "<td>" + name + "</td>" +
          "<td>" + p.gamesPlayed + "</td>" +
          "<td>" + p.totalMinutes + "</td>";
        tbody.appendChild(tr);
      });
    } catch (e) { console.error(e); }

    try {
      const visitors = await getJSON("/stats/api/visitors-daily");
      new Chart(document.getElementById("c-visitors"), {
        type: "line",
        data: {
          labels: visitors.map(r => r.date),
          datasets: [{
            label: "Sessions",
            data: visitors.map(r => r.sessions),
            borderColor: "#58a6ff",
            backgroundColor: "rgba(88,166,255,0.18)",
            tension: 0.25, fill: true, pointRadius: 2,
          }],
        },
        options: baseOpts({}),
      });
    } catch (e) { console.error(e); }

    try {
      const countries = await getJSON("/stats/api/countries");
      new Chart(document.getElementById("c-countries"), {
        type: "bar",
        data: {
          labels: countries.map(r => r.country),
          datasets: [{
            label: "Sessions",
            data: countries.map(r => r.sessions),
            backgroundColor: countries.map((_, i) => PALETTE[i % PALETTE.length]),
          }],
        },
        options: baseOpts({ indexAxis: "y", plugins: { legend: { display: false } } }),
      });
    } catch (e) { console.error(e); }

    try {
      const modes = await getJSON("/stats/api/modes");
      new Chart(document.getElementById("c-modes"), {
        type: "doughnut",
        data: {
          labels: ["Solo", "Online"],
          datasets: [{
            data: [modes.solo || 0, modes.online || 0],
            backgroundColor: ["#3fb950", "#58a6ff"],
            borderColor: "#0e1117", borderWidth: 2,
          }],
        },
        options: noScales({}),
      });
    } catch (e) { console.error(e); }

    try {
      const sources = await getJSON("/stats/api/sources");
      new Chart(document.getElementById("c-sources"), {
        type: "doughnut",
        data: {
          labels: sources.map(r => r.source),
          datasets: [{
            data: sources.map(r => r.sessions),
            backgroundColor: sources.map((_, i) => PALETTE[i % PALETTE.length]),
            borderColor: "#0e1117", borderWidth: 2,
          }],
        },
        options: noScales({}),
      });
    } catch (e) { console.error(e); }

    try {
      const referrers = await getJSON("/stats/api/top-referrers");
      const tbody = document.querySelector("#t-referrers tbody");
      tbody.innerHTML = "";
      if (!referrers.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = "<td colspan=\\"2\\" style=\\"color:#8b949e\\">No referrers yet</td>";
        tbody.appendChild(tr);
      } else {
        for (const r of referrers) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" + (r.host || "—") + "</td>" +
            "<td>" + r.sessions + "</td>";
          tbody.appendChild(tr);
        }
      }
    } catch (e) { console.error(e); }

    try {
      const platforms = await getJSON("/stats/api/platforms");
      const PLATFORM_COLORS = {
        desktop: "#58a6ff",
        mobile: "#3fb950",
        tablet: "#d29922",
        bot: "#f85149",
        unknown: "#8b949e",
      };
      new Chart(document.getElementById("c-platforms"), {
        type: "doughnut",
        data: {
          labels: platforms.map(r => r.platform),
          datasets: [{
            data: platforms.map(r => r.sessions),
            backgroundColor: platforms.map((r, i) => PLATFORM_COLORS[r.platform] || PALETTE[i % PALETTE.length]),
            borderColor: "#0e1117", borderWidth: 2,
          }],
        },
        options: noScales({}),
      });
    } catch (e) { console.error(e); }

    try {
      const pr = await getJSON("/stats/api/private-rooms");
      document.getElementById("pr-created").textContent = pr.created;
      document.getElementById("pr-started").textContent = pr.started;
      document.getElementById("pr-expired").textContent = pr.expired_unstarted;
      document.getElementById("pr-avg-humans").textContent = (pr.avg_humans_at_start || 0).toFixed(1);
      document.getElementById("pr-median-dur").textContent = Math.round((pr.median_duration_ms || 0) / 60000) + " min";
      const tbody = document.querySelector("#t-pr-top tbody");
      tbody.innerHTML = pr.top_configs.map(c =>
        "<tr><td>" + c.factions + "</td><td>" + c.bpf + "</td><td>" + c.min_h + "</td><td>" + c.n + "</td></tr>"
      ).join("");
    } catch (e) { console.error(e); }
  })();
</script>
</body>
</html>`;

router.get("/", (_req: Request, res: Response) => {
  res.type("html").send(HTML);
});

export const dashboardRouter: ExpressRouter = router;
