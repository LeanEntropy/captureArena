import {
  GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL,
  RESPAWN_DELAY, BOT_NAMES,
  MIN_POINT_DIST, TURN_SPEED,
  TRAIL_KILL_DIST, SELF_TRAIL_SKIP,
  CONTINUOUS_LAND,
} from "./constants.js";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
import { Character } from "./Character.js";
import { BotAI } from "./BotAI.js";

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
    // Place each char at its faction's spawn point (mirrors main.js Game.start).
    for (const c of this.characters) {
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      c.setPos(sp.x, sp.z);
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
  // On re-entry to own territory, triggers a claim if the trail is long enough.
  _stepCharacterTrail(char) {
    if (!char.alive) return;
    const owner = this._getOwnerAt(char.pos.x, char.pos.z);
    const insideOwn = owner === char.factionId;
    if (insideOwn) {
      // Task 5b claim hook point — re-entered own territory.
      if (char.wasOutside) {
        if (char.trailVerts.length >= 5) {
          this.claim(char);
        } else {
          char.trailVerts = [];
        }
      }
      char.wasOutside = false;
      return;
    }

    // Outside own territory
    char.wasOutside = true;
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

  // Per-character trail-cross kill detection.
  // Mirrors main.js Game.tick lines 1024-1048.
  _checkTrailKills() {
    const chars = this.characters;
    for (const c of chars) {
      if (!c.alive || c.invulnTimer > 0) continue;
      for (const other of chars) {
        if (!other.alive) continue;
        if (other === c) {
          // Self-trail collision: skip last SELF_TRAIL_SKIP verts (just-laid-down).
          for (let i = 0; i < other.trailVerts.length - SELF_TRAIL_SKIP; i++) {
            const tv = other.trailVerts[i];
            const dx = c.pos.x - tv.x;
            const dz = c.pos.z - tv.z;
            if (Math.sqrt(dx * dx + dz * dz) < TRAIL_KILL_DIST) {
              this._killCharacter(c, null);
              break;
            }
          }
        } else if (other.factionId !== c.factionId) {
          // Enemy trail collision: c kills other (the trail's owner).
          for (const tv of other.trailVerts) {
            const dx = c.pos.x - tv.x;
            const dz = c.pos.z - tv.z;
            if (Math.sqrt(dx * dx + dz * dz) < TRAIL_KILL_DIST) {
              this._killCharacter(other, c);
              break;
            }
          }
        }
        if (!c.alive) break;
      }
    }
  }

  // Cutoff: kill any living, non-invuln character that is standing on enemy
  // territory while not currently making a trail run.
  _checkCutoff() {
    for (const c of this.characters) {
      if (!c.alive) continue;
      if (c.invulnTimer > 0) continue;
      // Only kill if not currently trailing — wasOutside means they intentionally left territory.
      if (c.wasOutside) continue;
      const owner = this._getOwnerAt(c.pos.x, c.pos.z);
      if (owner !== c.factionId && owner !== 0) {
        this._killCharacter(c, null);
      }
    }
  }

  _killCharacter(victim, killer) {
    victim.kill();   // single source of truth — sets alive=false, respawnTimer, clears trail, zeros invuln
    if (killer) {
      killer.killCount += 1;
      if (this.scoreTracker?.onKill) {
        this.scoreTracker.onKill(killer, this.factionManager);
      }
    }
    this.onKill?.(killer ? killer.id : null, victim.id);
  }

  // ===== claim / heal / grid helpers =====

  // Stamp a 2D polygon ({x, y}[] in world coords; y is the second axis = z) onto
  // this.grid with the given owner. Returns the set of overwritten owner IDs.
  // Faithfully mirrors main.js territoryGrid.stampPolygon().
  _stampPolygon(poly2D, ownerId) {
    const overwritten = new Set();
    if (poly2D.length < 3) return overwritten;

    // World-coord bounding box → grid-row range
    let wMinY = Infinity, wMaxY = -Infinity;
    for (const p of poly2D) {
      if (p.y < wMinY) wMinY = p.y;
      if (p.y > wMaxY) wMaxY = p.y;
    }
    const minGY = Math.max(0, Math.min(GRID_SIZE - 1,
      Math.floor((wMinY - WORLD_MIN) / CELL_SIZE)));
    const maxGY = Math.max(0, Math.min(GRID_SIZE - 1,
      Math.floor((wMaxY - WORLD_MIN) / CELL_SIZE)));

    const n = poly2D.length;
    for (let gy = minGY; gy <= maxGY; gy++) {
      const scanY = WORLD_MIN + (gy + 0.5) * CELL_SIZE;

      // Find all X intersections of polygon edges with this scanline Y
      const xIntersections = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const yi = poly2D[i].y, yj = poly2D[j].y;
        if ((yi <= scanY && yj > scanY) || (yj <= scanY && yi > scanY)) {
          const t = (scanY - yi) / (yj - yi);
          const xInt = poly2D[i].x + t * (poly2D[j].x - poly2D[i].x);
          xIntersections.push(xInt);
        }
      }
      xIntersections.sort((a, b) => a - b);

      // Fill between pairs
      for (let k = 0; k + 1 < xIntersections.length; k += 2) {
        const gxStart = Math.max(0, Math.min(GRID_SIZE - 1,
          Math.floor((xIntersections[k] - WORLD_MIN) / CELL_SIZE)));
        const gxEnd = Math.max(0, Math.min(GRID_SIZE - 1,
          Math.floor((xIntersections[k + 1] - WORLD_MIN) / CELL_SIZE)));
        for (let gx = gxStart; gx <= gxEnd; gx++) {
          const idx = gy * GRID_SIZE + gx;
          const prev = this.grid[idx];
          if (prev !== GRID_SENTINEL && prev !== ownerId) {
            if (prev !== 0) overwritten.add(prev);
            this.grid[idx] = ownerId;
          }
        }
      }
    }
    return overwritten;
  }

  // BFS flood-fill of all cells equal to ownerId. Keeps the largest
  // connected component; reassigns smaller components to reassignTo.
  // Returns the count of cells reassigned. Faithful port of
  // main.js territoryGrid.floodFillConnected (uses array-as-queue for determinism).
  _floodFillConnected(ownerId, reassignTo) {
    const visited = new Uint8Array(GRID_SIZE * GRID_SIZE);
    const components = [];

    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] !== ownerId || visited[i]) continue;

      const component = [];
      const gy0 = Math.floor(i / GRID_SIZE);
      const gx0 = i % GRID_SIZE;
      const queue = [gx0, gy0];
      visited[i] = 1;
      let head = 0;

      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        component.push(cy * GRID_SIZE + cx);

        const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const nIdx = ny * GRID_SIZE + nx;
          if (visited[nIdx] || this.grid[nIdx] !== ownerId) continue;
          visited[nIdx] = 1;
          queue.push(nx, ny);
        }
      }
      components.push(component);
    }

    if (components.length <= 1) return 0;

    let largestIdx = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].length > components[largestIdx].length) largestIdx = i;
    }

    let reassigned = 0;
    for (let i = 0; i < components.length; i++) {
      if (i === largestIdx) continue;
      for (const cellIdx of components[i]) {
        this.grid[cellIdx] = reassignTo;
        reassigned++;
      }
    }
    return reassigned;
  }

  // Multi-pass: assign each unclaimed in-arena cell (value 0) to its
  // dominant 4-neighbor faction. Repeats until no change.
  // Faithful port of main.js Game._healUnclaimedCells.
  _healUnclaimedCells() {
    const grid = this.grid;
    const size = GRID_SIZE;
    const changedCells = [];   // flat: [idx0, faction0, idx1, faction1, ...]

    let changed = true;
    while (changed) {
      changed = false;
      for (let gy = 1; gy < size - 1; gy++) {
        for (let gx = 1; gx < size - 1; gx++) {
          const idx = gy * size + gx;
          if (grid[idx] !== 0) continue;

          // Use a plain Uint8Array sized FACTION_COUNT+1 — preserves ordering.
          const counts = new Uint8Array(FACTION_COUNT + 1);
          const n = grid[idx - 1];
          const s = grid[idx + 1];
          const w = grid[idx - size];
          const e = grid[idx + size];
          if (n > 0 && n !== GRID_SENTINEL) counts[n]++;
          if (s > 0 && s !== GRID_SENTINEL) counts[s]++;
          if (w > 0 && w !== GRID_SENTINEL) counts[w]++;
          if (e > 0 && e !== GRID_SENTINEL) counts[e]++;

          let best = 0, bestCount = 0;
          for (let f = 1; f <= FACTION_COUNT; f++) {
            if (counts[f] > bestCount) { bestCount = counts[f]; best = f; }
          }
          if (best > 0) {
            grid[idx] = best;
            changedCells.push(idx, best);
            changed = true;
          }
        }
      }
    }

    if (changedCells.length > 0) {
      this.onHeal?.(changedCells);
    }
  }

  // Public claim. Stamps the character's current trail polygon onto the grid as
  // their faction territory, runs continuous-land cleanup against any victims,
  // heals unclaimed cells, fires the onClaim event hook, and reports score.
  // Returns true if the claim was applied; false if the trail was too short.
  claim(char) {
    if (!char.trailVerts || char.trailVerts.length < 5) {
      return false;
    }

    const trail = char.trailVerts;

    // Count cells before for score reporting.
    let cellsBefore = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === char.factionId) cellsBefore++;
    }

    // Build {x, y} polygon (y = z) — stampPolygon's expected format.
    const trailPoly = trail.map(t => ({ x: t.x, y: t.z }));

    const overwritten = this._stampPolygon(trailPoly, char.factionId);

    // CONTINUOUS_LAND: per overwritten faction, keep largest component, reassign rest.
    if (CONTINUOUS_LAND && overwritten.size > 0) {
      for (const victimFactionId of overwritten) {
        if (victimFactionId === char.factionId) continue;
        this._floodFillConnected(victimFactionId, char.factionId);
      }
    }

    // Clear trail.
    char.trailVerts = [];

    // Heal pass: fill unclaimed cells.
    this._healUnclaimedCells();

    // Build flat trail-points array for the event hook (multiplayer client uses this
    // to re-rasterize the same claim on its local grid copy).
    const trailPointsFlat = new Array(trail.length * 2);
    for (let i = 0; i < trail.length; i++) {
      trailPointsFlat[i * 2] = trail[i].x;
      trailPointsFlat[i * 2 + 1] = trail[i].z;
    }
    this.onClaim?.(char.id, trailPointsFlat, char.factionId);

    // Score tracking.
    let cellsAfter = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === char.factionId) cellsAfter++;
    }
    const cellsFlipped = cellsAfter - cellsBefore;
    if (this.scoreTracker?.onCapture && cellsFlipped > 0) {
      this.scoreTracker.onCapture(char, cellsFlipped, this.factionManager);
    }
    if (this.scoreTracker?.onClaim) {
      this.scoreTracker.onClaim(char, this.factionManager);
    }

    return true;
  }

  // Respawn a dead character whose timer has expired. If the faction is still
  // alive and has respawns enabled, the char respawns in place; otherwise it
  // is reassigned to a surviving faction. Mirrors main.js Game.tick lines 985-1020.
  respawnChar(c) {
    const faction = this.factionManager.factions.get(c.factionId);
    if (faction && faction.respawnsEnabled) {
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      c.respawn(sp.x, sp.z);
      return;
    }

    const newFaction = this.factionManager.reassignCharacter(c);
    if (newFaction) {
      this.scoreTracker.onFactionChange(c);
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      c.respawn(sp.x, sp.z);
    }

    // Update elimination state for all factions (mirrors main.js).
    for (const [id] of this.factionManager.factions) {
      this.factionManager.checkElimination(id);
    }
  }

  // ===== public API =====

  setHumanControl(charId, isHuman) {
    const c = this.characters[charId];
    if (c) c.isHuman = !!isHuman;
  }

  setTargetDir(charId, dirX, dirZ) {
    const c = this.characters[charId];
    if (!c) return;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    c.targetDir = { x: dirX / len, z: dirZ / len };
  }

  // Reset grid, factions, and characters back to a fresh-match state.
  // Used by the server between rounds.
  restart() {
    this._initGrid();
    this.factionManager = new FactionManager();
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL);
    for (const c of this.characters) {
      c.alive = true;
      c.trailVerts = [];
      c.killCount = 0;
      c.invulnTimer = 0;
      c.respawnTimer = 0;
      c.wasOutside = false;
      c.botWaypoints = [];
      c.botLoopCount = 0;
      this.factionManager.addCharacter(c, c.factionId);
      // Reposition at spawn point (mirrors start())
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      if (sp) c.setPos(sp.x, sp.z);
    }
    this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
    this.matchManager.startMatch();
  }

  tick(dt) {
    if (!this.started) return;
    this.matchManager.update(dt, this.grid, GRID_SIZE, GRID_SENTINEL);
    if (this.matchManager.phase !== "playing") return;

    for (const c of this.characters) {
      if (!c.alive) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) {
          this.respawnChar(c);
        }
        continue;
      }
      // Bots plan their own targetDir each tick; humans rely on setTargetDir().
      if (!c.isHuman) {
        const dir = BotAI.planTargetDir(c, this);
        c.targetDir = dir;
      }
      this._stepCharacter(c, dt);
      this._stepCharacterTrail(c);
    }

    this._checkTrailKills();
    this._checkCutoff();
    this.factionManager.updateTerritoryPcts(this.grid, GRID_SIZE, GRID_SENTINEL);
  }
}
