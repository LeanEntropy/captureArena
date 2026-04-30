import * as THREE from "three";
import earcut from "earcut";

// ===================== CONSTANTS =====================
const ARENA_RADIUS = 24.5;
const START_RADIUS = 3;
const MIN_POINT_DIST = 0.3;
const PLAYER_SPEED = 8;
const BOT_SPEED = 6;
const TURN_SPEED = 5;
const TRAIL_WIDTH = 0.8;
const TRAIL_KILL_DIST = 0.6;
const SELF_TRAIL_SKIP = 5;
const BOT_COUNT = 2;
const RESPAWN_DELAY = 3;
const INVULN_TIME = 2;
const CAMERA_HEIGHT = 30;
const CAMERA_Z_OFFSET = 14;
const TOTAL_AREA = Math.PI * ARENA_RADIUS * ARENA_RADIUS;

const CONTINUOUS_LAND = true; // When true, disconnected land fragments are freed after territory loss

const COLORS = [0x4CAF50, 0x2196F3, 0xFF9800, 0xE91E63, 0x9C27B0, 0x00BCD4, 0xCDDC39, 0xFF5722];
const BOT_NAMES = ["K-9","Lime","Toe","Leaf Assassin","Helmet Destroyer","Star Jammer","Sky Bully","Daisy Stick"];

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
const GRID_SIZE = 1024;
const WORLD_MIN = -ARENA_RADIUS;  // -24.5
const WORLD_SIZE = ARENA_RADIUS * 2;  // 49
const CELL_SIZE = WORLD_SIZE / GRID_SIZE;  // ~0.0479
const GRID_SENTINEL = 255;  // out-of-bounds marker

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
        const simplified = simplifyContour(worldLoop, 0.06);
        if (simplified.length >= 3) {
          loops.push(simplified);
        }
      }
    }

    return loops;
  },

  floodFillConnected(ownerId, startWX, startWZ) {
    // Flood fill from world position to find all connected cells of ownerId.
    // Returns count of disconnected cells cleared.
    const { gx: startGX, gy: startGY } = this.worldToGrid(startWX, startWZ);

    // If start cell doesn't belong to owner, find nearest owned cell
    let sgx = startGX, sgy = startGY;
    if (this.getOwnerGrid(sgx, sgy) !== ownerId) {
      // Search nearby for an owned cell
      let found = false;
      for (let r = 1; r < 100 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only check ring
            const nx = sgx + dx, ny = sgy + dy;
            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
              if (this.grid[ny * GRID_SIZE + nx] === ownerId) {
                sgx = nx;
                sgy = ny;
                found = true;
              }
            }
          }
        }
      }
      if (!found) return 0; // no owned cells at all
    }

    // BFS flood fill to mark connected cells
    const visited = new Uint8Array(GRID_SIZE * GRID_SIZE);
    const queue = [sgx, sgy]; // flat pairs
    visited[sgy * GRID_SIZE + sgx] = 1;
    let head = 0;

    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];

      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
        const nIdx = ny * GRID_SIZE + nx;
        if (visited[nIdx]) continue;
        if (this.grid[nIdx] !== ownerId) continue;
        visited[nIdx] = 1;
        queue.push(nx, ny);
      }
    }

    // Clear any unvisited cells that belong to this owner
    let cleared = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === ownerId && !visited[i]) {
        this.grid[i] = 0;
        cleared++;
      }
    }
    return cleared;
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

// ===================== TRIANGULATOR (earcut) =====================
function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const coords = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = pts[i].x;
    coords[i * 2 + 1] = pts[i].y;
  }
  const indices = earcut(coords);
  return indices.length >= 3 ? indices : [];
}

// ===================== GEOMETRY HELPERS =====================
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i+1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a / 2);
}
function to2D(v3arr) { return v3arr.map(v => ({ x: v.x, y: v.z })); }
function closestIdx(verts, target) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const dx = verts[i].x-target.x, dz = verts[i].z-target.z;
    const d = dx*dx + dz*dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function dist2D(a, b) {
  const dx = a.x-b.x, dz = a.z-b.z;
  return Math.sqrt(dx*dx + dz*dz);
}

