import * as THREE from "three";

// ===================== CONSTANTS =====================
const ARENA_RADIUS = 24.5;
const START_RADIUS = 3;
const START_POINTS = 45;
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

// Conquest modes:
// "RETAIN_FIRST_OWNER" — conquered territory keeps visual memory of original owner (polygons overlap visually)
// "REPLACE_OWNER" — conquered territory is subtracted from the previous owner's polygon
const CONQUEST_MODE = "REPLACE_OWNER"; // default
const CONTINUOUS_LAND = true; // When true, disconnected land fragments are freed after territory loss

const COLORS = [0x4CAF50, 0x2196F3, 0xFF9800, 0xE91E63, 0x9C27B0, 0x00BCD4, 0xCDDC39, 0xFF5722];
const BOT_NAMES = ["K-9","Lime","Toe","Leaf Assassin","Helmet Destroyer","Star Jammer","Sky Bully","Daisy Stick"];

// ===================== DEBUG LOG =====================
const DEBUG_LOG = [];
const DEBUG_MAX = 2000;
function dlog(category, msg, data) {
  const entry = { t: performance.now().toFixed(1), cat: category, msg, ...(data || {}) };
  DEBUG_LOG.push(entry);
  if (DEBUG_LOG.length > DEBUG_MAX) DEBUG_LOG.shift();
  console.log(`[${entry.t}][${category}] ${msg}`, data || "");
  try { localStorage.setItem("captureArena_debug", JSON.stringify(DEBUG_LOG)); } catch(e) {}
}

// ===================== TRIANGULATOR (Ear Clipping) =====================
function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const indices = [];
  const V = new Array(n);
  let area = 0;
  for (let p = n - 1, q = 0; q < n; p = q++) {
    area += pts[p].x * pts[q].y - pts[q].x * pts[p].y;
  }
  for (let v = 0; v < n; v++) V[v] = area > 0 ? v : n - 1 - v;
  let nv = n, count = 2 * nv, v = nv - 1;
  while (nv > 2) {
    if (--count <= 0) break;
    let u = v; if (nv <= u) u = 0;
    v = u + 1; if (nv <= v) v = 0;
    let w = v + 1; if (nv <= w) w = 0;
    if (snip(pts, u, v, w, nv, V)) {
      indices.push(V[u], V[v], V[w]);
      for (let s = v, t = v + 1; t < nv; s++, t++) V[s] = V[t];
      nv--; count = 2 * nv;
    }
  }
  indices.reverse();
  return indices;
}
function snip(pts, u, v, w, n, V) {
  const A = pts[V[u]], B = pts[V[v]], C = pts[V[w]];
  if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 1e-10) return false;
  for (let p = 0; p < n; p++) {
    if (p === u || p === v || p === w) continue;
    if (ptInTri(A, B, C, pts[V[p]])) return false;
  }
  return true;
}
function ptInTri(A, B, C, P) {
  const d1 = (C.x-B.x)*(P.y-B.y)-(C.y-B.y)*(P.x-B.x);
  const d2 = (A.x-C.x)*(P.y-C.y)-(A.y-C.y)*(P.x-C.x);
  const d3 = (B.x-A.x)*(P.y-A.y)-(B.y-A.y)*(P.x-A.x);
  return !(((d1<0)||(d2<0)||(d3<0)) && ((d1>0)||(d2>0)||(d3>0)));
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
function segmentIntersection(p1, p2, p3, p4) {
  // Returns intersection point of segment (p1->p2) with segment (p3->p4), or null
  // All points are {x, y} (2D)
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // parallel or collinear
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < -1e-10 || t > 1+1e-10 || u < -1e-10 || u > 1+1e-10) return null;
  const tc = Math.max(0, Math.min(1, t));
  const uc = Math.max(0, Math.min(1, u));
  return { x: p1.x + tc * d1x, y: p1.y + tc * d1y, t: tc, u: uc };
}

