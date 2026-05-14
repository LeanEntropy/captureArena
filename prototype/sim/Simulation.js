import {
  GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL,
  RESPAWN_DELAY, BOT_NAMES,
  MIN_POINT_DIST, TURN_SPEED,
  TRAIL_KILL_DIST, SELF_TRAIL_SKIP,
  PLAYER_SPEED, BOT_SPEED,
} from "./constants.js";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
import { Character } from "./Character.js";
import { BotAI } from "./BotAI.js";
import { extractContours } from "./grid_geom.js";
import { enforceConnectivity } from "./connectivity.js";

// Max extractContours rebuilds allowed per tick. See ctor comment.
const CONTOUR_BUILD_PER_TICK = 1;

export class Simulation {
  constructor({ seed = 1, numFactions = FACTION_COUNT, botsPerFaction = CHARS_PER_FACTION } = {}) {
    this.seed = seed;
    this.numFactions = numFactions;
    this.botsPerFaction = botsPerFaction;
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.factionManager = new FactionManager();
    this.scoreTracker = new ScoreTracker();
    this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
    this.characters = [];
    this.totalArenaCells = 0;
    this.started = false;
    // cellCounts is sized to numFactions (index 0 = unclaimed).
    this.cellCounts = new Uint32Array(numFactions + 1);

    this.onClaim = null;
    this.onClaimResult = null;
    this.onHeal = null;
    this.onTrailVertex = null;
    this.onKill = null;
    this.onTeleport = null;

    this._contourCache = new Map();
    // Throttle for extractContours rebuilds. After a claim invalidates 5
    // factions' caches, all 5 used to rebuild on the next tick when bots
    // replanned simultaneously → 5 × O(grid) ≈ 80ms tick spike → server
    // stalled → patches arrived late → client snapshot interp clamped to
    // newest → visible synchronized freeze on all entities. With this gate,
    // at most CONTOUR_BUILD_PER_TICK rebuilds happen per tick. Other bots in
    // the same tick see empty contours and fall back to their wander branch
    // for one tick (≈33ms of degraded AI).
    this._contourBuildsThisTick = 0;
  }

  // Invalidate cached contours for the given faction(s). Pass an iterable of
  // factionIds, or omit to invalidate all.
  _invalidateContourCache(factionIds) {
    if (!factionIds) {
      this._contourCache.clear();
      return;
    }
    for (const f of factionIds) {
      this._contourCache.delete(f);
    }
  }

  // Cached contour lookup. BotAI calls this many times per second across
  // many bots; the underlying extractContours is O(grid). The cache is keyed
  // on factionId and invalidated by claim() and _healUnclaimedCells().
  // Rebuilds are throttled to CONTOUR_BUILD_PER_TICK per tick — see ctor.
  getCachedContours(factionId) {
    let entry = this._contourCache.get(factionId);
    if (entry && entry.contours) return entry.contours;
    if (this._contourBuildsThisTick >= CONTOUR_BUILD_PER_TICK) {
      // Budget exhausted this tick. Returning empty makes BotAI._planLoop
      // fall through its `contours.length === 0` branch (wander toward
      // origin) for one tick. Next tick the budget resets and one more
      // faction gets rebuilt. Acceptable AI degradation; the alternative
      // was a server-tick spike that froze every client.
      return [];
    }
    this._contourBuildsThisTick++;
    const contours = extractContours(this.grid, factionId);
    if (entry) {
      entry.contours = contours;
    } else {
      entry = { contours };
      this._contourCache.set(factionId, entry);
    }
    return contours;
  }

  // Cached cell count per faction. Reads from the incrementally-maintained
  // cellCounts Uint32Array (kept in sync by every cell write in claim() and
  // _healUnclaimedCells), so this is O(1). The previous implementation
  // called countCells (O(grid)) when the cache was invalidated, compounding
  // the per-claim cost with extractContours on the same tick.
  getCachedCellCount(factionId) {
    return this.cellCounts[factionId] ?? 0;
  }

