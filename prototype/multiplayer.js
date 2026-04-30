import * as Colyseus from "colyseus.js";

export class MultiplayerClient {
  constructor() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}`;
    this.client = new Colyseus.Client(url);
    this.room = null;
    this.playerToken = null;

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
  }

  async connect(playerName, playerToken) {
    // Browser refresh = new sessionId. Reconnection grace covers transient
    // network blips only. Score persistence across refresh is via playerToken.
    // Resolve token: passed-in > localStorage > generate new
    let token = playerToken;
    if (!token) {
      token = localStorage.getItem("playerToken");
      if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem("playerToken", token);
      }
    }
    this.playerToken = token;

    this.room = await this.client.joinOrCreate("game", {});
    this.room.onStateChange((state) => {
      if (this.onState) this.onState(state);
    });
    this.room.onMessage("claim", ({ charId, trailPoints, factionId, replayTrail }) => {
      if (this.onClaim) this.onClaim(charId, factionId, trailPoints, !!replayTrail);
    });
    this.room.onMessage("claimResult", ({ charId, factionId, cells }) => {
      if (this.onClaimResult) this.onClaimResult(charId, factionId, cells);
    });
    this.room.onMessage("heal", ({ changedCells }) => {
      if (this.onHeal) this.onHeal(changedCells);
    });
    this.room.onMessage("trailVertex", ({ charId, x, z }) => {
      if (this.onTrailVertex) this.onTrailVertex(charId, x, z);
    });
    this.room.onMessage("kill", ({ killerId, victimId }) => {
      if (this.onKill) this.onKill(killerId, victimId);
    });
    this.room.onMessage("teleport", ({ charId, posX, posZ, dirX, dirZ, reason }) => {
      if (this.onTeleport) this.onTeleport(charId, posX, posZ, dirX, dirZ, reason);
    });
    this.room.onMessage("yourCharId", ({ charId }) => {
      if (this.onYourCharId) this.onYourCharId(charId);
    });
    this.room.onMessage("gridSnapshot", ({ bytes }) => {
      if (this.onGridSnapshot) this.onGridSnapshot(bytes);
    });
    this.room.onMessage("cumulativeScore", ({ score }) => {
      if (this.onCumulativeScore) this.onCumulativeScore(score);
    });

    // Now that handlers are wired, send hello
    this.room.send("hello", { name: playerName, playerToken: token });

    return this.room;
  }

  sendInput(dirX, dirZ) {
    if (!this.room) return;
    this.room.send("input", { dirX, dirZ });
  }

  disconnect() {
    if (this.room) this.room.leave();
  }
}