function subtractPolygon(victimPoly2D, claimerPoly2D) {
  // Subtract claimerPoly2D from victimPoly2D (victim minus claimer).
  // Returns array of 2D points forming the result polygon, or [] if fully consumed.
  //
  // Algorithm: Event-based Weiler-Atherton walk with degenerate filtering,
  // event rotation for wrap-around, and try-both-directions with area comparison.

  const vN = victimPoly2D.length;
  const cN = claimerPoly2D.length;
  if (vN < 3 || cN < 3) return [];

  // Precompute which victim vertices are inside claimer
  const insideFlags = victimPoly2D.map(v => pointInPoly(v.x, v.y, claimerPoly2D));

  // If all victim vertices are inside claimer, territory is fully consumed
  if (insideFlags.every(f => f)) return [];

  // If no victim vertices are inside claimer, check for edge intersections
  if (insideFlags.every(f => !f)) {
    let hasIx = false;
    for (let i = 0; i < vN && !hasIx; i++) {
      const ni = (i + 1) % vN;
      for (let j = 0; j < cN; j++) {
        const nj = (j + 1) % cN;
        if (segmentIntersection(victimPoly2D[i], victimPoly2D[ni], claimerPoly2D[j], claimerPoly2D[nj])) {
          hasIx = true; break;
        }
      }
    }
    if (!hasIx) return victimPoly2D.slice(); // no overlap at all
  }

  // Find all intersections, filtering degenerate ones at t near 0 or 1
  const T_EPS = 1e-9;
  const allIx = [];
  for (let i = 0; i < vN; i++) {
    const ni = (i + 1) % vN;
    for (let j = 0; j < cN; j++) {
      const nj = (j + 1) % cN;
      const hit = segmentIntersection(victimPoly2D[i], victimPoly2D[ni], claimerPoly2D[j], claimerPoly2D[nj]);
      if (hit && hit.t > T_EPS && hit.t < 1 - T_EPS) {
        // Classify as entering or exiting by testing a point just past the intersection
        const testT = hit.t + 1e-5;
        const tx = victimPoly2D[i].x + testT * (victimPoly2D[ni].x - victimPoly2D[i].x);
        const ty = victimPoly2D[i].y + testT * (victimPoly2D[ni].y - victimPoly2D[i].y);
        const entering = pointInPoly(tx, ty, claimerPoly2D);
        allIx.push({ x: hit.x, y: hit.y, vEdge: i, cEdge: j, t: hit.t, u: hit.u, entering });
      }
    }
  }

  // No valid intersections — return based on inside flags
  if (allIx.length === 0) {
    const outside = victimPoly2D.filter((v, i) => !insideFlags[i]);
    return outside.length >= 3 ? outside : [];
  }

  allIx.sort((a, b) => a.vEdge !== b.vEdge ? a.vEdge - b.vEdge : a.t - b.t);

  // Build result polygon by walking events in a given claimer boundary direction
  function buildResultWithDir(walkDir) {
    // Build event list: outside vertices + intersection events, in victim-edge order
    const events = [];
    let ixIdx = 0;
    for (let i = 0; i < vN; i++) {
      if (!insideFlags[i]) events.push({ type: 'v', x: victimPoly2D[i].x, y: victimPoly2D[i].y });
      while (ixIdx < allIx.length && allIx[ixIdx].vEdge === i) {
        events.push({ type: 'ix', ix: allIx[ixIdx] });
        ixIdx++;
      }
    }

    // Find start: first vertex or exit intersection (handles wrap-around)
    let startIdx = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].type === 'v') { startIdx = i; break; }
      if (events[i].type === 'ix' && !events[i].ix.entering) { startIdx = i; break; }
    }

    const result = [];
    const N = events.length;
    let i = 0;
    while (i < N) {
      const idx = (startIdx + i) % N;
      const ev = events[idx];
      if (ev.type === 'v') {
        result.push({ x: ev.x, y: ev.y });
        i++;
      } else if (ev.type === 'ix') {
        if (ev.ix.entering) {
          // Enter claimer: add entry point, walk claimer boundary to next exit
          result.push({ x: ev.ix.x, y: ev.ix.y });
          let found = false;
          for (let j = 1; j < N; j++) {
            const eidx = (startIdx + i + j) % N;
            if (events[eidx].type === 'ix' && !events[eidx].ix.entering) {
              walkBoundary(ev.ix, events[eidx].ix, result, walkDir);
              result.push({ x: events[eidx].ix.x, y: events[eidx].ix.y });
              i += j + 1;
              found = true;
              break;
            }
          }
          if (!found) i++;
        } else {
          // Exit intersection (at start due to wrap-around): add exit point
          result.push({ x: ev.ix.x, y: ev.ix.y });
          i++;
        }
      } else {
        i++;
      }
    }
    return result;
  }

  // Walk claimer boundary from entry to exit intersection
  function walkBoundary(entry, exit, out, dir) {
    const ee = entry.cEdge, xe = exit.cEdge;
    if (dir === 'fwd') {
      let idx = (ee + 1) % cN, s = 0;
      while (s++ < cN + 2) {
        if (idx === (xe + 1) % cN) break;
        out.push({ x: claimerPoly2D[idx].x, y: claimerPoly2D[idx].y });
        idx = (idx + 1) % cN;
      }
    } else {
      let idx = ee, s = 0;
      while (s++ < cN + 2) {
        if (idx === xe) break;
        out.push({ x: claimerPoly2D[idx].x, y: claimerPoly2D[idx].y });
        idx = (idx - 1 + cN) % cN;
      }
    }
  }

  // Deduplicate very close points
  function dedup(r) {
    const E = 1e-6, d = [];
    for (const p of r) {
      if (d.length === 0) { d.push(p); }
      else {
        const l = d[d.length - 1];
        if (Math.abs(p.x - l.x) > E || Math.abs(p.y - l.y) > E) d.push(p);
      }
    }
    if (d.length > 1) {
      const f = d[0], l = d[d.length - 1];
      if (Math.abs(f.x - l.x) < E && Math.abs(f.y - l.y) < E) d.pop();
    }
    return d.length >= 3 ? d : [];
  }

  // Try both walk directions, pick the valid result with correct area
  const rFwd = dedup(buildResultWithDir('fwd'));
  const rBwd = dedup(buildResultWithDir('bwd'));
  const aFwd = rFwd.length >= 3 ? polyArea(rFwd) : Infinity;
  const aBwd = rBwd.length >= 3 ? polyArea(rBwd) : Infinity;
  const aVictim = polyArea(victimPoly2D);

  // Correct subtraction result must be smaller than (or equal to) victim
  const fOk = aFwd <= aVictim * 1.001;
  const bOk = aBwd <= aVictim * 1.001;

  if (fOk && bOk) {
    // Both valid — pick the LARGER one (removes less area = less error in edge cases)
    return aFwd >= aBwd ? rFwd : rBwd;
  } else if (fOk) return rFwd;
  else if (bOk) return rBwd;
  else {
    // Neither is valid — damage control, pick smaller
    return aFwd <= aBwd ? rFwd : rBwd;
  }
}

