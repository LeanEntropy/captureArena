import * as THREE from "three";

import { MultiplayerClient } from "./multiplayer.js";
import { FACTION_COUNT, FACTION_COLORS, FACTION_NAMES } from "./sim/faction.js";
import { Simulation } from "./sim/Simulation.js";
import { UIManager } from "./ui.js";
import {
  ARENA_RADIUS, PLAYER_SPEED, BOT_SPEED, TURN_SPEED,
  GRID_SIZE, WORLD_MIN, WORLD_SIZE, CELL_SIZE, GRID_SENTINEL,
  BOT_NAMES,
} from "./sim/constants.js";
import { initVibeJamPortals, animateVibeJamPortals, arrivedViaPortal } from "./portals.js";

// Renderer-only tuning (client-side; not part of shared simulation)
const CAMERA_HEIGHT = 34;
const CAMERA_Z_OFFSET = 26;
const TRAIL_WIDTH = 0.8;
// Trail is a 3D extruded ribbon: bottom edge at TRAIL_Y, top edge above the
// peak wave amplitude (waves cap ~0.55) so the player's path stays visible
// above the wavy arena surface.
const TRAIL_Y_TOP = 0.85;

// ===== Theme F (Atoll Hybrid) — Y stratification =====
// Director's HARD RULE from prior reverted Slice A: the floor of the island
// must NOT share a Y plane with the territory mesh, and water animation must
// stay outside ARENA_RADIUS.
//
// Layout (all measured from Y = 0):
//   Water plane              Y = -2.0    (well below cylinder, outside arena)
//   Cylinder bottom          Y = -3.0
//   Cylinder TOP face        Y =  0.0
//   Territory mesh           Y =  0.05   + polygonOffset (-1, -1) for safety
//   Trail mesh               Y =  0.10
//   Character group base     Y =  0.05   (matches territory; renderer adds body height)
//   FX ring base (claim/etc) Y =  0.12
const ISLAND_TOP_Y = 0.0;
const ISLAND_HEIGHT = 3.0;
const WATER_Y = -2.0;
const TERRITORY_Y = 0.05;
const TRAIL_Y = 0.10;
const FX_RING_Y = 0.12;

// ===================== DEBUG LOG =====================
const DEBUG_LOG = [];
const DEBUG_MAX = 2000;
try { localStorage.removeItem("captureArena_debug"); } catch(e) {}
// Performance: previously persisted the entire DEBUG_LOG to localStorage on
// every dlog call (each kill/claim/respawn event). With a 2000-entry log this
// can add up to several ms of synchronous JSON.stringify + storage IO per
// event during heavy gameplay. Now we just persist on demand via window.dumpDebug().
function dlog(category, msg, data) {
  const entry = { t: performance.now().toFixed(1), cat: category, msg, ...(data || {}) };
  DEBUG_LOG.push(entry);
  if (DEBUG_LOG.length > DEBUG_MAX) DEBUG_LOG.shift();
  console.log(`[${entry.t}][${category}] ${msg}`, data || "");
}
// Manual dump helper (call from devtools): dumps current log to localStorage
// for inspection. Replaces the previous per-event auto-persist behavior.
window.dumpDebug = () => {
  try { localStorage.setItem("captureArena_debug", JSON.stringify(DEBUG_LOG)); }
  catch(e) { console.warn("[debug] localStorage write failed:", e); }
  return DEBUG_LOG.length;
};

// ===================== TERRITORY GRID =====================
const territoryGrid = {
  grid: new Uint8Array(GRID_SIZE * GRID_SIZE),
  totalArenaCells: 0,

  init() {
    let count = 0;
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const { wx, wy } = this.gridToWorld(gx, gy);
        const dist = Math.sqrt(wx * wx + wy * wy);
        const idx = gy * GRID_SIZE + gx;
        if (dist > ARENA_RADIUS) {
          this.grid[idx] = GRID_SENTINEL;
        } else {
          this.grid[idx] = 0;
          count++;
        }
      }
    }
    this.totalArenaCells = count;
    dlog("GRID", "initialized", { totalArenaCells: count, gridSize: GRID_SIZE });
  },

  worldToGrid(wx, wy) {
    const gx = Math.floor((wx - WORLD_MIN) / CELL_SIZE);
    const gy = Math.floor((wy - WORLD_MIN) / CELL_SIZE);
    return {
      gx: Math.max(0, Math.min(GRID_SIZE - 1, gx)),
      gy: Math.max(0, Math.min(GRID_SIZE - 1, gy))
    };
  },

  gridToWorld(gx, gy) {
    return {
      wx: WORLD_MIN + (gx + 0.5) * CELL_SIZE,
      wy: WORLD_MIN + (gy + 0.5) * CELL_SIZE
    };
  },

  getOwner(wx, wy) {
    const gx = Math.floor((wx - WORLD_MIN) / CELL_SIZE);
    const gy = Math.floor((wy - WORLD_MIN) / CELL_SIZE);
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return 0;
    const val = this.grid[gy * GRID_SIZE + gx];
    return val === GRID_SENTINEL ? 0 : val;
  },

  getOwnerGrid(gx, gy) {
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return GRID_SENTINEL;
    return this.grid[gy * GRID_SIZE + gx];
  },

  stampCircle(cx, cy, radius, ownerId) {
    const { gx: minGX, gy: minGY } = this.worldToGrid(cx - radius, cy - radius);
    const { gx: maxGX, gy: maxGY } = this.worldToGrid(cx + radius, cy + radius);
    const r2 = radius * radius;
    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const { wx, wy } = this.gridToWorld(gx, gy);
        const dx = wx - cx, dy = wy - cy;
        if (dx * dx + dy * dy <= r2) {
          const idx = gy * GRID_SIZE + gx;
          if (this.grid[idx] !== GRID_SENTINEL) {
            this.grid[idx] = ownerId;
          }
        }
      }
    }
  },

  stampPolygon(poly2D, ownerId) {
    // Scanline rasterization of a 2D polygon ({x,y}[] in world coords)
    // Returns the set of previous owner IDs that were overwritten
    const overwritten = new Set();
    if (poly2D.length < 3) return overwritten;

    // Find bounding box in grid coords
    let wMinY = Infinity, wMaxY = -Infinity;
    for (const p of poly2D) {
      if (p.y < wMinY) wMinY = p.y;
      if (p.y > wMaxY) wMaxY = p.y;
    }
    const { gy: minGY } = this.worldToGrid(0, wMinY);
    const { gy: maxGY } = this.worldToGrid(0, wMaxY);

    const n = poly2D.length;
    for (let gy = minGY; gy <= maxGY; gy++) {
      const { wy: scanY } = this.gridToWorld(0, gy);

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
        const { gx: gxStart } = this.worldToGrid(xIntersections[k], 0);
        const { gx: gxEnd } = this.worldToGrid(xIntersections[k + 1], 0);
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
  },

  clearOwner(ownerId) {
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === ownerId) this.grid[i] = 0;
    }
  },

  countCells(ownerId) {
    let count = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === ownerId) count++;
    }
    return count;
  },

  extractContours(ownerId) {
    // Marching squares to extract boundary contours
    // Create binary ownership function
    const owned = (gx, gy) => {
      if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return 0;
      return this.grid[gy * GRID_SIZE + gx] === ownerId ? 1 : 0;
    };

    // Find bounding box of owned cells to avoid scanning entire grid
    let minGX = GRID_SIZE, maxGX = 0, minGY = GRID_SIZE, maxGY = 0;
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        if (this.grid[gy * GRID_SIZE + gx] === ownerId) {
          if (gx < minGX) minGX = gx;
          if (gx > maxGX) maxGX = gx;
          if (gy < minGY) minGY = gy;
          if (gy > maxGY) maxGY = gy;
        }
      }
    }
    if (minGX > maxGX) return []; // no cells owned

    // Expand bounds by 1 for marching squares border
    minGX = Math.max(0, minGX - 1);
    minGY = Math.max(0, minGY - 1);
    maxGX = Math.min(GRID_SIZE - 1, maxGX + 1);
    maxGY = Math.min(GRID_SIZE - 1, maxGY + 1);

    // Marching squares: for each 2x2 block, compute case and emit segments
    // Corners: TL=bit3, TR=bit2, BR=bit1, BL=bit0
    // Segment endpoints are on cell edges (midpoints)
    const segments = [];

    for (let gy = minGY; gy < maxGY; gy++) {
      for (let gx = minGX; gx < maxGX; gx++) {
        const tl = owned(gx, gy);
        const tr = owned(gx + 1, gy);
        const br = owned(gx + 1, gy + 1);
        const bl = owned(gx, gy + 1);
        const caseIdx = (tl << 3) | (tr << 2) | (br << 1) | bl;

        if (caseIdx === 0 || caseIdx === 15) continue; // all same

        // Midpoints of edges: top, right, bottom, left
        const top = { gx: gx + 0.5, gy: gy };
        const right = { gx: gx + 1, gy: gy + 0.5 };
        const bottom = { gx: gx + 0.5, gy: gy + 1 };
        const left = { gx: gx, gy: gy + 0.5 };

        switch (caseIdx) {
          case 1:  segments.push([bottom, left]); break;
          case 2:  segments.push([right, bottom]); break;
          case 3:  segments.push([right, left]); break;
          case 4:  segments.push([top, right]); break;
          case 5:  // saddle: TL and BR owned, TR and BL empty
            // Separate the two diagonal islands (standard non-connected saddle)
            segments.push([top, left]); segments.push([right, bottom]);
            break;
          case 6:  segments.push([top, bottom]); break;
          case 7:  segments.push([top, left]); break;
          case 8:  segments.push([left, top]); break;
          case 9:  segments.push([bottom, top]); break;
          case 10: // saddle: TR and BL owned, TL and BR empty
            segments.push([left, bottom]); segments.push([top, right]);
            break;
          case 11: segments.push([right, top]); break;
          case 12: segments.push([left, right]); break;
          case 13: segments.push([bottom, right]); break;
          case 14: segments.push([left, bottom]); break;
        }
      }
    }

    if (segments.length === 0) return [];

    // Chain segments into closed loops
    // Key segments by their start point for efficient lookup
    const key = (p) => `${p.gx},${p.gy}`;
    const adjMap = new Map();
    for (let i = 0; i < segments.length; i++) {
      const k = key(segments[i][0]);
      if (!adjMap.has(k)) adjMap.set(k, []);
      adjMap.get(k).push(i);
    }

    const used = new Uint8Array(segments.length);
    const loops = [];

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;

      const loop = [];
      let current = i;
      while (current !== -1 && !used[current]) {
        used[current] = 1;
        const seg = segments[current];
        loop.push(seg[0]);

        // Find next segment whose start matches current end
        const endKey = key(seg[1]);
        current = -1;
        const candidates = adjMap.get(endKey);
        if (candidates) {
          for (const ci of candidates) {
            if (!used[ci]) {
              current = ci;
              break;
            }
          }
        }
      }

      if (loop.length >= 3) {
        // Convert grid coords to world coords
        const worldLoop = loop.map(p => {
          const { wx, wy } = this.gridToWorld(p.gx, p.gy);
          return { x: wx, y: wy };
        });

        // Simplify with RDP
        const simplified = simplifyContour(worldLoop, 0.08);
        if (simplified.length >= 3) {
          loops.push(simplified);
        }
      }
    }

    return loops;
  },

  floodFillConnected(ownerId, reassignTo) {
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

        const neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
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
};