function randomSpawn(characters) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = ARENA_RADIUS * (0.2 + Math.random() * 0.5);
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    let ok = true;
    // Reject spawn near any alive character
    for (const c of characters) {
      if (c.alive && dist2D({x,z}, c.pos) < 10) { ok = false; break; }
    }
    // Reject spawn inside ANY character's territory
    if (ok) {
      if (territoryGrid.getOwner(x, z) !== 0) {
        ok = false;
      }
    }
    if (ok) return { x, z };
  }
  const a = Math.random() * Math.PI * 2, r = ARENA_RADIUS * 0.4;
  return { x: Math.cos(a)*r, z: Math.sin(a)*r };
}

// ===================== CHARACTER =====================
class Character {
  constructor(scene, x, z, color, name, isPlayer) {
    this.scene = scene;
    this.pos = new THREE.Vector3(x, 0, z);
    this.dir = new THREE.Vector3(0, 0, 1);
    this.targetDir = this.dir.clone();
    this.speed = isPlayer ? PLAYER_SPEED : BOT_SPEED;
    this.color = color;
    this.name = name;
    this.isPlayer = isPlayer;
    this.alive = true;
    this.respawnTimer = 0;
    this.invulnTimer = INVULN_TIME;
    this.killCount = 0;
    this.ownerId = 0; // set when game starts, 1-based
    this.territoryDirty = true;
    this.contourLoops = []; // cached contour for rendering
    this.areaMesh = null;
    this.trailVerts = [];
    this.trailMesh = null;
    this.wasOutside = false;
    this.allCharacters = null; // set after all characters are created
    this.group = this._buildChar(color);
    scene.add(this.group);
    // Bot AI state
    this.botPhase = "idle";
    this.botWaypoints = [];
    this.botLoopCount = 0;
    this.botAggroChance = 0.25;
  }

