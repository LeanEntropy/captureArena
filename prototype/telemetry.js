// Browser-side telemetry for the self-hosted /track endpoint.
//
// One singleton per page. Generates a session_id (sessionStorage), reuses the
// existing playerToken localStorage key (set by multiplayer.js), and queues
// events in memory. The queue flushes via navigator.sendBeacon every 5 seconds
// AND on visibilitychange→hidden / pagehide so we never lose the last batch
// when the user closes the tab.
//
// All event objects stamped client-side will be re-stamped server-side with
// ts, country (via IP geolookup), referrer host, and traffic source — the
// server strips client-supplied ts/country values.

// On the canonical site `/track` resolves to our own server. From itch's
// iframe sandbox we have to point at the absolute Railway URL or the POST
// goes to itch (which does nothing with it).
const ITCH_HOST_SUFFIXES = [".itch.zone", ".itch.io"];
const REMOTE_TRACK_URL = "https://landcapture.up.railway.app/track";
const FLUSH_MS = 5000;
const SERVER_BATCH_CAP = 50;
const NAME_MAX_LEN = 32;

function _resolveEndpoint() {
  const h = location.hostname.toLowerCase();
  const onItch =
    h === "itch.io" || ITCH_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
  return onItch ? REMOTE_TRACK_URL : "/track";
}

const ENDPOINT = _resolveEndpoint();

const queue = [];
let inited = false;
let sessionId = null;
let playerToken = null;
let playerName = null;
let flushTimer = null;
let _gameStartTs = 0;
// Captured ONCE at init from document.referrer (the actual external page the
// user came from). The Referer HTTP header on /track requests is our own
// domain — useless for upstream-source attribution. We pin this for the
// session and ship it with every event so the server uses it for
// referrer_host/source.
let referrerHost = null;
let referrerHref = null;

function _parseHost(href) {
  if (!href) return null;
  try {
    return new URL(href).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function _randomId(prefix) {
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function _getSessionId() {
  try {
    let id = sessionStorage.getItem("tel_sid");
    if (!id) {
      id = crypto?.randomUUID ? crypto.randomUUID() : _randomId("s_");
      sessionStorage.setItem("tel_sid", id);
    }
    return id;
  } catch {
    // sessionStorage may be blocked in private mode — fall back to in-memory.
    return _randomId("s_");
  }
}

function _getPlayerToken() {
  try {
    return localStorage.getItem("playerToken");
  } catch {
    return null;
  }
}

function _send(payload) {
  const body = JSON.stringify(payload);
  // Try sendBeacon first (survives unload). Fall back to fetch+keepalive.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // fall through
  }
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // swallow — telemetry must never break the game
  }
}

function flush() {
  if (queue.length === 0) return;
  // Splice up to server cap so a long-lived tab never overflows.
  const batch = queue.splice(0, SERVER_BATCH_CAP);
  _send({ events: batch });
}

export function setPlayerName(name) {
  if (typeof name === "string" && name.trim().length > 0) {
    playerName = name.trim().slice(0, NAME_MAX_LEN);
  }
}

export function track(event, detail) {
  if (!inited) init();
  const entry = { event, session_id: sessionId };
  if (playerToken) entry.player_token = playerToken;
  // Always attach playerName when set so the dashboard can show recent names.
  if (detail && typeof detail === "object") {
    entry.detail = playerName ? { ...detail, playerName } : detail;
  } else if (playerName) {
    entry.detail = { playerName };
  }
  // Ship the captured external referrer host with every event. The server
  // prefers this over the request's Referer header (which is our own URL).
  if (referrerHost) entry.referrer_host = referrerHost;
  if (referrerHref) entry.referrer = referrerHref;
  queue.push(entry);
}

export function gameStart(mode) {
  _gameStartTs = Date.now();
  track("game_start", { mode });
}

export function gameEnd(stats) {
  const detail = { durationMs: _gameStartTs ? Date.now() - _gameStartTs : 0 };
  if (stats && typeof stats === "object") Object.assign(detail, stats);
  track("game_end", detail);
}

export function init() {
  if (inited) return;
  inited = true;

  sessionId = _getSessionId();
  playerToken = _getPlayerToken();

  // Snapshot referrer + portal flag once, before they can be cleared by SPA nav.
  const portalQS = new URLSearchParams(window.location.search).get("portal");
  const arrivedViaPortal = !!portalQS && portalQS !== "false" && portalQS !== "0";
  const referrer = document.referrer || null;
  // Pin the captured upstream referrer for the whole session so every event
  // can ship it. Skip self-referrals (in-app navigation).
  referrerHref = referrer;
  const parsedHost = _parseHost(referrer);
  if (parsedHost && parsedHost !== window.location.hostname.toLowerCase()) {
    referrerHost = parsedHost;
  }

  // Initial pageview — every visit gets one.
  const pvDetail = { path: window.location.pathname };
  if (arrivedViaPortal) pvDetail.portal = true;
  track("pageview", pvDetail);

  // Portal arrival is a separate event so the dashboard can split it out
  // even when sessions are also counted as pageviews.
  if (arrivedViaPortal) {
    track("portal_arrival", { from: referrer, portal: true });
  }

  // Periodic flush so the server sees activity from long-lived tabs.
  flushTimer = setInterval(flush, FLUSH_MS);

  // Flush on tab hide / unload — sendBeacon is the safe path here.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export default { init, track, gameStart, gameEnd, setPlayerName };
