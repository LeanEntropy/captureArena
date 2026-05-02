import * as Colyseus from "colyseus.js";

// When this client is loaded from itch.io's iframe sandbox the host is
// some `*.itch.zone` URL — connecting back to that host obviously won't
// reach our Colyseus server. Detect it and route to the canonical Railway
// host so the same static client works on both itch and the direct site.
const REMOTE_SERVER = "wss://landcapture.up.railway.app";
const ITCH_HOST_SUFFIXES = [".itch.zone", ".itch.io"];
const INPUT_BUFFER_MAX = 100; // ~3.3s @ 30Hz

function _isItchHost() {
  const h = location.hostname.toLowerCase();
  return h === "itch.io" || ITCH_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

function _resolveServerUrl() {
  if (_isItchHost()) return REMOTE_SERVER;
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
    // Browser refresh = new sessionId. Reconnection grace covers transient
    // network blips only. Score persistence across refresh is via playerToken.
    // Resolve token: passed-in > localStorage > generate new
    let token = playerToken || localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.joinOrCreate("game", {});
    this.room.onStateChange((state) => this.onState?.(state));

    // Forward server messages to the matching event hook. Each entry is
    // [serverMessage, hookName, (payload) => args[]].
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

    // Now that handlers are wired, send hello
    this.room.send("hello", { name: playerName, playerToken: token });

    return this.room;
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

  disconnect() {
    if (this.room) this.room.leave();
  }
}