  _buildChar(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
    );
    body.position.y = 0.5;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.75, 0.75),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
    );
    head.position.y = 1.3;
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

  _initTerritory() {
    territoryGrid.stampCircle(this.pos.x, this.pos.z, START_RADIUS, this.ownerId);
    this.territoryDirty = true;
    this._rebuildAreaMesh();
  }

  _rebuildAreaMesh() {
    if (this.areaMesh) {
      this.scene.remove(this.areaMesh);
      this.areaMesh.geometry.dispose();
      this.areaMesh = null;
    }

    if (!this.territoryDirty) return;
    this.territoryDirty = false;

    // Extract contours
    this.contourLoops = territoryGrid.extractContours(this.ownerId);
    if (this.contourLoops.length === 0) return;

    // Sort loops by area descending: largest is outer boundary, smaller are holes
    this.contourLoops.sort((a, b) => polyArea(b) - polyArea(a));

    const MIN_HOLE_AREA = 0.5; // ignore tiny contour artifacts (< ~200 grid cells)

    const outer = this.contourLoops[0];
    const holes = [];
    for (let i = 1; i < this.contourLoops.length; i++) {
      const loop = this.contourLoops[i];
      const area = polyArea(loop);
      if (area < MIN_HOLE_AREA) continue; // skip tiny artifacts

      // Check winding direction via signed area
      let signedArea = 0;
      for (let j = 0; j < loop.length; j++) {
        const k = (j + 1) % loop.length;
        signedArea += loop[j].x * loop[k].y - loop[k].x * loop[j].y;
      }
      // Only treat as hole if winding is CW (signedArea < 0), opposite to CCW outer
      // If same winding (CCW, signedArea > 0), it's a disconnected island — skip
      if (signedArea < 0) {
        holes.push(loop);
      }
    }

    // Build flat coords for earcut
    const coords = [];
    for (const p of outer) { coords.push(p.x, p.y); }
    const holeIndices = [];
    for (const hole of holes) {
      holeIndices.push(coords.length / 2);
      for (const p of hole) { coords.push(p.x, p.y); }
    }

    const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : null, 2);
    if (indices.length < 3) return;

    const totalPts = coords.length / 2;
    const pos = new Float32Array(totalPts * 3);
    for (let i = 0; i < totalPts; i++) {
      pos[i * 3] = coords[i * 2];       // x (world)
      pos[i * 3 + 1] = 0.02;            // y (slightly above ground)
      pos[i * 3 + 2] = coords[i * 2 + 1]; // z (world y -> three.js z)
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    this.areaMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color: this.color, transparent: false, opacity: 1.0, side: THREE.DoubleSide, depthWrite: false
    }));
    this.scene.add(this.areaMesh);
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

  insideOwn(x, z) {
    return territoryGrid.getOwner(x, z) === this.ownerId;
  }

  update(dt) {
    if (!this.alive) { this.respawnTimer -= dt; return null; }
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // Steer
    const ca = Math.atan2(this.dir.x, this.dir.z);
    const ta = Math.atan2(this.targetDir.x, this.targetDir.z);
    let diff = ta - ca;
    while (diff > Math.PI) diff -= Math.PI*2;
    while (diff < -Math.PI) diff += Math.PI*2;
    const turn = Math.max(-TURN_SPEED*dt, Math.min(TURN_SPEED*dt, diff));
    const na = ca + turn;
    this.dir.set(Math.sin(na), 0, Math.cos(na));

    // Move
    this.pos.x += this.dir.x * this.speed * dt;
    this.pos.z += this.dir.z * this.speed * dt;

    // Boundary -- solid wall, slide along it
    if (this.pos.length() > ARENA_RADIUS) {
      this.pos.normalize().multiplyScalar(ARENA_RADIUS);
      this.pos.y = 0;
    }

    // Territory check
    const inside = this.insideOwn(this.pos.x, this.pos.z);
    if (!inside) {
      const last = this.trailVerts[this.trailVerts.length - 1];
      if (!last || dist2D(this.pos, last) >= MIN_POINT_DIST) {
        this.trailVerts.push(this.pos.clone());
        this._rebuildTrailMesh();
        if (this.isPlayer && this.trailVerts.length <= 3) {
          dlog("TRAIL", `trail point #${this.trailVerts.length}`, { x: this.pos.x.toFixed(2), z: this.pos.z.toFixed(2) });
        }
      }
      if (!this.wasOutside && this.isPlayer) {
        dlog("EXIT", "left territory", { x: this.pos.x.toFixed(2), z: this.pos.z.toFixed(2) });
      }
      this.wasOutside = true;
    } else if (this.wasOutside && this.trailVerts.length > 2) {
      if (this.isPlayer) {
        dlog("ENTER", "re-entered territory, will claim", { x: this.pos.x.toFixed(2), z: this.pos.z.toFixed(2), trailLen: this.trailVerts.length });
      }
      this._claim();
      this.wasOutside = false;
    } else {
      this.wasOutside = false;
    }

    // Visual
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
    this.group.visible = this.invulnTimer > 0 ? Math.sin(performance.now() * 0.01) > 0 : true;
    return null;
  }

  _claim() {
    if (this.trailVerts.length < 3) {
      dlog("CLAIM", `${this.name}: aborted, trail too short`, { trailLen: this.trailVerts.length });
      this._clearTrail(); return;
    }
    const trail = this.trailVerts;

    const areaBefore = territoryGrid.countCells(this.ownerId);
    dlog("CLAIM", `${this.name}: starting claim`, {
      trailLen: trail.length,
      areaBefore,
      trailStart: `${trail[0].x.toFixed(2)},${trail[0].z.toFixed(2)}`,
      trailEnd: `${trail[trail.length-1].x.toFixed(2)},${trail[trail.length-1].z.toFixed(2)}`
    });

    // Build a trail polygon by closing the trail loop through the territory boundary.
    // We need boundary vertices to form the arc. Extract a boundary polygon from contours.
    // Use fresh contour extraction to get boundary points.
    const contours = territoryGrid.extractContours(this.ownerId);
    if (contours.length === 0) {
      dlog("CLAIM", `${this.name}: aborted, no contours found`);
      this._clearTrail();
      return;
    }

    // Use largest contour as boundary
    contours.sort((a, b) => polyArea(b) - polyArea(a));
    const boundary = contours[0];

    // Convert boundary to Vector3-like for closestIdx (needs .x, .z)
    const boundaryV3 = boundary.map(p => ({ x: p.x, z: p.y }));

    const si = closestIdx(boundaryV3, trail[0]);
    const ei = closestIdx(boundaryV3, trail[trail.length - 1]);

    // Build trail polygon: trail points + boundary arc from ei back to si
    let trailPoly;
    if (si === ei) {
      trailPoly = trail.map(t => ({ x: t.x, y: t.z }));
    } else {
      const n = boundaryV3.length;
      const arcFwd = [];
      for (let i = ei; ; i = (i + 1) % n) {
        arcFwd.push({ x: boundaryV3[i].x, y: boundaryV3[i].z });
        if (i === si) break;
        if (arcFwd.length > n) break;
      }
      const arcBwd = [];
      for (let i = ei; ; i = (i - 1 + n) % n) {
        arcBwd.push({ x: boundaryV3[i].x, y: boundaryV3[i].z });
        if (i === si) break;
        if (arcBwd.length > n) break;
      }
      const arc = arcFwd.length <= arcBwd.length ? arcFwd : arcBwd;

      trailPoly = trail.map(t => ({ x: t.x, y: t.z }));
      // Include ALL arc points: arc[0] is the boundary point near trail end,
      // arc[last] is the boundary point near trail start. Skipping them
      // creates gaps between the trail and boundary, producing broken polygons.
      for (let i = 0; i < arc.length; i++) {
        trailPoly.push(arc[i]);
      }
    }

    dlog("CLAIM", `${this.name}: trail polygon built`, {
      trailPolyLen: trailPoly.length,
      polyArea: polyArea(trailPoly).toFixed(2)
    });

    if (trailPoly.length < 3) {
      dlog("CLAIM", `${this.name}: aborted, trail polygon too small`, { trailPolyLen: trailPoly.length });
      this._clearTrail();
      return;
    }

    // Stamp the trail polygon onto the grid
    const overwritten = territoryGrid.stampPolygon(trailPoly, this.ownerId);

    dlog("CLAIM", `${this.name}: stamped polygon`, {
      polyVerts: trailPoly.length,
      overwrittenOwners: [...overwritten]
    });

    // Handle CONTINUOUS_LAND for victims
    if (CONTINUOUS_LAND && overwritten.size > 0) {
      for (const victimId of overwritten) {
        // Find the victim character
        const victim = this.allCharacters ? this.allCharacters.find(c => c.ownerId === victimId) : null;
        if (victim) {
          const cleared = territoryGrid.floodFillConnected(victimId, victim.pos.x, victim.pos.z);
          if (cleared > 0) {
            dlog("CONTINUOUS_LAND", `${victim.name}: cleared ${cleared} disconnected cells`);
          }
          victim.territoryDirty = true;
          victim._rebuildAreaMesh();
        }
      }
    } else if (overwritten.size > 0) {
      // Even without CONTINUOUS_LAND, rebuild overwritten victims' meshes
      for (const victimId of overwritten) {
        const victim = this.allCharacters ? this.allCharacters.find(c => c.ownerId === victimId) : null;
        if (victim) {
          victim.territoryDirty = true;
          victim._rebuildAreaMesh();
        }
      }
    }

    // Rebuild our own mesh
    this.territoryDirty = true;
    this._rebuildAreaMesh();

    const areaAfter = territoryGrid.countCells(this.ownerId);
    dlog("CLAIM", `${this.name}: SUCCESS`, {
      cellsBefore: areaBefore,
      cellsAfter: areaAfter,
      cellsGained: areaAfter - areaBefore,
      areaPct: ((areaAfter / territoryGrid.totalArenaCells) * 100).toFixed(2),
      overwritten: [...overwritten]
    });

    this._clearTrail();
  }

  _clearTrail() {
    this.trailVerts = [];
    if (this.trailMesh) { this.scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); this.trailMesh = null; }
  }

  die() {
    territoryGrid.clearOwner(this.ownerId);
    this.territoryDirty = true;
    if (this.areaMesh) {
      this.scene.remove(this.areaMesh);
      this.areaMesh.geometry.dispose();
      this.areaMesh = null;
    }
    this.contourLoops = [];
    this.alive = false;
    this.respawnTimer = RESPAWN_DELAY;
    this.wasOutside = false;
    this._clearTrail();
    this.group.visible = false;
  }

  respawn(x, z) {
    this.pos.set(x, 0, z);
    this.dir.set(Math.random()-0.5, 0, Math.random()-0.5).normalize();
    this.targetDir.copy(this.dir);
    this.alive = true;
    this.invulnTimer = INVULN_TIME;
    this.wasOutside = false;
    this.group.visible = true;
    this._initTerritory();
    // Reset bot AI state
    this.botWaypoints = [];
    this.botPhase = "idle";
  }

  getAreaPct() {
    return (territoryGrid.countCells(this.ownerId) / territoryGrid.totalArenaCells) * 100;
  }
}