  start() {
    this._initGrid();
    this._initCharacters();
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL, this.numFactions);
    // Initial cellCounts populate. From here, every grid mutation must keep
    // cellCounts in sync.
    this._recomputeCellCounts();
    for (const c of this.characters) {
      this.factionManager.addCharacter(c, c.factionId);
    }
    // Place each char at its faction's spawn point (mirrors main.js Game.start).
    for (const c of this.characters) {
      const sp = this._spawnFor(c.factionId);
      c.setPos(sp.x, sp.z);
    }
    this.matchManager.startMatch();
    this.started = true;
  }

  // Full O(N) scan to rebuild cellCounts from the current grid contents.
  // Only called from start() and restart(); per-tick code paths (claim, heal)
  // maintain the counts incrementally.
  _recomputeCellCounts() {
    const counts = this.cellCounts;
    counts.fill(0);
    const grid = this.grid;
    for (let i = 0, len = grid.length; i < len; i++) {
      const v = grid[i];
      if (v === GRID_SENTINEL) continue;
      // v is in [0, FACTION_COUNT]; index 0 = unclaimed.
      counts[v]++;
    }
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
    for (let f = 1; f <= this.numFactions; f++) {
      for (let i = 0; i < this.botsPerFaction; i++) {
        const name = BOT_NAMES[id % BOT_NAMES.length];
        const c = new Character({ id, factionId: f, name, respawnDelay: RESPAWN_DELAY });
        this.characters.push(c);
        this.scoreTracker.register(c);
        id++;
      }
    }
  }

  /**
   * Dynamically grow the simulation by appending one bot character to a
   * given faction. Returns the new Character (also pushed onto
   * this.characters and registered with scoreTracker), or null if the
   * faction can't be grown (already at the per-faction cap or the faction
   * id is out of range).
   *
   * Used by the multiplayer server when all bot slots are taken by humans
   * but a new client still wants in. Solo never calls this — its 30-char
   * arrangement is fixed at start.
   *
   * @param {number} factionId - 1..FACTION_COUNT
   * @param {number} maxPerFaction - cap (typically MAX_CHARS_PER_FACTION)
   * @returns {object|null}
   */
  addCharacter(factionId, maxPerFaction) {
    if (factionId < 1 || factionId > this.numFactions) return null;
    let countInFaction = 0;
    for (const c of this.characters) {
      if (c.factionId === factionId) countInFaction++;
    }
    if (countInFaction >= maxPerFaction) return null;

    const id = this.characters.length;
    const name = BOT_NAMES[id % BOT_NAMES.length];
    const c = new Character({ id, factionId, name, respawnDelay: RESPAWN_DELAY });
    this.characters.push(c);
    this.scoreTracker.register(c);
    // Mirror start(): register with factionManager and place at faction spawn,
    // otherwise the new char defaults to (0,0) on neutral land and starts a
    // trail immediately — dying on first edge/self collision. Critical for
    // private rooms where every host joins via this grow path.
    this.factionManager.addCharacter(c, factionId);
    const sp = this._spawnFor(factionId);
    c.setPos(sp.x, sp.z);
    return c;
  }

  // Returns the faction id (1-5) that owns the cell at world coords (wx, wz),
  // or 0 if unclaimed / out of bounds.
  _getOwnerAt(wx, wz) {
    const { gx, gy } = this._worldToGrid(wx, wz);
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return 0;
    const v = this.grid[gy * GRID_SIZE + gx];
    return v === GRID_SENTINEL ? 0 : v;
  }

  // Look up the faction's spawn point. Wrapper that supplies the standard
  // grid/dimensions arguments so callers don't have to repeat them.
  _spawnFor(factionId) {
    return this.factionManager.getSpawnPoint(
      factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
    );
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
      // Track the most recent inside position so we can anchor the trail's
      // first vertex to the territory boundary rather than one cell past it.
      char._lastInsidePos = { x: char.pos.x, z: char.pos.z };

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

    // Outside own territory.
    // First frame outside: push the last-known inside position before the
    // current outside position so the trail visually starts at the boundary.
    if (!char.wasOutside) {
      char.wasOutside = true;
      if (char._lastInsidePos) {
        char.trailVerts.push({ x: char._lastInsidePos.x, z: char._lastInsidePos.z });
        this.onTrailVertex?.(char.id, char._lastInsidePos.x, char._lastInsidePos.z);
      }
    }

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
    // Death penalty: victim loses 4% of their accumulated score.
    if (this.scoreTracker?.onDeath) {
      this.scoreTracker.onDeath(victim);
    }
    this.onKill?.(killer ? killer.id : null, victim.id);
  }

  // ===== claim / heal / grid helpers =====

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
            // Incrementally maintain cellCounts: cell flips from 0 (unclaimed) → best.
            this.cellCounts[0]--;
            this.cellCounts[best]++;
            grid[idx] = best;
            changedCells.push(idx, best);
            changed = true;
          }
        }
      }
    }

    if (changedCells.length > 0) {
      // Invalidate contour cache for every faction that gained cells.
      for (let i = 1; i < changedCells.length; i += 2) {
        this._contourCache.delete(changedCells[i]);
      }
      this.onHeal?.(changedCells);
    }
  }

  // ===== flood-fill claim helpers =====

  // Convert a world coord to integer grid coords. Mirrors _getOwnerAt's
  // convention. Caller must guard against out-of-grid results if needed.
  _worldToGrid(wx, wz) {
    const gx = Math.floor((wx - WORLD_MIN) / CELL_SIZE);
    const gy = Math.floor((wz - WORLD_MIN) / CELL_SIZE);
    return { gx, gy };
  }

  // Find the nearest cell whose owner === factionId to the world point (wx, wz).
  // Returns { gx, gy } or null if the faction owns no arena cells.
  // Optimized: scan within a 200-cell radius bbox first; only fall back to a
  // full grid scan if no own cell is found nearby. The faction nearly always
  // has territory close to the trail endpoint, so the fast path hits almost
  // every time.
  _nearestOwnCell(factionId, wx, wz) {
    const { gx: tgx, gy: tgy } = this._worldToGrid(wx, wz);
    const N = GRID_SIZE;
    const grid = this.grid;
    const RADIUS = 200;

    // Fast path: scan a bounded window around the target.
    const minGX = Math.max(0, tgx - RADIUS);
    const maxGX = Math.min(N - 1, tgx + RADIUS);
    const minGY = Math.max(0, tgy - RADIUS);
    const maxGY = Math.min(N - 1, tgy + RADIUS);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let gy = minGY; gy <= maxGY; gy++) {
      const rowBase = gy * N;
      const dy = gy - tgy;
      const dy2 = dy * dy;
      for (let gx = minGX; gx <= maxGX; gx++) {
        if (grid[rowBase + gx] !== factionId) continue;
        const dx = gx - tgx;
        const d = dx * dx + dy2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = rowBase + gx;
          if (d === 0) {
            return { gx, gy };
          }
        }
      }
    }
    if (bestIdx >= 0) {
      const gx = bestIdx % N;
      const gy = (bestIdx - gx) / N;
      return { gx, gy };
    }

    // Slow path: full scan (rare — only when faction has no nearby cells).
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== factionId) continue;
      const gx = i % N;
      const gy = (i - gx) / N;
      const dx = gx - tgx;
      const dy = gy - tgy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        if (d === 0) break;
      }
    }
    if (bestIdx < 0) return null;
    const gx = bestIdx % N;
    const gy = (bestIdx - gx) / N;
    return { gx, gy };
  }

  // Bresenham-supercover line rasterizer. Sets buffer[gy * GRID_SIZE + gx] = 1
  // for every grid cell the line from (gx0, gy0) to (gx1, gy1) passes through.
  // 4-connected coverage: writes intermediate cells on diagonal steps so a
  // 4-connected BFS cannot leak through a corner.
  //
  // `radius` (default 0): stamp each plotted cell as a (2r+1)×(2r+1) square.
  // r=0 → 1-cell line; r=1 → 3×3 thick line (default for claim walls); r=2 → 5×5;
  // higher r is used as a fallback when the BFS leaks at r=1 (parallel trail
  // sections sitting 4-5 cells apart leave 1-cell gaps in a 3×3 wall).
  // The radius is in grid cells.
  _rasterizeLine(buffer, gx0, gy0, gx1, gy1, thick = false, radius = -1, plottedOut = null) {
    // Back-compat: thick=true and radius unspecified → 3×3 stamp (radius=1).
    let r = radius;
    if (r < 0) r = thick ? 1 : 0;
    let x = gx0 | 0;
    let y = gy0 | 0;
    const x1 = gx1 | 0;
    const y1 = gy1 | 0;
    const dx = Math.abs(x1 - x);
    const dy = Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx - dy;
    const N = GRID_SIZE;

    // Plot a single cell; record it in plottedOut on the first time it's set.
    // (Subsequent stamps over the same cell don't double-record.)
    const plot = (px, py) => {
      if (px < 0 || px >= N || py < 0 || py >= N) return;
      const idx = py * N + px;
      if (!buffer[idx]) {
        buffer[idx] = 1;
        if (plottedOut) plottedOut.push(idx);
      }
      if (r === 0) return;
      // Stamp (2r+1)×(2r+1) around (px, py).
      for (let oy = -r; oy <= r; oy++) {
        const ny = py + oy;
        if (ny < 0 || ny >= N) continue;
        const rowBase = ny * N;
        for (let ox = -r; ox <= r; ox++) {
          const nx = px + ox;
          if (nx < 0 || nx >= N) continue;
          const sIdx = rowBase + nx;
          if (!buffer[sIdx]) {
            buffer[sIdx] = 1;
            if (plottedOut) plottedOut.push(sIdx);
          }
        }
      }
    };

    // Plot starting cell.
    plot(x, y);

    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      let stepX = false, stepY = false;
      if (e2 > -dy) { err -= dy; x += sx; stepX = true; }
      if (e2 <  dx) { err += dx; y += sy; stepY = true; }
      // Supercover: when we step diagonally in a single iteration, also paint
      // one of the two orthogonal neighbors so a 4-connected flood-fill can't
      // squeeze through the corner.
      if (stepX && stepY) {
        // Paint (x - sx, y) — the cell we'd have passed through if we'd
        // stepped Y first. Either choice closes the corner; pick the
        // deterministic "horizontal first" one.
        plot(x - sx, y);
      }
      plot(x, y);
    }
  }

  // Public claim. BlocklyIO-style BFS sub-fill algorithm
  // (paper.io clone reference: github.com/lallenlowe/blocklyio).
  //
  // Approach: rasterize the trail (and short bridges to the nearest own cell at
  // each endpoint) into a "trail mask". For each cell adjacent to the trail,
  // run a bounded sub-flood-fill that aborts and is discarded if it ever
  // touches the arena boundary (sentinel / out-of-bounds). Only sub-fills that
  // stay fully enclosed get committed to the claimer's faction.
  //
  // Why this is structurally immune to the "thin-line" leak: the sub-fill
  // either succeeds entirely (region is enclosed) or aborts entirely (region
  // is open to outside). There is no partial commit, so a 1-cell gap in the
  // wall just means that sub-fill is discarded — never a half-filled region.
  //
  // Returns true if the claim was processed (trail length OK + own faction has
  // territory to anchor against); false otherwise.
  claim(char) {
    if (!char.trailVerts || char.trailVerts.length < 5) {
      return false;
    }
    const _claimT0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    const trail = char.trailVerts;
    const factionId = char.factionId;
    const N = GRID_SIZE;
    const grid = this.grid;
    const cellCounts = this.cellCounts;

    // 1. Anchor bridges. The trail must close into a loop with the claimer's
    //    own territory; bridge from trail[0] and trail[N-1] to the nearest
    //    own-faction cell. Without these the trail is an open arc and no
    //    sub-fill could ever be enclosed.
    const startNear = this._nearestOwnCell(factionId, trail[0].x, trail[0].z);
    const endNear   = this._nearestOwnCell(factionId, trail[trail.length - 1].x, trail[trail.length - 1].z);
    if (!startNear || !endNear) {
      // Faction has no territory — nothing to close against.
      char.trailVerts = [];
      return false;
    }

    // 2. Rasterize trail + bridges into trailMask. 3-cell-thick (radius 1)
    //    so a 4-connected sub-fill cannot squeeze through corner gaps that
    //    supercover Bresenham can leave between adjacent diagonal cells.
    //    Track plotted cells in trailCells inline (avoids a 1M-cell scan).
    const trailMask = new Uint8Array(N * N);
    const trailCells = [];
    const tg = new Array(trail.length);
    let minGX = Infinity, minGY = Infinity, maxGX = -Infinity, maxGY = -Infinity;
    const expandBbox = (gx, gy) => {
      if (gx < minGX) minGX = gx;
      if (gx > maxGX) maxGX = gx;
      if (gy < minGY) minGY = gy;
      if (gy > maxGY) maxGY = gy;
    };
    for (let i = 0; i < trail.length; i++) {
      tg[i] = this._worldToGrid(trail[i].x, trail[i].z);
      expandBbox(tg[i].gx, tg[i].gy);
    }
    expandBbox(startNear.gx, startNear.gy);
    expandBbox(endNear.gx, endNear.gy);
    // Pad bbox to enclose not just the trail but also the loop-closure path
    // along own-faction territory between the two anchors. The inside-region
    // BFS uses own-faction cells as walls; if the bbox edge falls between the
    // trail and the connecting own-faction cells, the BFS hits the bbox edge
    // and incorrectly marks the inside region as "escaped".
    //
    // Heuristic: scale PAD with trail extent (the connecting own-faction path
    // is at most as long as the trail itself for most realistic shapes), with
    // a small floor for the wall-thickness margin and a cap so degenerate
    // long trails don't blow the perf budget.
    const WALL_RADIUS = 2;
    const trailExtent = Math.max(maxGX - minGX, maxGY - minGY);
    const PAD = Math.min(120, Math.max(WALL_RADIUS + 2, trailExtent));
    minGX = Math.max(0, minGX - PAD);
    minGY = Math.max(0, minGY - PAD);
    maxGX = Math.min(N - 1, maxGX + PAD);
    maxGY = Math.min(N - 1, maxGY + PAD);

    // Wall thickness rationale: with TRAIL_KILL_DIST=0.6 (~4.6 cells) the player
    // can come within ~4 cells of an older part of their own trail before dying.
    // A 3-cell-thick wall (radius=1) leaves a 1-row gap when the trail's stamp
    // from one row doesn't reach a parallel segment 2 rows away — a 4-connected
    // BFS leaks straight through. A 5-cell-thick wall (radius=2) merges
    // parallel segments up to 4 cells apart into a solid wall, eliminating the
    // gap-leak that produced thin-line claim outcomes.
    for (let i = 0; i < trail.length - 1; i++) {
      this._rasterizeLine(trailMask, tg[i].gx, tg[i].gy, tg[i + 1].gx, tg[i + 1].gy, false, WALL_RADIUS, trailCells);
    }
    // Bridges: trail[0] → nearest own cell, trail[N-1] → nearest own cell.
    this._rasterizeLine(trailMask, tg[0].gx, tg[0].gy, startNear.gx, startNear.gy, false, WALL_RADIUS, trailCells);
    this._rasterizeLine(trailMask, tg[trail.length - 1].gx, tg[trail.length - 1].gy, endNear.gx, endNear.gy, false, WALL_RADIUS, trailCells);

    // 3. For every cell adjacent to a trail cell, run a sub-flood-fill.
    //    Walls = sentinel | own faction | trail cells.
    //    If the sub-fill ever reaches grid boundary or a sentinel cell during
    //    expansion, abort: that region is "outside" → discard.
    //    If it terminates without touching outside, commit those cells to
    //    factionId.
    //
    //    `visited` is shared across all sub-fills: once a region is known to
    //    be open or already committed, no other seed needs to re-explore it.
    const visited = new Uint8Array(N * N);
    const changedCells = []; // flat list of grid indices that flipped owner
    const losers = new Set(); // factions that lost cells — invalidate contour cache

    // Reusable BFS scratch arrays. Re-allocated only if a sub-fill outgrows
    // them; keeps the common-case allocation cost down to one push per cell.
    const subQueue = []; // grid indices; index-head pointer for O(1) dequeue
    const subCells = []; // cells in the current sub-fill (committed if enclosed)

    const NEIGHBORS = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];

    for (let t = 0; t < trailCells.length; t++) {
      const tIdx = trailCells[t];
      const tgx = tIdx % N;
      const tgy = (tIdx - tgx) / N;

      for (let nb = 0; nb < 4; nb++) {
        const dx = NEIGHBORS[nb][0];
        const dy = NEIGHBORS[nb][1];
        const sx = tgx + dx;
        const sy = tgy + dy;
        if (sx < 0 || sx >= N || sy < 0 || sy >= N) continue;
        const sIdx = sy * N + sx;
        if (visited[sIdx]) continue;
        const sv = grid[sIdx];
        // Walls: sentinel, own faction, or part of the trail itself.
        if (sv === GRID_SENTINEL || sv === factionId || trailMask[sIdx]) continue;

        // Sub-fill from sIdx. Track every cell reached; if we touch the
        // boundary at any point, mark touchedBoundary and finish enumerating
        // the region (still mark visited to avoid re-attempting it from other
        // seeds) but don't commit.
        subCells.length = 0;
        subQueue.length = 0;
        subQueue.push(sIdx);
        visited[sIdx] = 1;
        let touchedBoundary = false;
        let head = 0;

        while (head < subQueue.length) {
          const cur = subQueue[head++];
          subCells.push(cur);
          const cx = cur % N;
          const cy = (cur - cx) / N;
          for (let i = 0; i < 4; i++) {
            const ax = cx + NEIGHBORS[i][0];
            const ay = cy + NEIGHBORS[i][1];
            // Out of bbox = "outside the trail loop" = sub-fill escaped.
            // The bbox is sized to cover both the trail and the own-faction
            // loop-closure path between the two anchors (PAD scales with
            // trail extent above), so an honest enclosed region's BFS hits
            // own-faction or trail walls before bbox edge.
            if (ax < minGX || ax > maxGX || ay < minGY || ay > maxGY) {
              touchedBoundary = true;
              continue;
            }
            const aIdx = ay * N + ax;
            const av = grid[aIdx];
            if (av === GRID_SENTINEL) {
              // Touched arena boundary → region escapes outside.
              touchedBoundary = true;
              continue;
            }
            if (av === factionId || trailMask[aIdx]) continue; // wall
            if (visited[aIdx]) continue;
            visited[aIdx] = 1;
            subQueue.push(aIdx);
          }
        }

        if (!touchedBoundary) {
          // Enclosed region: commit every cell to the claimer.
          for (let i = 0; i < subCells.length; i++) {
            const ci = subCells[i];
            const prev = grid[ci];
            if (prev === factionId) continue; // shouldn't happen; safety
            if (prev !== 0) losers.add(prev);
            cellCounts[prev]--;
            cellCounts[factionId]++;
            grid[ci] = factionId;
            changedCells.push(ci);
          }
        }
        // If touchedBoundary: discard. visited[] entries stay set so other
        // trail-adjacent seeds skip the same open region.
      }
    }

    // 4. The trail cells themselves also become own faction (they're the
    //    border of the claimed region). Iterate the trailCells list we built
    //    earlier to avoid another full mask scan.
    for (let i = 0; i < trailCells.length; i++) {
      const ci = trailCells[i];
      const prev = grid[ci];
      if (prev === GRID_SENTINEL) continue; // safety: trail clipped against arena
      if (prev === factionId) continue;
      if (prev !== 0) losers.add(prev);
      cellCounts[prev]--;
      cellCounts[factionId]++;
      grid[ci] = factionId;
      changedCells.push(ci);
    }

    // Invalidate contour cache for the claimer (always grew territory) AND
    // every loser (each shrank, so their cached boundary is stale). This
    // must run for EVERY claim, including bots'. Stale loser contours cause
    // BotAI to plan paths through cells that no longer belong to its faction
    // → bots wander into enemy territory and die from cutoff → respawn at
    // faction spawn → synchronized teleports across all bots. Reported by
    // user as "all characters jump together" in regular online, not in prod.
    this._contourCache.delete(factionId);
    for (const loser of losers) this._contourCache.delete(loser);

    // Encirclement sweep is suppressed:
    //   - When the match is frozen (private-room waiting state). With no bots,
    //     every other faction has zero residents — sweeping would capture
    //     every disconnected fragment on a single small claim.
    //   - When the claim is by a bot. The spec is a player-vs-player mechanic
    //     ("if I close around a player…"). Running it on every bot claim
    //     causes mass-kills: when ≥6 bots happen to be trail-running at the
    //     moment of a claim, their faction has no residents, the entire
    //     faction territory flips to the claimer, and all trail-running bots
    //     of that faction die and respawn at spawn in the same tick. That's
    //     the "everyone jumps together" jitter the user sees in regular
    //     online; production (no encirclement) doesn't have it.
    if (losers.size > 0 && !this.matchManager.frozen && char.isHuman) {
      // Encirclement death: any disconnected region of an affected faction
      // without a resident player flips to the claimer; trail-runners whose
      // faction is now wiped die. Contour cache for claimer + losers was
      // already invalidated above so this runs only when the human-claim
      // gate fires, but the cache stays consistent for every claim.
      const affectedFactions = new Set(losers);
      affectedFactions.add(factionId);

      // Snap each character's body position to its current grid index.
      for (const c of this.characters) {
        if (!c.alive) { c.cellIndex = -1; continue; }
        const { gx, gy } = this._worldToGrid(c.pos.x, c.pos.z);
        c.cellIndex = (gx >= 0 && gx < N && gy >= 0 && gy < N) ? (gy * N + gx) : -1;
      }
      const result = enforceConnectivity({
        grid,
        gridSize: N,
        numFactions: this.numFactions,
        affectedFactions,
        characters: this.characters,
        claimerFactionId: factionId,
        cellCounts,
      });
      if (result.capturedCells > 0) {
        const seen = new Set(changedCells);
        let foundInBbox = 0;
        for (let gy = minGY; gy <= maxGY; gy++) {
          for (let gx = minGX; gx <= maxGX; gx++) {
            const idx = gy * N + gx;
            if (grid[idx] === factionId && !seen.has(idx)) {
              changedCells.push(idx);
              seen.add(idx);
              foundInBbox++;
            }
          }
        }
        // Fragments outside the bbox: full-grid pass only when needed.
        if (foundInBbox < result.capturedCells) {
          for (let i = 0, len = grid.length; i < len; i++) {
            if (grid[i] === factionId && !seen.has(i)) {
              changedCells.push(i);
              seen.add(i);
            }
          }
        }
      }
      // Apply the kill pass.
      for (const v of result.killedCharacters) {
        this._killCharacter(v, char); // credit the claimer
      }
    }

    // 5. Clear trail and fire hooks.
    char.trailVerts = [];
    const cellsFlipped = changedCells.length;

    // Build flat trail-points array for the legacy onClaim hook (renderers
    // use it to clear trail meshes by charId).
    const trailPointsFlat = new Array(trail.length * 2);
    for (let i = 0; i < trail.length; i++) {
      trailPointsFlat[i * 2] = trail[i].x;
      trailPointsFlat[i * 2 + 1] = trail[i].z;
    }
    // Cell-diff hook: GameRoom broadcasts this directly so peers don't need to
    // re-run the algorithm. Signature kept stable: (charId, factionId, cells, trailPoints).
    this.onClaimResult?.(char.id, factionId, changedCells, trailPointsFlat);
    this.onClaim?.(char.id, trailPointsFlat, factionId);

    // Thin-line diagnostic — fires in BOTH browser (solo) and Node (server).
    // In solo mode, persists to localStorage for offline analysis.
    {
      const trailLen = trail.length;
      const ratio = trailLen > 0 ? cellsFlipped / trailLen : 0;
      const suspicious = (cellsFlipped > 0 && ratio < 5) || (trailLen > 20 && ratio < 10);
      if (suspicious) {
        const ts = (typeof performance !== "undefined" ? performance.now() : Date.now()).toFixed(0);
        const entry = { ts, charId: char.id, factionId, trailLen, cellsFlipped, ratio: +ratio.toFixed(2),
                        trail: trailPointsFlat.slice(0, 200) };
        // Console (browser DevTools or server stdout)
        console.log(`[CLAIM_THIN ${ts}] char=${char.id} f=${factionId} trailLen=${trailLen} cells=${cellsFlipped} ratio=${ratio.toFixed(2)} trail=${JSON.stringify(entry.trail)}${trailPointsFlat.length > 200 ? `...(+${trailPointsFlat.length-200})` : ""}`);
        // Browser-only persistence
        if (typeof localStorage !== "undefined") {
          try {
            const key = "_claim_diag";
            const arr = JSON.parse(localStorage.getItem(key) || "[]");
            arr.push(entry);
            while (arr.length > 50) arr.shift();
            localStorage.setItem(key, JSON.stringify(arr));
          } catch {}
        }
      }
    }

    if (this.scoreTracker?.onCapture && cellsFlipped > 0) {
      this.scoreTracker.onCapture(char, cellsFlipped, this.factionManager);
    }
    if (this.scoreTracker?.onClaim) {
      this.scoreTracker.onClaim(char, this.factionManager);
    }

    const _claimT1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this._claimMs = (this._claimMs ?? 0) + (_claimT1 - _claimT0);
    this._claimCount = (this._claimCount ?? 0) + 1;
    this._lastClaimMs = _claimT1 - _claimT0;
    return true;
  }

  // Respawn a dead character whose timer has expired. If the faction is still
  // alive and has respawns enabled, the char respawns in place; otherwise it
  // is reassigned to a surviving faction. Mirrors main.js Game.tick lines 985-1020.
  respawnChar(c) {
    const faction = this.factionManager.factions.get(c.factionId);
    if (faction && faction.respawnsEnabled) {
      const sp = this._spawnFor(c.factionId);
      c.respawn(sp.x, sp.z);
      this.onTeleport?.(c.id, sp.x, sp.z, c.dir.x, c.dir.z, "respawn");
      return;
    }

    const newFaction = this.factionManager.reassignCharacter(c);
    if (newFaction) {
      this.scoreTracker.onFactionChange(c);
      const sp = this._spawnFor(c.factionId);
      c.respawn(sp.x, sp.z);
      this.onTeleport?.(c.id, sp.x, sp.z, c.dir.x, c.dir.z, "reassign");
    }

    // Update elimination state for all factions (mirrors main.js).
    for (const [id] of this.factionManager.factions) {
      this.factionManager.checkElimination(id);
    }
  }

  // ===== public API =====

  setHumanControl(charId, isHuman) {
    const c = this.characters[charId];
    if (!c) return;
    c.isHuman = !!isHuman;
    // Match client prediction speed (PLAYER_SPEED=9.8 vs BOT_SPEED=7.5). If
    // left at BOT_SPEED for humans, the server simulates ~30% slower than the
    // client predicts; reconciliation snaps the local mesh sideways each ack,
    // showing up as a "jump to the right" of motion as the user reported.
    c.speed = c.isHuman ? PLAYER_SPEED : BOT_SPEED;
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
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL, this.numFactions);
    // Re-init cellCounts after the grid was rewritten.
    this._recomputeCellCounts();
    for (const c of this.characters) {
      c.alive = true;
      c.killCount = 0;
      c.invulnTimer = 0;
      c.respawnTimer = 0;
      c._resetTransient();
      this.factionManager.addCharacter(c, c.factionId);
      // Reposition at spawn point (mirrors start())
      const sp = this._spawnFor(c.factionId);
      if (sp) {
        c.setPos(sp.x, sp.z);
        this.onTeleport?.(c.id, sp.x, sp.z, c.dir.x, c.dir.z, "restart");
      }
    }
    this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
    this.matchManager.startMatch();
  }

  tick(dt) {
    if (!this.started) return;
    this._contourBuildsThisTick = 0;
    const _t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.matchManager.update(dt, this.grid, GRID_SIZE, GRID_SENTINEL, this.cellCounts, this.totalArenaCells);
    if (this.matchManager.phase !== "playing") {
      this._lastTickPhases = "";
      return;
    }
    const _t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());

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
    const _t2 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    this._checkTrailKills();
    const _t3 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this._checkCutoff();
    const _t4 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    // Per-tick territoryPcts is intentionally NOT called here: matchManager
    // refreshes it at 1Hz from incremental cellCounts. Calling it every tick
    // used to scan the full 1024×1024 grid and dominated the tick budget.

    this._lastTickPhases =
      `match=${(_t1-_t0).toFixed(1)} chars=${(_t2-_t1).toFixed(1)} ` +
      `trailKill=${(_t3-_t2).toFixed(1)} cutoff=${(_t4-_t3).toFixed(1)}`;
  }
}
