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

type ClientEvent = {
  event: string;
  session_id: string;
  player_token?: string | null;
  path?: string | null;
  mode?: string | null;
  detail?: Record<string, unknown> | null;
  // Client-supplied upstream referrer. The HTTP Referer header on /track
  // POSTs is our own URL, so we depend on the client snapshotting
  // document.referrer at page load and shipping it here.
  referrer_host?: string | null;
  referrer?: string | null;
};

// Sentinel return from optString: distinguishes "absent/null OK" (undefined)
// from "present-but-invalid" (the symbol). Callers map invalid → reject entry.
const INVALID = Symbol("invalid");

function optString(value: unknown, maxLen: number): string | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLen) return INVALID;
  return value;
}

function requiredString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLen) return null;
  return value;
}

function validateEntry(raw: unknown): ClientEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const event = requiredString(e.event, 64);
  const session_id = requiredString(e.session_id, 128);
  if (!event || !session_id) return null;

  const playerToken = optString(e.player_token, 128);
  const path = optString(e.path, 256);
  const mode = optString(e.mode, 32);
  const referrerHost = optString(e.referrer_host, 256);
  const referrer = optString(e.referrer, 1024);
  if (
    playerToken === INVALID ||
    path === INVALID ||
    mode === INVALID ||
    referrerHost === INVALID ||
    referrer === INVALID
  ) return null;

  let detail: Record<string, unknown> | undefined;
  if (e.detail !== undefined && e.detail !== null) {
    if (typeof e.detail !== "object" || Array.isArray(e.detail)) return null;
    detail = e.detail as Record<string, unknown>;
  }

  const out: ClientEvent = { event, session_id };
  if (playerToken !== undefined) out.player_token = playerToken;
  if (path !== undefined) out.path = path;
  if (mode !== undefined) out.mode = mode;
  if (referrerHost !== undefined) out.referrer_host = referrerHost.toLowerCase();
  if (referrer !== undefined) out.referrer = referrer;
  if (detail !== undefined) out.detail = detail;
  return out;
}

// ── handler ──────────────────────────────────────────────────────────────────

function headerString(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : undefined;
}

export function trackHandler(req: Request, res: Response): void {
  ensureFlushTimer();

  const events = Array.isArray(req.body?.events) ? (req.body.events as unknown[]) : null;
  if (!events || events.length < 1 || events.length > 50) {
    res.status(204).end();
    return;
  }

  const ts = Date.now();
  // Header-based referrer is our own URL on every /track POST (the page
  // making the fetch). Keep it only as a fallback for clients that haven't
  // snapshotted document.referrer yet — the per-event referrer_host wins.
  const headerReferrerHost = parseReferrerHost(headerString(req, "referer"));
  const country = lookupCountry(req.ip);
  const platform = classifyPlatform(headerString(req, "user-agent"));

  for (const raw of events) {
    const v = validateEntry(raw);
    if (!v) continue;
    const portalFlag = v.detail?.portal === true;
    // Prefer the client-supplied referrer (captured from document.referrer
    // at page load — the actual upstream page). Fall back to the request
    // header only if absent. The client also strips self-referrals before
    // sending.
    const referrerHost = v.referrer_host ?? headerReferrerHost;
    // mode is best-effort: prefer top-level field, fall back to detail.mode.
    const detailMode = typeof v.detail?.mode === "string" ? v.detail.mode : null;
    pendingWrites.push({
      ts,
      session_id: v.session_id,
      player_token: v.player_token ?? null,
      event: v.event,
      country,
      referrer_host: referrerHost,
      source: deriveSource(referrerHost, portalFlag),
      mode: v.mode ?? detailMode ?? null,
      path: v.path ?? null,
      detail: v.detail ? JSON.stringify(v.detail) : null,
      platform,
    });
  }

  res.status(204).end();
}