// ===================== CONTOUR SIMPLIFICATION (RDP) =====================
function pointToSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const ex = p.x - a.x, ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  const ex = p.x - projX, ey = p.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function rdpRecurse(points, epsilon, start, end) {
  if (end - start < 2) return [points[start], points[end]];
  let maxDist = 0, maxIdx = start;
  const a = points[start], b = points[end];
  for (let i = start + 1; i < end; i++) {
    const d = pointToSegDist(points[i], a, b);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdpRecurse(points, epsilon, start, maxIdx);
    const right = rdpRecurse(points, epsilon, maxIdx, end);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function simplifyContour(points, epsilon) {
  if (points.length <= 4) return points;
  const open = points.concat([points[0]]);
  const result = rdpRecurse(open, epsilon, 0, open.length - 1);
  result.pop(); // remove closing duplicate
  return result.length >= 3 ? result : points;
}

// ===================== CHARACTER (RENDERER WRAPPER) =====================
// Renderer-side Character. Visual mesh + trail mesh + label.
// Authoritative simulation state lives on this.simChar (Simulation's plain-data
// Character). Each frame, Game.tick syncs pos/dir from simChar to this.pos/dir.
// Player/bot input writes to this.targetDir, Game forwards it to sim.
class Character {
  constructor(scene, simChar, color, isPlayer) {
    this.scene = scene;
    this.simChar = simChar;          // authoritative sim state (Simulation/Character.js)
    this.pos = new THREE.Vector3(simChar.pos.x, 0, simChar.pos.z);
    this.dir = new THREE.Vector3(simChar.dir.x, 0, simChar.dir.z);
    this.targetDir = this.dir.clone();
    this.speed = isPlayer ? PLAYER_SPEED : BOT_SPEED;
    this.color = color;
    this._initialName = simChar.name;
    this.isPlayer = isPlayer;
    this.factionId = simChar.factionId;   // mirror; updated on faction reassign
    this.trailVerts = [];                 // Vector3[]; populated via sim.onTrailVertex hook
    this.trailMesh = null;
    // Online prediction hook: when set, syncVisuals reads from this object's
    // {posX, posZ, dirX, dirZ} instead of simChar. Used for the local player
    // in online mode to eliminate input-roundtrip lag.
    this.predicted = null;
    // Snapshot interpolation buffer for REMOTE characters in online mode.
    // Server broadcasts at 20Hz; rendering at 60Hz. Without buffering, the
    // simple per-frame lerp produces visible stair-stepping every 3 frames
    // when the lerp target jumps. Glenn Fiedler's snapshot interpolation:
    // keep the last 2-3 snapshots, render at "now - INTERP_DELAY" by lerping
    // between the two bracketing snapshots. This produces actual smooth
    // constant-velocity motion between known states.
    this.posBuffer = [];           // {t, x, z, dirX, dirZ}, ordered by t ascending
    this._lastSchemaPosX = null;   // last sampled schema posX (for change detection)
    this._lastSchemaPosZ = null;
    this.group = this._buildChar(color);
    scene.add(this.group);
  }

  // Reactive name accessor: in online mode the schema name updates after
  // handleHello, so we always read the latest value rather than caching at
  // construction. _updateLabels() and HUD code read c.name each frame.
  get name() { return this.simChar?.name ?? this._initialName; }
  set name(v) { this._initialName = v; }

  // Convenience accessors that forward to simChar (renderer code reads these
  // for HUD / scoring / kill detection that hasn't moved yet).
  get alive() { return this.simChar.alive; }
  set alive(v) { this.simChar.alive = v; }
  get respawnTimer() { return this.simChar.respawnTimer; }
  set respawnTimer(v) { this.simChar.respawnTimer = v; }
  get invulnTimer() { return this.simChar.invulnTimer; }
  set invulnTimer(v) { this.simChar.invulnTimer = v; }
  get killCount() { return this.simChar.killCount; }
  set killCount(v) { this.simChar.killCount = v; }
  get wasOutside() { return this.simChar.wasOutside; }
  set wasOutside(v) { this.simChar.wasOutside = v; }

  _buildChar(color) {
    const g = new THREE.Group();
    // Theme F: lift the entire character group onto the island top so feet
    // sit on the territory surface (Y = TERRITORY_Y) rather than below it.
    g.position.y = ISLAND_TOP_Y + 0.05;
    this.baseY = ISLAND_TOP_Y + 0.05;   // used by FX (kill debris, respawn build-up)
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.75, 0.75),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
    );
    head.position.y = 1.3;
    head.castShadow = true;
    g.add(head);
    const eyeG = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupG = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const pupM = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeG, eyeM);
      eye.position.set(s*0.18, 1.35, 0.36);
      g.add(eye);
      const pup = new THREE.Mesh(pupG, pupM);
      pup.position.set(s*0.18, 1.35, 0.42);
      g.add(pup);
    }
    // Theme F sailor cap: faction-colored band + white top cube on the head.
    // Lifted from companion mockup ("castaway" style) — pure boxes per ART_ETHOS.
    const capBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.08, 0.78),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    capBand.position.y = 1.72;
    capBand.castShadow = true;
    g.add(capBand);
    const capTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.18, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7 })
    );
    capTop.position.y = 1.85;
    capTop.castShadow = true;
    g.add(capTop);
    // Invuln shield: transparent sphere enclosing the character. Hidden by
    // default; toggled on in syncVisuals() while invulnTimer > 0. Faction-
    // colored so onlookers can identify both the player AND that they're
    // invulnerable at a glance.
    this.invulnSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 16, 12),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.22, depthWrite: false,
      })
    );
    this.invulnSphere.position.y = 1.0;
    this.invulnSphere.visible = false;
    g.add(this.invulnSphere);
    return g;
  }

  _rebuildTrailMesh() {
    // Performance: previously this rebuilt the full BufferGeometry every time a
    // single vertex was appended (server emits ~5–20 trailVertex events/sec
    // per character × 30 characters). With trails growing to hundreds of
    // vertices each, total per-vertex work was O(total trail length) → O(N²)
    // amortized work when chasing a long trail. The new approach uses a
    // pre-allocated growable Float32Array and a Uint16/Uint32 index buffer,
    // and on each call only writes the last two ribbon vertices + the new
    // pair of triangles. The previous tail vertex is also rewritten with a
    // refined normal (now that we know the next vertex). This makes append
    // cost O(1) per vertex.
    const verts = this.trailVerts;
    if (verts.length < 2) {
      if (this.trailMesh) {
        this.scene.remove(this.trailMesh);
        this.trailMesh.geometry.dispose();
        this.trailMesh = null;
      }
      this._trailGeomCapacity = 0;
      return;
    }

    const hw = TRAIL_WIDTH / 2;

    // Allocate / grow geometry buffers if needed. Capacity doubles each time
    // to amortize growth cost; max trail length is bounded by sim's MAX_TRAIL.
    // 3D trail layout: 4 verts per point laid out as
    //   [0]=bottom-left, [1]=bottom-right, [2]=top-left, [3]=top-right
    // Each segment from i-1 → i becomes 3 quads (top + 2 side walls) = 6 tris
    // = 18 indices. Bottom face is omitted (camera looks down, never sees it).
    const VERTS_PER_POINT = 4;
    const FLOATS_PER_POINT = VERTS_PER_POINT * 3;       // 12
    const INDICES_PER_SEGMENT = 18;
    if (!this.trailMesh || (this._trailGeomCapacity || 0) < verts.length) {
      if (this.trailMesh) {
        this.scene.remove(this.trailMesh);
        this.trailMesh.geometry.dispose();
        this.trailMesh = null;
      }
      const cap = Math.max(64, Math.ceil(verts.length * 1.5));
      const positions = new Float32Array(cap * FLOATS_PER_POINT);
      const useUint32 = cap * VERTS_PER_POINT > 65535;
      const indexArr = useUint32
        ? new Uint32Array(cap * INDICES_PER_SEGMENT)
        : new Uint16Array(cap * INDICES_PER_SEGMENT);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setIndex(new THREE.BufferAttribute(indexArr, 1));
      geom.setDrawRange(0, 0);
      this.trailMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
        color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85
      }));
      this.scene.add(this.trailMesh);
      this._trailGeomCapacity = cap;
      this._trailWrittenCount = 0;     // # of points whose 4 verts are filled
      this._trailIndexCount = 0;       // # of indices written
    }

    const geom = this.trailMesh.geometry;
    const posAttr = geom.attributes.position;
    const idxAttr = geom.index;
    const posArr = posAttr.array;
    const idxArr = idxAttr.array;

    const writePoint = (i) => {
      const p = verts[i];
      let dx, dz;
      if (i > 0 && i < verts.length - 1) {
        dx = verts[i+1].x - verts[i-1].x;
        dz = verts[i+1].z - verts[i-1].z;
      } else if (i < verts.length - 1) {
        dx = verts[i+1].x - p.x;
        dz = verts[i+1].z - p.z;
      } else {
        dx = p.x - verts[i-1].x;
        dz = p.z - verts[i-1].z;
      }
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const nx = -dz/len, nz = dx/len;
      const o = i * FLOATS_PER_POINT;
      // bottom-left (Y=TRAIL_Y, +normal)
      posArr[o     ] = p.x + nx*hw; posArr[o +  1] = TRAIL_Y;     posArr[o +  2] = p.z + nz*hw;
      // bottom-right (Y=TRAIL_Y, -normal)
      posArr[o +  3] = p.x - nx*hw; posArr[o +  4] = TRAIL_Y;     posArr[o +  5] = p.z - nz*hw;
      // top-left (Y=TRAIL_Y_TOP, +normal)
      posArr[o +  6] = p.x + nx*hw; posArr[o +  7] = TRAIL_Y_TOP; posArr[o +  8] = p.z + nz*hw;
      // top-right (Y=TRAIL_Y_TOP, -normal)
      posArr[o +  9] = p.x - nx*hw; posArr[o + 10] = TRAIL_Y_TOP; posArr[o + 11] = p.z - nz*hw;
    };

    // Rewrite the previous tail (its forward-neighbor changed) and write all
    // new points. In steady-state this is two writes per call.
    const start = Math.max(0, (this._trailWrittenCount || 0) - 1);
    for (let i = start; i < verts.length; i++) {
      writePoint(i);
      if (i > 0 && i >= (this._trailIndexCount / INDICES_PER_SEGMENT | 0) + 1) {
        // Vertex base for prev (i-1) and current (i) — each point owns 4 verts.
        const pBase = (i - 1) * VERTS_PER_POINT;
        const cBase = i * VERTS_PER_POINT;
        const pBL = pBase, pBR = pBase + 1, pTL = pBase + 2, pTR = pBase + 3;
        const cBL = cBase, cBR = cBase + 1, cTL = cBase + 2, cTR = cBase + 3;
        let o = this._trailIndexCount;
        // Top face: pTL, pTR, cTR, cTL
        idxArr[o   ] = pTL; idxArr[o+ 1] = pTR; idxArr[o+ 2] = cTR;
        idxArr[o+ 3] = pTL; idxArr[o+ 4] = cTR; idxArr[o+ 5] = cTL;
        // Left wall: pBL, pTL, cTL, cBL
        idxArr[o+ 6] = pBL; idxArr[o+ 7] = pTL; idxArr[o+ 8] = cTL;
        idxArr[o+ 9] = pBL; idxArr[o+10] = cTL; idxArr[o+11] = cBL;
        // Right wall: pBR, pTR, cTR, cBR
        idxArr[o+12] = pBR; idxArr[o+13] = pTR; idxArr[o+14] = cTR;
        idxArr[o+15] = pBR; idxArr[o+16] = cTR; idxArr[o+17] = cBR;
        this._trailIndexCount = o + INDICES_PER_SEGMENT;
      }
    }
    this._trailWrittenCount = verts.length;

    posAttr.needsUpdate = true;
    idxAttr.needsUpdate = true;
    geom.setDrawRange(0, this._trailIndexCount);
  }

  // Renderer-only sync: pull authoritative pos/dir from simChar (or predicted
  // state for the local online player) and place the mesh. All simulation
  // work (steer, move, trail, claim, kills) is owned by sim.tick.
  //
  // Three rendering paths:
  //   1. Local player with prediction (this.predicted set) — snap to predicted
  //      pos/dir each frame. Predicted state is already advanced this tick by
  //      _stepPrediction(); lerping would re-introduce visual lag.
  //   2. Solo / local sim (simChar exposes plain {x,z}, no _schemaChar) — snap
  //      directly to simChar pos/dir each frame. Sim runs at render rate so
  //      the position is already exact every frame.
  //   3. Remote online characters (simChar is a schema-backed proxy) — use
  //      snapshot interpolation: maintain a buffer of the last 2-3 server
  //      snapshots, render at performance.now() - INTERP_DELAY by lerping
  //      between the two bracketing snapshots. Produces actual smooth
  //      constant-velocity motion between server states; eliminates the
  //      stair-stepping that the simple per-frame lerp produced (target only
  //      changed every ~3 frames at 60Hz render / 20Hz server).
  syncVisuals() {
    if (!this.alive) {
      this.group.visible = false;
      return;
    }
    this.factionId = this.simChar.factionId;

    let tgtX, tgtZ, tgtDirX, tgtDirZ;
    let snap = false;

    if (this.predicted) {
      // Path 1: local player with client-side prediction.
      // Lerp the visual mesh toward the predicted pos at ~30% per frame
      // (~3 frames lag at 60fps) to absorb the per-ack reconciliation
      // jumps without introducing noticeable input lag. _snapNextFrame
      // overrides this for explicit teleport events (respawn/restart).
      tgtX = this.predicted.posX;
      tgtZ = this.predicted.posZ;
      tgtDirX = this.predicted.dirX;
      tgtDirZ = this.predicted.dirZ;
      snap = this._snapNextFrame === true;
      this._snapNextFrame = false;
    } else if (this.simChar && this.simChar._schemaChar) {
      // Path 3: remote character in online mode — snapshot interpolation.
      const schemaX = this.simChar.pos.x;
      const schemaZ = this.simChar.pos.z;
      const now = performance.now();

      // Push a new snapshot whenever the schema position changed since last
      // sample. onStateChange runs ~20Hz when server broadcasts, so this
      // captures each new authoritative pos with its arrival timestamp.
      if (this._lastSchemaPosX === null
        || schemaX !== this._lastSchemaPosX
        || schemaZ !== this._lastSchemaPosZ) {
        // Detect a large pos jump (> 2 world units between consecutive server
        // snapshots) — this is a server-side discontinuity (death, cutoff,
        // reassign) that should snap, not interpolate. The matching teleport
        // event may not have arrived yet (arrives via separate broadcast on
        // the same WS connection but processed independently from state
        // patches). Clear the buffer so we snap to the new pos immediately
        // rather than sliding visibly for 100ms.
        if (this._lastSchemaPosX !== null) {
          const dx = schemaX - this._lastSchemaPosX;
          const dz = schemaZ - this._lastSchemaPosZ;
          if (dx * dx + dz * dz > 4) {
            this.posBuffer.length = 0;
          }
        }
        this.posBuffer.push({
          t: now,
          x: schemaX,
          z: schemaZ,
          dirX: this.simChar.dir.x,
          dirZ: this.simChar.dir.z,
        });
        // Keep the most recent 3 snapshots — enough to bracket render-time
        // and absorb a single dropped/late packet without losing both ends.
        if (this.posBuffer.length > 3) this.posBuffer.shift();
        this._lastSchemaPosX = schemaX;
        this._lastSchemaPosZ = schemaZ;
      }

      const INTERP_DELAY = 100; // ms behind real-time, ≈ 2 server ticks at 20Hz
      const renderTime = now - INTERP_DELAY;
      const buf = this.posBuffer;

      if (buf.length === 0) {
        // Just spawned — nothing yet. Use schema as best-effort.
        tgtX = schemaX;
        tgtZ = schemaZ;
        tgtDirX = this.simChar.dir.x;
        tgtDirZ = this.simChar.dir.z;
        snap = true;
      } else if (buf.length === 1) {
        // Only one snapshot — snap to it.
        tgtX = buf[0].x;
        tgtZ = buf[0].z;
        tgtDirX = buf[0].dirX;
        tgtDirZ = buf[0].dirZ;
        snap = true;
      } else {
        // Find the two snapshots that bracket renderTime. Prefer the latest
        // pair; if renderTime is before the oldest, clamp to oldest; if past
        // the newest, clamp to newest (extrapolation would amplify any lag
        // spike into a teleport).
        let i0 = -1, i1 = -1;
        for (let i = buf.length - 1; i >= 1; i--) {
          if (buf[i - 1].t <= renderTime && renderTime <= buf[i].t) {
            i0 = i - 1; i1 = i;
            break;
          }
        }
        if (i0 < 0) {
          if (renderTime < buf[0].t) {
            // Clamp to oldest snapshot.
            tgtX = buf[0].x; tgtZ = buf[0].z;
            tgtDirX = buf[0].dirX; tgtDirZ = buf[0].dirZ;
          } else {
            // Past newest — clamp to newest (no extrapolation).
            const last = buf[buf.length - 1];
            tgtX = last.x; tgtZ = last.z;
            tgtDirX = last.dirX; tgtDirZ = last.dirZ;
          }
        } else {
          const a = buf[i0], b = buf[i1];
          const span = b.t - a.t;
          const t = span > 0 ? (renderTime - a.t) / span : 0;
          tgtX = a.x + (b.x - a.x) * t;
          tgtZ = a.z + (b.z - a.z) * t;
          tgtDirX = a.dirX + (b.dirX - a.dirX) * t;
          tgtDirZ = a.dirZ + (b.dirZ - a.dirZ) * t;
          // Renormalize dir (interpolated dir vector loses unit length).
          const dl = Math.hypot(tgtDirX, tgtDirZ) || 1;
          tgtDirX /= dl;
          tgtDirZ /= dl;
        }
        snap = true;
      }
    } else {
      // Path 2: solo / local sim. simChar.pos is exact every frame.
      tgtX = this.simChar.pos.x;
      tgtZ = this.simChar.pos.z;
      tgtDirX = this.simChar.dir.x;
      tgtDirZ = this.simChar.dir.z;
      snap = true;
    }

    this.pos.set(tgtX, 0, tgtZ);
    this.dir.set(tgtDirX, 0, tgtDirZ);

    if (snap) {
      this.group.position.x = tgtX;
      this.group.position.z = tgtZ;
      this.group.rotation.y = Math.atan2(tgtDirX, tgtDirZ);
    } else if (this.predicted) {
      // Local player: lerp visual toward predicted pos. ~3 frame visual lag
      // at 60fps in exchange for smoothing out per-ack reconciliation jumps.
      const t = 0.30;
      this.group.position.x += (tgtX - this.group.position.x) * t;
      this.group.position.z += (tgtZ - this.group.position.z) * t;
      // Rotation: lerp via shortest-path angle to avoid 2π wraparound jumps.
      const targetAng = Math.atan2(tgtDirX, tgtDirZ);
      let curAng = this.group.rotation.y;
      let d = targetAng - curAng;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.group.rotation.y = curAng + d * t;
    }

    // Invuln shield visible while invulnTimer > 0 (any character, not just
    // local player). Pulses subtly so it reads as "active effect" rather than
    // a static prop. Replaces the old player-only flicker.
    const invuln = this.invulnTimer > 0;
    this.group.visible = true;
    if (this.invulnSphere) {
      this.invulnSphere.visible = invuln;
      if (invuln) {
        const pulse = 0.18 + 0.10 * Math.sin(performance.now() * 0.006);
        this.invulnSphere.material.opacity = pulse;
      }
    }
  }

  // Renderer trail mesh teardown. Sim owns the actual trailVerts data; this
  // method clears the renderer mirror used to build the visible mesh.
  _clearTrail() {
    this.trailVerts = [];
    if (this.trailMesh) { this.scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); this.trailMesh = null; }
    this._trailGeomCapacity = 0;
    this._trailWrittenCount = 0;
    this._trailIndexCount = 0;
  }

  // Visual death hook (sim already mutated simChar via Character.kill()).
  onDieVisual() {
    this._clearTrail();
    this.group.visible = false;
  }

  // Visual respawn hook (sim already mutated simChar via Character.respawn()).
  onRespawnVisual() {
    this.targetDir.set(this.simChar.dir.x, 0, this.simChar.dir.z);
    this.group.visible = true;
  }

}

// ===================== ONLINE CHAR PROXY =====================
// Wraps a Colyseus CharacterSchema in a sim-Character-shaped object so the
// renderer Character class (which reads simChar.pos, simChar.dir, etc.) works
// unchanged in online mode. Schema fields auto-update as state syncs from
// the server; getters forward each frame's reads to the latest schema values.
function makeOnlineCharProxy(schemaChar) {
  return {
    get id() { return schemaChar.id; },
    get factionId() { return schemaChar.factionId; },
    get name() { return schemaChar.name; },
    get isHuman() { return schemaChar.isHuman; },
    get alive() { return schemaChar.alive; },
    set alive(_v) { /* read-only mirror of server state */ },
    get invulnTimer() { return schemaChar.invulnTimer; },
    set invulnTimer(_v) {},
    get killCount() { return schemaChar.killCount; },
    set killCount(_v) {},
    get deaths() { return schemaChar.deaths ?? 0; },
    get cellsCaptured() { return schemaChar.cellsCaptured ?? 0; },
    get respawnTimer() { return 0; },
    set respawnTimer(_v) {},
    pos: {
      get x() { return schemaChar.posX; },
      get z() { return schemaChar.posZ; },
    },
    dir: {
      get x() { return schemaChar.dirX; },
      get z() { return schemaChar.dirZ; },
    },
    targetDir: { x: 0, z: 1 },
    trailVerts: [],          // Trail comes from server "trailVertex" events (Task 16+)
    wasOutside: false,
    _schemaChar: schemaChar, // expose underlying schema for direct lookup if needed
  };
}

