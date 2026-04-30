import * as THREE from "three";

import { MultiplayerClient } from "./multiplayer.js";
import { FACTION_COUNT, FACTION_COLORS } from "./sim/faction.js";
import { Simulation } from "./sim/Simulation.js";
import { UIManager } from "./ui.js";
import {
  ARENA_RADIUS, PLAYER_SPEED, BOT_SPEED, TURN_SPEED,
  GRID_SIZE, WORLD_MIN, WORLD_SIZE, CELL_SIZE, GRID_SENTINEL,
} from "./sim/constants.js";
import { initVibeJamPortals, animateVibeJamPortals, arrivedViaPortal } from "./portals.js";

// Renderer-only tuning (client-side; not part of shared simulation)
const CAMERA_HEIGHT = 34;
const CAMERA_Z_OFFSET = 26;
const TRAIL_WIDTH = 0.8;

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
    if (!this.trailMesh || (this._trailGeomCapacity || 0) < verts.length) {
      if (this.trailMesh) {
        this.scene.remove(this.trailMesh);
        this.trailMesh.geometry.dispose();
        this.trailMesh = null;
      }
      const cap = Math.max(64, Math.ceil(verts.length * 1.5));
      const positions = new Float32Array(cap * 6);   // 2 verts/point × 3 floats
      const useUint32 = cap * 2 > 65535;
      const indexArr = useUint32 ? new Uint32Array(cap * 6) : new Uint16Array(cap * 6);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setIndex(new THREE.BufferAttribute(indexArr, 1));
      geom.setDrawRange(0, 0);
      this.trailMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
        color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85
      }));
      this.scene.add(this.trailMesh);
      this._trailGeomCapacity = cap;
      this._trailWrittenCount = 0;     // # of points whose ribbon verts are filled
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
      const o = i * 6;
      posArr[o    ] = p.x + nx*hw; posArr[o + 1] = 0.05; posArr[o + 2] = p.z + nz*hw;
      posArr[o + 3] = p.x - nx*hw; posArr[o + 4] = 0.05; posArr[o + 5] = p.z - nz*hw;
    };

    // Rewrite the previous tail (its forward-neighbor changed) and write all
    // new points. In steady-state this is two writes per call.
    const start = Math.max(0, (this._trailWrittenCount || 0) - 1);
    for (let i = start; i < verts.length; i++) {
      writePoint(i);
      if (i > 0 && i >= (this._trailIndexCount / 6 | 0) + 1) {
        // Append two triangles for the newly-formed segment from i-1 to i.
        const pr = (i - 1) * 2, cr = i * 2;
        const o = this._trailIndexCount;
        idxArr[o    ] = pr;     idxArr[o + 1] = pr + 1; idxArr[o + 2] = cr + 1;
        idxArr[o + 3] = pr;     idxArr[o + 4] = cr + 1; idxArr[o + 5] = cr;
        this._trailIndexCount = o + 6;
      }
    }
    this._trailWrittenCount = verts.length;

    posAttr.needsUpdate = true;
    idxAttr.needsUpdate = true;
    geom.setDrawRange(0, this._trailIndexCount);
  }

  // Renderer-only sync: pull authoritative pos/dir from simChar (or predicted
  // state for the local online player) and lerp the mesh toward it. All
  // simulation work (steer, move, trail, claim, kills) is owned by sim.tick.
  syncVisuals() {
    if (!this.alive) {
      this.group.visible = false;
      return;
    }
    // Source of truth for pos/dir: predicted state for local online player,
    // authoritative simChar (or schema-backed proxy) otherwise.
    let tgtX, tgtZ, tgtDirX, tgtDirZ;
    if (this.predicted) {
      tgtX = this.predicted.posX;
      tgtZ = this.predicted.posZ;
      tgtDirX = this.predicted.dirX;
      tgtDirZ = this.predicted.dirZ;
    } else {
      tgtX = this.simChar.pos.x;
      tgtZ = this.simChar.pos.z;
      tgtDirX = this.simChar.dir.x;
      tgtDirZ = this.simChar.dir.z;
    }
    this.pos.set(tgtX, 0, tgtZ);
    this.dir.set(tgtDirX, 0, tgtDirZ);
    this.factionId = this.simChar.factionId;

    // Local player (solo or online-with-prediction) is already authoritative:
    // sim pos is exact for solo; predicted pos is already advanced this frame
    // for online. Lerping would introduce ~3-frame visual lag. Snap directly.
    // Remote characters keep the lerp to smooth 20 Hz server updates.
    if (this.isPlayer) {
      this.group.position.x = tgtX;
      this.group.position.z = tgtZ;
      this.group.rotation.y = Math.atan2(tgtDirX, tgtDirZ);
    } else {
      // Frame-rate independent lerp toward target (smooths 20 Hz server updates
      // over ~3 frames at 60 FPS). Snap if too far (prevents long lerps after
      // teleport / respawn / drift reconciliation).
      const t = 0.30;
      let mx = this.group.position.x;
      let mz = this.group.position.z;
      const dx = tgtX - mx;
      const dz = tgtZ - mz;
      if (dx * dx + dz * dz > 9) {
        // > 3 units away: snap.
        this.group.position.set(tgtX, this.group.position.y, tgtZ);
      } else {
        this.group.position.x = mx + dx * t;
        this.group.position.z = mz + dz * t;
      }

      // Shortest-arc lerp of rotation.
      const targetRot = Math.atan2(tgtDirX, tgtDirZ);
      let drot = targetRot - this.group.rotation.y;
      while (drot > Math.PI) drot -= 2 * Math.PI;
      while (drot < -Math.PI) drot += 2 * Math.PI;
      this.group.rotation.y += drot * t;
    }

    this.group.visible = (this.isPlayer && this.invulnTimer > 0)
      ? Math.sin(performance.now() * 0.01) > 0
      : true;
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

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(5, 15, 5);
    dl.castShadow = true;
    // Performance: 1024² shadow map is plenty for ~30 cube characters viewed
    // from above. 2048² was 4× the GPU memory + fillrate per frame for no
    // visible improvement on this art style.
    dl.shadow.mapSize.width = 1024;
    dl.shadow.mapSize.height = 1024;
    dl.shadow.camera.near = 0.5;
    dl.shadow.camera.far = 60;
    dl.shadow.camera.left = -40;
    dl.shadow.camera.right = 40;
    dl.shadow.camera.top = 40;
    dl.shadow.camera.bottom = -40;
    dl.shadow.radius = 2;
    this.scene.add(dl);
    this.scene.add(dl.target);
    this.shadowLight = dl;

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 128),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Border
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ARENA_RADIUS - 0.2, ARENA_RADIUS + 0.2, 128),
      new THREE.MeshBasicMaterial({ color: 0xe0e0e0, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    this.characters = [];
    this.player = null;
    this.camTarget = new THREE.Vector3();
    this.camCurrent = new THREE.Vector3();
    this.started = false;
    this.mode = "solo";
    this.playerName = "";
    this.killedBy = "";
    // Input throttling: send to server at 20 Hz (matches server tick rate).
    this._inputSendAccum = 0;
    this._inputSendInterval = 1 / 20;
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

    // Labels
    this.labels = new Map();

    // Debug toggles

    // HUD
    this.hudTL = document.getElementById("hud-tl");
    this.hudTR = document.getElementById("hud-tr");
    this.deathScreen = document.getElementById("death-screen");
    this.deathMsg = document.getElementById("death-msg");
    this.deathTimer = document.getElementById("death-timer");

    // ===== Sim event hooks: bridge authoritative sim events to renderer state =====
    this.sim.onClaim = (charId, trailPoints, _factionId) => {
      this.territoryDirty = true;
      const simChar = this.sim.characters[charId];
      const r = this._charBySim.get(simChar);
      if (r) r._clearTrail();
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
        victimR.onDieVisual();
        if (victimR === this.player) {
          this.killedBy = killerR ? killerR.name : "";
          this.deathMsg.textContent = killerR ? `Killed by ${killerR.name}` : "You died!";
          this.deathScreen.classList.add("visible");
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

    this.mp.onCumulativeScore = (score) => {
      this.cumulativeScore = score;
      console.log(`[online] cumulative score from prior sessions: ${score}`);
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
    this.factionManager = null;
    this.matchManager = { phase: "playing", timeRemaining: 0, getTimeString: () => "" };
    this.scoreTracker = null;

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

    // Camera: orbit the arena center until we have a real player char.
    const spawn = this.player
      ? { x: this.player.simChar.pos.x, z: this.player.simChar.pos.z }
      : { x: 0, z: 0 };
    this.camera.position.set(spawn.x, CAMERA_HEIGHT, spawn.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(spawn.x, 0, spawn.z);
    this.camCurrent.set(spawn.x, 0, spawn.z);
    this.camTarget.copy(this.camCurrent);

    this.started = true;
    console.log(`[online] renderer initialized with ${this.characters.length} characters`);

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
    console.log(`[online] bound player to char ${this.myCharId}`);
  }

  // Client-side prediction step for the local online player. Mirrors the
  // server's Simulation._stepCharacter math (TURN_SPEED rad/s steer,
  // PLAYER_SPEED * dt advance, arena-radius clamp). Reconciles to the
  // authoritative server position via a soft tether instead of a hard snap:
  // small drifts (< RECON_HARD_SNAP) are pulled toward server pos at
  // RECON_PULL_RATE per second so movement looks smooth; large drifts (e.g.
  // respawn / teleport) hard-snap so the player doesn't slide across the
  // map. Without input prediction the round-trip lag (~150-200ms) makes the
  // local character feel rubbery; with the old 2-unit snap, every direction
  // change naturally drifted past threshold and visibly teleported. The
  // soft pull keeps the predicted pos within ~1 unit of the server while
  // never visibly jumping.
  _stepPrediction(dt) {
    if (this.mode !== "online") return;
    if (!this.player || !this.predicted) return;
    if (!this.player.alive) return;

    const sc = this.player.simChar;
    const RECON_HARD_SNAP = 8;       // units — only respawn/teleport scale
    const RECON_PULL_RATE = 5;       // units/sec of drift correction
    const ddx = sc.pos.x - this.predicted.posX;
    const ddz = sc.pos.z - this.predicted.posZ;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq > RECON_HARD_SNAP * RECON_HARD_SNAP) {
      // Catastrophic drift (respawn, teleport, extended disconnect) — snap.
      this.predicted.posX = sc.pos.x;
      this.predicted.posZ = sc.pos.z;
      this.predicted.dirX = sc.dir.x || this.predicted.dirX;
      this.predicted.dirZ = sc.dir.z || this.predicted.dirZ;
    } else if (distSq > 1e-6) {
      // Soft tether: pull predicted toward server at RECON_PULL_RATE u/s.
      // Clamped so a single frame can't pull more than the actual drift.
      const dist = Math.sqrt(distSq);
      const pull = Math.min(1, (RECON_PULL_RATE * dt) / dist);
      this.predicted.posX += ddx * pull;
      this.predicted.posZ += ddz * pull;
    }

    // Steer predicted dir toward this.player.targetDir at TURN_SPEED rad/s.
    const tdx = this.player.targetDir.x;
    const tdz = this.player.targetDir.z;
    const tlen = Math.hypot(tdx, tdz);
    if (tlen > 1e-6) {
      const ca = Math.atan2(this.predicted.dirX, this.predicted.dirZ);
      const ta = Math.atan2(tdx / tlen, tdz / tlen);
      let diff = ta - ca;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-TURN_SPEED * dt, Math.min(TURN_SPEED * dt, diff));
      const na = ca + turn;
      this.predicted.dirX = Math.sin(na);
      this.predicted.dirZ = Math.cos(na);
    }

    // Advance predicted pos.
    this.predicted.posX += this.predicted.dirX * PLAYER_SPEED * dt;
    this.predicted.posZ += this.predicted.dirZ * PLAYER_SPEED * dt;

    // Arena clamp.
    const r = Math.hypot(this.predicted.posX, this.predicted.posZ);
    if (r > ARENA_RADIUS) {
      const inv = ARENA_RADIUS / r;
      this.predicted.posX *= inv;
      this.predicted.posZ *= inv;
    }
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
    this.camera.lookAt(playerSpawn.x, 0, playerSpawn.z);
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
      spawnPoint:   { x: -ARENA_RADIUS + 8, y: 1, z: 0 }, // start (red) — west edge
      exitPosition: { x:  ARENA_RADIUS - 8, y: 1, z: 0 }, // exit (green) — east edge
    });
  }

  tick(dt) {
    if (!this.started) return;

    // ---- Player input: collect WASD + mouse → player.targetDir in any mode. ----
    if (this.player && this.player.alive && this.player.isPlayer) {
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

    // Match ended: still update visuals/HUD then bail out.
    if (this.matchManager && this.matchManager.phase === "ended") {
      for (const c of this.characters) c.syncVisuals();
      this._updateLabels();
      if (this.uiManager) this.uiManager.update(dt);
      this._maybeRebuildTerritory(dt);
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
          dlog("REASSIGN", `${c.name} reassigned to faction ${newFactionId}`);
        }
        c.onRespawnVisual();
        if (c === this.player && this.deathScreen) this.deathScreen.classList.remove("visible");
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
    if (this.player && this.player.alive && this.player.isPlayer) {
      this.camTarget.set(this.player.pos.x, 0, this.player.pos.z);
    }
    const smooth = 1 - Math.pow(0.03, dt);
    this.camCurrent.lerp(this.camTarget, smooth);
    this.camera.position.set(this.camCurrent.x, CAMERA_HEIGHT, this.camCurrent.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(this.camCurrent.x, 0, this.camCurrent.z);

    if (this.shadowLight) {
      this.shadowLight.position.set(this.camCurrent.x + 5, 15, this.camCurrent.z + 5);
      this.shadowLight.target.position.set(this.camCurrent.x, 0, this.camCurrent.z);
      this.shadowLight.target.updateMatrixWorld();
    }

    // ---- Labels & UI ----
    this._updateLabels();
    if (this.uiManager) this.uiManager.update(dt);
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
      if (label._cachedName !== c.name) {
        label.textContent = c.name;
        label._cachedName = c.name;
      }
      label.style.left = `${(tmp.x * 0.5 + 0.5) * W}px`;
      label.style.top = `${(-tmp.y * 0.5 + 0.5) * H}px`;
    }
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

    const geom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    // Performance: alphaTest with transparent:false keeps the binary alpha cutout
    // (boundary cells are fully transparent, all other cells fully opaque) but
    // skips the alpha-blend pipeline — one of the biggest fillrate costs since
    // this plane covers most of the screen. Single-sided cuts shading cost in
    // half (we only ever view it from above).
    const mat = new THREE.MeshBasicMaterial({
      map: this.territoryTexture,
      transparent: false,
      alphaTest: 0.5,
      side: THREE.FrontSide,
    });

    this.territoryMesh = new THREE.Mesh(geom, mat);
    this.territoryMesh.rotation.x = -Math.PI / 2;
    this.territoryMesh.position.y = 0.02;
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

// Name entry
document.getElementById("solo-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  game.startSolo(name);
});

document.getElementById("online-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  game.startOnline(name);
});

document.getElementById("name-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("solo-btn").click();
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
    game.camera.lookAt(startX, 0, startZ);
  }
}
