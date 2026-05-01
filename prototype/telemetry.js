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

const ENDPOINT = "/track";
const FLUSH_MS = 5000;

const queue = [];
let inited = false;
let sessionId = null;
let playerToken = null;
let playerName = null;
let flushTimer = null;
let _gameStartTs = 0;

function _getSessionId() {
  try {
    let id = sessionStorage.getItem("tel_sid");
    if (!id) {
      id = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("tel_sid", id);
    }
    return id;
  } catch {
    // sessionStorage may be blocked in private mode — fall back to in-memory.
    return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  // Try sendBeacon first (survives unload). Fall back to fetch+keepalive.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    // fall through
  }
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // swallow — telemetry must never break the game
  }
}

function flush() {
  if (queue.length === 0) return;
  // Splice up to 50 (server cap) so a long-lived tab never overflows.
  const batch = queue.splice(0, 50);
  _send({ events: batch });
}

export function setPlayerName(name) {
  if (typeof name === "string" && name.trim().length > 0) {
    playerName = name.trim().slice(0, 32);
  }
}

export function track(event, detail) {
  if (!inited) init();
  const entry = {
    event,
    session_id: sessionId,
  };
  if (playerToken) entry.player_token = playerToken;
  // Always attach playerName when set so the dashboard can show recent names.
  if (detail && typeof detail === "object") {
    entry.detail = playerName ? { ...detail, playerName } : detail;
  } else if (playerName) {
    entry.detail = { playerName };
  }
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