// ===================== JEN FX MANAGER (Theme F) =====================
// Owns all per-event visual effects:
//   * Claim   → wave-ripple (E source) — 3 concentric water rings + droplet cubes
//   * Kill    → voxel debris (D source) — 12 bouncy 3D cube fragments with gravity
//   * Respawn → build-up (D source)     — char rises from below + dust puffs
//   * Win     → voxel rain (D source)   — 30 cubes drop from sky in winning color
//
// All meshes are tracked in this.particles[] and disposed when life >= maxLife,
// so there are no leaks even at high event rates. Materials use shared geometries
// where possible (cube debris) but the simpler-to-reason-about per-particle alloc
// is kept since per-event volume is bounded (≤14 particles per kill, ≤30 for win).
class JenFXManager {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];   // {mesh, kind, life, maxLife, vel?, gravity?, ...}
    this.shockwaves = [];  // expanding ring meshes
  }

  // ---- Claim: wave-ripple FX (E source) ----
  // Spawns 3 concentric ring shockwaves at (x, z) plus 8 small light-blue
  // cubes that pop up and outward like a water splash. Wave rings expand
  // and fade over ~0.7s; droplets fall under gravity and dispose at maxLife.
  triggerClaim(x, z) {
    [0, 0.12, 0.24].forEach((delay, idx) => {
      setTimeout(() => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.3, 0.42, 32),
          new THREE.MeshBasicMaterial({
            color: 0xC8F0FF, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, FX_RING_Y + idx * 0.005, z);
        this.scene.add(ring);
        this.shockwaves.push({ mesh: ring, life: 0, maxLife: 0.7, scaleTo: 8 });
      }, delay * 1000);
    });
    for (let i = 0; i < 8; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.4;
      const droplet = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xCFEEFF, transparent: true, opacity: 0.95 }),
      );
      droplet.position.set(x, FX_RING_Y, z);
      this.scene.add(droplet);
      this.particles.push({
        mesh: droplet, kind: "physics", life: 0, maxLife: 0.7,
        vel: new THREE.Vector3(Math.cos(ang) * speed, 1.4 + Math.random() * 1.2, Math.sin(ang) * speed),
        gravity: -5, floorY: FX_RING_Y, bounceY: 0.0,
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
      });
    }
  }

  // ---- Kill: voxel debris FX (D source) ----
  // Spawns 12 cubes at the victim's chest (Y = baseY + 1) that fly outward
  // with gravity, bounce once on the territory surface, then fade out.
  // Cubes are tinted variants of the victim's faction color so the kill
  // visually communicates which faction lost a unit.
  triggerKill(x, z, baseY, victimColor) {
    const chestY = baseY + 1.0;
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 2;
      const upspeed = 2.5 + Math.random() * 1.5;
      const sz = 0.2 + Math.random() * 0.14;
      const variantColor = i % 3 === 0
        ? new THREE.Color(victimColor).multiplyScalar(0.7).getHex()
        : victimColor;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz, sz),
        new THREE.MeshLambertMaterial({ color: variantColor, transparent: true, opacity: 1 }),
      );
      m.position.set(x, chestY, z);
      m.castShadow = true;
      this.scene.add(m);
      this.particles.push({
        mesh: m, kind: "physics", life: 0, maxLife: 1.2,
        vel: new THREE.Vector3(Math.cos(angle) * speed, upspeed, Math.sin(angle) * speed),
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        gravity: -10, floorY: TRAIL_Y, bounceY: 0.3, hasBounced: 0,
      });
    }
  }

  // ---- Respawn: build-up FX (D source) ----
  // Animates the character group rising from `baseY - 1.5` to `baseY` over
  // 0.5s while spawning 5 white dust puffs at ground level. The mesh visibility
  // is owned by the caller (sim's onRespawnVisual), we just animate the Y.
  triggerRespawn(charGroup, baseY, x, z) {
    this.particles.push({
      mesh: null, kind: "respawn-build",
      respawnTarget: charGroup, life: 0, maxLife: 0.5,
      startY: baseY - 1.5, endY: baseY,
    });
    // Snap to start position so the animation has somewhere to begin.
    charGroup.position.y = baseY - 1.5;
    for (let i = 0; i < 5; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.2;
      const puff = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshBasicMaterial({ color: 0xfffafa, transparent: true, opacity: 0.9 }),
      );
      puff.position.set(x, baseY + 0.1, z);
      this.scene.add(puff);
      this.particles.push({
        mesh: puff, kind: "physics", life: 0, maxLife: 0.5,
        vel: new THREE.Vector3(Math.cos(ang) * speed, 0.6, Math.sin(ang) * speed),
        gravity: -3, floorY: baseY + 0.1, bounceY: 0.0,
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5),
      });
    }
  }

  // ---- Win: voxel rain (D source) ----
  // Drops 30 cubes from Y=8-12 over the playable area. Cubes hit the
  // territory surface, bounce once, then fade out. Tinted in the winning
  // faction's color (with some variant darker shades for visual interest).
  triggerWin(winningColor) {
    for (let i = 0; i < 30; i++) {
      const cx = (Math.random() - 0.5) * ARENA_RADIUS * 1.5;
      const cz = (Math.random() - 0.5) * ARENA_RADIUS * 1.5;
      const sz = 0.4 + Math.random() * 0.5;
      const variantColor = i % 4 === 0
        ? new THREE.Color(winningColor).multiplyScalar(0.7).getHex()
        : winningColor;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz, sz),
        new THREE.MeshLambertMaterial({ color: variantColor, transparent: true, opacity: 1 }),
      );
      m.position.set(cx, ISLAND_TOP_Y + 8 + Math.random() * 4, cz);
      m.castShadow = true;
      this.scene.add(m);
      const fallDelay = Math.random() * 0.8;
      this.particles.push({
        mesh: m, kind: "physics", life: -fallDelay, maxLife: 2.5,
        vel: new THREE.Vector3(0, -3 - Math.random() * 2, 0),
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        gravity: -10, floorY: TRAIL_Y, bounceY: 0.3, hasBounced: 0,
      });
    }
  }

  // ---- Per-frame update ----
  // Single update loop ticks both shockwaves and particles. Disposes any
  // mesh whose life >= maxLife so memory is bounded by the worst-case
  // active event count (≤30 for win, ≤14 for kill).
  update(dt) {
    // Shockwaves (expanding rings)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      const k = sw.life / sw.maxLife;
      const scaleTo = sw.scaleTo || 6;
      const s = 1 + k * scaleTo;
      sw.mesh.scale.set(s, s, 1);
      sw.mesh.material.opacity = 0.95 * (1 - k);
      if (sw.life >= sw.maxLife) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      // Delayed-spawn (used by win-rain).
      if (p.life < 0) continue;
      const k = p.life / p.maxLife;
      if (p.kind === "respawn-build") {
        // Animate the live character group upward from below ground.
        p.respawnTarget.position.y = p.startY + (p.endY - p.startY) * Math.min(1, k);
        if (p.life >= p.maxLife) {
          p.respawnTarget.position.y = p.endY;
          this.particles.splice(i, 1);
        }
        continue;
      }
      if (p.kind === "physics") {
        p.vel.y += p.gravity * dt;
        p.mesh.position.x += p.vel.x * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += p.vel.z * dt;
        if (p.mesh.position.y < p.floorY) {
          p.mesh.position.y = p.floorY;
          if (p.bounceY > 0) {
            p.vel.y *= -p.bounceY;
            p.vel.x *= 0.55; p.vel.z *= 0.55;
            p.hasBounced = (p.hasBounced || 0) + 1;
          } else {
            p.vel.y = 0;
          }
        }
        if (p.rotVel) {
          p.mesh.rotation.x += p.rotVel.x * dt;
          p.mesh.rotation.y += p.rotVel.y * dt;
          p.mesh.rotation.z += p.rotVel.z * dt;
        }
        const fadeStart = p.maxLife * 0.55;
        if (p.life > fadeStart) {
          p.mesh.material.opacity = 1 - (p.life - fadeStart) / (p.maxLife - fadeStart);
        }
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
      }
    }
  }
}

// ===================== JEN HUD MANAGER (Theme F) =====================
// Theme F-specific HUD: notification toast stack (A's cream cards anchored
// below the leaderboard), faction-state banner (D's wooden stamp), and a
// last-9-second countdown intensification.
//
// The notification anchor (#jen-notif-stack) is positioned each frame just
// below the leaderboard's actual bottom, so it never overlaps regardless of
// how many entries the leaderboard renders.
class JenHUDManager {
  constructor() {
    this.notifStack = document.getElementById("jen-notif-stack");
    this.bannerEl = document.getElementById("jen-banner");
    this.timerEl = document.getElementById("hud-tl");
    this.leaderboardEl = document.getElementById("player-leaderboard");
    this._lastBannerKey = "";
  }

  // Push a notification toast. Auto-dismisses after 3s. Cap at 4 visible.
  push(text) {
    if (!this.notifStack) return;
    const el = document.createElement("div");
    el.className = "jen-notif";
    el.textContent = text;
    this.notifStack.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add("in");
      // Brief flash to draw the eye — scale + brightness pulse over 0.5s.
      el.classList.add("flash");
      el.addEventListener("animationend", () => el.classList.remove("flash"), { once: true });
    });
    while (this.notifStack.children.length > 4) {
      this.notifStack.removeChild(this.notifStack.firstChild);
    }
    setTimeout(() => {
      el.classList.remove("in");
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }, 3000);
  }

  // Show a center banner (D wooden stamp). `key` dedupes — calling repeatedly
  // with the same key inside the duration window is a no-op so we don't
  // re-pop the banner every frame the underlying state is true.
  showBanner(text, key, durationMs = 2200) {
    if (!this.bannerEl) return;
    if (this._lastBannerKey === key) return;
    this._lastBannerKey = key;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add("show");
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.bannerEl.classList.remove("show");
      // Allow the same key to re-trigger after dismissal so a faction can
      // re-enter endangered status later in the match.
      setTimeout(() => { this._lastBannerKey = ""; }, 400);
    }, durationMs);
  }

  // Reposition the notification stack just below the leaderboard. Called
  // each frame because the leaderboard height is dynamic (player count).
  updateNotificationAnchor() {
    if (!this.notifStack || !this.leaderboardEl) return;
    const r = this.leaderboardEl.getBoundingClientRect();
    if (r.bottom > 0) {
      this.notifStack.style.top = (r.bottom + 8) + "px";
    }
  }

  // Apply the "intense" countdown class when ≤ 9s remain. Toggling the
  // class triggers the cd-pulse CSS animation defined in index.html.
  setCountdownIntense(intense) {
    if (!this.timerEl) return;
    if (intense) this.timerEl.classList.add("intense");
    else this.timerEl.classList.remove("intense");
  }
}

