import {
  GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL,
  RESPAWN_DELAY, BOT_NAMES,
  MIN_POINT_DIST, TURN_SPEED,
  TRAIL_KILL_DIST, SELF_TRAIL_SKIP,
} from "./constants.js";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
import { Character } from "./Character.js";
import { BotAI } from "./BotAI.js";
import { extractContours, countCells } from "./grid_geom.js";

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
    // Incremental cell counts per faction (index 0 = unclaimed). Maintained
    // by every code path that mutates this.grid: claim(), _healUnclaimedCells(),
    // restart(). Lets updateTerritoryPcts read percentages in O(FACTION_COUNT)
    // instead of scanning the whole 1024×1024 grid each second (the 50ms stall
    // that was eating the entire tick budget once per second).
    this.cellCounts = new Uint32Array(FACTION_COUNT + 1);

    // Event hooks (set by host: server or client). Optional.
    this.onClaim = null;       // (charId, trailPoints, factionId) => void
    this.onClaimResult = null; // (charId, factionId, changedCells, trailPoints) => void
    this.onHeal = null;        // (changedCells) => void
    this.onTrailVertex = null; // (charId, x, z) => void
    this.onKill = null;        // (killerId, victimId) => void
    // Position discontinuity (respawn / restart / faction reassignment).
    // Distinct from onKill — fires at the moment the character's pos jumps
    // to a new location, NOT when they die. Lets clients clear interpolation
    // buffers / prediction state so they don't smooth across the artificial
    // line between old and new positions.
    this.onTeleport = null;    // (charId, posX, posZ, dirX, dirZ, reason) => void

    // Per-faction contour cache. Bots re-plan their loops every few seconds
    // and need the boundary contour of their faction. Computing it is O(N²)
    // (full grid scan + marching squares). Cache it and invalidate per-faction
    // whenever cells change owner during claim() or heal().
    this._contourCache = new Map();   // factionId → { contours, cellCount }
    this._contourDirty = new Set();   // factionIds with stale cache
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
  getCachedContours(factionId) {
    let entry = this._contourCache.get(factionId);
    if (entry) return entry.contours;
    const contours = extractContours(this.grid, factionId);
    entry = { contours };
    this._contourCache.set(factionId, entry);
    return contours;
  }

  // Cached cell count per faction. Bots check whether their faction has any
  // territory, and pick aggro targets among factions with territory.
  getCachedCellCount(factionId) {
    let entry = this._contourCache.get(factionId);
    if (entry && typeof entry.cellCount === "number") return entry.cellCount;
    const count = countCells(this.grid, factionId);
    if (!entry) {
      entry = { cellCount: count };
      this._contourCache.set(factionId, entry);
    } else {
      entry.cellCount = count;
    }
    return count;
  }

  start() {
    this._initGrid();
    this._initCharacters();
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL);
    // Initial cellCounts populate. From here, every grid mutation must keep
    // cellCounts in sync.
    this._recomputeCellCounts();
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
    for (let i = 0; i < trail.length; i++) {
      tg[i] = this._worldToGrid(trail[i].x, trail[i].z);
      if (tg[i].gx < minGX) minGX = tg[i].gx;
      if (tg[i].gx > maxGX) maxGX = tg[i].gx;
      if (tg[i].gy < minGY) minGY = tg[i].gy;
      if (tg[i].gy > maxGY) maxGY = tg[i].gy;
    }
    if (startNear.gx < minGX) minGX = startNear.gx;
    if (startNear.gx > maxGX) maxGX = startNear.gx;
    if (startNear.gy < minGY) minGY = startNear.gy;
    if (startNear.gy > maxGY) maxGY = startNear.gy;
    if (endNear.gx < minGX) minGX = endNear.gx;
    if (endNear.gx > maxGX) maxGX = endNear.gx;
    if (endNear.gy < minGY) minGY = endNear.gy;
    if (endNear.gy > maxGY) maxGY = endNear.gy;
    // Pad bbox by 3 cells on each side so sub-fill perimeter checks always
    // have a 1-cell margin around the trail+bridge stamp. Clamp to grid.
    const PAD = 3;
    minGX = Math.max(0, minGX - PAD);
    minGY = Math.max(0, minGY - PAD);
    maxGX = Math.min(N - 1, maxGX + PAD);
    maxGY = Math.min(N - 1, maxGY + PAD);

    for (let i = 0; i < trail.length - 1; i++) {
      this._rasterizeLine(trailMask, tg[i].gx, tg[i].gy, tg[i + 1].gx, tg[i + 1].gy, false, 1, trailCells);
    }
    // Bridges: trail[0] → nearest own cell, trail[N-1] → nearest own cell.
    this._rasterizeLine(trailMask, tg[0].gx, tg[0].gy, startNear.gx, startNear.gy, false, 1, trailCells);
    this._rasterizeLine(trailMask, tg[trail.length - 1].gx, tg[trail.length - 1].gy, endNear.gx, endNear.gy, false, 1, trailCells);

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
            // (The bbox padding guarantees a real escape if the wall has a
            // gap; without bounding here the sub-fill could traverse the
            // entire arena chasing a leak, blowing the perf budget.)
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

    // Invalidate contour cache for the claimer + every faction that lost cells.
    this._contourCache.delete(factionId);
    for (const loser of losers) this._contourCache.delete(loser);

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
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      c.respawn(sp.x, sp.z);
      this.onTeleport?.(c.id, sp.x, sp.z, c.dir.x, c.dir.z, "respawn");
      return;
    }

    const newFaction = this.factionManager.reassignCharacter(c);
    if (newFaction) {
      this.scoreTracker.onFactionChange(c);
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
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
    // Re-init cellCounts after the grid was rewritten.
    this._recomputeCellCounts();
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
    // NOTE: updateTerritoryPcts is called inside matchManager.update() at 1Hz
    // (see MatchManager.update). Calling it here every tick was scanning the
    // entire 1024×1024 grid 20 times per second — the dominant cost in the
    // over-budget tick stalls. The 1Hz cadence is plenty for endangered/recovery
    // checks and HUD readout; per-tick precision isn't needed.
    const _t5 = _t4;

    this._lastTickPhases =
      `match=${(_t1-_t0).toFixed(1)} chars=${(_t2-_t1).toFixed(1)} ` +
      `trailKill=${(_t3-_t2).toFixed(1)} cutoff=${(_t4-_t3).toFixed(1)} ` +
      `pct=${(_t5-_t4).toFixed(1)}`;
  }
}
