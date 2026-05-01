// POST /track — accepts a batched events payload from the browser, validates
// each entry, stamps server-side metadata (ts, country, referrer_host, source),
// queues for an interval-flushed batched insert, and returns 204 immediately.
//
// Client-supplied `country` and `ts` are stripped so they can't lie.

import type { Request, Response } from "express";
import { insertEvent, db, type EventRow } from "./db.js";
import { lookupCountry } from "./geo.js";

// In-memory queue; flushed every 50ms inside a transaction.
const pendingWrites: EventRow[] = [];

let flushTimer: NodeJS.Timeout | null = null;

const flushTxn = db.transaction((rows: EventRow[]) => {
  for (const r of rows) insertEvent.run(r);
});

function flush(): void {
  if (pendingWrites.length === 0) return;
  // Splice out current batch so concurrent pushes during the txn aren't lost.
  const batch = pendingWrites.splice(0, pendingWrites.length);
  try {
    flushTxn(batch);
  } catch (err) {
    console.error("[stats] flush failed:", err);
  }
}

// Idempotent boot — multiple module imports must not start multiple intervals.
function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flush, 50);
  // Don't keep the event loop alive just for the flusher.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

// ── source classification (referrer-host based) ──────────────────────────────

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yandex|baidu)\./i;
const SOCIAL_HOSTS =
  /(^|\.)(t\.co|twitter\.com|x\.com|facebook\.com|reddit\.com|news\.ycombinator\.com)$/i;

function deriveSource(
  referrerHost: string | null,
  portalFlag: boolean
): string {
  if (portalFlag) return "portal";
  if (!referrerHost) return "direct";
  if (SEARCH_HOSTS.test(referrerHost)) return "search";
  if (SOCIAL_HOSTS.test(referrerHost)) return "social";
  return "other";
}

function parseReferrerHost(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Coarse User-Agent → platform classifier. Order matters: bot first, then
// tablet (so iPad/Android tablets aren't misread as mobile), then mobile,
// then desktop fallback.
function classifyPlatform(ua: string | undefined): string {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (s.includes("bot") || s.includes("crawler") || s.includes("spider") || s.includes("slurp")) {
    return "bot";
  }
  if (s.includes("tablet") || s.includes("ipad")) return "tablet";
  if (s.includes("mobile") || s.includes("android") || s.includes("iphone") || s.includes("ipod")) {
    return "mobile";
  }
  return "desktop";
}

// ── validation ───────────────────────────────────────────────────────────────

function isString(x: unknown): x is string {
  return typeof x === "string";
}

type ClientEvent = {
  event: string;
  session_id: string;
  player_token?: string | null;
  path?: string | null;
  mode?: string | null;
  detail?: Record<string, unknown> | null;
};

function validateEntry(raw: unknown): ClientEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!isString(e.event) || e.event.length === 0 || e.event.length > 64) return null;
  if (!isString(e.session_id) || e.session_id.length === 0 || e.session_id.length > 128) return null;
  const out: ClientEvent = {
    event: e.event,
    session_id: e.session_id,
  };
  if (e.player_token !== undefined && e.player_token !== null) {
    if (!isString(e.player_token) || e.player_token.length > 128) return null;
    out.player_token = e.player_token;
  }
  if (e.path !== undefined && e.path !== null) {
    if (!isString(e.path) || e.path.length > 256) return null;
    out.path = e.path;
  }
  if (e.mode !== undefined && e.mode !== null) {
    if (!isString(e.mode) || e.mode.length > 32) return null;
    out.mode = e.mode;
  }
  if (e.detail !== undefined && e.detail !== null) {
    if (typeof e.detail !== "object" || Array.isArray(e.detail)) return null;
    out.detail = e.detail as Record<string, unknown>;
  }
  return out;
}

// ── handler ──────────────────────────────────────────────────────────────────

export function trackHandler(req: Request, res: Response): void {
  ensureFlushTimer();

  const body = req.body;
  if (!body || !Array.isArray(body.events)) {
    res.status(204).end();
    return;
  }
  const events = body.events as unknown[];
  if (events.length < 1 || events.length > 50) {
    res.status(204).end();
    return;
  }

  const ts = Date.now();
  const referrerHost = parseReferrerHost(
    typeof req.headers["referer"] === "string" ? req.headers["referer"] : undefined
  );
  const country = lookupCountry(req.ip);
  const platform = classifyPlatform(
    typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined
  );

  for (const raw of events) {
    const v = validateEntry(raw);
    if (!v) continue;
    const portalFlag =
      !!v.detail && (v.detail as Record<string, unknown>).portal === true;
    const source = deriveSource(referrerHost, portalFlag);
    // mode is best-effort: prefer top-level field, fall back to detail.mode.
    const detailMode =
      v.detail && typeof (v.detail as Record<string, unknown>).mode === "string"
        ? ((v.detail as Record<string, unknown>).mode as string)
        : null;
    pendingWrites.push({
      ts,
      session_id: v.session_id,
      player_token: v.player_token ?? null,
      event: v.event,
      country,
      referrer_host: referrerHost,
      source,
      mode: v.mode ?? detailMode ?? null,
      path: v.path ?? null,
      detail: v.detail ? JSON.stringify(v.detail) : null,
      platform,
    });
  }

  res.status(204).end();
}
