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
            // Maintain cellCounts: cell flips from prev → ownerId.
            this.cellCounts[prev]--;
            this.cellCounts[ownerId]++;
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
        // Cell flips from ownerId → reassignTo. Maintain cellCounts.
        this.cellCounts[ownerId]--;
        this.cellCounts[reassignTo]++;
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
  _rasterizeLine(buffer, gx0, gy0, gx1, gy1, thick = false, radius = -1) {
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

    const plot = (px, py) => {
      if (px < 0 || px >= N || py < 0 || py >= N) return;
      buffer[py * N + px] = 1;
      if (r === 0) return;
      // Stamp (2r+1)×(2r+1) around (px, py).
      for (let oy = -r; oy <= r; oy++) {
        const ny = py + oy;
        if (ny < 0 || ny >= N) continue;
        const rowBase = ny * N;
        for (let ox = -r; ox <= r; ox++) {
          const nx = px + ox;
          if (nx < 0 || nx >= N) continue;
          buffer[rowBase + nx] = 1;
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

  // Public claim. Replaces the rasterized trail with a temporary "wall" mask,
  // floods from outside the trail loop within a tight bbox, and any
  // non-sentinel cell the flood doesn't reach is enclosed → flips to claimer's
  // faction.
  // No global victim-fragment reassignment, no heal pass — the BFS produces a
  // clean enclosed region with no orphans by construction.
  // Returns true if the claim was applied; false if the trail was too short
  // or the faction has no territory to close against.
  //
  // Performance: BFS is constrained to a bounding box around the trail+bridges
  // (expanded by a small margin) instead of scanning the whole 1024×1024 grid.
  // Tracks the list of changed cell indices and fires onClaimResult() for the
  // server to broadcast the diff to clients (avoiding a re-run of the algorithm
  // on every client).
  claim(char) {
    if (!char.trailVerts || char.trailVerts.length < 5) {
      return false;
    }
    const _claimT0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

    const trail = char.trailVerts;
    const factionId = char.factionId;
    const N = GRID_SIZE;

    // 1. Find nearest own cells to the trail endpoints. These act as the
    //    "anchors" the trail closes against.
    const startNear = this._nearestOwnCell(factionId, trail[0].x, trail[0].z);
    const endNear   = this._nearestOwnCell(factionId, trail[trail.length - 1].x, trail[trail.length - 1].z);
    if (!startNear || !endNear) {
      // Faction has no territory — nothing to close against.
      char.trailVerts = [];
      return false;
    }

    // 2. Compute trail+bridge endpoints in grid coords; derive bounding box.
    const tg = new Array(trail.length);
    let minGX = Infinity, minGY = Infinity, maxGX = -Infinity, maxGY = -Infinity;
    for (let i = 0; i < trail.length; i++) {
      const g = this._worldToGrid(trail[i].x, trail[i].z);
      tg[i] = g;
      if (g.gx < minGX) minGX = g.gx;
      if (g.gx > maxGX) maxGX = g.gx;
      if (g.gy < minGY) minGY = g.gy;
      if (g.gy > maxGY) maxGY = g.gy;
    }
    // Include bridge endpoints in the bbox so the bridges stay inside it.
    if (startNear.gx < minGX) minGX = startNear.gx;
    if (startNear.gx > maxGX) maxGX = startNear.gx;
    if (startNear.gy < minGY) minGY = startNear.gy;
    if (startNear.gy > maxGY) maxGY = startNear.gy;
    if (endNear.gx < minGX) minGX = endNear.gx;
    if (endNear.gx > maxGX) maxGX = endNear.gx;
    if (endNear.gy < minGY) minGY = endNear.gy;
    if (endNear.gy > maxGY) maxGY = endNear.gy;

    // Pad bbox by 5 cells on each side to ensure the perimeter cells are
    // outside the trail+bridge loop. Clamp to grid bounds.
    const PAD = 5;
    minGX = Math.max(0, minGX - PAD);
    minGY = Math.max(0, minGY - PAD);
    maxGX = Math.min(N - 1, maxGX + PAD);
    maxGY = Math.min(N - 1, maxGY + PAD);

    // Polygon shoelace area (in cells). Closed polygon = trail vertices with
    // implicit edge from last back to first. Used to detect BFS leaks: the
    // enclosed-cell count should be roughly proportional to this area; far
    // below it indicates the wall failed to seal.
    let twoA = 0;
    for (let i = 0; i < trail.length; i++) {
      const j = (i + 1) % trail.length;
      twoA += trail[i].x * trail[j].z - trail[j].x * trail[i].z;
    }
    const polyAreaCells = Math.abs(twoA) / 2 / (CELL_SIZE * CELL_SIZE);

    const grid = this.grid;
    let walls, visited, enclosedCount;

    // 3+4. Rasterize wall & run BFS. Try with thin walls first (radius 1 →
    //      3-cell-wide trail). If the BFS leaks (enclosedCount << polygon
    //      area), retry with progressively thicker walls. This handles the
    //      common leak class: parallel trail sections 4-7 cells apart leave
    //      1-2 cell gaps in a 3-cell-wide wall, but a 7-cell-wide wall
    //      (radius 3) closes those gaps.
    const RADII_TO_TRY = [1, 3, 5];
    let usedRadius = -1;
    for (const radius of RADII_TO_TRY) {
      walls = new Uint8Array(N * N);
      for (let i = 0; i < trail.length - 1; i++) {
        this._rasterizeLine(walls, tg[i].gx, tg[i].gy, tg[i + 1].gx, tg[i + 1].gy, false, radius);
      }
      this._rasterizeLine(walls, tg[0].gx, tg[0].gy, startNear.gx, startNear.gy, false, radius);
      this._rasterizeLine(walls, tg[trail.length - 1].gx, tg[trail.length - 1].gy, endNear.gx, endNear.gy, false, radius);

      // BFS bounded to the bbox, seeded from the bbox perimeter.
      // Blockers = sentinel + own territory + walls.
      visited = new Uint8Array(N * N);
      const queue = [];
      let head = 0;

      // Seed: bbox perimeter cells (top + bottom rows, left + right cols).
      for (let gx = minGX; gx <= maxGX; gx++) {
        const topIdx = minGY * N + gx;
        const botIdx = maxGY * N + gx;
        if (grid[topIdx] !== GRID_SENTINEL && grid[topIdx] !== factionId && !walls[topIdx] && !visited[topIdx]) {
          visited[topIdx] = 1; queue.push(topIdx);
        }
        if (minGY !== maxGY) {
          if (grid[botIdx] !== GRID_SENTINEL && grid[botIdx] !== factionId && !walls[botIdx] && !visited[botIdx]) {
            visited[botIdx] = 1; queue.push(botIdx);
          }
        }
      }
      for (let gy = minGY + 1; gy <= maxGY - 1; gy++) {
        const leftIdx = gy * N + minGX;
        const rightIdx = gy * N + maxGX;
        if (grid[leftIdx] !== GRID_SENTINEL && grid[leftIdx] !== factionId && !walls[leftIdx] && !visited[leftIdx]) {
          visited[leftIdx] = 1; queue.push(leftIdx);
        }
        if (minGX !== maxGX) {
          if (grid[rightIdx] !== GRID_SENTINEL && grid[rightIdx] !== factionId && !walls[rightIdx] && !visited[rightIdx]) {
            visited[rightIdx] = 1; queue.push(rightIdx);
          }
        }
      }
      // Also seed any non-blocker cell inside the bbox that is adjacent to a
      // sentinel — sentinels are "outside the arena," so cells touching them
      // are reachable from outside with one step. This handles bboxes that
      // overlap the arena's circular boundary.
      for (let gy = minGY; gy <= maxGY; gy++) {
        const rowBase = gy * N;
        for (let gx = minGX; gx <= maxGX; gx++) {
          const idx = rowBase + gx;
          if (grid[idx] !== GRID_SENTINEL) continue;
          if (gy > minGY) {
            const nIdx = idx - N;
            if (grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1; queue.push(nIdx);
            }
          }
          if (gy < maxGY) {
            const nIdx = idx + N;
            if (grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1; queue.push(nIdx);
            }
          }
          if (gx > minGX) {
            const nIdx = idx - 1;
            if (grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1; queue.push(nIdx);
            }
          }
          if (gx < maxGX) {
            const nIdx = idx + 1;
            if (grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx] && !visited[nIdx]) {
              visited[nIdx] = 1; queue.push(nIdx);
            }
          }
        }
      }

      // BFS expand (4-connected, deterministic neighbor order: N, S, W, E).
      while (head < queue.length) {
        const idx = queue[head++];
        const gx = idx % N;
        const gy = (idx - gx) / N;

        if (gy > minGY) {
          const nIdx = idx - N;
          if (!visited[nIdx] && grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx]) {
            visited[nIdx] = 1; queue.push(nIdx);
          }
        }
        if (gy < maxGY) {
          const nIdx = idx + N;
          if (!visited[nIdx] && grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx]) {
            visited[nIdx] = 1; queue.push(nIdx);
          }
        }
        if (gx > minGX) {
          const nIdx = idx - 1;
          if (!visited[nIdx] && grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx]) {
            visited[nIdx] = 1; queue.push(nIdx);
          }
        }
        if (gx < maxGX) {
          const nIdx = idx + 1;
          if (!visited[nIdx] && grid[nIdx] !== GRID_SENTINEL && grid[nIdx] !== factionId && !walls[nIdx]) {
            visited[nIdx] = 1; queue.push(nIdx);
          }
        }
      }

      // Count enclosed cells (non-flooded, non-wall, non-own, non-sentinel
      // cells inside the bbox).
      enclosedCount = 0;
      for (let gy = minGY; gy <= maxGY; gy++) {
        const rowBase = gy * N;
        for (let gx = minGX; gx <= maxGX; gx++) {
          const idx = rowBase + gx;
          const v = grid[idx];
          if (v === GRID_SENTINEL || v === factionId) continue;
          if (walls[idx]) continue;
          if (!visited[idx]) enclosedCount++;
        }
      }

      usedRadius = radius;
      // BFS-leak heuristic: enclosed should be at least ~50% of the polygon
      // area when the wall sealed correctly. (Slack accounts for the
      // bridge-arc closure adding/removing area vs. the raw polygon, plus the
      // wall stamp eating some cells along its width.) If we're way under,
      // the BFS leaked through a thin gap → retry with thicker wall.
      const leaked = polyAreaCells > 50 && enclosedCount < polyAreaCells * 0.5;
      if (!leaked) break;
    }

    // 5a. Decide path. If the final attempt still leaked OR enclosed nothing,
    //     the trail is too pathological for any wall thickness (e.g. the
    //     player traced figure-8 self-crossings) — fall back to polygon-stamp
    //     so they still get a fill instead of a wall-only thin-line capture.
    const bfsLeaked = polyAreaCells > 50 && enclosedCount < polyAreaCells * 0.5;

    const changedCells = []; // flat list of cell indices
    const losers = new Set(); // factions that lost cells — must invalidate their contour cache
    const cellCounts = this.cellCounts;

    if (enclosedCount === 0 || bfsLeaked) {
      // FALLBACK: BFS leaked. Stamp the trail as a closed polygon (closing
      // line trail[0]→trail[N-1]) and use the result as the claimed region.
      // Build the polygon in world coords (poly2D wants {x, y}; y = z axis).
      const poly2D = new Array(trail.length);
      for (let i = 0; i < trail.length; i++) {
        poly2D[i] = { x: trail[i].x, y: trail[i].z };
      }
      // _stampPolygon implicitly closes the polygon (treats edge n-1→0).
      // It maintains cellCounts and updates losers per-cell, so we need to
      // capture changed cells ourselves. Snapshot+diff for correctness.
      const preSnap = new Uint8Array(grid);
      this._stampPolygon(poly2D, factionId);
      // Also stamp the wall mask cells (so the trail line itself is filled
      // even if the polygon's scanline fill missed them at thin/corner spots).
      let wallGain = 0;
      for (let gy = minGY; gy <= maxGY; gy++) {
        const rowBase = gy * N;
        for (let gx = minGX; gx <= maxGX; gx++) {
          const idx = rowBase + gx;
          if (!walls[idx]) continue;
          const v = grid[idx];
          if (v === GRID_SENTINEL || v === factionId) continue;
          if (v !== 0) losers.add(v);
          cellCounts[v]--;
          wallGain++;
          grid[idx] = factionId;
        }
      }
      cellCounts[factionId] += wallGain;
      // Compute changed cells = post != pre.
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] !== preSnap[i]) {
          const old = preSnap[i];
          if (old !== 0 && old !== GRID_SENTINEL && old !== factionId) losers.add(old);
          changedCells.push(i);
        }
      }
    } else {
      // Normal path: any non-sentinel, non-own, non-visited cell is enclosed
      // → flip to own. Also flip wall cells (the trail itself is now own
      // territory). Maintain cellCounts incrementally.
      let claimerGain = 0;
      for (let gy = minGY; gy <= maxGY; gy++) {
        const rowBase = gy * N;
        for (let gx = minGX; gx <= maxGX; gx++) {
          const idx = rowBase + gx;
          const v = grid[idx];
          if (v === GRID_SENTINEL) continue;
          if (v === factionId) continue;
          if (!visited[idx] || walls[idx]) {
            if (v !== 0) losers.add(v);
            cellCounts[v]--;
            claimerGain++;
            grid[idx] = factionId;
            changedCells.push(idx);
          }
        }
      }
      cellCounts[factionId] += claimerGain;
    }
    // Invalidate contour cache for the claimer + every faction that lost cells.
    this._contourCache.delete(factionId);
    for (const loser of losers) this._contourCache.delete(loser);

    // 6. Clear trail and fire hooks.
    char.trailVerts = [];

    const cellsFlipped = changedCells.length;

    // Build flat trail-points array for the legacy onClaim hook (some hosts
    // still want the trail polyline, e.g. to clear renderer trail meshes).
    const trailPointsFlat = new Array(trail.length * 2);
    for (let i = 0; i < trail.length; i++) {
      trailPointsFlat[i * 2] = trail[i].x;
      trailPointsFlat[i * 2 + 1] = trail[i].z;
    }
    // New hook: cell-diff. Hosts can broadcast this directly so peers don't
    // need to re-run the algorithm. If onClaimResult is wired, prefer it
    // over onClaim for grid-sync purposes.
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
