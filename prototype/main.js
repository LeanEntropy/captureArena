import * as THREE from "three";

import { MultiplayerClient } from "./multiplayer.js";
import { FACTION_COUNT, FACTION_COLORS } from "./sim/faction.js";
import { Simulation } from "./sim/Simulation.js";
import { UIManager } from "./ui.js";
import {
  ARENA_RADIUS, PLAYER_SPEED, BOT_SPEED,
  GRID_SIZE, WORLD_MIN, WORLD_SIZE, CELL_SIZE, GRID_SENTINEL,
} from "./sim/constants.js";

// Renderer-only tuning (client-side; not part of shared simulation)
const CAMERA_HEIGHT = 34;
const CAMERA_Z_OFFSET = 26;
const TRAIL_WIDTH = 0.8;

// ===================== DEBUG LOG =====================
const DEBUG_LOG = [];
const DEBUG_MAX = 2000;
try { localStorage.removeItem("captureArena_debug"); } catch(e) {}
function dlog(category, msg, data) {
  const entry = { t: performance.now().toFixed(1), cat: category, msg, ...(data || {}) };
  DEBUG_LOG.push(entry);
  if (DEBUG_LOG.length > DEBUG_MAX) DEBUG_LOG.shift();
  console.log(`[${entry.t}][${category}] ${msg}`, data || "");
  try { localStorage.setItem("captureArena_debug", JSON.stringify(DEBUG_LOG)); } catch(e) {}
}

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
    this.name = simChar.name;
    this.isPlayer = isPlayer;
    this.factionId = simChar.factionId;   // mirror; updated on faction reassign
    this.trailVerts = [];                 // Vector3[]; populated via sim.onTrailVertex hook
    this.trailMesh = null;
    this.group = this._buildChar(color);
    scene.add(this.group);
  }

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
    if (this.trailMesh) { this.scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); this.trailMesh = null; }
    if (this.trailVerts.length < 2) return;
    const positions = [], indices = [], hw = TRAIL_WIDTH / 2;
    for (let i = 0; i < this.trailVerts.length; i++) {
      const p = this.trailVerts[i];
      let dx, dz;
      if (i > 0 && i < this.trailVerts.length - 1) {
        dx = this.trailVerts[i+1].x - this.trailVerts[i-1].x;
        dz = this.trailVerts[i+1].z - this.trailVerts[i-1].z;
      } else if (i < this.trailVerts.length - 1) {
        dx = this.trailVerts[i+1].x - p.x;
        dz = this.trailVerts[i+1].z - p.z;
      } else {
        dx = p.x - this.trailVerts[i-1].x;
        dz = p.z - this.trailVerts[i-1].z;
      }
      const len = Math.sqrt(dx*dx+dz*dz) || 1;
      const nx = -dz/len, nz = dx/len;
      positions.push(p.x+nx*hw, 0.05, p.z+nz*hw, p.x-nx*hw, 0.05, p.z-nz*hw);
      if (i > 0) {
        const pr = (i-1)*2, cr = i*2;
        indices.push(pr,pr+1,cr+1, pr,cr+1,cr);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    this.trailMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: this.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85
    }));
    this.scene.add(this.trailMesh);
  }

  // Renderer-only sync: pull authoritative pos/dir from simChar, update mesh.
  // All simulation work (steer, move, trail, claim, kills) is owned by sim.tick.
  syncVisuals() {
    if (!this.alive) {
      this.group.visible = false;
      return;
    }
    this.pos.set(this.simChar.pos.x, 0, this.simChar.pos.z);
    this.dir.set(this.simChar.dir.x, 0, this.simChar.dir.z);
    this.factionId = this.simChar.factionId;
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.group.visible = (this.isPlayer && this.invulnTimer > 0)
      ? Math.sin(performance.now() * 0.01) > 0
      : true;
  }

  // Renderer trail mesh teardown. Sim owns the actual trailVerts data; this
  // method clears the renderer mirror used to build the visible mesh.
  _clearTrail() {
    this.trailVerts = [];
    if (this.trailMesh) { this.scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); this.trailMesh = null; }
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
    dl.shadow.mapSize.width = 2048;
    dl.shadow.mapSize.height = 2048;
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
    this.sim.onClaim = (charId, _trailPoints, _factionId) => {
      this.territoryDirty = true;
      const simChar = this.sim.characters[charId];
      const r = this._charBySim.get(simChar);
      if (r) r._clearTrail();
      dlog("CLAIM", `${r ? r.name : "?"}: claimed (sim)`, { charId });
    };
    this.sim.onHeal = (_changedCells) => {
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

    try {
      await this.mp.connect(name, null);
      console.log("[online] connected, sessionId =", this.mp.room.sessionId);
    } catch (err) {
      console.error("[online] connection failed:", err);
    }
  }

  _initRendererFromOnlineState(state) {
    // Online mode does not run the local sim. Initialize a blank territory
    // grid so the texture rasterizer doesn't crash; Task 16 will sync claims.
    territoryGrid.init();
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
  }

  tick(dt) {
    if (!this.started) return;

    // ---- Player input: only meaningful in solo mode (Task 18 wires online). ----
    if (this.mode === "solo" && this.player && this.player.alive && this.player.isPlayer) {
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
      this.sim.setTargetDir(this.player.simChar.id, this.player.targetDir.x, this.player.targetDir.z);
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
    }

    // Match ended: still update visuals/HUD then bail out.
    if (this.matchManager && this.matchManager.phase === "ended") {
      for (const c of this.characters) c.syncVisuals();
      this._updateLabels();
      if (this.uiManager) this.uiManager.update(dt);
      if (this.territoryDirty) {
        this._updateTerritoryTexture();
        this.territoryDirty = false;
      }
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
    }

    // Texture refresh if grid changed this tick.
    if (this.territoryDirty) {
      this._updateTerritoryTexture();
      this.territoryDirty = false;
    }

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
    for (const c of this.characters) {
      let label = this.labels.get(c);
      if (!label) {
        label = document.createElement("div");
        label.style.cssText = "position:fixed;pointer-events:none;font-size:12px;font-weight:bold;color:#333;text-shadow:0 0 3px white;white-space:nowrap;transform:translate(-50%,-100%);z-index:5;";
        document.getElementById("ui").appendChild(label);
        this.labels.set(c, label);
      }
      if (!c.alive) { label.style.display = "none"; continue; }
      label.style.display = "";
      label.textContent = c.name;
      const pos = new THREE.Vector3(c.pos.x, 2.5, c.pos.z);
      pos.project(this.camera);
      label.style.left = `${(pos.x*0.5+0.5)*innerWidth}px`;
      label.style.top = `${(-pos.y*0.5+0.5)*innerHeight}px`;
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
    const mat = new THREE.MeshBasicMaterial({
      map: this.territoryTexture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.territoryMesh = new THREE.Mesh(geom, mat);
    this.territoryMesh.rotation.x = -Math.PI / 2;
    this.territoryMesh.position.y = 0.02;
    this.scene.add(this.territoryMesh);
  }

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

    for (let gy = 0; gy < size; gy++) {
      for (let gx = 0; gx < size; gx++) {
        const gridIdx = gy * size + gx;
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
    this.renderer.render(this.scene, this.camera);
  }
}

// ===================== MAIN =====================
const game = new Game();
window.game = game; // debug hook
let lastTime = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  game.tick(dt);
  game.render();
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