// ===================== CONTINUOUS LAND: FRAGMENT SPLITTING =====================
// When a subtraction creates a self-intersecting polygon, split it into separate
// polygon loops. This enables CONTINUOUS_LAND mode to discard disconnected pieces.

function splitPolygonFragments(poly2D) {
  // Returns an array of polygon fragments. If no self-intersections, returns [poly2D].
  // For self-intersecting polygons, splits at intersection points into separate loops.
  if (!poly2D || poly2D.length < 3) return [];

  // Find the first self-intersection (non-adjacent edges crossing)
  const n = poly2D.length;
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    const p1 = poly2D[i];
    const p2 = poly2D[ni];

    // Check against all non-adjacent edges
    for (let j = i + 2; j < n; j++) {
      // Skip the edge that shares a vertex with edge i
      if (j === n - 1 && i === 0) continue; // last edge wraps to vertex 0
      const nj = (j + 1) % n;

      const hit = segmentIntersection(p1, p2, poly2D[j], poly2D[nj]);
      if (!hit) continue;

      // Skip intersections at exact endpoints (t=0,1 or u=0,1)
      if ((hit.t < 1e-8 || hit.t > 1 - 1e-8) && (hit.u < 1e-8 || hit.u > 1 - 1e-8)) continue;

      const ix = { x: hit.x, y: hit.y };

      // Split into two loops at this crossing point.
      //
      // Original polygon: v0, v1, ..., v_i, [ix], v_{i+1}, ..., v_j, [ix], v_{j+1}, ..., v_{n-1}
      //
      // Loop A: ix, v_{i+1}, v_{i+2}, ..., v_j, ix
      //   = vertices from index (i+1) to j, bookended by the intersection point
      //
      // Loop B: ix, v_{j+1}, v_{j+2}, ..., v_{n-1}, v_0, v_1, ..., v_i, ix
      //   = vertices from index (j+1) wrapping around to i, bookended by the intersection point

      const loopA = [ix];
      for (let k = (i + 1) % n; ; k = (k + 1) % n) {
        loopA.push({ x: poly2D[k].x, y: poly2D[k].y });
        if (k === j) break;
      }

      const loopB = [ix];
      for (let k = (j + 1) % n; ; k = (k + 1) % n) {
        loopB.push({ x: poly2D[k].x, y: poly2D[k].y });
        if (k === i) break;
      }

      // Filter out degenerate fragments (< 3 vertices or near-zero area)
      const MIN_FRAG_AREA = 0.1;
      const results = [];

      for (const loop of [loopA, loopB]) {
        if (loop.length < 3) continue;
        const area = polyArea(loop);
        if (area < MIN_FRAG_AREA) continue;

        // Recursively check each sub-loop for further self-intersections
        const subFragments = splitPolygonFragments(loop);
        for (const frag of subFragments) {
          if (frag.length >= 3 && polyArea(frag) >= MIN_FRAG_AREA) {
            results.push(frag);
          }
        }
      }

      return results.length > 0 ? results : [poly2D];
    }
  }

  // No self-intersections found — this polygon is a single fragment
  return [poly2D];
}