// ===================== GAME =====================
class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);
    this.camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 300);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    // ===== Theme F (Atoll Hybrid) scene setup =====
    // Replaces the previous flat-ground-on-white look with:
    //   * Sky-gradient background + sea fog
    //   * Animated Vanta-style waves on a plane OUTSIDE ARENA_RADIUS (water Y=-2)
    //   * Flat sand-cliff cylinder island (top face at Y=0 = ISLAND_TOP_Y)
    //   * 14 cliff rocks around the rim (sit on island top)
    //   * 3 distant atolls in the fog
    //   * Warm-dawn lighting retune (ambient + directional + cool sea bounce)
    this._buildThemeFScene();

    this.characters = [];
    this.player = null;
    this.camTarget = new THREE.Vector3();
    this.camCurrent = new THREE.Vector3();
    // Mouse-wheel zoom state. _cameraZoom is the smoothed (rendered) value;
    // _cameraZoomTarget is what the user has dialled in via scroll wheel.
    this._cameraZoom = 1.0;
    this._cameraZoomTarget = 1.0;
    // Respawn cinematic state. Non-null while the ~2s cinematic is playing.
    // Fields: { startTime, savedZoom, oldCamX, oldCamZ, spawnX, spawnZ }
    this._respawnCinematic = null;
    this.started = false;
    this.mode = "solo";
    this.playerName = "";
    this.killedBy = "";
    // Input throttling: send to server at 30 Hz (matches server tick rate).
    this._inputSendAccum = 0;
    this._inputSendInterval = 1 / 30;
    // Authoritative simulation. Created here so event hooks can be attached
    // even before start() is called.
    this.sim = new Simulation();
    this.factionManager = null;   // alias to sim.factionManager after start
    this.matchManager = null;     // alias to sim.matchManager after start
    this.scoreTracker = null;     // alias to sim.scoreTracker after start
    this.uiManager = null;
    this.territoryDirty = false;
    this.territoryTexture = null;
    this.territoryMesh = null;
    this._territoryCanvas = null;
    this._territoryCtx = null;
    this._territoryImageData = null;
    this._debugNearestFilter = false;
    // Throttle texture rebuilds to at most 10 Hz. Multiple claim/heal events per
    // tick coalesce into a single putImageData. The grid still mutates
    // immediately; only the GPU upload is delayed by up to ~100ms.
    this._territoryRebuildAccum = 0;
    this._territoryRebuildInterval = 0.1;
    // Map: simChar -> renderer Character (used by event hooks).
    this._charBySim = new Map();

    // Input
    this.mouseNDC = new THREE.Vector2();
    this.hasMouseInput = false;
    this.keysDown = new Set();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.renderer.domElement.addEventListener("mousemove", e => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.hasMouseInput = true;
    });
    this.renderer.domElement.addEventListener("touchmove", e => {
      e.preventDefault();
      if (e.touches.length) {
        const t = e.touches[0], rect = this.renderer.domElement.getBoundingClientRect();
        this.mouseNDC.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseNDC.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
        this.hasMouseInput = true;
      }
    }, { passive: false });
    this.renderer.domElement.addEventListener("touchstart", e => {
      e.preventDefault();
      if (e.touches.length) {
        const t = e.touches[0], rect = this.renderer.domElement.getBoundingClientRect();
        this.mouseNDC.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseNDC.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
        this.hasMouseInput = true;
      }
    }, { passive: false });
    window.addEventListener("keydown", e => {
      this.keysDown.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "c") this._toggleGridOverlay();
      if (e.key.toLowerCase() === "v") this._toggleFactionMeshes();
      if (e.key.toLowerCase() === "f" && _stats) {
        // Toggle stats.js FPS/MS/MB overlay
        _stats.dom.style.display = _stats.dom.style.display === "none" ? "block" : "none";
      }
    });
    window.addEventListener("keyup", e => this.keysDown.delete(e.key.toLowerCase()));
    window.addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    // Mouse-wheel zoom: scroll up → zoom in, scroll down → zoom out.
    // Clamped to [0.5, 2.5] so the camera can never clip the ground or fly
    // too far away. The factor is smoothed each frame via lerp (see tick()).
    this.renderer.domElement.addEventListener("wheel", e => {
      e.preventDefault();
      this._cameraZoomTarget += e.deltaY * 0.001;
      this._cameraZoomTarget = Math.max(0.5, Math.min(2.5, this._cameraZoomTarget));
    }, { passive: false });

    // Labels
    this.labels = new Map();

    // Debug toggles

    // HUD
    this.hudTL = document.getElementById("hud-tl");
    this.hudTR = document.getElementById("hud-tr");
    this.deathScreen = document.getElementById("death-screen");
    this.deathTimer = document.getElementById("death-timer");

    // ===== Theme F overlays =====
    this.fx = new JenFXManager(this.scene);
    this.hud = new JenHUDManager();
    // Track per-faction state from previous frame so we only fire banners on
    // transitions (endangered/eliminated/recovered), not every frame.
    this._lastFactionState = new Map();
    // Win FX one-shot guard.
    this._winFXFired = false;

    // ===== Sim event hooks: bridge authoritative sim events to renderer state =====
    this.sim.onClaim = (charId, trailPoints, _factionId) => {
      this.territoryDirty = true;
      const simChar = this.sim.characters[charId];
      const r = this._charBySim.get(simChar);
      if (r) r._clearTrail();
      // Theme F: wave-ripple FX at the claimer's current position.
      const x = simChar.pos.x, z = simChar.pos.z;
      this.fx.triggerClaim(x, z);
      // Notification toast — only for the local player's claim.
      if (r === this.player && this.factionManager) {
        const faction = this.factionManager.getAllFactions().find(f => f.id === simChar.factionId);
        const fname = faction ? faction.name : `F${simChar.factionId}`;
        this.hud.push(`Claimed for ${fname}`);
      }
      dlog("CLAIM", `${r ? r.name : "?"}: claimed (sim)`, { charId });
    };
    this.sim.onHeal = (changedCells) => {
      this.territoryDirty = true;
    };
    this.sim.onTrailVertex = (charId, x, z) => {
      const simChar = this.sim.characters[charId];
      const r = this._charBySim.get(simChar);
      if (!r) return;
      r.trailVerts.push(new THREE.Vector3(x, 0, z));
      r._rebuildTrailMesh();
    };
    this.sim.onKill = (killerId, victimId) => {
      const victimSim = this.sim.characters[victimId];
      const victimR = this._charBySim.get(victimSim);
      const killerSim = killerId !== null ? this.sim.characters[killerId] : null;
      const killerR = killerSim ? this._charBySim.get(killerSim) : null;
      if (victimR) {
        // Theme F voxel-debris FX at the victim's position. Use the renderer
        // character's baseY so debris spawns on the actual ground (island top).
        this.fx.triggerKill(
          victimSim.pos.x, victimSim.pos.z,
          victimR.baseY != null ? victimR.baseY : ISLAND_TOP_Y,
          victimR.color,
        );
        victimR.onDieVisual();
        if (victimR === this.player) {
          this.killedBy = killerR ? killerR.name : "";
          this.deathScreen.classList.add("visible");
          this.hud.push(killerR ? `Killed by ${killerR.name}` : `Cut off`);
        } else if (killerR === this.player) {
          this.hud.push(`You killed ${victimR.name}`);
        }
        dlog("KILL", `${victimR.name} killed${killerR ? " by " + killerR.name : ""}`, {
          isPlayer: victimR.isPlayer
        });
      }
    };
  }

  startSolo(name) {
    this.mode = "solo";
    this.start(name);  // existing local sim flow
  }

  async startOnline(name) {
    this.mode = "online";
    this.playerName = name;
    this.onlineInitialized = false;
    this.mp = new MultiplayerClient();

    // Server says the chosen name is already in use by another human.
    // Disconnect, re-show the name entry with an inline error, and let the
    // user pick a different name without reloading.
    this.mp.onNameRejected = ({ reason }) => {
      try { this.mp.disconnect(); } catch (_) {}
      this.mp = null;
      this.mode = null;
      const nameEntry = document.getElementById("name-entry");
      const nameInput = document.getElementById("name-input");
      let errEl = document.getElementById("name-error");
      if (!errEl) {
        errEl = document.createElement("div");
        errEl.id = "name-error";
        errEl.style.cssText = "color:#FFD0D0;font-size:13px;font-weight:bold;margin-top:8px;text-shadow:0 0 4px rgba(0,0,0,0.6);";
        nameInput?.parentElement?.appendChild(errEl);
      }
      errEl.textContent = reason || "Name already in use. Pick a different one.";
      nameEntry?.classList.remove("hidden");
      nameInput?.focus();
      nameInput?.select();
    };

    // First state arrival → build renderer characters from schema. After init,
    // schema entries auto-mutate as Colyseus syncs; syncVisuals() reads them.
    this.mp.onState = (state) => {
      if (!this.onlineInitialized) {
        this._initRendererFromOnlineState(state);
        this.onlineInitialized = true;
      }
    };

    // Initial grid snapshot (gzipped) — apply once we receive it. If the
    // snapshot arrives before _initRendererFromOnlineState has aliased the
    // grid, buffer it and apply on init.
    this.mp.onGridSnapshot = async (b64) => {
      try {
        const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const raw = await this._inflateGzip(compressed);
        const bytes = new Uint8Array(raw);
        if (!this.onlineInitialized) {
          this._pendingSnapshot = bytes;
          console.log(`[online] grid snapshot buffered (${bytes.byteLength} bytes) — pending state init`);
          return;
        }
        if (territoryGrid.grid.length !== bytes.length) {
          console.warn(`[online] gridSnapshot size mismatch: ${bytes.length} vs ${territoryGrid.grid.length}`);
          return;
        }
        territoryGrid.grid.set(bytes);
        this.territoryDirty = true;
        this._flushOnlineEventQueue();
        console.log(`[online] grid snapshot applied (${bytes.byteLength} bytes)`);
      } catch (err) {
        console.error("[online] gridSnapshot apply failed:", err);
      }
    };

    // Buffer for claim/heal/trail events that arrive before snapshot+init.
    // Events received before _onlineGridReady is true are queued and replayed
    // immediately after the snapshot is applied, in arrival order.
    this._onlineGridReady = false;
    this._onlineEventQueue = [];

    // Per-claim event: handles two paths.
    //  - Small claim: server already broadcast a claimResult cell-diff; this
    //    "claim" event arrives only to clear the renderer trail mesh.
    //  - Large claim: server sent trail polyline with replayTrail=true; we
    //    re-run the algorithm locally as a fallback.
    this.mp.onClaim = (charId, factionId, trailPoints, replayTrail) => {
      if (!this._onlineGridReady) {
        this._onlineEventQueue.push({ type: "claim", charId, factionId, trailPoints, replayTrail });
        return;
      }
      if (replayTrail && trailPoints && trailPoints.length >= 2) {
        // Large-claim fallback: run the algorithm locally.
        this._applyOnlineClaim(charId, trailPoints, factionId);
      } else {
        // Small claim: grid already updated by claimResult; just clear trail mesh.
        this._clearOnlineCharTrail(charId);
      }
    };

    // Per-claim cell-diff: server-authoritative grid update. Just write the
    // cells into the local grid; no algorithm rerun, no client-side compute spike.
    this.mp.onClaimResult = (charId, factionId, cells) => {
      if (!this._onlineGridReady) {
        this._onlineEventQueue.push({ type: "claimResult", charId, factionId, cells });
        return;
      }
      this._applyOnlineClaimResult(charId, factionId, cells);
    };

    // Per-heal event: server already healed; apply the same diff to our grid.
    this.mp.onHeal = ({ changedCells }) => {
      if (!changedCells) return;
      if (!this._onlineGridReady) {
        this._onlineEventQueue.push({ type: "heal", changedCells });
        return;
      }
      for (let i = 0; i < changedCells.length; i += 2) {
        territoryGrid.grid[changedCells[i]] = changedCells[i + 1];
      }
      this.territoryDirty = true;
    };

    // Trail vertices: append to renderer character trail so the line is visible.
    this.mp.onTrailVertex = (charId, x, z) => {
      if (!this._onlineGridReady) {
        this._onlineEventQueue.push({ type: "trail", charId, x, z });
        return;
      }
      const r = this._findRendererCharBySimId(charId);
      if (!r) return;
      r.trailVerts.push(new THREE.Vector3(x, 0, z));
      r._rebuildTrailMesh();
    };

    this.mp.onYourCharId = (charId) => {
      this.myCharId = charId;
      console.log(`[online] my char id is ${charId}`);
      // If renderer is already initialized, bind now; otherwise binding will
      // happen at the end of _initRendererFromOnlineState.
      this._bindOnlinePlayer();
    };

    // Server tagged a position discontinuity (respawn, restart, faction
    // reassignment). Clear the renderer's interpolation buffer for this char
    // so it doesn't smooth across the artificial line between old and new
    // pos, and snap the mesh directly. For the LOCAL player, also reset
    // predicted state so the soft tether resumes from the new pos rather
    // than fighting the discontinuity.
    this.mp.onTeleport = (charId, posX, posZ, dirX, dirZ, reason) => {
      this._applyTeleport(charId, posX, posZ, dirX, dirZ, reason);
    };

    this.mp.onCumulativeScore = (score) => {
      this.cumulativeScore = score;
      console.log(`[online] cumulative score from prior sessions: ${score}`);
    };

    // Server-broadcast kill: mirror the sim.onKill side effects from solo —
    // voxel-debris FX at the victim, death-screen toggle for the local player,
    // and a notification toast naming the killer/victim. The character's
    // alive=false flag arrives via the schema sync (handled by the wasAlive
    // loop in tick() for the dead→alive respawn case); this hook adds the
    // visual + HUD feedback that solo gets through sim.onKill.
    this.mp.onKill = (killerId, victimId) => {
      const victimR = this._findRendererCharBySimId(victimId);
      const killerR = killerId !== null ? this._findRendererCharBySimId(killerId) : null;
      if (!victimR) return;
      const baseY = victimR.baseY != null ? victimR.baseY : ISLAND_TOP_Y;
      this.fx.triggerKill(
        victimR.simChar.pos.x, victimR.simChar.pos.z,
        baseY, victimR.color,
      );
      victimR.onDieVisual();
      if (victimR === this.player) {
        this.killedBy = killerR ? killerR.name : "";
        if (this.deathScreen) this.deathScreen.classList.add("visible");
        this.hud.push(killerR ? `Killed by ${killerR.name}` : `Cut off`);
      } else if (killerR === this.player) {
        this.hud.push(`You killed ${victimR.name}`);
      }
      dlog("KILL", `${victimR.name} killed${killerR ? " by " + killerR.name : ""}`, {
        isPlayer: victimR.isPlayer,
      });
    };

    try {
      await this.mp.connect(name, null);
      console.log("[online] connected, sessionId =", this.mp.room.sessionId);
    } catch (err) {
      console.error("[online] connection failed:", err);
    }
  }

  // Decompress a gzip Uint8Array into an ArrayBuffer (browser-native API).
  async _inflateGzip(bytes) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }

  // Replay any claim/heal/trail events that arrived before the snapshot was
  // applied. After flush, _onlineGridReady becomes true and subsequent events
  // apply directly without queueing.
  _flushOnlineEventQueue() {
    this._onlineGridReady = true;
    const queue = this._onlineEventQueue;
    this._onlineEventQueue = [];
    for (const ev of queue) {
      if (ev.type === "claimResult") {
        this._applyOnlineClaimResult(ev.charId, ev.factionId, ev.cells);
      } else if (ev.type === "claim") {
        if (ev.replayTrail && ev.trailPoints && ev.trailPoints.length >= 2) {
          this._applyOnlineClaim(ev.charId, ev.trailPoints, ev.factionId);
        } else {
          this._clearOnlineCharTrail(ev.charId);
        }
      } else if (ev.type === "heal") {
        for (let i = 0; i < ev.changedCells.length; i += 2) {
          territoryGrid.grid[ev.changedCells[i]] = ev.changedCells[i + 1];
        }
        this.territoryDirty = true;
      } else if (ev.type === "trail") {
        const r = this._findRendererCharBySimId(ev.charId);
        if (r) {
          r.trailVerts.push(new THREE.Vector3(ev.x, 0, ev.z));
          r._rebuildTrailMesh();
        }
      }
    }
    if (queue.length > 0) console.log(`[online] flushed ${queue.length} buffered events`);
  }

  // Apply a server-authoritative claim cell-diff: write each cell to the
  // local grid (faction owner) and clear the claimer's renderer trail mesh.
  // No algorithm rerun, no compute spike on the client.
  _applyOnlineClaimResult(charId, factionId, cells) {
    if (!cells) return;
    // cells may arrive as a typed array (Int32Array) or a plain array.
    const grid = territoryGrid.grid;
    const len = cells.length;
    for (let i = 0; i < len; i++) {
      grid[cells[i]] = factionId;
    }
    // Keep the local sim's faction id in sync (server is authoritative).
    const simChar = this.sim.characters[charId];
    if (simChar) {
      simChar.factionId = factionId;
      simChar.trailVerts = [];
    }
    this._clearOnlineCharTrail(charId);
    this.territoryDirty = true;
    this._emitOnlineClaimFX(charId, factionId);
  }

  _clearOnlineCharTrail(charId) {
    const r = this._findRendererCharBySimId(charId);
    if (r) r._clearTrail();
  }

  _findRendererCharBySimId(simCharId) {
    for (const r of this.characters) {
      if (r.simChar && r.simChar.id === simCharId) return r;
    }
    return null;
  }

  // Apply a server-broadcast teleport: clear the renderer's interpolation
  // buffer, snap the mesh to the new pos/dir, and (for the local player)
  // reset predicted state so the soft tether resumes from the new pos
  // instead of pulling toward the OLD pre-teleport pos.
  // Reasons: "respawn" (death-respawn), "restart" (round reset), "reassign"
  // (faction eliminated, char moved to a new faction's spawn).
  _applyTeleport(charId, posX, posZ, dirX, dirZ, reason) {
    console.log(`[teleport] ${reason} ${charId} ${posX.toFixed(1)} ${posZ.toFixed(1)}`);
    const r = this._findRendererCharBySimId(charId);
    if (!r) return;
    // Clear the snapshot interpolation buffer so we don't lerp from the
    // pre-teleport pos to the new one.
    r.posBuffer = [];
    r._lastSchemaPosX = null;
    r._lastSchemaPosZ = null;
    // Snap mesh + internal vectors directly.
    r.group.position.x = posX;
    r.group.position.z = posZ;
    r.group.rotation.y = Math.atan2(dirX, dirZ);
    r.pos.set(posX, 0, posZ);
    r.dir.set(dirX, 0, dirZ);
    // Override the local-player visual lerp once so this frame snaps cleanly
    // to the new pos rather than sliding 30% of the way each frame from the
    // OLD position.
    r._snapNextFrame = true;
    // Local player: reset prediction state so the input-replay reconciliation
    // doesn't try to evolve the OLD predicted pos forward; instead we resync
    // to the teleport pos and start replay fresh from the next ack.
    if (charId === this.myCharId && this.predicted) {
      this.predicted.posX = posX;
      this.predicted.posZ = posZ;
      this.predicted.dirX = dirX || this.predicted.dirX;
      this.predicted.dirZ = dirZ || this.predicted.dirZ;
      // Drop pending inputs — they were aimed at the pre-teleport position
      // and replaying them onto the new pos would slide the player off-spawn.
      if (this.mp) {
        this.mp.inputBuffer = [];
        // The next ack we receive will be for an input sent BEFORE the
        // teleport — but the server pos at that seq corresponds to wherever
        // the server placed us post-teleport. Bumping _lastAckedSeq to the
        // current seq prevents a stale-replay from clobbering predicted.
        this._lastAckedSeq = this.mp.inputSeq;
      }
    }
  }

  // Replay a server-broadcast claim on the client by running the local sim's
  // claim() against the shared grid. Uses the matching sim character (id-keyed)
  // so faction logic uses the right faction id.
  _applyOnlineClaim(charId, trailPoints, factionId) {
    const simChar = this.sim.characters[charId];
    if (!simChar) return;
    // Reconstruct trailVerts on the sim char from the flat [x, z, x, z, ...] array.
    simChar.trailVerts = [];
    for (let i = 0; i < trailPoints.length; i += 2) {
      simChar.trailVerts.push({ x: trailPoints[i], z: trailPoints[i + 1] });
    }
    // Server may have reassigned faction — sync.
    simChar.factionId = factionId;
    // Run sim.claim() against the aliased grid. With onClaim/onHeal nulled out,
    // this won't re-broadcast; it'll just mutate territoryGrid.grid in place.
    this.sim.claim(simChar);
    // Clear renderer trail mesh — claim consumed the trail.
    const r = this._findRendererCharBySimId(charId);
    if (r) r._clearTrail();
    this.territoryDirty = true;
    this._emitOnlineClaimFX(charId, factionId);
  }

  // Mirror solo's sim.onClaim side effects: wave-ripple FX at the claimer's
  // current position + notification toast for the local player. Used by both
  // the small-claim (claimResult cell-diff) and large-claim (algorithm replay)
  // online paths so the visual feedback matches solo regardless of payload.
  _emitOnlineClaimFX(charId, factionId) {
    const r = this._findRendererCharBySimId(charId);
    if (!r) return;
    const x = r.simChar.pos.x, z = r.simChar.pos.z;
    this.fx.triggerClaim(x, z);
    if (r === this.player && this.factionManager) {
      const faction = this.factionManager.getAllFactions().find(f => f.id === factionId);
      const fname = faction ? faction.name : `F${factionId}`;
      this.hud.push(`Claimed for ${fname}`);
    }
    dlog("CLAIM", `${r.name}: claimed (mp)`, { charId });
  }

  _initRendererFromOnlineState(state) {
    // Online mode: keep a local Simulation around so we can re-run claim() to
    // mutate the shared territoryGrid.grid in lockstep with the server. We
    // never call sim.tick() in online mode — only sim.claim() on incoming
    // claim events, against a grid alias shared with territoryGrid.
    this.sim.start();
    // Alias the renderer's territoryGrid.grid to sim.grid so the texture
    // rasterizer reads the same buffer that sim.claim() writes. The server's
    // gridSnapshot message will overwrite this with authoritative data.
    territoryGrid.grid = this.sim.grid;
    territoryGrid.totalArenaCells = this.sim.totalArenaCells;
    // If a gridSnapshot arrived before the schema state, apply it now.
    if (this._pendingSnapshot) {
      territoryGrid.grid.set(this._pendingSnapshot);
      this._pendingSnapshot = null;
      this._flushOnlineEventQueue();
      console.log("[online] applied buffered gridSnapshot after state init");
    }
    // Suppress event re-emission on the client: we don't want our local
    // sim.claim() to fire onClaim/onHeal again (we already applied them).
    this.sim.onClaim = null;
    this.sim.onHeal = null;

    // Build adapter objects that look like the solo factionManager /
    // matchManager / scoreTracker, but proxy to the schema state. The renderer
    // Character + UIManager are unchanged; only the data sources differ.
    const game = this;
    this.factionManager = {
      getAllFactions() {
        const allChars = Array.from(game.mp.room.state.characters);
        return Array.from(game.mp.room.state.factions).map(f => {
          const fChars = allChars.filter(c => c.factionId === f.id);
          return {
            id: f.id,
            name: FACTION_NAMES[f.id - 1] ?? `F${f.id}`,
            color: FACTION_COLORS[f.id - 1] ?? 0xffffff,
            territoryPct: f.territoryPct,
            alive: f.alive,
            endangered: f.endangered,
            aliveCount: fChars.filter(c => c.alive).length,
            totalCount: fChars.length,
          };
        });
      },
    };
    this.matchManager = {
      getTimeString() {
        const t = game.mp.room.state.timeRemaining || 0;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
      },
      get timeRemaining() { return game.mp.room.state.timeRemaining; },
      get phase() { return game.mp.room.state.phase; },
      get winner() {
        const phase = game.mp.room.state.phase;
        // Server transitions to "intermission" right after the round ends —
        // we still want to show the winner banner during intermission.
        if (phase !== "ended" && phase !== "intermission") return null;
        const factions = game.factionManager.getAllFactions();
        return factions.slice().sort((a, b) => b.territoryPct - a.territoryPct)[0] ?? null;
      },
    };
    // The scoreTracker adapter operates on the renderer-side proxy chars
    // (simChar) which are the same objects passed to UIManager.setPlayer.
    // entry.char === this.player comparisons therefore work the same way as
    // they do in solo, where the player key is the sim Character instance.
    this.scoreTracker = {
      getScore(char) {
        const id = char?.id;
        if (id == null) return { total: 0, captures: 0, kills: 0, claims: 0, cellsCaptured: 0, deaths: 0 };
        const cs = game.mp.room.state.characters.find(c => c.id === id);
        if (!cs) return { total: 0, captures: 0, kills: 0, claims: 0, cellsCaptured: 0, deaths: 0 };
        return {
          total: cs.score,
          captures: 0,
          kills: cs.killCount,
          claims: 0,
          cellsCaptured: cs.cellsCaptured ?? 0,
          deaths: cs.deaths ?? 0,
        };
      },
      getLeaderboard() {
        const chars = Array.from(game.mp.room.state.characters);
        return chars
          .slice()
          .sort((a, b) => b.score - a.score)
          .map(cs => {
            const rChar = game.characters.find(rc => rc.simChar?.id === cs.id);
            return {
              char: rChar?.simChar ?? null,
              total: cs.score,
              captures: 0,
              kills: cs.killCount,
              claims: 0,
              cellsCaptured: cs.cellsCaptured ?? 0,
              deaths: cs.deaths ?? 0,
            };
          })
          .filter(e => e.char != null);
      },
      getPlayerRankInFaction(char) {
        const id = char?.id;
        if (id == null) return -1;
        const target = game.mp.room.state.characters.find(c => c.id === id);
        if (!target) return -1;
        const sameFaction = Array.from(game.mp.room.state.characters)
          .filter(c => c.factionId === target.factionId)
          .sort((a, b) => b.score - a.score);
        return sameFaction.findIndex(c => c.id === id) + 1;
      },
    };

    // Build renderer Characters wrapping each Colyseus CharacterSchema via
    // a sim-shaped proxy.
    for (const schemaChar of state.characters) {
      const proxy = makeOnlineCharProxy(schemaChar);
      const color = FACTION_COLORS[schemaChar.factionId - 1] ?? 0x808080;
      // No human player yet (Task 17); mark all as non-player so input ignores them.
      const r = new Character(this.scene, proxy, color, false);
      this.characters.push(r);
      this._charBySim.set(proxy, r);
    }

    // Placeholder: use first character as a non-input "player" so existing
    // camera/HUD code that reads this.player.pos doesn't crash. The actual
    // human takeover lands in Task 17.
    if (this.characters.length > 0) {
      this.player = this.characters[0];
      this.player.isPlayer = false;
    }

    this._createTerritoryTexture();
    this._updateTerritoryTexture();

    // Instantiate UIManager with the schema-backed adapters. The minimap
    // reads territoryGrid.grid (now aliased to sim.grid), which is kept in
    // sync by the gridSnapshot + claimResult/heal events.
    this.uiManager = new UIManager(
      this.factionManager, this.matchManager, this.scoreTracker,
      territoryGrid.grid, GRID_SIZE, GRID_SENTINEL,
    );

    // Camera: orbit the arena center until we have a real player char.
    const spawn = this.player
      ? { x: this.player.simChar.pos.x, z: this.player.simChar.pos.z }
      : { x: 0, z: 0 };
    this.camera.position.set(spawn.x, CAMERA_HEIGHT, spawn.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(spawn.x, TERRITORY_Y, spawn.z);
    this.camCurrent.set(spawn.x, 0, spawn.z);
    this.camTarget.copy(this.camCurrent);

    this.started = true;
    console.log(`[online] renderer initialized with ${this.characters.length} characters`);

    // Vibe Jam 2026 portals — webring (https://vibej.am/2026#portals).
    // Mirrors the solo-mode init in start(): green exit always visible; red
    // start portal only when the player arrived via ?portal=true. Wires the
    // player-state callbacks so the portals can forward username/team/color
    // through to the next game in the webring.
    this.portalLayer = new THREE.Group();
    this.scene.add(this.portalLayer);
    initVibeJamPortals({
      scene: this.portalLayer,
      getPlayer: () => this.player?.group ?? null,
      spawnPoint:   { x: -ARENA_RADIUS + 1, y: 1, z: 0 }, // start (red) — west edge
      exitPosition: { x:  ARENA_RADIUS - 1, y: 1, z: 0 }, // exit (green) — east edge
      getUsername: () => this.playerName || null,
      getColor: () => {
        const fid = this.player?.simChar?.factionId;
        return (fid != null && fid > 0) ? (FACTION_COLORS[fid - 1] ?? null) : null;
      },
      getSpeed: () => PLAYER_SPEED,
      getTeam: () => {
        const fid = this.player?.simChar?.factionId;
        return (fid != null && fid > 0) ? (FACTION_NAMES[fid - 1] ?? null) : null;
      },
      getHp: () => (this.player?.alive ? 100 : 1),
    });

    // If yourCharId already arrived, bind the local player now.
    this._bindOnlinePlayer();
  }

  // Bind the local human player to the renderer Character whose simChar.id
  // matches this.myCharId. Called both when myCharId arrives and after the
  // online renderer state initializes — whichever happens last triggers the
  // actual binding. Safe to call multiple times.
  _bindOnlinePlayer() {
    if (this.myCharId == null || !this.characters || this.characters.length === 0) return;
    const rChar = this.characters.find(c => c.simChar?.id === this.myCharId);
    if (!rChar) return;
    rChar.isPlayer = true;
    this.player = rChar;
    // Wire UI to the local player char. UIManager indexes player by reference;
    // pass the simChar proxy so leaderboard equality (entry.char === player)
    // matches the same proxy returned by getLeaderboard().
    if (this.uiManager) this.uiManager.setPlayer(rChar.simChar);
    // Initialize client-side prediction state from current schema. The
    // renderer character will read pos/dir from `predicted` instead of the
    // schema; we reconcile each frame against the authoritative server pos.
    const sc = rChar.simChar;
    this.predicted = {
      posX: sc.pos.x,
      posZ: sc.pos.z,
      dirX: sc.dir.x || 0,
      dirZ: sc.dir.z || 1,
    };
    rChar.predicted = this.predicted;
    // Last server-acked input seq we processed. We only run reconciliation
    // when this advances (otherwise the server hasn't seen any new input
    // and our prediction is still consistent with what they'll compute).
    this._lastAckedSeq = 0;
    // One-shot flag: when true, the visual lerp on the local player is
    // skipped for this frame and the mesh snaps directly to the predicted
    // pos (used for teleport events: respawn, restart, faction reassign).
    rChar._snapNextFrame = true;
    console.log(`[online] bound player to char ${this.myCharId}`);
  }

  // Integrate a single input through one prediction step using the same math
  // as Simulation._stepCharacter (TURN_SPEED steer, PLAYER_SPEED advance,
  // arena clamp). `state` is mutated in place. `dt` is the duration this
  // input was active for. Used during input-replay reconciliation.
  _integrateInput(state, dirX, dirZ, dt) {
    const tlen = Math.hypot(dirX, dirZ);
    if (tlen > 1e-6) {
      const ca = Math.atan2(state.dirX, state.dirZ);
      const ta = Math.atan2(dirX / tlen, dirZ / tlen);
      let diff = ta - ca;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-TURN_SPEED * dt, Math.min(TURN_SPEED * dt, diff));
      const na = ca + turn;
      state.dirX = Math.sin(na);
      state.dirZ = Math.cos(na);
    }
    state.posX += state.dirX * PLAYER_SPEED * dt;
    state.posZ += state.dirZ * PLAYER_SPEED * dt;
    const r = Math.hypot(state.posX, state.posZ);
    if (r > ARENA_RADIUS) {
      const inv = ARENA_RADIUS / r;
      state.posX *= inv;
      state.posZ *= inv;
    }
  }

  // Client-side prediction + server-confirmed reconciliation for the local
  // online player.
  //
  // Quake-style scheme:
  //   1. Each input is tagged with a monotonically increasing seq (mp.sendInput).
  //   2. Server applies inputs at 30Hz and echoes the latest applied seq via
  //      schemaChar.lastAppliedInputSeq.
  //   3. When that seq advances, we KNOW the server's posX/posZ reflects the
  //      world AFTER input N was applied. Reset predicted = server pos at N,
  //      then replay every unacked input N+1..now through _integrateInput to
  //      derive the correct present-time predicted pos. This eliminates the
  //      drift between client prediction and server truth that the old
  //      soft-tether produced when latency varied.
  //   4. Even when no new ack arrives this frame, advance predicted by dt with
  //      the current targetDir so motion stays smooth between server updates.
  _stepPrediction(dt) {
    if (this.mode !== "online") return;
    if (!this.player || !this.predicted) return;
    if (!this.player.alive) return;

    const sc = this.player.simChar;
    const ackedSeq = sc._schemaChar?.lastAppliedInputSeq ?? 0;

    if (ackedSeq > this._lastAckedSeq) {
      // Snapshot pre-reconciliation pos so we can detect a large jump and
      // snap the visual rather than lerping (which would slide for 100+ms).
      const prevPosX = this.predicted.posX;
      const prevPosZ = this.predicted.posZ;

      // Server has confirmed up to ackedSeq. Reset to server's authoritative
      // pos AT that seq, then replay any inputs after it.
      this.predicted.posX = sc.pos.x;
      this.predicted.posZ = sc.pos.z;
      this.predicted.dirX = sc.dir.x || this.predicted.dirX;
      this.predicted.dirZ = sc.dir.z || this.predicted.dirZ;

      // Drop confirmed inputs from the buffer so what remains is purely the
      // pending tail (seq > ackedSeq).
      if (this.mp) this.mp.ackInputs(ackedSeq);

      // Replay each pending input. Each represents one server-tick worth of
      // simulation, so use the server tick interval as dt for the integration.
      // (Slight imprecision OK — the next ack will correct it.)
      // Cap the replay length: if the inputBuffer has accumulated many
      // entries (server stall / reconnect window), replaying all of them
      // produces a huge predicted jump. Cap at 10 ticks (~333ms of motion),
      // which is much longer than any real ack latency we care about.
      const tickDt = this._inputSendInterval; // 1/30
      const buf = this.mp ? this.mp.inputBuffer : [];
      const REPLAY_CAP = 10;
      const replayStart = Math.max(0, buf.length - REPLAY_CAP);
      for (let i = replayStart; i < buf.length; i++) {
        const inp = buf[i];
        this._integrateInput(this.predicted, inp.dirX, inp.dirZ, tickDt);
      }

      this._lastAckedSeq = ackedSeq;

      // If the predicted-state reset jumped by an unreasonable amount,
      // snap the visual mesh instead of lerping. This prevents a long
      // visible slide after a server-side discontinuity (cutoff death's
      // hold-then-respawn before the teleport event arrives, a delayed
      // teleport broadcast, or a server tick stall that broadcasts a big
      // pos delta in a single state patch).
      const jumpSq =
        (this.predicted.posX - prevPosX) * (this.predicted.posX - prevPosX) +
        (this.predicted.posZ - prevPosZ) * (this.predicted.posZ - prevPosZ);
      // 2 world units = ~6 cells = noticeable jump that shouldn't lerp.
      if (jumpSq > 4 && this.player) {
        this.player._snapNextFrame = true;
      }
    }

    // Forward-extrapolate predicted by dt with the latest targetDir so the
    // player sees instant response between acks (and between input sends).
    this._integrateInput(
      this.predicted,
      this.player.targetDir.x,
      this.player.targetDir.z,
      dt,
    );
  }

  start(name) {
    this.playerName = name;
    this.started = true;

    // Boot the authoritative simulation. This initializes the grid, factions,
    // creates plain-data characters for every faction slot, and starts the match.
    this.sim.start();

    // Alias: existing renderer code (texture rasterizer, minimap, contour
    // extraction) reads from territoryGrid.grid, so point it at the sim's grid.
    territoryGrid.grid = this.sim.grid;
    territoryGrid.totalArenaCells = this.sim.totalArenaCells;

    // Alias the public managers so the rest of main.js + UIManager keep working.
    this.factionManager = this.sim.factionManager;
    this.matchManager = this.sim.matchManager;
    this.scoreTracker = this.sim.scoreTracker;

    window._factionManager = this.factionManager;
    window._scoreTracker = this.scoreTracker;
    window._game = this;

    // Pick the player's faction at random; the player takes the first sim char
    // belonging to that faction.
    const playerFactionId = Math.floor(Math.random() * FACTION_COUNT) + 1;
    let playerSimChar = null;
    for (const sc of this.sim.characters) {
      if (sc.factionId === playerFactionId) { playerSimChar = sc; break; }
    }
    if (!playerSimChar) playerSimChar = this.sim.characters[0]; // safety
    playerSimChar.name = name;
    // Solo: ensure no bot shares the player's name. Pull a fresh name from
    // BOT_NAMES that nobody else is using; fallback to "Bot-{id}" if the pool
    // is exhausted. (Online does the equivalent server-side in handleHello.)
    {
      const used = new Set(this.sim.characters.map(c => (c.name || "").toLowerCase()));
      for (const c of this.sim.characters) {
        if (c === playerSimChar) continue;
        if ((c.name || "").toLowerCase() === name.toLowerCase()) {
          const fresh = BOT_NAMES.find(n => !used.has(n.toLowerCase())) ?? `Bot-${c.id}`;
          used.delete((c.name || "").toLowerCase());
          used.add(fresh.toLowerCase());
          c.name = fresh;
        }
      }
    }

    // Build renderer Characters wrapping each sim Character.
    for (const sc of this.sim.characters) {
      const isPlayer = (sc === playerSimChar);
      const color = FACTION_COLORS[sc.factionId - 1];
      const r = new Character(this.scene, sc, color, isPlayer);
      this.characters.push(r);
      this._charBySim.set(sc, r);
      if (isPlayer) {
        this.player = r;
        this.sim.setHumanControl(sc.id, true);
      }
    }

    this.uiManager = new UIManager(
      this.factionManager, this.matchManager, this.scoreTracker,
      territoryGrid.grid, GRID_SIZE, GRID_SENTINEL
    );
    // UIManager reads .pos.{x,z}, .alive, .factionId — sim Character has them.
    // Score lookups key on simChar (sim.scoreTracker.register registers simChars).
    this.uiManager.setPlayer(this.player.simChar);

    this._createTerritoryTexture();
    this._updateTerritoryTexture();

    const playerSpawn = { x: playerSimChar.pos.x, z: playerSimChar.pos.z };
    this.camera.position.set(playerSpawn.x, CAMERA_HEIGHT, playerSpawn.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(playerSpawn.x, TERRITORY_Y, playerSpawn.z);
    this.camCurrent.set(playerSpawn.x, 0, playerSpawn.z);
    this.camTarget.copy(this.camCurrent);

    // Vibe Jam 2026 portals — webring (https://vibej.am/2026#portals).
    // Exit portal (green) always visible; start portal (red) only if the
    // player arrived via ?portal=true. Lives in its own scene group so it's
    // visually distinct from the territory plane.
    this.portalLayer = new THREE.Group();
    this.scene.add(this.portalLayer);
    initVibeJamPortals({
      scene: this.portalLayer,
      getPlayer: () => this.player?.group ?? null,
      spawnPoint:   { x: -ARENA_RADIUS + 1, y: 1, z: 0 }, // start (red) — west edge (very edge)
      exitPosition: { x:  ARENA_RADIUS - 1, y: 1, z: 0 }, // exit (green) — east edge (very edge)
      // Player-state callbacks — supply live values so portals can forward
      // username, faction color, speed, team, and hp in query params.
      getUsername: () => this.playerName || null,
      getColor: () => {
        // Faction color as a THREE hex integer (e.g. 0xE74A3F).
        // factionId is 1-based; FACTION_COLORS is 0-indexed.
        const fid = this.player?.simChar?.factionId;
        return (fid != null && fid > 0) ? (FACTION_COLORS[fid - 1] ?? null) : null;
      },
      getSpeed: () => PLAYER_SPEED,
      getTeam: () => {
        const fid = this.player?.simChar?.factionId;
        return (fid != null && fid > 0) ? (FACTION_NAMES[fid - 1] ?? null) : null;
      },
      getHp: () => (this.player?.alive ? 100 : 1),
    });
  }

  tick(dt) {
    if (!this.started) return;

    // ---- Player input: collect WASD + mouse → player.targetDir in any mode. ----
    // Frozen during the FIRST TWO PHASES of the respawn cinematic (camera
    // approach + hold-at-spawn). Once the zoom-back-out begins (phase 3 at
    // t≥0.65), the player regains control while the camera smoothly returns.
    // This keeps the "freshly respawned, not moving" feel of the cinematic
    // without locking the player out for the full 2 seconds.
    const cinFreezeInput = this._respawnCinematic
      && (performance.now() - this._respawnCinematic.startTime) < 1300;
    if (this.player && this.player.alive && this.player.isPlayer) {
      if (cinFreezeInput) {
        // Input frozen: zero the target direction so the sim doesn't move the
        // player from whatever direction was held at the moment of respawn.
        this.player.targetDir.set(0, 0, 0);
        if (this.mode === "solo") {
          this.sim.setTargetDir(this.player.simChar.id, 0, 0);
        } else if (this.mode === "online" && this.mp) {
          this._inputSendAccum += dt;
          if (this._inputSendAccum >= this._inputSendInterval) {
            this._inputSendAccum = 0;
            this.mp.sendInput(0, 0);
          }
        }
      } else {
        let kx = 0, kz = 0;
        if (this.keysDown.has("w") || this.keysDown.has("arrowup")) kz -= 1;
        if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) kz += 1;
        if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) kx -= 1;
        if (this.keysDown.has("d") || this.keysDown.has("arrowright")) kx += 1;
        if (kx !== 0 || kz !== 0) {
          this.player.targetDir.set(kx, 0, kz).normalize();
        } else if (this.hasMouseInput) {
          this.hasMouseInput = false;
          this.raycaster.setFromCamera(this.mouseNDC, this.camera);
          const hit = new THREE.Vector3();
          if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
            const dx = hit.x - this.player.pos.x;
            const dz = hit.z - this.player.pos.z;
            if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
              this.player.targetDir.set(dx, 0, dz).normalize();
            }
          }
        }
        if (this.mode === "solo") {
          this.sim.setTargetDir(this.player.simChar.id, this.player.targetDir.x, this.player.targetDir.z);
        } else if (this.mode === "online" && this.mp) {
          // Throttle send to 20 Hz (server tick rate).
          this._inputSendAccum += dt;
          if (this._inputSendAccum >= this._inputSendInterval) {
            this._inputSendAccum = 0;
            this.mp.sendInput(this.player.targetDir.x, this.player.targetDir.z);
          }
        }
      }
    }

    // Bot AI lives entirely inside sim.tick() now (sim/BotAI.js).

    // Track per-char alive state from previous frame so we can fire visual
    // hooks when sim respawns or kills a character.
    const wasAlive = new Map();
    for (const c of this.characters) wasAlive.set(c, c.alive);

    // ---- Run authoritative sim tick (solo mode only; online state arrives
    // via Colyseus). Event hooks (onClaim, onTrailVertex, onKill, onHeal)
    // fire during this call. ----
    if (this.mode === "solo") {
      this.sim.tick(dt);
    } else if (this.mode === "online") {
      // Client-side prediction for the local player only — eliminates the
      // input-roundtrip lag while server reconciliation snaps any drift.
      this._stepPrediction(dt);
    }

    // Match ended (or in intermission for multiplayer): still update visuals/
    // HUD then bail out (but tick FX + water).
    const _matchPhase = this.matchManager && this.matchManager.phase;
    // Reset the one-shot win FX guard when a new round starts.
    if (_matchPhase === "playing" && this._winFXFired) {
      this._winFXFired = false;
    }
    if (_matchPhase === "ended" || _matchPhase === "intermission") {
      // Win FX (one-shot): fire voxel-rain in the winner's color.
      if (!this._winFXFired) {
        this._winFXFired = true;
        const winner = this.matchManager.winner;
        if (winner) {
          this.fx.triggerWin(winner.color);
          this.hud.showBanner(`${(winner.name || "WINNER").toUpperCase()} WINS`,
                              `win-${winner.id}`, 3500);
        }
      }
      for (const c of this.characters) c.syncVisuals();
      this._updateLabels();
      if (this.uiManager) this.uiManager.update(dt);
      this._maybeRebuildTerritory(dt);
      this.fx.update(dt);
      if (this._waterMat) this._waterMat.uniforms.uTime.value += dt;
      if (this._territoryMat) this._territoryMat.uniforms.uTime.value += dt;
      this.hud.updateNotificationAnchor();
      return;
    }

    // ---- Sync renderer-side state from sim/schema ----
    for (const c of this.characters) {
      const wasAliveBefore = wasAlive.get(c);
      const isAliveNow = c.alive;

      // Detect respawn: was dead, is alive now -> visual respawn hook.
      if (!wasAliveBefore && isAliveNow) {
        // Faction may have changed (reassignment); recolor the mesh.
        const newFactionId = c.simChar.factionId;
        if (newFactionId !== c.factionId) {
          const newColor = FACTION_COLORS[newFactionId - 1];
          c.color = newColor;
          c.factionId = newFactionId;
          c.group.children.forEach(child => {
            if (child.material && child.material.color) child.material.color.setHex(newColor);
          });
          if (c === this.player && this.uiManager) this.uiManager.setPlayer(this.player.simChar);
          if (c === this.player) {
            const fname = FACTION_NAMES[newFactionId - 1] ?? `F${newFactionId}`;
            this.hud.push(`Reassigned to ${fname} Team`);
          }
          dlog("REASSIGN", `${c.name} reassigned to faction ${newFactionId}`);
        }
        c.onRespawnVisual();
        // Theme F build-up FX: animate the character group up from below.
        const baseY = c.baseY != null ? c.baseY : (ISLAND_TOP_Y + 0.05);
        this.fx.triggerRespawn(c.group, baseY, c.simChar.pos.x, c.simChar.pos.z);
        if (c === this.player && this.deathScreen) this.deathScreen.classList.remove("visible");
        if (c === this.player) this.hud.push("You spawned (invuln 5s)");
        // Juice: 2-second cinematic on local player respawn.
        // Phase 1 [0–700ms]: camera moves to spawn + zooms in to 0.45.
        // Phase 2 [700–1300ms]: hold (build-up FX plays).
        // Phase 3 [1300–2000ms]: zoom back out + follow player normally.
        // Input is frozen for the full duration (handled in the input block).
        if (c === this.player) {
          this._respawnCinematic = {
            startTime: performance.now(),
            savedZoom: this._cameraZoomTarget,
            oldCamX: this.camCurrent.x,
            oldCamZ: this.camCurrent.z,
            spawnX: c.simChar.pos.x,
            spawnZ: c.simChar.pos.z,
          };
        }
        dlog("RESPAWN", `${c.name} respawned`, { x: c.simChar.pos.x.toFixed(1), z: c.simChar.pos.z.toFixed(1) });
      }

      c.syncVisuals();

      // Self-correcting visual cleanup: if the character is alive and standing
      // in their own territory, the renderer trail must be empty.  This catches
      // the case where the sim discards a short trail (<5 verts) without firing
      // onClaim, so the renderer never got a _clearTrail() notification.
      if (isAliveNow && c.trailVerts.length > 0) {
        const wx = c.simChar.pos.x;
        const wz = c.simChar.pos.z;
        const gx = Math.floor((wx - WORLD_MIN) / CELL_SIZE);
        const gz = Math.floor((wz - WORLD_MIN) / CELL_SIZE);
        if (gx >= 0 && gx < GRID_SIZE && gz >= 0 && gz < GRID_SIZE) {
          const cellOwner = territoryGrid.grid[gz * GRID_SIZE + gx];
          if (cellOwner === c.simChar.factionId) {
            c._clearTrail();
          }
        }
      }
    }

    // Texture refresh if grid changed this tick (throttled to ~10 Hz).
    this._maybeRebuildTerritory(dt);

    // ---- Camera ----
    if (this._respawnCinematic) {
      // Respawn cinematic overrides normal camera follow.
      // t: normalised progress [0..1] over the 2000ms window.
      const cin = this._respawnCinematic;
      const elapsed = performance.now() - cin.startTime;
      const t = Math.min(elapsed / 2000, 1.0);

      // Smoothstep helper for eased transitions.
      const ss = x => x * x * (3 - 2 * x);

      if (t < 0.35) {
        // Phase 1: approach spawn + zoom in.
        const p = ss(t / 0.35);
        const camX = cin.oldCamX + (cin.spawnX - cin.oldCamX) * p;
        const camZ = cin.oldCamZ + (cin.spawnZ - cin.oldCamZ) * p;
        const zoomVal = cin.savedZoom + (0.45 - cin.savedZoom) * p;
        this._cameraZoom = zoomVal;
        this._cameraZoomTarget = zoomVal;
        this.camCurrent.set(camX, 0, camZ);
        this.camTarget.set(camX, 0, camZ);
      } else if (t < 0.65) {
        // Phase 2: hold at spawn zoomed in (build-up FX plays).
        this._cameraZoom = 0.45;
        this._cameraZoomTarget = 0.45;
        this.camCurrent.set(cin.spawnX, 0, cin.spawnZ);
        this.camTarget.set(cin.spawnX, 0, cin.spawnZ);
      } else {
        // Phase 3: zoom back out + follow player position.
        const p = ss((t - 0.65) / 0.35);
        const zoomVal = 0.45 + (cin.savedZoom - 0.45) * p;
        this._cameraZoom = zoomVal;
        this._cameraZoomTarget = zoomVal;
        // Let camTarget track the player so the follow is live.
        if (this.player && this.player.alive) {
          this.camTarget.set(this.player.pos.x, TERRITORY_Y, this.player.pos.z);
        }
        const smooth3 = 1 - Math.pow(0.03, dt);
        this.camCurrent.lerp(this.camTarget, smooth3);
      }

      if (t >= 1.0) {
        // Cinematic complete — restore user's zoom target and resume normal follow.
        this._cameraZoomTarget = cin.savedZoom;
        this._respawnCinematic = null;
        dlog("CINEMATIC", "respawn cinematic complete");
      }

      const zoom = this._cameraZoom;
      this.camera.position.set(this.camCurrent.x, CAMERA_HEIGHT * zoom, this.camCurrent.z + CAMERA_Z_OFFSET * zoom);
      this.camera.lookAt(this.camCurrent.x, TERRITORY_Y, this.camCurrent.z);
    } else {
      // Normal camera follow.
      if (this.player && this.player.alive && this.player.isPlayer) {
        this.camTarget.set(this.player.pos.x, TERRITORY_Y, this.player.pos.z);
      }
      const smooth = 1 - Math.pow(0.03, dt);
      this.camCurrent.lerp(this.camTarget, smooth);
      // Smooth zoom: lerp the current zoom factor toward the user-requested target.
      this._cameraZoom += (this._cameraZoomTarget - this._cameraZoom) * 0.15;
      const zoom = this._cameraZoom;
      this.camera.position.set(this.camCurrent.x, CAMERA_HEIGHT * zoom, this.camCurrent.z + CAMERA_Z_OFFSET * zoom);
      this.camera.lookAt(this.camCurrent.x, TERRITORY_Y, this.camCurrent.z);
    }

    if (this.shadowLight) {
      this.shadowLight.position.set(this.camCurrent.x + 5, 15, this.camCurrent.z + 5);
      this.shadowLight.target.position.set(this.camCurrent.x, 0, this.camCurrent.z);
      this.shadowLight.target.updateMatrixWorld();
    }

    // ---- Labels & UI ----
    this._updateLabels();
    if (this.uiManager) this.uiManager.update(dt);

    // ---- Theme F overlays + water shader ----
    this.fx.update(dt);
    if (this._waterMat) this._waterMat.uniforms.uTime.value += dt;
    if (this._territoryMat) this._territoryMat.uniforms.uTime.value += dt;
    this.hud.updateNotificationAnchor();
    // Faction-state banners (D wooden stamp): poll once/frame, fire on transitions.
    this._pollFactionBanners();
    // Top-player categories (killer / land grabber / survivor): poll once/frame.
    this._pollTopPlayers();
    // Countdown intensification: D blocky-flip pulses last 9 seconds.
    if (this.matchManager && this.matchManager.timeRemaining != null) {
      this.hud.setCountdownIntense(this.matchManager.timeRemaining <= 9);
    }
  }

  // Re-evaluate the three "top" categories (killer / land grabber / survivor)
  // each frame and:
  //   * cache the winning charId per category in this._topPlayers
  //   * fire a banner notification if the LOCAL player just earned an icon
  // Ties skip the category (no winner). Survivor requires deaths>0 to count
  // (otherwise everyone alive at game start is tied at 0).
  // The icons are read by _updateLabels() which prepends them to each label.
  _pollTopPlayers() {
    if (!this.scoreTracker) return;
    const lb = this.scoreTracker.getLeaderboard?.() ?? [];
    if (lb.length === 0) return;

    const pickTop = (key, lowest) => {
      let best = null;
      let bestVal = lowest ? Infinity : -Infinity;
      let tied = false;
      for (const e of lb) {
        const v = e[key] ?? 0;
        if (lowest ? v < bestVal : v > bestVal) {
          best = e;
          bestVal = v;
          tied = false;
        } else if (v === bestVal) {
          tied = true;
        }
      }
      if (!best || tied) return null;
      // For "top killer" / "top land grabber": require >0 to avoid declaring a
      // winner when nobody has scored anything yet.
      if (!lowest && bestVal <= 0) return null;
      return best.char;
    };

    const topKiller = pickTop("kills", false);
    const topGrabber = pickTop("cellsCaptured", false);
    // Survivor: lowest deaths, but only if at least one player has died
    // (otherwise the field is meaningless — everyone's at 0).
    const anyDeaths = lb.some(e => (e.deaths ?? 0) > 0);
    const topSurvivor = anyDeaths ? pickTop("deaths", true) : null;

    const prev = this._topPlayers || { killer: null, grabber: null, survivor: null };
    const next = {
      killer: topKiller ? topKiller.id : null,
      grabber: topGrabber ? topGrabber.id : null,
      survivor: topSurvivor ? topSurvivor.id : null,
    };

    // Fire a banner ONLY when the LOCAL player gains a category they didn't
    // hold last frame. Avoids spamming for bot transitions.
    const localId = this.player?.simChar?.id;
    if (localId != null) {
      if (next.killer === localId && prev.killer !== localId) {
        this.hud.showBanner("★ TOP KILLER ★", `top-killer-${localId}`, 2500);
      }
      if (next.grabber === localId && prev.grabber !== localId) {
        this.hud.showBanner("★ TOP LAND GRABBER ★", `top-grabber-${localId}`, 2500);
      }
      if (next.survivor === localId && prev.survivor !== localId) {
        this.hud.showBanner("★ TOP SURVIVOR ★", `top-survivor-${localId}`, 2500);
      }
    }

    this._topPlayers = next;
  }

  // Poll faction state each frame and fire D wooden-stamp banners on
  // endangered/eliminated/recovered transitions. The banner manager dedupes
  // by key so calling this every frame is cheap when nothing has changed.
  _pollFactionBanners() {
    if (!this.factionManager) return;
    for (const f of this.factionManager.getAllFactions()) {
      const state = !f.alive ? "eliminated"
                  : f.endangered ? "endangered"
                  : "alive";
      const prev = this._lastFactionState.get(f.id);
      if (prev != null && prev !== state) {
        const fname = (f.name || `F${f.id}`).toUpperCase();
        if (state === "endangered") {
          this.hud.showBanner(`${fname} ENDANGERED`, `endangered-${f.id}`, 2000);
        } else if (state === "eliminated") {
          this.hud.showBanner(`${fname} ELIMINATED`, `eliminated-${f.id}`, 2800);
        } else if (state === "alive" && prev === "endangered") {
          this.hud.showBanner(`${fname} RECOVERED`, `recovered-${f.id}`, 2000);
        }
      }
      this._lastFactionState.set(f.id, state);
    }
  }

  _updateLabels() {
    // Performance: hot path running once per frame for every character.
    // Optimizations:
    //  - reuse a single Vector3 instead of allocating per character per frame
    //    (was 30 alloc/frame = ~1800 alloc/sec of GC pressure)
    //  - cache the rendered name + alive flag on the label element so we only
    //    touch label.textContent / label.style.display when they change
    //  - skip off-screen labels (NDC outside [-1, 1]); also clamp by side so
    //    we don't write bogus huge .left/.top values that trigger needless
    //    layout work
    const tmp = this._labelTmpVec3 || (this._labelTmpVec3 = new THREE.Vector3());
    const cam = this.camera;
    const W = innerWidth, H = innerHeight;
    for (const c of this.characters) {
      let label = this.labels.get(c);
      if (!label) {
        label = document.createElement("div");
        label.style.cssText = "position:fixed;pointer-events:none;font-size:12px;font-weight:bold;color:#333;text-shadow:0 0 3px white;white-space:nowrap;transform:translate(-50%,-100%);z-index:5;";
        document.getElementById("ui").appendChild(label);
        label._displayed = "";
        label._cachedName = "";
        this.labels.set(c, label);
      }
      if (!c.alive) {
        if (label._displayed !== "none") {
          label.style.display = "none";
          label._displayed = "none";
        }
        continue;
      }
      tmp.set(c.group.position.x, 2.5, c.group.position.z);
      tmp.project(cam);
      // Off-screen / behind camera (z > 1) → hide.
      if (tmp.x < -1.1 || tmp.x > 1.1 || tmp.y < -1.1 || tmp.y > 1.1 || tmp.z > 1) {
        if (label._displayed !== "none") {
          label.style.display = "none";
          label._displayed = "none";
        }
        continue;
      }
      if (label._displayed !== "") {
        label.style.display = "";
        label._displayed = "";
      }
      // Prepend top-player icons (⚔️ killer, 🏆 land grabber, 🛡️ survivor).
      // _topPlayers maps category → winning charId. The icon string is rebuilt
      // only when the resulting label text changes (cheap when no transitions).
      const charId = c.simChar?.id;
      const tp = this._topPlayers;
      let prefix = "";
      if (tp && charId != null) {
        if (tp.killer === charId) prefix += "⚔️";
        if (tp.grabber === charId) prefix += "\u{1F3C6}";
        if (tp.survivor === charId) prefix += "\u{1F6E1}️";
      }
      const desired = prefix ? `${prefix} ${c.name}` : c.name;
      if (label._cachedName !== desired) {
        label.textContent = desired;
        label._cachedName = desired;
      }
      label.style.left = `${(tmp.x * 0.5 + 0.5) * W}px`;
      label.style.top = `${(-tmp.y * 0.5 + 0.5) * H}px`;
    }
  }

  // ===== Theme F scene builder =====
  // Builds the entire static visual stack: sky+fog, lights, water shader,
  // cylinder island, cliff rocks, distant atolls. Called once from the Game
  // constructor (REPLACES the old flat ground+ring setup).
  //
  // Constraints (Director rules from prior reverted Slice A):
  //   1. Cylinder TOP must be at a DIFFERENT Y than the territory mesh —
  //      territory at Y=0.05, cylinder top at Y=0.0, with polygonOffset on
  //      the territory material as a belt-and-suspenders against Z-fighting
  //      at grazing angles.
  //   2. Water animation must NEVER cross into the playable area. Two
  //      mechanisms enforce this: (a) the water plane sits 2.0 units BELOW
  //      the cylinder top, (b) the water shader DISCARDs all fragments
  //      inside ARENA_RADIUS, so even at grazing angles no wave crests can
  //      visually overlap the island.
  //   3. Total cost ≤ 3ms/frame for all new visuals — measured via stats.js
  //      MS panel (toggle with F key).
  _buildThemeFScene() {
    // ---- Sky gradient background + sea fog ----
    this.scene.background = this._makeGradientBg(0xFFD9B8, 0x8FC8DA);
    this.scene.fog = new THREE.Fog(0xBCD8DE, 80, 260);

    // ---- Lights (warm dawn + cool sea bounce) ----
    this.scene.add(new THREE.AmbientLight(0xfff0d8, 0.78));
    const dl = new THREE.DirectionalLight(0xfff2c8, 0.7);
    dl.position.set(5, 15, 5);
    dl.castShadow = true;
    // 1024² shadow map; ARENA_RADIUS=66.89 means cylinder spans 134 units.
    // Shadow camera frustum needs to cover the playable area; clamp to a
    // 90×90 box around the camera target each frame (tickShadow not done here,
    // kept stationary at origin which is acceptable for this top-down camera).
    dl.shadow.mapSize.width = 1024;
    dl.shadow.mapSize.height = 1024;
    dl.shadow.camera.near = 0.5;
    dl.shadow.camera.far = 60;
    dl.shadow.camera.left = -45;
    dl.shadow.camera.right = 45;
    dl.shadow.camera.top = 45;
    dl.shadow.camera.bottom = -45;
    dl.shadow.radius = 2;
    this.scene.add(dl);
    this.scene.add(dl.target);
    this.shadowLight = dl;
    // Cool sea-bounce fill from the opposite side (no shadows).
    const fill = new THREE.DirectionalLight(0x88B8D0, 0.18);
    fill.position.set(-3, 3, -3);
    this.scene.add(fill);

    // ---- Water (Vanta-style faceted waves, GPU shader) ----
    // Vertex displacement: Vanta's exact wave formula (extracted from
    // vanta.waves.min.js, MIT) ported to a vertex shader so it runs on GPU
    // instead of CPU (~0.3ms vs CPU-bound 1-2ms on a 1024-vert plane).
    //
    //   const i = waveSpeed; (default 1)
    //   const phase = sqrt(i) * cos(-x - 0.7 * z);
    //   const o = sin(i * t * 0.02 - i * x * 0.025 + i * z * 0.015 + phase);
    //   y = oy + pow(o + 1, 2) / 4 * waveHeight;  (waveHeight default 15)
    //
    // Wave amplitude scaled UP (1.6 vs Vanta default 15) to give the 80×80
    // plane enough per-triangle slope variance for the faceted lighting to
    // read as distinct dark/light facets — see vertex-shader comment.
    //
    // Lighting: FLAT-SHADED PER TRIANGLE. The plane has shared vertices, but
    // we recover a per-face normal in the fragment shader via dFdx/dFdy on
    // view-space position. This is Vanta's faceted low-poly trick — each
    // triangle gets one uniform color from a 2-tone Lambert mix (deep blue
    // → light blue), producing the hard-edged "crystal facet" water look.
    // No glitter, no scrolling stripes, no smooth normal interpolation.
    const waterSize = ARENA_RADIUS * 6;
    const waterGeom = new THREE.PlaneGeometry(waterSize, waterSize, 80, 80);
    // Faceted low-poly Vanta look: deep + light blue, hard-edged Lambert per
    // triangle. Colors picked from Vanta default waves preset (#0d3556 → #5093d0)
    // with contrast nudged up so each facet reads at full game scale.
    const deepColor = new THREE.Color(0x0d3556);
    const lightColor = new THREE.Color(0x5093d0);
    this._waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIslandRadius: { value: ARENA_RADIUS + 0.5 },
        uDeepColor: { value: deepColor },
        uLightColor: { value: lightColor },
        // Fixed light direction in view space — chosen so facets show clear
        // bright/dark contrast across the plane regardless of camera orbit.
        // (Using view-space dir means contrast pattern stays stable as camera
        // rotates, which matches Vanta's behavior.)
        uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() },
        uFogColor: { value: new THREE.Color(0xBCD8DE) },
        uFogNear: { value: 80.0 },
        uFogFar: { value: 260.0 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vWorldXZ;
        varying vec3 vViewPosition;
        varying float vViewDist;
        void main() {
          // Vanta's wave formula, ported from vanta.waves.min.js (MIT).
          // Plane is rotated -PI/2 around X by the host, so locally we work
          // with (position.x, position.y) which become world (x, z).
          vec3 p = position;
          float wsp = 1.0;                              // waveSpeed
          float phase = sqrt(wsp) * cos(-p.x - 0.7 * p.y);
          float o = sin(wsp * uTime * 0.02 * 60.0
                      - wsp * p.x * 0.025
                      + wsp * p.y * 0.015
                      + phase);
          // (uTime is in seconds; Vanta's t was a frame counter that
          // incremented by ~1/frame at 60fps, so * 60 to match cadence.)
          float n = pow(o + 1.0, 2.0) / 4.0;
          // Wave amplitude: scaled UP from Vanta default (0.45 → 1.6) because
          // our 80×80 plane covers 6×ARENA_RADIUS (~400u) so each grid cell is
          // ~5u wide; without enough vertical displacement the per-triangle
          // face normals are nearly all upward and Lambert lighting collapses
          // to one uniform shade. Higher amplitude → steeper triangle slopes
          // → distinct dark/light facets like the reference image.
          p.z += n * 1.6;
          vWorldXZ = p.xy;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          // View-space position is what we differentiate in the fragment
          // shader to recover the per-triangle face normal (dFdx/dFdy on a
          // per-vertex-shared mesh gives the FLAT face normal — that's the
          // whole trick for Vanta's faceted look without duplicating verts).
          vViewPosition = mvPos.xyz;
          vViewDist = -mvPos.z;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uIslandRadius;
        uniform vec3 uDeepColor;
        uniform vec3 uLightColor;
        uniform vec3 uLightDir;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec2 vWorldXZ;
        varying vec3 vViewPosition;
        varying float vViewDist;
        void main() {
          float dist = length(vWorldXZ);
          // HARD RULE: discard everything inside the island radius. No wave
          // animation can ever bleed onto the playable area — pixels are
          // killed before any blending can occur.
          if (dist < uIslandRadius) discard;

          // Per-FACE normal via screen-space derivatives of view-space pos.
          // Because dFdx/dFdy are constant across a triangle, this gives a
          // single normal per triangle → flat-shaded facets even though the
          // plane geometry has shared vertices. This is exactly Vanta's trick.
          vec3 dx = dFdx(vViewPosition);
          vec3 dy = dFdy(vViewPosition);
          vec3 faceNormal = normalize(cross(dx, dy));

          // Lambert against a fixed view-space light. abs() so back-facing
          // facets light up from the same source rather than going pure dark
          // (matches Vanta — every triangle reads as a distinct shade, no
          // pitch-black wedges).
          float light = clamp(abs(dot(faceNormal, normalize(uLightDir))), 0.0, 1.0);

          // Remap Lambert from [0,1] to a wider value range and apply a
          // gamma-style curve so the bright-vs-dark facet split is dramatic
          // (matches reference screenshot where adjacent facets read as
          // clearly different shades, not subtle gradient).
          float t = smoothstep(0.55, 1.0, light);
          vec3 col = mix(uDeepColor, uLightColor, t);

          // Manual fog (ShaderMaterial doesn't auto-pick up scene.fog).
          float fogF = clamp((vViewDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
          col = mix(col, uFogColor, fogF);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeom, this._waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    this.scene.add(water);

    // ---- Cylinder island (sand sides + grass top) ----
    // Director rule: territory mesh and island top MUST NOT share a Y plane.
    // We pick the alternative the Director called "structurally cleaner" —
    // territory mesh at a small offset (+0.05) above cylinder top (Y=0).
    // Belt-and-suspenders: territory material has polygonOffset enabled so
    // the depth test always picks the territory at grazing camera angles.
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xC9B077, roughness: 0.95 });
    const topMat = new THREE.MeshLambertMaterial({ color: 0x9CC15A });    // grass green
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x8a7152, roughness: 1.0 });
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, ISLAND_HEIGHT, 64),
      [sideMat, topMat, bottomMat],
    );
    cyl.position.y = ISLAND_TOP_Y - ISLAND_HEIGHT / 2;   // top face at Y = ISLAND_TOP_Y
    cyl.receiveShadow = true;
    cyl.castShadow = true;
    this.scene.add(cyl);

    // ---- Cliff rocks around the rim ----
    // 14 chunky boxes scattered just inside the cylinder edge so they sit on
    // the island top, not floating in the sea. Sized to read at game scale
    // (cylinder radius 66.89) without dwarfing characters: rocks span 1.7-3.3
    // units wide vs character body 1.0 — chunky-but-not-overwhelming silhouette.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7d5c, roughness: 0.95 });
    const rockMatDark = new THREE.MeshStandardMaterial({ color: 0x6d6045, roughness: 0.95 });
    const rockCount = 14;
    for (let i = 0; i < rockCount; i++) {
      const ang = (i / rockCount) * Math.PI * 2 + (Math.random() * 0.12);
      const r = ARENA_RADIUS * 0.97 + Math.random() * 1.5;     // just inside the rim
      const sz = 1.7 + Math.random() * 1.6;                    // 1.7 .. 3.3 units
      const rock = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz * 0.7, sz),
        i % 3 === 0 ? rockMatDark : rockMat,
      );
      rock.position.set(Math.cos(ang) * r, ISLAND_TOP_Y + sz * 0.35, Math.sin(ang) * r);
      rock.rotation.y = Math.random() * Math.PI;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // ---- Distant atolls in the fog ----
    // 3 small islands beyond the playable arena, base sitting on the water
    // surface. They give a sense of place and scale; the fog hides their
    // pop-in at the horizon.
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (i - 1) * 0.6 + (Math.random() - 0.5) * 0.2;
      const r = ARENA_RADIUS * 2.6 + Math.random() * ARENA_RADIUS * 0.4;
      const dwidth = 8 + Math.random() * 6;     // 8..14 units, reads at distance
      const dheight = 3 + Math.random() * 2;    // low-profile atoll silhouette
      const distantAtoll = new THREE.Mesh(
        new THREE.BoxGeometry(dwidth, dheight, dwidth),
        new THREE.MeshStandardMaterial({ color: 0x7a8b62, roughness: 1.0 }),
      );
      distantAtoll.position.set(
        Math.cos(ang) * r,
        WATER_Y + dheight / 2 + 0.05,
        Math.sin(ang) * r,
      );
      this.scene.add(distantAtoll);
    }
  }

  // Sky gradient: cheap top→bottom canvas-textured background.
  _makeGradientBg(topHex, bottomHex) {
    const cv = document.createElement("canvas");
    cv.width = 4; cv.height = 256;
    const ctx = cv.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#" + topHex.toString(16).padStart(6, "0"));
    grad.addColorStop(1, "#" + bottomHex.toString(16).padStart(6, "0"));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _createTerritoryTexture() {
    const texSize = GRID_SIZE;
    this._territoryCanvas = document.createElement("canvas");
    this._territoryCanvas.width = texSize;
    this._territoryCanvas.height = texSize;
    this._territoryCtx = this._territoryCanvas.getContext("2d");
    this._territoryImageData = this._territoryCtx.createImageData(texSize, texSize);

    this.territoryTexture = new THREE.CanvasTexture(this._territoryCanvas);
    this.territoryTexture.colorSpace = THREE.SRGBColorSpace;
    this.territoryTexture.minFilter = THREE.NearestFilter;
    this.territoryTexture.magFilter = THREE.NearestFilter;
    this.territoryTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.territoryTexture.wrapT = THREE.ClampToEdgeWrapping;

    // Subdivided plane so the Vanta wave vertex displacement has resolution
    // to bend with. Same ShaderMaterial trick as the water (dFdx/dFdy faceted
    // normals) so the arena reads as faceted polygons that move in sync with
    // the surrounding waves. Wave displacement is upward-only (n ∈ [0,1]), so
    // the surface never dips below the cylinder top → no z-fight.
    //
    // VISUAL ONLY: characters and collision continue to use TERRITORY_Y; the
    // simulation is unaware of the wave height.
    const geom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 96, 96);
    this._territoryMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: this.territoryTexture },
        // Match the water shader's light direction so facet contrast aligns.
        uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() },
        // Lower amplitude than the water (water=1.6) — the arena is the
        // gameplay surface, so we want a noticeable but gentle ripple, not a
        // heaving sea. Tweak here to dial wave intensity.
        uAmplitude: { value: 0.55 },
        // Spatial frequency multiplier. <1 = longer wavelength (fewer, larger
        // waves on the arena); 1.0 = same density as the water shader. Tweak
        // here to dial the wave count without touching the formula.
        uFreq: { value: 0.5 },
        // Lambert tint range: result rgb is texColor * mix(uShadeMin, 1.0, lambert).
        // Keeps texture colors readable while showing clear facet shading.
        uShadeMin: { value: 0.55 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uAmplitude;
        uniform float uFreq;
        varying vec2 vUv;
        varying vec3 vViewPosition;
        void main() {
          // Same Vanta wave formula as the water shader, with a spatial-
          // frequency multiplier (uFreq). Lower uFreq = longer wavelength.
          // Plane is rotated -PI/2 around X by the host, so local (x,y)
          // becomes world (x,z).
          vec3 p = position;
          float wsp = 1.0;
          float fx = p.x * uFreq;
          float fy = p.y * uFreq;
          float phase = sqrt(wsp) * cos(-fx - 0.7 * fy);
          float o = sin(wsp * uTime * 0.02 * 60.0
                      - wsp * fx * 0.025
                      + wsp * fy * 0.015
                      + phase);
          float n = pow(o + 1.0, 2.0) / 4.0;
          p.z += n * uAmplitude;
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          vViewPosition = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uLightDir;
        uniform float uShadeMin;
        varying vec2 vUv;
        varying vec3 vViewPosition;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          // Preserve the original alpha cutout (boundary/sentinel cells are
          // alpha=0). Discard before doing facet work to save fragment cost.
          if (tex.a < 0.5) discard;

          // Per-face normal via screen-space derivatives — same trick as the
          // water shader. Gives flat-shaded facets without duplicating verts.
          vec3 dx = dFdx(vViewPosition);
          vec3 dy = dFdy(vViewPosition);
          vec3 faceNormal = normalize(cross(dx, dy));
          float lambert = clamp(abs(dot(faceNormal, normalize(uLightDir))), 0.0, 1.0);
          // Multiplicative tint keeps team colors recognizable while giving
          // each facet a visibly different shade.
          float shade = mix(uShadeMin, 1.0, lambert);
          gl_FragColor = vec4(tex.rgb * shade, 1.0);
        }
      `,
      transparent: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.territoryMesh = new THREE.Mesh(geom, this._territoryMat);
    this.territoryMesh.rotation.x = -Math.PI / 2;
    this.territoryMesh.position.y = TERRITORY_Y;
    this.scene.add(this.territoryMesh);
  }

  // Throttle the (heavy) putImageData to at most ~10 Hz. Claims and
  // heal events arrive in bursts of 5–20 per second; coalescing them produces
  // identical visual output with one upload instead of many. Worst-case the
  // territory mesh is up to ~100 ms behind the authoritative grid — well below
  // human-perception threshold for area changes.
  _maybeRebuildTerritory(dt) {
    if (!this.territoryDirty) return;
    this._territoryRebuildAccum += dt;
    if (this._territoryRebuildAccum >= this._territoryRebuildInterval) {
      this._territoryRebuildAccum = 0;
      this._updateTerritoryTexture();
      this.territoryDirty = false;
    }
  }

  // Re-rasterize the full grid and upload to the territory texture.
  // Full-grid rebuild is ~10ms; at 10Hz that's ~100ms/sec — acceptable.
  // Dirty-rect partial updates were dropped because floodFillConnected and the
  // heal pass mutate cells outside the claimed polygon's bbox, causing holes.
  _updateTerritoryTexture() {
    if (!this._territoryCtx) return;

    const data = this._territoryImageData.data;
    const grid = territoryGrid.grid;
    const size = GRID_SIZE;

    const factionR = new Uint8Array(6);
    const factionG = new Uint8Array(6);
    const factionB = new Uint8Array(6);
    for (let i = 0; i < FACTION_COUNT; i++) {
      const c = FACTION_COLORS[i];
      factionR[i + 1] = (c >> 16) & 0xFF;
      factionG[i + 1] = (c >> 8) & 0xFF;
      factionB[i + 1] = c & 0xFF;
    }

    // Full-grid rebuild — simpler than dirty-rect bookkeeping which was
    // missing changes from floodFillConnected and the heal pass.
    for (let gy = 0; gy < size; gy++) {
      const rowBase = gy * size;
      for (let gx = 0; gx < size; gx++) {
        const gridIdx = rowBase + gx;
        const val = grid[gridIdx];
        const pixIdx = gridIdx * 4;

        if (val === GRID_SENTINEL) {
          data[pixIdx] = 0;
          data[pixIdx + 1] = 0;
          data[pixIdx + 2] = 0;
          data[pixIdx + 3] = 0;
        } else if (val === 0) {
          data[pixIdx] = 255;
          data[pixIdx + 1] = 255;
          data[pixIdx + 2] = 255;
          data[pixIdx + 3] = 255;
        } else {
          data[pixIdx] = factionR[val];
          data[pixIdx + 1] = factionG[val];
          data[pixIdx + 2] = factionB[val];
          data[pixIdx + 3] = 255;
        }
      }
    }

    this._territoryCtx.putImageData(this._territoryImageData, 0, 0);
    this.territoryTexture.needsUpdate = true;
  }

  // _checkCutoff, _killCharacter, _healUnclaimedCells: previously lived here;
  // now owned by Simulation. Visual side-effects (death-screen on player kill)
  // are wired via the sim.onKill hook in the Game constructor.

  _toggleFactionMeshes() {
    if (!this.territoryMesh) return;
    this.territoryMesh.visible = !this.territoryMesh.visible;
  }

  _toggleGridOverlay() {
    if (!this.territoryTexture) return;
    this._debugNearestFilter = !this._debugNearestFilter;
    if (this._debugNearestFilter) {
      this.territoryTexture.minFilter = THREE.NearestFilter;
      this.territoryTexture.magFilter = THREE.NearestFilter;
    } else {
      this.territoryTexture.minFilter = THREE.LinearFilter;
      this.territoryTexture.magFilter = THREE.LinearFilter;
    }
    this.territoryTexture.needsUpdate = true;
  }

  render() {
    if (this.started) animateVibeJamPortals();
    this.renderer.render(this.scene, this.camera);
  }
}

// ===================== STATS.JS FPS OVERLAY =====================
// stats.js is loaded as a plain UMD <script> tag (window.Stats).
// Toggle with F key. Hidden by default — zero overhead when hidden.
let _stats = null;
function _initStats() {
  if (typeof window.Stats === "undefined") return null;
  const s = new window.Stats();
  s.dom.style.display = "none"; // hidden until toggled
  s.dom.style.top = "0px";
  s.dom.style.left = "0px";
  document.body.appendChild(s.dom);
  return s;
}

// ===================== TITLE SCREEN — Design 3 Faction Stripes =====================
// Five rotating sailor-cap cube characters across the bottom of the title screen,
// one per faction. Reuses the in-game Character cube proportions (Theme F sailor cap).
// Render loop pauses automatically when #name-entry gets the .hidden class
// (set by Solo/Online click handlers) so the GPU is freed for actual gameplay.
function _initTitleScreen() {
  const canvas = document.getElementById("ts-canvas");
  const nameEntry = document.getElementById("name-entry");
  if (!canvas || !nameEntry) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x000000, 0);  // transparent — CSS stripes show through

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 1.6, 13);
  camera.lookAt(0, 0.4, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.55);
  dl.position.set(2, 6, 4);
  scene.add(dl);

  // Build a sailor-cap cube character matching the in-game Character mesh
  // (Theme F: faction-colored body + head + faction-band cap + white cap top + eyes).
  function buildTitleCharacter(color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), bodyMat);
    body.position.y = 0.5;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.75, 0.75),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    head.position.y = 1.3;
    g.add(head);
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), eyeWhite);
      e.position.set(s * 0.18, 1.35, 0.36);
      g.add(e);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), pupBlack);
      p.position.set(s * 0.18, 1.35, 0.42);
      g.add(p);
    }
    const capBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.08, 0.78),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    capBand.position.y = 1.72;
    g.add(capBand);
    const capTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.18, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7 })
    );
    capTop.position.y = 1.85;
    g.add(capTop);
    return g;
  }

  // 5 chars across the bottom — one per faction stripe.
  // CSS stripes are 20% wide each, so in NDC they sit at x = -0.8, -0.4, 0, 0.4, 0.8.
  // We position the chars in world-space so they line up under each stripe at the
  // chosen camera FOV. spacing tuned by eye to match the 20% stripe width.
  const chars = [];
  const spacing = 3.6;
  for (let i = 0; i < FACTION_COLORS.length; i++) {
    const g = new THREE.Group();
    const x = (i - 2) * spacing;
    g.position.set(x, -2.4, 0);
    g.scale.setScalar(0.95);
    const c = buildTitleCharacter(FACTION_COLORS[i]);
    g.add(c);
    scene.add(g);
    chars.push(g);
  }

  // Render loop with automatic resize. Stops when nameEntry is hidden, restarts if
  // unhidden (e.g. dev hot-reload or future "back to menu" flow).
  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;

  function tick() {
    if (!running) return;
    // Resize handling — title-screen canvas is fullscreen, browser may resize.
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const px = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * px) || canvas.height !== Math.round(h * px)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const t = clock.getElapsedTime();
    chars.forEach((g, i) => {
      g.rotation.y = t * 0.45 + i * 0.6;
      // Idle bob — characters lift their bodies up and down on a per-faction phase.
      g.children[0].children[0].position.y = 0.5 + Math.sin(t * 2 + i * 0.7) * 0.08;
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  function start() { if (!running) { running = true; tick(); } }
  function stop()  { running = false; cancelAnimationFrame(raf); raf = 0; }

  // Watch #name-entry for .hidden class toggling — pauses the render loop when
  // the title screen disappears (game starts), restarts if it comes back.
  const obs = new MutationObserver(() => {
    if (nameEntry.classList.contains("hidden")) stop(); else start();
  });
  obs.observe(nameEntry, { attributes: true, attributeFilter: ["class"] });

  // Also pause on tab-hidden so a backgrounded title screen doesn't burn battery.
  document.addEventListener("visibilitychange", () => {
    if (nameEntry.classList.contains("hidden")) return;
    if (document.hidden) stop(); else start();
  });

  // Window resize → trigger immediate re-evaluation (also handled per-frame above
  // but this avoids a 1-frame wrong-aspect flash on resize).
  window.addEventListener("resize", () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  });

  start();
  return { start, stop };
}
const _titleScreen = _initTitleScreen();

// ===================== MAIN =====================
const game = new Game();
window.game = game; // debug hook
_stats = _initStats();
let lastTime = performance.now();

function loop(now) {
  if (_stats) _stats.begin();
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  game.tick(dt);
  game.render();
  if (_stats) _stats.end();
}
requestAnimationFrame(loop);

// ===================== MUSIC =====================
const _bgm = document.getElementById("bgm");
let _musicEnabled = (() => {
  try { const v = localStorage.getItem("musicEnabled"); return v === null ? true : v === "true"; }
  catch(e) { return true; }
})();
let _musicStarted = false; // tracks whether audio has been started at least once (user gesture)
let _musicLoopTimer = null;

function _updateMusicButtons() {
  const icon = _musicEnabled ? "🔊" : "🔇";
  const titleBtn = document.getElementById("music-toggle-title");
  const hudBtn = document.getElementById("music-toggle-hud");
  if (titleBtn) titleBtn.textContent = icon;
  if (hudBtn) hudBtn.textContent = icon;
}

function _startMusic() {
  if (!_musicEnabled) return;
  if (_musicLoopTimer) { clearTimeout(_musicLoopTimer); _musicLoopTimer = null; }
  _bgm.currentTime = 0;
  _bgm.play().catch(() => {}); // swallow autoplay policy errors
  _musicStarted = true;
}

function _resumeMusic() {
  if (!_musicEnabled) return;
  _bgm.play().catch(() => {});
}

function _pauseMusic() {
  if (_musicLoopTimer) { clearTimeout(_musicLoopTimer); _musicLoopTimer = null; }
  _bgm.pause();
}

// 2-second gap loop: when song ends, wait 2s then restart (if still enabled)
_bgm.addEventListener("ended", () => {
  if (!_musicEnabled) return;
  _musicLoopTimer = setTimeout(() => {
    _musicLoopTimer = null;
    if (_musicEnabled) {
      _bgm.currentTime = 0;
      _bgm.play().catch(() => {});
    }
  }, 2000);
});

function _toggleMusic() {
  _musicEnabled = !_musicEnabled;
  try { localStorage.setItem("musicEnabled", String(_musicEnabled)); } catch(e) {}
  _updateMusicButtons();
  if (_musicEnabled) {
    if (!_musicStarted) {
      _startMusic();
    } else {
      _resumeMusic();
    }
  } else {
    _pauseMusic();
  }
}

// Attempt to start music on first user gesture (if enabled)
function _onFirstGesture() {
  if (_musicEnabled && !_musicStarted) {
    _startMusic();
  }
}

document.getElementById("music-toggle-title").addEventListener("click", () => {
  _toggleMusic();
});
document.getElementById("music-toggle-hud").addEventListener("click", () => {
  _toggleMusic();
});

// Rules popup
const _rulesModal = document.getElementById("rules-modal");
const _rulesClose = document.getElementById("rules-close");
const _rulesInfo = document.getElementById("info-btn-title");
if (_rulesInfo) _rulesInfo.addEventListener("click", () => {
  _rulesModal.classList.add("visible");
});
if (_rulesClose) _rulesClose.addEventListener("click", () => {
  _rulesModal.classList.remove("visible");
});
if (_rulesModal) _rulesModal.addEventListener("click", (e) => {
  if (e.target === _rulesModal) _rulesModal.classList.remove("visible"); // click outside card → close
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _rulesModal.classList.contains("visible")) {
    _rulesModal.classList.remove("visible");
  }
});

// Initialize button labels
_updateMusicButtons();

// Settings popup (gears icon in HUD). Click toggles a small card next to
// the gears button. Currently exposes one toggle: battlefield waves on/off.
// Wave toggle works by zeroing the territory shader's amplitude — pure
// visual flip, no impact on simulation or collisions.
(function initSettingsPopup() {
  const btn = document.getElementById("settings-toggle-hud");
  const popup = document.getElementById("settings-popup");
  const closeBtn = document.getElementById("settings-close");
  const wavesChk = document.getElementById("setting-waves");
  if (!btn || !popup || !closeBtn || !wavesChk) return;

  // Default amplitude is the value set in the territory shader (0.55).
  const DEFAULT_AMP = 0.55;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.classList.toggle("visible");
  });
  closeBtn.addEventListener("click", () => popup.classList.remove("visible"));
  // Click outside the popup closes it.
  document.addEventListener("click", (e) => {
    if (!popup.classList.contains("visible")) return;
    if (popup.contains(e.target) || btn.contains(e.target)) return;
    popup.classList.remove("visible");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup.classList.contains("visible")) {
      popup.classList.remove("visible");
    }
  });

  wavesChk.addEventListener("change", () => {
    const mat = window._game?._territoryMat;
    if (!mat) return;
    mat.uniforms.uAmplitude.value = wavesChk.checked ? DEFAULT_AMP : 0.0;
  });
})();

// ===================== MOBILE HUD COLLAPSE =====================
// On mobile (max-width 768px OR pointer:coarse), both the factions panel and
// leaderboard default to collapsed so they don't obscure the arena.
// Each panel has a companion tab-sticker button that toggles it open/closed.
// Collapsed state is persisted in localStorage so it survives across sessions.

(function initMobileHUDCollapse() {
  const isMobile =
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;

  const PANELS = [
    { id: "hud-tr",           storageKey: "hudTrCollapsed" },
    { id: "player-leaderboard", storageKey: "lbCollapsed"  },
  ];

  // On mobile, restore persisted collapsed state (default: collapsed).
  // On desktop this function is a no-op (buttons are hidden via CSS anyway).
  if (isMobile) {
    for (const panel of PANELS) {
      const el = document.getElementById(panel.id);
      if (!el) continue;
      let collapsed = true; // default collapsed on mobile
      try {
        const stored = localStorage.getItem(panel.storageKey);
        if (stored !== null) collapsed = stored === "true";
      } catch(e) {}
      if (collapsed) el.classList.add("collapsed");
    }
  }

  // Wire click handlers for all tab stickers (they are present in DOM but
  // hidden via CSS on desktop, so safe to always attach).
  document.querySelectorAll(".hud-collapse-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const targetEl = document.getElementById(tab.dataset.target);
      if (!targetEl) return;
      const nowCollapsed = targetEl.classList.toggle("collapsed");
      // Persist the new state
      const panel = PANELS.find(p => p.id === tab.dataset.target);
      if (panel) {
        try { localStorage.setItem(panel.storageKey, String(nowCollapsed)); } catch(e) {}
      }
    });
  });
})();

// Name entry
document.getElementById("solo-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  _onFirstGesture();
  game.startSolo(name);
});

document.getElementById("online-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  _onFirstGesture();
  game.startOnline(name);
});

document.getElementById("name-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("solo-btn").click();
});

document.getElementById("return-to-menu").addEventListener("click", () => {
  location.reload();
});

// Vibe Jam 2026 — instant load when arriving through the webring.
// If ?portal=true is set, skip the title/name screen and auto-start in Solo
// mode (multiplayer's server-connect would add a perceptible startup delay).
// We also nudge the player to spawn at the start (red) portal so they appear
// to "walk out of it".
if (arrivedViaPortal) {
  const portalQS = new URLSearchParams(window.location.search);
  const portalName = (portalQS.get("username") || "Player").slice(0, 16);
  document.getElementById("name-entry").classList.add("hidden");
  game.startSolo(portalName);
  // After Game.start() runs synchronously above, this.player exists. Move the
  // player to the start-portal location so the spawn matches the red portal.
  const startX = -ARENA_RADIUS + 8;
  const startZ = 0;
  if (game.player?.simChar) {
    game.player.simChar.pos.x = startX;
    game.player.simChar.pos.z = startZ;
    game.player.pos.set(startX, 0, startZ);
    game.player.group.position.set(startX, game.player.group.position.y, startZ);
    // Recenter camera on the new spawn so the player isn't off-screen.
    game.camCurrent.set(startX, 0, startZ);
    game.camTarget.copy(game.camCurrent);
    game.camera.position.set(startX, CAMERA_HEIGHT, startZ + CAMERA_Z_OFFSET);
    game.camera.lookAt(startX, TERRITORY_Y, startZ);
  }
}
