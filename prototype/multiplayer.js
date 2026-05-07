import * as Colyseus from "colyseus.js";

// When this client is loaded from a host that is NOT itself the Colyseus
// server (e.g. itch.io's iframe sandbox, GitHub Pages, a CDN), connecting
// back to `location.host` won't reach a game server. Detect those hosts
// and route to the configured remote origin instead.
//
// Source of the remote origin (in order):
//   1. <meta name="game-remote-origin" content="https://your-host.tld">
//      in index.html. Forks edit one line and they're done.
//   2. Hardcoded fallback below — kept only so a hand-built ZIP without
//      the meta tag still has somewhere to call. A fork should set the
//      meta tag to its own server.
const REMOTE_FALLBACK = "wss://landcapture.up.railway.app";
const ITCH_HOST_SUFFIXES = [".itch.zone", ".itch.io"];
const INPUT_BUFFER_MAX = 100; // ~3.3s @ 30Hz

function _readMetaOrigin() {
  const meta = document.querySelector('meta[name="game-remote-origin"]');
  const origin = meta?.getAttribute("content")?.trim();
  if (!origin) return null;
  // Convert https:// → wss:// (and http:// → ws://) so the origin can be
  // shared with the telemetry endpoint without rewriting per-call.
  return origin.replace(/^http(s?):\/\//i, (_m, s) => `ws${s ? "s" : ""}://`);
}

function _isRemoteHostRequired() {
  const h = location.hostname.toLowerCase();
  return h === "itch.io" || ITCH_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function _resolveServerUrl() {
  if (_isRemoteHostRequired()) {
    return _readMetaOrigin() ?? REMOTE_FALLBACK;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

export class MultiplayerClient {
  constructor() {
    this.client = new Colyseus.Client(_resolveServerUrl());
    this.room = null;
    this.playerToken = null;

    // Input sequence tracking for server-confirmed reconciliation.
    // Each input message is tagged with a monotonically increasing seq;
    // server echoes back the latest applied seq via CharacterSchema
    // .lastAppliedInputSeq. The client uses ackInputs() to drop confirmed
    // entries from the buffer; unacked inputs are replayed onto the
    // server-confirmed pos to derive the new predicted state.
    this.inputSeq = 0;
    this.inputBuffer = []; // [{ seq, dirX, dirZ, t }]

    // RTT tracking — last 5 samples in ms, median reported by getRTT().
    this._rttSamples = [];
    this._pingInterval = null;

    // Event hooks (set by host renderer)
    this.onState = null;           // (state) => void
    this.onClaim = null;           // (charId, factionId, trailPoints?, replayTrail) => void
    this.onClaimResult = null;     // (charId, factionId, cells:Int32Array) => void
    this.onHeal = null;            // (changedCells) => void
    this.onTrailVertex = null;     // (charId, x, z) => void
    this.onKill = null;            // (killerId, victimId) => void
    this.onTeleport = null;        // (charId, posX, posZ, dirX, dirZ, reason) => void
    this.onYourCharId = null;      // (charId) => void
    this.onGridSnapshot = null;    // (b64) => void
    this.onCumulativeScore = null; // (score) => void
    this.onNameRejected = null;    // ({reason}) => void — server says name conflict
  }

  async connect(playerName, playerToken) {
    let token = playerToken || localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.joinOrCreate("game", {});
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  // Join a private room by 6-char code. Same hello flow.
  async joinPrivate(code, playerName) {
    let token = localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.join("private", { code });
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  // Create a private room with the given config + immediately join it.
  async createPrivate(config, playerName) {
    let token = localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.create("private", config);
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  _wireRoomHandlers() {
    this.room.onStateChange((state) => this.onState?.(state));

    const handlers = [
      ["claim",           "onClaim",           (m) => [m.charId, m.factionId, m.trailPoints, !!m.replayTrail]],
      ["claimResult",     "onClaimResult",     (m) => [m.charId, m.factionId, m.cells]],
      ["heal",            "onHeal",            (m) => [m.changedCells]],
      ["trailVertex",     "onTrailVertex",     (m) => [m.charId, m.x, m.z]],
      ["kill",            "onKill",            (m) => [m.killerId, m.victimId]],
      ["teleport",        "onTeleport",        (m) => [m.charId, m.posX, m.posZ, m.dirX, m.dirZ, m.reason]],
      ["yourCharId",      "onYourCharId",      (m) => [m.charId]],
      ["gridSnapshot",    "onGridSnapshot",    (m) => [m.bytes]],
      ["cumulativeScore", "onCumulativeScore", (m) => [m.score]],
      ["nameRejected",    "onNameRejected",    (m) => [{ reason: m.reason }]],
    ];
    for (const [msg, hook, mapArgs] of handlers) {
      this.room.onMessage(msg, (payload) => {
        const fn = this[hook];
        if (fn) fn(...mapArgs(payload));
      });
    }
    this.room.onMessage("pong", (t) => {
      const rtt = performance.now() - t;
      this._rttSamples.push(rtt);
      while (this._rttSamples.length > 5) this._rttSamples.shift();
    });
    this._pingInterval = setInterval(() => {
      try { this.room?.send("ping", performance.now()); } catch {}
    }, 2000);
  }

  sendInput(dirX, dirZ) {
    if (!this.room) return;
    this.inputSeq++;
    this.inputBuffer.push({
      seq: this.inputSeq,
      dirX,
      dirZ,
      t: performance.now(),
    });
    // Bound the buffer — at 30Hz this caps memory at ~3.3s of pending inputs.
    while (this.inputBuffer.length > INPUT_BUFFER_MAX) this.inputBuffer.shift();
    this.room.send("input", { dirX, dirZ, seq: this.inputSeq });
  }

  // Drop inputs the server has already applied. Called by the client after
  // reading the local player's CharacterSchema.lastAppliedInputSeq.
  ackInputs(upToSeq) {
    while (this.inputBuffer.length > 0 && this.inputBuffer[0].seq <= upToSeq) {
      this.inputBuffer.shift();
    }
  }

  // Returns the median of the last 5 RTT samples in milliseconds, or null
  // if no pong has been received yet. Resistant to single-frame stalls.
  getRTT() {
    if (this._rttSamples.length === 0) return null;
    const sorted = [...this._rttSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  disconnect() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    if (this.room) this.room.leave();
  }
}
