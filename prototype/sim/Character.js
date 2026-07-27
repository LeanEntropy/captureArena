import { BOT_SPEED, INVULN_TIME } from "./constants.js";

export class Character {
  constructor({ id, factionId, name, respawnDelay = 3, speed = BOT_SPEED }) {
    this.id = id;
    this.factionId = factionId;
    this.name = name;
    this.respawnDelay = respawnDelay;

    this.alive = true;
    this.isHuman = false;
    this.pos = { x: 0, z: 0 };
    this.dir = { x: 0, z: 1 };
    this.targetDir = { x: 0, z: 1 };
    this.speed = speed;
    this.trailVerts = [];
    this.invulnTimer = 0;
    this.respawnTimer = 0;
    this.killCount = 0;
    this.wasOutside = false;
    this._lastInsidePos = null;

    // Bot AI state (consumed by sim/BotAI.js; ignored when isHuman=true).
    this.botWaypoints = [];
    this.botLoopCount = 0;
    this.botAggroChance = 0.25;
    this.botLastWaypointDist = Infinity;
    this.botStallTicks = 0;
  }

  setPos(x, z) {
    this.pos = { x, z };
  }

  setDir(x, z) {
    this.dir = { x, z };
  }

  // Reset all per-life transient state (trail, outside flag, bot plan).
  // Caller is responsible for setting alive, pos, respawnTimer, invulnTimer.
  _resetTransient() {
    this.trailVerts = [];
    this.wasOutside = false;
    this._lastInsidePos = null;
    this.botWaypoints = [];
    this.botLoopCount = 0;
    this.botLastWaypointDist = Infinity;
    this.botStallTicks = 0;
  }

  kill() {
    this.alive = false;
    this.respawnTimer = this.respawnDelay;
    this.invulnTimer = 0;
    this._resetTransient();
  }

  respawn(x, z) {
    this.alive = true;
    this.pos = { x, z };
    this.respawnTimer = 0;
    this.invulnTimer = INVULN_TIME;
    this._resetTransient();
  }
}
