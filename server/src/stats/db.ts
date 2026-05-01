// SQLite event store for self-hosted analytics.
//
// Single `events` table — append-only log. Each row is one client-reported
// event (pageview, mode_pick, game_start, game_end, portal_arrival, ...) plus
// server-stamped metadata (ts, country, referrer_host, source).
//
// WAL mode is used so dashboard reads never block the ingest writer.
//
// The DB path is taken from STATS_DB_PATH (default /app/data/stats.db). Parent
// directory is auto-created.

import Database, { type Database as DatabaseType, type Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.STATS_DB_PATH ?? "/app/data/stats.db";

// Make sure the parent dir exists; better-sqlite3 won't create it for us.
try {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch {
  // Best-effort — if the dir already exists or perms fail, the DB open below
  // will surface a clearer error.
}

export const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Idempotent schema migration — safe to run on every boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    player_token TEXT,
    event TEXT NOT NULL,
    country TEXT,
    referrer_host TEXT,
    source TEXT,
    mode TEXT,
    path TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_event_ts ON events(event, ts);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_token ON events(player_token);
`);

// Idempotent column-add migration: SQLite errors when the column already exists,
// so swallow the duplicate-column error and let any other failure bubble up.
try {
  db.exec(`ALTER TABLE events ADD COLUMN platform TEXT`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/duplicate column name/i.test(msg)) {
    throw err;
  }
}

console.log(`[stats] db opened at ${DB_PATH}`);

// Prepared INSERT — reused by ingest's batched flush.
export const insertEvent: Statement = db.prepare(`
  INSERT INTO events
    (ts, session_id, player_token, event, country, referrer_host, source, mode, path, detail, platform)
  VALUES
    (@ts, @session_id, @player_token, @event, @country, @referrer_host, @source, @mode, @path, @detail, @platform)
`);

export type EventRow = {
  ts: number;
  session_id: string;
  player_token: string | null;
  event: string;
  country: string | null;
  referrer_host: string | null;
  source: string | null;
  mode: string | null;
  path: string | null;
  detail: string | null;
  platform: string | null;
};

// Server-emitted event helper. Stamps ts and uses session_id='server' for any
// event the SERVER emits directly (match_end, concurrent_sample, etc).
// `detail` is JSON-stringified here so callers can pass an object.
export function insertServerEvent(
  event: string,
  detail: Record<string, unknown> | null,
  opts: { mode?: string | null } = {},
): void {
  try {
    insertEvent.run({
      ts: Date.now(),
      session_id: "server",
      player_token: null,
      event,
      country: null,
      referrer_host: null,
      source: null,
      mode: opts.mode ?? null,
      path: null,
      detail: detail ? JSON.stringify(detail) : null,
      platform: null,
    });
  } catch (err) {
    console.error(`[stats] insertServerEvent(${event}) failed:`, err);
  }
}
