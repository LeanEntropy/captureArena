import {
  GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL,
  RESPAWN_DELAY, BOT_NAMES,
  MIN_POINT_DIST, TURN_SPEED,
} from "./constants.js";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
import { Character } from "./Character.js";

export class Simulation {
  constructor({ seed = 1 } = {}) {
    this.seed = seed;
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.factionManager = new FactionManager();
    this.scoreTracker = new ScoreTracker();
    this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
    this.characters = [];
    this.totalArenaCells = 0;
    this.started = false;

    // Event hooks (set by host: server or client). Optional.
    this.onClaim = null;       // (charId, trailPoints, factionId) => void
    this.onHeal = null;        // (changedCells) => void
    this.onTrailVertex = null; // (charId, x, z) => void
    this.onKill = null;        // (killerId, victimId) => void
  }

  start() {
    this._initGrid();
    this._initCharacters();
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL);
    for (const c of this.characters) {
      this.factionManager.addCharacter(c, c.factionId);
    }
    this.matchManager.startMatch();
    this.started = true;
  }

  _initGrid() {
    // Mirror the existing prototype/main.js territoryGrid.init() — circular arena.
    let arenaCount = 0;
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const wx = WORLD_MIN + (gx + 0.5) * CELL_SIZE;
        const wy = WORLD_MIN + (gy + 0.5) * CELL_SIZE;
        const dist = Math.sqrt(wx * wx + wy * wy);
        const idx = gy * GRID_SIZE + gx;
        this.grid[idx] = (dist > ARENA_RADIUS) ? GRID_SENTINEL : 0;
        if (this.grid[idx] === 0) arenaCount++;
      }
    }
    this.totalArenaCells = arenaCount;
  }

  _initCharacters() {
    let id = 0;
    for (let f = 1; f <= FACTION_COUNT; f++) {
      for (let i = 0; i < CHARS_PER_FACTION; i++) {
        const name = BOT_NAMES[id % BOT_NAMES.length];
        const c = new Character({ id, factionId: f, name, respawnDelay: RESPAWN_DELAY });
        this.characters.push(c);
        this.scoreTracker.register(c);
        id++;
      }
    }
  }

  // Returns the faction id (1-5) that owns the cell at world coords (wx, wz),
  // or 0 if unclaimed / out of bounds.
  _getOwnerAt(wx, wz) {
    const gx = Math.floor((wx - WORLD_MIN) / CELL_SIZE);
    const gy = Math.floor((wz - WORLD_MIN) / CELL_SIZE);
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return 0;
    const v = this.grid[gy * GRID_SIZE + gx];
    return v === GRID_SENTINEL ? 0 : v;
  }

  // Mirror of main.js Character.update(dt) simulation portion:
  // smoothly turn toward targetDir, advance position, clamp to arena, decrement invuln.
  _stepCharacter(char, dt) {
    if (char.invulnTimer > 0) {
      char.invulnTimer = Math.max(0, char.invulnTimer - dt);
    }

    // Steer: rotate dir toward targetDir at TURN_SPEED rad/s
    const ca = Math.atan2(char.dir.x, char.dir.z);
    const ta = Math.atan2(char.targetDir.x, char.targetDir.z);
    let diff = ta - ca;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-TURN_SPEED * dt, Math.min(TURN_SPEED * dt, diff));
    const na = ca + turn;
    char.dir = { x: Math.sin(na), z: Math.cos(na) };

    // Move
    char.pos = {
      x: char.pos.x + char.dir.x * char.speed * dt,
      z: char.pos.z + char.dir.z * char.speed * dt,
    };

    // Boundary -- solid wall, slide along it
    const r = Math.sqrt(char.pos.x * char.pos.x + char.pos.z * char.pos.z);
    if (r > ARENA_RADIUS) {
      const inv = ARENA_RADIUS / r;
      char.pos = { x: char.pos.x * inv, z: char.pos.z * inv };
    }
  }

  // Records trail vertices when the character is outside its own territory and
  // has moved at least MIN_POINT_DIST since the last recorded vertex.
  _stepCharacterTrail(char) {
    if (!char.alive) return;
    const owner = this._getOwnerAt(char.pos.x, char.pos.z);
    const insideOwn = owner === char.factionId;
    if (insideOwn) return;

    const last = char.trailVerts[char.trailVerts.length - 1];
    if (!last) {
      char.trailVerts.push({ x: char.pos.x, z: char.pos.z });
      this.onTrailVertex?.(char.id, char.pos.x, char.pos.z);
      return;
    }
    const dx = char.pos.x - last.x;
    const dz = char.pos.z - last.z;
    if (Math.sqrt(dx * dx + dz * dz) >= MIN_POINT_DIST) {
      char.trailVerts.push({ x: char.pos.x, z: char.pos.z });
      this.onTrailVertex?.(char.id, char.pos.x, char.pos.z);
    }
  }

  // Cutoff: kill any living, non-invuln character that is standing on enemy
  // territory while not currently making a trail run.
  _checkCutoff() {
    for (const c of this.characters) {
      if (!c.alive) continue;
      if (c.invulnTimer > 0) continue;
      // Only kill if not currently trailing (no trail = not on a claim run).
      if (c.trailVerts.length !== 0) continue;
      const owner = this._getOwnerAt(c.pos.x, c.pos.z);
      if (owner !== c.factionId && owner !== 0) {
        this._killCharacter(c, null);
      }
    }
  }

  _killCharacter(victim, killer) {
    victim.alive = false;
    victim.respawnTimer = RESPAWN_DELAY;
    victim.trailVerts = [];
    victim.invulnTimer = 0;

    if (killer) {
      killer.killCount = (killer.killCount || 0) + 1;
      if (this.scoreTracker?.onKill) {
        this.scoreTracker.onKill(killer, this.factionManager);
      }
    }
    this.onKill?.(killer ? killer.id : null, victim.id);
  }

  tick(dt) {
    if (!this.started) return;
    this.matchManager.update(dt, this.grid, GRID_SIZE, GRID_SENTINEL);
    if (this.matchManager.phase !== "playing") return;

    for (const c of this.characters) {
      if (!c.alive) {
        c.respawnTimer -= dt;
        // Respawn execution is handled in Task 5b.
        continue;
      }
      this._stepCharacter(c, dt);
      this._stepCharacterTrail(c);
    }

    this._checkCutoff();
    this.factionManager.updateTerritoryPcts(this.grid, GRID_SIZE, GRID_SENTINEL);
  }
}