// ===================== GAME =====================
class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6);
    dl.position.set(10, 20, 10);
    this.scene.add(dl);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 128),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    ground.rotation.x = -Math.PI / 2;
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
    this.playerName = "";
    this.killedBy = "";

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
    window.addEventListener("keydown", e => this.keysDown.add(e.key.toLowerCase()));
    window.addEventListener("keyup", e => this.keysDown.delete(e.key.toLowerCase()));
    window.addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Labels
    this.labels = new Map();

    // HUD
    this.hudTL = document.getElementById("hud-tl");
    this.hudTR = document.getElementById("hud-tr");
    this.deathScreen = document.getElementById("death-screen");
    this.deathMsg = document.getElementById("death-msg");
    this.deathTimer = document.getElementById("death-timer");
  }

  start(name) {
    this.playerName = name;
    this.started = true;

    // Initialize the territory grid
    territoryGrid.init();

    // Create player
    const sp = randomSpawn([]);
    this.player = new Character(this.scene, sp.x, sp.z, COLORS[0], name, true);
    this.player.ownerId = 1;
    this.characters.push(this.player);
    this.player._initTerritory();

    // Create bots
    for (let i = 0; i < BOT_COUNT; i++) {
      const pos = randomSpawn(this.characters);
      const bot = new Character(this.scene, pos.x, pos.z, COLORS[(i+1) % COLORS.length], BOT_NAMES[i], false);
      bot.ownerId = i + 2;
      this.characters.push(bot);
      bot._initTerritory();
    }

    // Give each character a reference to all characters
    for (const c of this.characters) {
      c.allCharacters = this.characters;
    }

    this.camera.position.set(sp.x, CAMERA_HEIGHT, sp.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(sp.x, 0, sp.z);
    this.camCurrent.set(sp.x, 0, sp.z);
    this.camTarget.copy(this.camCurrent);
  }

  tick(dt) {
    if (!this.started) return;

    // Player input
    if (this.player && this.player.alive) {
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
    }

    // Bot AI -- loop-based territory claiming
    for (const c of this.characters) {
      if (c.isPlayer || !c.alive) continue;

      // If no waypoints, plan a new claiming loop
      if (c.botWaypoints.length === 0) {
        try {
          this._planBotLoop(c);
        } catch (e) {
          dlog("BOT_AI", `${c.name} _planBotLoop error: ${e.message}`);
          const angle = Math.random() * Math.PI * 2;
          c.botWaypoints = [{ x: c.pos.x + Math.sin(angle) * 5, z: c.pos.z + Math.cos(angle) * 5 }];
        }
      }

      // Steer toward current waypoint
      if (c.botWaypoints.length > 0) {
        const wp = c.botWaypoints[0];
        const dx = wp.x - c.pos.x, dz = wp.z - c.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1.2) {
          c.botWaypoints.shift();
        } else {
          c.targetDir.set(dx / d, 0, dz / d);
        }
      }
    }

    // Update all characters
    for (const c of this.characters) {
      c.update(dt);
      // Respawn
      if (!c.alive && c.respawnTimer <= 0) {
        const sp = randomSpawn(this.characters);
        c.respawn(sp.x, sp.z);
        dlog("RESPAWN", `${c.name} respawned`, { x: sp.x.toFixed(1), z: sp.z.toFixed(1) });
        if (c === this.player) this.deathScreen.classList.remove("visible");
      }
    }

    // Trail collisions
    for (const c of this.characters) {
      if (!c.alive || c.invulnTimer > 0) continue;
      for (const other of this.characters) {
        if (!other.alive) continue;
        if (other === c) {
          // Self-trail collision (skip recent points)
          for (let i = 0; i < other.trailVerts.length - SELF_TRAIL_SKIP; i++) {
            if (dist2D(c.pos, other.trailVerts[i]) < TRAIL_KILL_DIST) {
              this._killCharacter(c);
              break;
            }
          }
        } else {
          // Enemy trail collision
          for (const tv of other.trailVerts) {
            if (dist2D(c.pos, tv) < TRAIL_KILL_DIST) {
              this._killCharacter(other, c);
              break;
            }
          }
        }
        if (!c.alive) break;
      }
    }

    // Camera
    if (this.player && this.player.alive) {
      this.camTarget.set(this.player.pos.x, 0, this.player.pos.z);
    }
    const smooth = 1 - Math.pow(0.03, dt);
    this.camCurrent.lerp(this.camTarget, smooth);
    this.camera.position.set(this.camCurrent.x, CAMERA_HEIGHT, this.camCurrent.z + CAMERA_Z_OFFSET);
    this.camera.lookAt(this.camCurrent.x, 0, this.camCurrent.z);

    // Labels
    this._updateLabels();

    // HUD
    this._updateHUD();
  }

  _killCharacter(victim, killer) {
    dlog("KILL", `${victim.name} killed${killer ? " by " + killer.name : ""}`, {
      victimPos: `${victim.pos.x.toFixed(1)},${victim.pos.z.toFixed(1)}`,
      trailLen: victim.trailVerts.length,
      isPlayer: victim.isPlayer
    });
    victim.die();
    if (killer) killer.killCount++;
    if (victim === this.player) {
      this.killedBy = killer ? killer.name : "";
      this.deathMsg.textContent = killer ? `Killed by ${killer.name}` : "You died!";
      this.deathScreen.classList.add("visible");
    }
  }

  _planBotLoop(bot) {
    // If territory was fully consumed, bot has no home -- just wander toward center
    const cellCount = territoryGrid.countCells(bot.ownerId);
    if (cellCount === 0) {
      dlog("BOT_AI", `${bot.name} has no territory, wandering toward center`);
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 },
        { x: (Math.random() - 0.5) * ARENA_RADIUS * 0.5, z: (Math.random() - 0.5) * ARENA_RADIUS * 0.5 }
      ];
      return;
    }

    // Compute territory center from contour loops
    const contours = territoryGrid.extractContours(bot.ownerId);
    if (contours.length === 0) {
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 }
      ];
      return;
    }
    contours.sort((a, b) => polyArea(b) - polyArea(a));
    const boundary = contours[0];

    let cx = 0, cz = 0;
    for (const v of boundary) { cx += v.x; cz += v.y; }
    cx /= boundary.length;
    cz /= boundary.length;

    // Convert boundary to Vector3-like for closestIdx
    const boundaryV3 = boundary.map(p => ({ x: p.x, z: p.y }));

    // Decide: aggro (head toward another player's territory) or normal patrol
    const doAggro = Math.random() < bot.botAggroChance;
    let outAngle;

    if (doAggro) {
      const others = this.characters.filter(o => o !== bot && o.alive && territoryGrid.countCells(o.ownerId) > 0);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        outAngle = Math.atan2(target.pos.x - cx, target.pos.z - cz);
      } else {
        outAngle = Math.random() * Math.PI * 2;
      }
    } else {
      outAngle = Math.random() * Math.PI * 2;
    }

    // Build a claiming loop: exit boundary -> arc outward -> re-enter boundary
    const loopRadius = 5 + Math.random() * 6;
    const arcSteps = 4 + Math.floor(Math.random() * 3);

    const exitDir = { x: cx + Math.sin(outAngle) * 50, z: cz + Math.cos(outAngle) * 50 };
    const exitIdx = closestIdx(boundaryV3, exitDir);
    const exitPt = boundaryV3[exitIdx];

    const arcSpread = (Math.PI * 0.4) + Math.random() * (Math.PI * 0.4);
    const startArcAngle = outAngle - arcSpread / 2;
    const endArcAngle = outAngle + arcSpread / 2;

    const waypoints = [];

    // First: walk to exit point on our boundary
    waypoints.push({ x: exitPt.x, z: exitPt.z });

    // Then: arc outward
    for (let i = 0; i <= arcSteps; i++) {
      const t = i / arcSteps;
      const angle = startArcAngle + (endArcAngle - startArcAngle) * t;
      const pushOut = 2 + loopRadius * Math.sin(t * Math.PI);
      const r = START_RADIUS + pushOut;
      let wx = cx + Math.sin(angle) * r;
      let wz = cz + Math.cos(angle) * r;
      const distFromOrigin = Math.sqrt(wx * wx + wz * wz);
      if (distFromOrigin > ARENA_RADIUS - 1) {
        wx *= (ARENA_RADIUS - 1) / distFromOrigin;
        wz *= (ARENA_RADIUS - 1) / distFromOrigin;
      }
      waypoints.push({ x: wx, z: wz });
    }

    // Finally: return to a point on our boundary
    const reEntryDir = { x: cx + Math.sin(endArcAngle) * 50, z: cz + Math.cos(endArcAngle) * 50 };
    const reEntryIdx = closestIdx(boundaryV3, reEntryDir);
    const reEntryPt = boundaryV3[reEntryIdx];
    waypoints.push({ x: reEntryPt.x, z: reEntryPt.z });

    // Push toward territory center to ensure we're solidly inside for the claim
    waypoints.push({ x: cx, z: cz });

    bot.botWaypoints = waypoints;
    bot.botLoopCount++;
    dlog("BOT_AI", `${bot.name} planned loop #${bot.botLoopCount}`, {
      waypoints: waypoints.length,
      phase: doAggro ? "aggro" : "patrol",
      cx: cx.toFixed(1), cz: cz.toFixed(1)
    });
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

  _updateHUD() {
    if (!this.player) return;
    const pct = this.player.getAreaPct().toFixed(1);
    const colorStr = `#${this.player.color.toString(16).padStart(6,"0")}`;
    this.hudTL.innerHTML = `<div style="background:${colorStr};color:white;padding:4px 12px;border-radius:4px;display:inline-block;margin-bottom:4px;">${pct}%</div><div style="margin-top:4px;">Kills: ${this.player.killCount}</div>`;

    const sorted = [...this.characters].sort((a,b) => b.getAreaPct() - a.getAreaPct());
    let lb = "<div style='font-weight:bold;margin-bottom:4px;'>Leaderboard</div>";
    sorted.forEach((c, i) => {
      const col = `#${c.color.toString(16).padStart(6,"0")}`;
      const me = c === this.player;
      lb += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;${me?"font-weight:bold;":""}"><span style="display:inline-block;width:10px;height:10px;background:${col};border-radius:2px;"></span><span>${i+1}.</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${c.name}</span><span>${c.getAreaPct().toFixed(1)}%</span></div>`;
    });
    this.hudTR.innerHTML = lb;

    if (!this.player.alive) {
      this.deathTimer.textContent = `Respawning in ${Math.ceil(this.player.respawnTimer)}...`;
    }
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
document.getElementById("play-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  game.start(name);
});
document.getElementById("name-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("play-btn").click();
});