function randomSpawn(characters) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = ARENA_RADIUS * (0.2 + Math.random() * 0.5);
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    let ok = true;
    for (const c of characters) {
      if (c.alive && dist2D({x,z}, c.pos) < 10) { ok = false; break; }
    }
    if (ok) {
      // Reject spawn if inside any alive character's territory
      for (const c of characters) {
        if (c.alive && c.areaVerts.length >= 3 && pointInPoly(x, z, to2D(c.areaVerts))) {
          ok = false;
          break;
        }
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
    this.areaVerts = [];
    this.areaMesh = null;
    this.trailVerts = [];
    this.trailMesh = null;
    this.wasOutside = false;
    this.allCharacters = null; // set after all characters are created
    this.group = this._buildChar(color);
    scene.add(this.group);
    this._initTerritory();
    // Bot AI state
    this.botPhase = "idle"; // "idle" | "outward" | "curving" | "returning" | "aggro"
    this.botWaypoints = [];  // queued waypoints for the current loop
    this.botLoopCount = 0;
    this.botAggroChance = 0.25; // chance to target another player's territory
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
    this.areaVerts = [];
    const step = (Math.PI * 2) / START_POINTS;
    for (let i = 0; i < START_POINTS; i++) {
      const a = step * i;
      this.areaVerts.push(new THREE.Vector3(
        this.pos.x + Math.cos(a) * START_RADIUS, 0,
        this.pos.z + Math.sin(a) * START_RADIUS
      ));
    }
    this._rebuildAreaMesh();
  }

  _rebuildAreaMesh() {
    if (this.areaMesh) { this.scene.remove(this.areaMesh); this.areaMesh.geometry.dispose(); this.areaMesh = null; }
    if (this.areaVerts.length < 3) return;
    const pts2D = to2D(this.areaVerts);
    const idx = triangulate(pts2D);
    if (idx.length === 0) return;
    const pos = new Float32Array(this.areaVerts.length * 3);
    for (let i = 0; i < this.areaVerts.length; i++) {
      pos[i*3] = this.areaVerts[i].x; pos[i*3+1] = 0.02; pos[i*3+2] = this.areaVerts[i].z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setIndex(idx);
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
    return this.areaVerts.length >= 3 && pointInPoly(x, z, to2D(this.areaVerts));
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

    // Boundary — solid wall, slide along it
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
        dlog("EXIT", "left territory", { x: this.pos.x.toFixed(2), z: this.pos.z.toFixed(2), areaVerts: this.areaVerts.length });
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
      if (this.isPlayer) dlog("CLAIM", "aborted: trail too short", { trailLen: this.trailVerts.length });
      this._clearTrail(); return;
    }
    const av = this.areaVerts, trail = this.trailVerts;
    const prevArea = polyArea(to2D(av));
    const prevVertCount = av.length;
    const si = closestIdx(av, trail[0]);
    const ei = closestIdx(av, trail[trail.length - 1]);

    const trailStartDist = dist2D(av[si], trail[0]);
    const trailEndDist = dist2D(av[ei], trail[trail.length - 1]);

    if (this.isPlayer) {
      dlog("CLAIM", "starting claim", {
        prevVertCount, prevArea: prevArea.toFixed(2),
        trailLen: trail.length,
        si, ei, avLen: av.length,
        trailStartDist: trailStartDist.toFixed(3),
        trailEndDist: trailEndDist.toFixed(3),
        trailStart: `${trail[0].x.toFixed(2)},${trail[0].z.toFixed(2)}`,
        trailEnd: `${trail[trail.length-1].x.toFixed(2)},${trail[trail.length-1].z.toFixed(2)}`,
        closestToStart: `${av[si].x.toFixed(2)},${av[si].z.toFixed(2)}`,
        closestToEnd: `${av[ei].x.toFixed(2)},${av[ei].z.toFixed(2)}`
      });
    }

    // Build two candidate polygons for the merged territory.
    // The trail starts near boundary vertex si and ends near boundary vertex ei.
    //
    // When si != ei:
    //   Candidate A: boundary arc (ei→si, CW) + trail forward
    //   Candidate B: boundary arc (si→ei, CW) + trail reversed
    //   Pick whichever has the larger area (that one includes old territory + bulge).
    //
    // When si == ei:
    //   The trail forms a closed loop anchored at one boundary point.
    //   Insert the trail into the boundary at that point to create the union.
    //   We try both trail orientations and pick the larger.

    let candA, candB;

    if (si === ei) {
      // Insert trail into boundary at position si.
      // Candidate A: boundary[0..si] + trail forward + boundary[si+1..end]
      candA = [];
      for (let k = 0; k <= si; k++) candA.push(av[k].clone());
      for (const t of trail) candA.push(t.clone());
      for (let k = si + 1; k < av.length; k++) candA.push(av[k].clone());

      // Candidate B: boundary[0..si] + trail reversed + boundary[si+1..end]
      candB = [];
      for (let k = 0; k <= si; k++) candB.push(av[k].clone());
      for (let j = trail.length - 1; j >= 0; j--) candB.push(trail[j].clone());
      for (let k = si + 1; k < av.length; k++) candB.push(av[k].clone());
    } else {
      // Arc A: ei → si walking forward
      const arcA = [];
      for (let i = ei; ; i = (i + 1) % av.length) {
        arcA.push(av[i].clone());
        if (i === si) break;
        if (arcA.length > av.length) break;
      }
      // Arc B: si → ei walking forward
      const arcB = [];
      for (let i = si; ; i = (i + 1) % av.length) {
        arcB.push(av[i].clone());
        if (i === ei) break;
        if (arcB.length > av.length) break;
      }

      // Candidate A: arcA + trail forward
      candA = [...arcA];
      for (const t of trail) candA.push(t.clone());

      // Candidate B: arcB + trail reversed
      candB = [...arcB];
      for (let j = trail.length - 1; j >= 0; j--) candB.push(trail[j].clone());
    }

    const areaA = polyArea(to2D(candA)), areaB = polyArea(to2D(candB));
    const chosen = areaA > areaB ? "A" : "B";
    const newVerts = areaA > areaB ? candA : candB;
    const newArea = Math.max(areaA, areaB);

    // Safety: never shrink territory. If both candidates are smaller, abort.
    if (newArea < prevArea) {
      if (this.isPlayer) {
        dlog("CLAIM", "ABORTED: would shrink territory", {
          prevArea: prevArea.toFixed(2), bestCandArea: newArea.toFixed(2),
          candAArea: areaA.toFixed(2), candBArea: areaB.toFixed(2),
          chosen, si, ei
        });
      }
      this._clearTrail();
      return;
    }

    if (this.isPlayer) {
      dlog("CLAIM", "polygon options", {
        candAVerts: candA.length, candAArea: areaA.toFixed(2),
        candBVerts: candB.length, candBArea: areaB.toFixed(2),
        chosen,
        arcA_ei_to_si: candA.length - trail.length,
        arcB_si_to_ei: candB.length - trail.length
      });
    }

    // Validate: try triangulating before committing
    const testIdx = triangulate(to2D(newVerts));
    if (testIdx.length > 0) {
      this.areaVerts = newVerts;
      this._rebuildAreaMesh();
      if (CONQUEST_MODE === "REPLACE_OWNER") {
        this._subtractFromOthers();
      }
      if (this.isPlayer) {
        dlog("CLAIM", "SUCCESS", {
          newVertCount: newVerts.length, newArea: newArea.toFixed(2),
          areaChange: (newArea - prevArea).toFixed(2),
          triangles: testIdx.length / 3,
          areaGrew: newArea > prevArea
        });
      }
    } else {
      if (this.isPlayer) {
        dlog("CLAIM", "FAILED triangulation", {
          newVertCount: newVerts.length, chosen,
          candATriTest: triangulate(to2D(candA)).length,
          candBTriTest: triangulate(to2D(candB)).length
        });
      }
    }
    this._clearTrail();
  }

  _subtractFromOthers() {
    if (!this.allCharacters) return;
    const claimerPoly2D = to2D(this.areaVerts);
    if (claimerPoly2D.length < 3) return;

    const othersCount = this.allCharacters.filter(c => c !== this).length;
    dlog("CONQUEST_CHECK", `${this.name} checking subtraction against ${othersCount} other characters`, {
      claimerVerts: claimerPoly2D.length,
      claimerArea: polyArea(claimerPoly2D).toFixed(2)
    });

    for (const victim of this.allCharacters) {
      if (victim === this) continue;
      if (victim.areaVerts.length < 3) continue;

      const victimPoly2D = to2D(victim.areaVerts);

      // Quick check: does any victim vertex fall inside claimer's polygon?
      let hasOverlap = false;
      let victimInsideCount = 0;
      let claimerInsideCount = 0;
      for (const v of victimPoly2D) {
        if (pointInPoly(v.x, v.y, claimerPoly2D)) { hasOverlap = true; victimInsideCount++; }
      }
      // Also check if any claimer vertex falls inside victim (claimer fully inside victim edge case)
      if (!hasOverlap) {
        for (const v of claimerPoly2D) {
          if (pointInPoly(v.x, v.y, victimPoly2D)) { hasOverlap = true; claimerInsideCount++; }
        }
      }
      dlog("CONQUEST_OVERLAP", `${this.name} vs ${victim.name}: overlap=${hasOverlap}`, {
        victimVertsInsideClaimer: victimInsideCount,
        claimerVertsInsideVictim: claimerInsideCount,
        victimVerts: victimPoly2D.length,
        claimerVerts: claimerPoly2D.length
      });
      if (!hasOverlap) continue;

      const prevArea = polyArea(victimPoly2D);
      const resultPoly2D = subtractPolygon(victimPoly2D, claimerPoly2D);

      if (resultPoly2D.length < 3) {
        // Victim's territory is fully consumed
        dlog("CONQUEST", "fully consumed " + victim.name, {
          claimer: this.name,
          prevArea: prevArea.toFixed(2)
        });
        victim.areaVerts = [];
        if (victim.areaMesh) {
          victim.scene.remove(victim.areaMesh);
          victim.areaMesh.geometry.dispose();
          victim.areaMesh = null;
        }
        continue;
      }

      // Convert result back to 3D
      const newVerts3D = resultPoly2D.map(p => new THREE.Vector3(p.x, 0, p.y));

      // Validate: try triangulating and check area didn't increase
      const testIdx = triangulate(resultPoly2D);
      if (testIdx.length > 0) {
        const newArea = polyArea(resultPoly2D);
        // Safety: subtraction must never INCREASE the victim's area
        if (newArea > prevArea * 1.01) {
          dlog("CONQUEST", "REJECTED: subtraction would increase area for " + victim.name, {
            claimer: this.name,
            prevArea: prevArea.toFixed(2),
            newArea: newArea.toFixed(2),
            areaIncrease: (newArea - prevArea).toFixed(2)
          });
        } else {
          dlog("CONQUEST", "subtracted from " + victim.name, {
            claimer: this.name,
            prevArea: prevArea.toFixed(2),
            newArea: newArea.toFixed(2),
            areaLost: (prevArea - newArea).toFixed(2),
            prevVerts: victim.areaVerts.length,
            newVerts: newVerts3D.length
          });
          victim.areaVerts = newVerts3D;
          victim._rebuildAreaMesh();
        }
      } else {
        dlog("CONQUEST", "subtraction failed triangulation for " + victim.name, {
          claimer: this.name,
          resultVerts: resultPoly2D.length
        });
      }

      // CONTINUOUS_LAND: detect and discard disconnected fragments after subtraction
      if (CONTINUOUS_LAND && victim.areaVerts.length >= 3) {
        const fragPoly2D = to2D(victim.areaVerts);
        const fragments = splitPolygonFragments(fragPoly2D);

        if (fragments.length > 1) {
          const fragAreas = fragments.map(f => polyArea(f));
          dlog("CONTINUOUS_LAND", `${victim.name}: subtraction produced ${fragments.length} fragments`, {
            areas: fragAreas.map(a => a.toFixed(2))
          });

          // Determine which fragment the victim is connected to:
          // 1. Check if the victim's character is physically inside a fragment
          // 2. If outside all fragments (capturing via trail), check which fragment
          //    contains the first trail point (where they exited territory)
          // 3. Fallback: keep the largest fragment
          let keepIdx = -1;

          // Strategy 1: player position inside a fragment
          for (let fi = 0; fi < fragments.length; fi++) {
            if (pointInPoly(victim.pos.x, victim.pos.z, fragments[fi])) {
              keepIdx = fi;
              dlog("CONTINUOUS_LAND", `${victim.name}: keeping fragment ${fi} (player inside)`, {
                area: fragAreas[fi].toFixed(2)
              });
              break;
            }
          }

          // Strategy 2: trail start point inside a fragment
          if (keepIdx === -1 && victim.trailVerts.length > 0) {
            const trailStart = victim.trailVerts[0];
            for (let fi = 0; fi < fragments.length; fi++) {
              if (pointInPoly(trailStart.x, trailStart.z, fragments[fi])) {
                keepIdx = fi;
                dlog("CONTINUOUS_LAND", `${victim.name}: keeping fragment ${fi} (trail start inside)`, {
                  area: fragAreas[fi].toFixed(2),
                  trailStart: { x: trailStart.x.toFixed(2), z: trailStart.z.toFixed(2) }
                });
                break;
              }
            }
          }

          // Strategy 3: fallback to largest fragment
          if (keepIdx === -1) {
            keepIdx = 0;
            let maxArea = fragAreas[0];
            for (let fi = 1; fi < fragments.length; fi++) {
              if (fragAreas[fi] > maxArea) {
                maxArea = fragAreas[fi];
                keepIdx = fi;
              }
            }
            dlog("CONTINUOUS_LAND", `${victim.name}: keeping fragment ${keepIdx} (largest, fallback)`, {
              area: fragAreas[keepIdx].toFixed(2)
            });
          }

          // Calculate total area lost from discarded fragments
          let discardedArea = 0;
          for (let fi = 0; fi < fragments.length; fi++) {
            if (fi !== keepIdx) discardedArea += fragAreas[fi];
          }
          dlog("CONTINUOUS_LAND", `${victim.name}: discarding ${fragments.length - 1} fragments`, {
            keptFragment: keepIdx,
            keptArea: fragAreas[keepIdx].toFixed(2),
            discardedArea: discardedArea.toFixed(2),
            totalFragments: fragments.length
          });

          // Apply: set victim's territory to the kept fragment
          const keptFrag = fragments[keepIdx];
          victim.areaVerts = keptFrag.map(p => new THREE.Vector3(p.x, 0, p.y));
          victim._rebuildAreaMesh();
        }
      }
    }
  }

  _clearTrail() {
    this.trailVerts = [];
    if (this.trailMesh) { this.scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); this.trailMesh = null; }
  }

  die() {
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

  getAreaPct() { return (polyArea(to2D(this.areaVerts)) / TOTAL_AREA) * 100; }
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

    // Create player
    const sp = randomSpawn([]);
    this.player = new Character(this.scene, sp.x, sp.z, COLORS[0], name, true);
    this.characters.push(this.player);

    // Create bots
    for (let i = 0; i < BOT_COUNT; i++) {
      const pos = randomSpawn(this.characters);
      const bot = new Character(this.scene, pos.x, pos.z, COLORS[(i+1) % COLORS.length], BOT_NAMES[i], false);
      this.characters.push(bot);
    }

    // Give each character a reference to all characters for conquest subtraction
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

    // Bot AI — loop-based territory claiming
    for (const c of this.characters) {
      if (c.isPlayer || !c.alive) continue;

      // If no waypoints, plan a new claiming loop
      if (c.botWaypoints.length === 0) {
        try {
          this._planBotLoop(c);
        } catch (e) {
          dlog("BOT_AI", `${c.name} _planBotLoop error: ${e.message}`);
          // Fallback: wander randomly
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
          c.botWaypoints.shift(); // reached waypoint, move to next
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
    // If territory was fully consumed, bot has no home — just wander toward center
    if (bot.areaVerts.length < 3) {
      dlog("BOT_AI", `${bot.name} has no territory, wandering toward center`);
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 },
        { x: (Math.random() - 0.5) * ARENA_RADIUS * 0.5, z: (Math.random() - 0.5) * ARENA_RADIUS * 0.5 }
      ];
      return;
    }

    // Compute territory center
    let cx = 0, cz = 0;
    for (const v of bot.areaVerts) { cx += v.x; cz += v.z; }
    cx /= bot.areaVerts.length;
    cz /= bot.areaVerts.length;

    // Decide: aggro (head toward another player's territory) or normal patrol
    const doAggro = Math.random() < bot.botAggroChance;
    let outAngle;

    if (doAggro) {
      // Find another alive character to target
      const others = this.characters.filter(o => o !== bot && o.alive && o.areaVerts.length > 0);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        let tx = 0, tz = 0;
        for (const v of target.areaVerts) { tx += v.x; tz += v.z; }
        tx /= target.areaVerts.length;
        tz /= target.areaVerts.length;
        outAngle = Math.atan2(tx - cx, tz - cz);
      } else {
        outAngle = Math.random() * Math.PI * 2;
      }
    } else {
      outAngle = Math.random() * Math.PI * 2;
    }

    // Build a claiming loop: exit boundary -> arc outward -> re-enter boundary
    // Loop radius determines how far the bot goes out
    const loopRadius = 5 + Math.random() * 6; // 5-11 units out from boundary
    const arcSteps = 4 + Math.floor(Math.random() * 3); // 4-6 waypoints in the arc

    // Find the exit point on boundary (closest to outward direction)
    const exitDir = { x: cx + Math.sin(outAngle) * 50, z: cz + Math.cos(outAngle) * 50 };
    const exitIdx = closestIdx(bot.areaVerts, exitDir);
    const exitPt = bot.areaVerts[exitIdx];

    // The arc sweeps from one side to the other outside territory
    // Start angle offset and end angle offset for the arc
    const arcSpread = (Math.PI * 0.4) + Math.random() * (Math.PI * 0.4); // 72-144 degree arc
    const startArcAngle = outAngle - arcSpread / 2;
    const endArcAngle = outAngle + arcSpread / 2;

    // Generate arc waypoints outside territory
    const waypoints = [];

    // First: walk to exit point on our boundary
    waypoints.push({ x: exitPt.x, z: exitPt.z });

    // Then: arc outward
    for (let i = 0; i <= arcSteps; i++) {
      const t = i / arcSteps;
      const angle = startArcAngle + (endArcAngle - startArcAngle) * t;
      // Distance from territory center varies — push out then come back
      // Minimum push of 2 units ensures waypoints are clearly outside territory
      const pushOut = 2 + loopRadius * Math.sin(t * Math.PI); // bulge in the middle
      const r = START_RADIUS + pushOut;
      let wx = cx + Math.sin(angle) * r;
      let wz = cz + Math.cos(angle) * r;
      // Clamp inside arena
      const distFromOrigin = Math.sqrt(wx * wx + wz * wz);
      if (distFromOrigin > ARENA_RADIUS - 1) {
        wx *= (ARENA_RADIUS - 1) / distFromOrigin;
        wz *= (ARENA_RADIUS - 1) / distFromOrigin;
      }
      waypoints.push({ x: wx, z: wz });
    }

    // Finally: return to a point on our boundary (near where the arc ends)
    const reEntryDir = { x: cx + Math.sin(endArcAngle) * 50, z: cz + Math.cos(endArcAngle) * 50 };
    const reEntryIdx = closestIdx(bot.areaVerts, reEntryDir);
    const reEntryPt = bot.areaVerts[reEntryIdx];
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
