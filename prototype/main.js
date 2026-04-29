import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import earcut from "earcut";

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
try { localStorage.removeItem("captureArena_debug"); } catch(e) {}
function dlog(category, msg, data) {
  const entry = { t: performance.now().toFixed(1), cat: category, msg, ...(data || {}) };
  DEBUG_LOG.push(entry);
  if (DEBUG_LOG.length > DEBUG_MAX) DEBUG_LOG.shift();
  console.log(`[${entry.t}][${category}] ${msg}`, data || "");
  try { localStorage.setItem("captureArena_debug", JSON.stringify(DEBUG_LOG)); } catch(e) {}
}

// ===================== TRIANGULATOR (earcut — robust, handles degenerate polygons) =====================
function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  // Flatten {x, y} array into [x0, y0, x1, y1, ...] for earcut
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

// ===================== POLYGON-CLIPPING LIBRARY HELPERS =====================
// Convert our {x, y} 2D polygon to the library's GeoJSON-style coordinate format:
// Polygon = [Ring], Ring = [[x,y], [x,y], ...] (closed: first == last)
function poly2DToGeoJSON(poly2D) {
  const ring = poly2D.map(p => [p.x, p.y]);
  // Close the ring (GeoJSON requires first == last)
  if (ring.length > 0) {
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return [ring]; // Polygon = [outerRing]
}

// Convert library's MultiPolygon result back to our {x, y} format.
// Returns the largest polygon (by area) as a flat array of {x, y} points.
// Also returns all polygons for cases where we need fragments.
function multiPolyFromGeoJSON(multiPoly) {
  if (!multiPoly || multiPoly.length === 0) return { largest: [], all: [] };

  const allPolys = [];
  for (const polygon of multiPoly) {
    // Each polygon is [outerRing, ...holeRings]. We only use the outer ring.
    const outerRing = polygon[0];
    if (!outerRing || outerRing.length < 3) continue;
    // Convert to {x, y}, dropping the closing duplicate point
    const pts = [];
    for (let i = 0; i < outerRing.length; i++) {
      const p = { x: outerRing[i][0], y: outerRing[i][1] };
      // Skip closing duplicate
      if (i === outerRing.length - 1) {
        const first = pts[0];
        if (first && Math.abs(p.x - first.x) < 1e-10 && Math.abs(p.y - first.y) < 1e-10) continue;
      }
      pts.push(p);
    }
    if (pts.length >= 3) allPolys.push(pts);
  }

  if (allPolys.length === 0) return { largest: [], all: [] };

  // Find the largest polygon by area
  let bestIdx = 0, bestArea = polyArea(allPolys[0]);
  for (let i = 1; i < allPolys.length; i++) {
    const a = polyArea(allPolys[i]);
    if (a > bestArea) { bestArea = a; bestIdx = i; }
  }

  return { largest: allPolys[bestIdx], all: allPolys };
}

function subtractPolygon(victimPoly2D, claimerPoly2D) {
  // Subtract claimerPoly2D from victimPoly2D (victim minus claimer).
  // Returns array of 2D points forming the result polygon, or [] if fully consumed.
  // Uses the polygon-clipping library (Martinez-Rueda algorithm) for robust boolean ops.

  if (victimPoly2D.length < 3 || claimerPoly2D.length < 3) return [];

  try {
    const victimGeo = poly2DToGeoJSON(victimPoly2D);
    const claimerGeo = poly2DToGeoJSON(claimerPoly2D);
    const result = polygonClipping.difference(victimGeo, claimerGeo);
    const { largest } = multiPolyFromGeoJSON(result);
    return largest;
  } catch (e) {
    dlog("SUBTRACT", "polygon-clipping difference() threw", { error: e.message });
    return victimPoly2D.slice(); // fallback: return victim unchanged
  }
}

// Union two 2D polygons. Returns the merged polygon as {x, y}[] or [] on failure.
function unionPolygons(polyA2D, polyB2D) {
  if (polyA2D.length < 3 && polyB2D.length < 3) return [];
  if (polyA2D.length < 3) return polyB2D.slice();
  if (polyB2D.length < 3) return polyA2D.slice();

  try {
    const geoA = poly2DToGeoJSON(polyA2D);
    const geoB = poly2DToGeoJSON(polyB2D);
    const result = polygonClipping.union(geoA, geoB);
    const { largest } = multiPolyFromGeoJSON(result);
    return largest;
  } catch (e) {
    dlog("UNION", "polygon-clipping union() threw", { error: e.message });
    return []; // fallback: return empty (caller should handle)
  }
}

// Difference that returns ALL resulting polygons (for CONTINUOUS_LAND fragment splitting)
function subtractPolygonAll(victimPoly2D, claimerPoly2D) {
  if (victimPoly2D.length < 3 || claimerPoly2D.length < 3) return [];

  try {
    const victimGeo = poly2DToGeoJSON(victimPoly2D);
    const claimerGeo = poly2DToGeoJSON(claimerPoly2D);
    const result = polygonClipping.difference(victimGeo, claimerGeo);
    const { all } = multiPolyFromGeoJSON(result);
    return all;
  } catch (e) {
    dlog("SUBTRACT_ALL", "polygon-clipping difference() threw", { error: e.message });
    return [victimPoly2D.slice()]; // fallback: return victim unchanged as single fragment
  }
}

// DEBUG: expose for testing (comment out in production)
// window._subtractPolygon = subtractPolygon;
// window._unionPolygons = unionPolygons;
// window._polyArea = polyArea;
// window._pointInPoly = pointInPoly;

// ===================== POLYGON SIMPLIFICATION =====================

// --- Ramer-Douglas-Peucker for open polylines ---
function _pointToSegmentDist(p, a, b) {
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

function _rdpSimplify(points, epsilon, start, end) {
  if (end - start < 2) return [points[start], points[end]];
  let maxDist = 0, maxIdx = start;
  const a = points[start], b = points[end];
  for (let i = start + 1; i < end; i++) {
    const d = _pointToSegmentDist(points[i], a, b);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = _rdpSimplify(points, epsilon, start, maxIdx);
    const right = _rdpSimplify(points, epsilon, maxIdx, end);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

// RDP for closed polygons: try multiple "seam" positions, pick the one that
// produces the best result (avoids artifacts from a single fixed seam).
function simplifyRDP(poly, epsilon) {
  if (poly.length <= 4) return poly;

  // For small polygons just use single-seam RDP
  if (poly.length <= 20) {
    const open = poly.concat([poly[0]]);
    const simplified = _rdpSimplify(open, epsilon, 0, open.length - 1);
    // Remove closing duplicate
    if (simplified.length > 1) simplified.pop();
    return simplified.length >= 3 ? simplified : poly;
  }

  // For larger polygons, try 3 seam positions and pick the one with fewest vertices
  // (they all respect the epsilon tolerance, so fewer = cleaner)
  const n = poly.length;
  let best = poly;
  const seams = [0, Math.floor(n / 3), Math.floor(2 * n / 3)];
  for (const seam of seams) {
    // Rotate polygon so seam is at index 0
    const rotated = poly.slice(seam).concat(poly.slice(0, seam));
    const open = rotated.concat([rotated[0]]);
    const simplified = _rdpSimplify(open, epsilon, 0, open.length - 1);
    if (simplified.length > 1) simplified.pop();
    if (simplified.length >= 3 && simplified.length < best.length) {
      best = simplified;
    }
  }
  return best;
}

// Remove near-duplicate vertices (vertices too close together)
function deduplicatePolygon(verts, minDist) {
    if (verts.length < 3) return verts;
    const minDistSq = minDist * minDist;
    const result = [verts[0]];
    for (let i = 1; i < verts.length; i++) {
        const prev = result[result.length - 1];
        const dx = verts[i].x - prev.x, dy = verts[i].y - prev.y;
        if (dx * dx + dy * dy >= minDistSq) {
            result.push(verts[i]);
        }
    }
    // Check last vs first
    if (result.length > 1) {
        const first = result[0], last = result[result.length - 1];
        const dx = last.x - first.x, dy = last.y - first.y;
        if (dx * dx + dy * dy < minDistSq) result.pop();
    }
    return result.length >= 3 ? result : verts;
}

// Remove spike patterns: three consecutive vertices A-B-C where B creates a
// near-zero-area triangle but B is far from the AC line (thin spike).
// Also catches backtracking edges where the polygon doubles back on itself.
function removeSpikes(poly, areaThreshold = 0.08, minEdgeLen = 0.15) {
    if (poly.length <= 4) return poly;
    const minEdgeSq = minEdgeLen * minEdgeLen;
    let changed = true;
    let result = poly.slice();

    // Iterate until stable (spikes can be nested)
    for (let pass = 0; pass < 3 && changed; pass++) {
        changed = false;
        const cleaned = [];
        const n = result.length;
        const remove = new Uint8Array(n);

        for (let i = 0; i < n; i++) {
            const prev = result[(i - 1 + n) % n];
            const curr = result[i];
            const next = result[(i + 1) % n];

            // Triangle area of prev-curr-next
            const triArea = Math.abs(
                (next.x - prev.x) * (curr.y - prev.y) -
                (next.y - prev.y) * (curr.x - prev.x)
            ) * 0.5;

            // Edge lengths squared
            const d_prev_curr_sq = (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2;
            const d_curr_next_sq = (next.x - curr.x) ** 2 + (next.y - curr.y) ** 2;

            // Spike check: tiny area triangle, meaning curr is either:
            // 1. Collinear with prev-next (harmless but redundant), or
            // 2. A thin spike extending out and back
            if (triArea < areaThreshold) {
                // Check that at least one of the edges is short enough to be a spike
                // (not just a long collinear segment we want to keep as a simplification point)
                const d_prev_next_sq = (next.x - prev.x) ** 2 + (next.y - prev.y) ** 2;
                const maxEdge = Math.max(d_prev_curr_sq, d_curr_next_sq);
                const baseLen = Math.sqrt(d_prev_next_sq);

                // If the "spike height" (area * 2 / base) is tiny, remove
                if (baseLen > 1e-6) {
                    const spikeHeight = (triArea * 2) / baseLen;
                    if (spikeHeight < 0.15) {
                        remove[i] = 1;
                        changed = true;
                        continue;
                    }
                }
            }

            // Micro-edge check: very short edge to next vertex
            if (d_curr_next_sq < minEdgeSq) {
                // Keep the vertex that's farther from the previous kept vertex
                // (skip this one, next one will be evaluated fresh)
                remove[i] = 1;
                changed = true;
            }
        }

        for (let i = 0; i < n; i++) {
            if (!remove[i]) cleaned.push(result[i]);
        }
        result = cleaned.length >= 3 ? cleaned : result;
    }
    return result;
}

// Remove thin protrusions: detect narrow "bridge" patterns where the polygon
// nearly touches itself, creating a thin strip. We find pairs of non-adjacent
// vertices that are very close, and if the polygon path between them encloses
// very little area, we shortcut across them.
function removeThinProtrusions(poly, widthThreshold = 0.4, minProtrusionVerts = 3) {
    if (poly.length <= 8) return poly;
    const n = poly.length;
    const widthSq = widthThreshold * widthThreshold;

    // Find pairs of non-adjacent vertices that are close together
    for (let i = 0; i < n; i++) {
        for (let j = i + minProtrusionVerts; j < n; j++) {
            // Skip adjacent pairs (including wrap-around)
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;

            const dx = poly[i].x - poly[j].x;
            const dy = poly[i].y - poly[j].y;
            if (dx * dx + dy * dy > widthSq) continue;

            // Found a close pair. Check if the path between them (the shorter arc)
            // forms a thin protrusion (very small area relative to its perimeter).
            const arcLen = j - i;
            const otherArcLen = n - arcLen;

            // Pick the shorter arc as the potential protrusion
            let protStart, protEnd, protLen;
            if (arcLen <= otherArcLen) {
                protStart = i; protEnd = j; protLen = arcLen;
            } else {
                protStart = j; protEnd = i; protLen = otherArcLen;
            }

            if (protLen < minProtrusionVerts || protLen > n / 2) continue;

            // Calculate the area of the protrusion arc
            let protArea = 0;
            for (let k = 0; k < protLen; k++) {
                const ci = (protStart + k) % n;
                const ni = (protStart + k + 1) % n;
                protArea += poly[ci].x * poly[ni].y - poly[ni].x * poly[ci].y;
            }
            protArea = Math.abs(protArea) * 0.5;

            // Calculate perimeter of the protrusion
            let perim = 0;
            for (let k = 0; k < protLen; k++) {
                const ci = (protStart + k) % n;
                const ni = (protStart + k + 1) % n;
                const ex = poly[ni].x - poly[ci].x, ey = poly[ni].y - poly[ci].y;
                perim += Math.sqrt(ex * ex + ey * ey);
            }

            // Thin protrusion test: area is very small relative to perimeter squared
            // (a circle has area/perim^2 ~ 0.08, a thin strip has ~ 0)
            if (perim > 0 && protArea / (perim * perim) < 0.01) {
                // Remove the protrusion: keep the main body, skip the thin arc
                // Midpoint of the close pair replaces the protrusion
                const mid = {
                    x: (poly[i].x + poly[j].x) * 0.5,
                    y: (poly[i].y + poly[j].y) * 0.5
                };

                let result;
                if (arcLen <= otherArcLen) {
                    // Remove indices i+1 to j-1, replace with midpoint
                    result = [];
                    for (let k = j; k !== i; k = (k + 1) % n) {
                        result.push(poly[k]);
                    }
                    result.push(mid);
                } else {
                    // Remove indices j+1 to i-1, replace with midpoint
                    result = [];
                    for (let k = i; k !== j; k = (k + 1) % n) {
                        result.push(poly[k]);
                    }
                    result.push(mid);
                }

                if (result.length >= 3) {
                    // Recurse: there might be more protrusions
                    return removeThinProtrusions(result, widthThreshold, minProtrusionVerts);
                }
            }
        }
    }
    return poly;
}

// Full polygon cleanup pipeline: dedup -> remove spikes -> RDP -> remove protrusions -> ensure CCW
function cleanPolygon(poly2D) {
    if (poly2D.length < 3) return poly2D;

    let result = poly2D;

    // 1. Deduplicate very close vertices
    result = deduplicatePolygon(result, MIN_POINT_DIST * 0.5);

    // 2. Remove spikes and near-degenerate triangles
    result = removeSpikes(result, 0.08, MIN_POINT_DIST * 0.5);

    // 3. RDP simplification (epsilon = 0.12 — small enough to preserve shape, large enough to clean noise)
    result = simplifyRDP(result, 0.12);

    // 4. Remove thin protrusions (near-zero-width bridges)
    result = removeThinProtrusions(result, 0.5, 3);

    // 5. Final dedup pass (RDP/protrusion removal can create new near-duplicates)
    result = deduplicatePolygon(result, MIN_POINT_DIST);

    // 6. Ensure consistent winding
    ensureCCW(result);

    return result;
}

// Ensure polygon has consistent CCW winding order (2D)
function ensureCCW(poly2D) {
    if (poly2D.length < 3) return poly2D;
    let area = 0;
    for (let i = 0; i < poly2D.length; i++) {
        const j = (i + 1) % poly2D.length;
        area += poly2D[i].x * poly2D[j].y - poly2D[j].x * poly2D[i].y;
    }
    if (area < 0) {
        // CW winding — reverse to CCW
        poly2D.reverse();
    }
    return poly2D;
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
    // Reject spawn inside ANY character's territory (alive or dead)
    if (ok) {
      for (const c of characters) {
        if (c.areaVerts.length >= 3 && pointInPoly(x, z, to2D(c.areaVerts))) {
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

    // Pre-triangulation cleanup: ensure vertices are clean before rendering
    let pts2D = to2D(this.areaVerts);
    pts2D = cleanPolygon(pts2D);
    if (pts2D.length < 3) return;

    // Sync cleaned vertices back to areaVerts (keeps vertex count manageable)
    if (pts2D.length !== this.areaVerts.length) {
      this.areaVerts = pts2D.map(p => new THREE.Vector3(p.x, 0, p.y));
    }

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

    if (this.isPlayer) {
      dlog("CLAIM", "starting claim (union method)", {
        prevVertCount, prevArea: prevArea.toFixed(2),
        trailLen: trail.length,
        trailStart: `${trail[0].x.toFixed(2)},${trail[0].z.toFixed(2)}`,
        trailEnd: `${trail[trail.length-1].x.toFixed(2)},${trail[trail.length-1].z.toFixed(2)}`
      });
    }

    // Build a trail polygon by closing the trail loop through the territory boundary.
    // The trail starts near boundary vertex si and ends near boundary vertex ei.
    // We connect trail end -> boundary arc -> trail start to form a closed polygon,
    // then union it with the existing territory.
    const si = closestIdx(av, trail[0]);
    const ei = closestIdx(av, trail[trail.length - 1]);

    // Build trail polygon: trail points + boundary arc from ei back to si
    let trailPoly;
    if (si === ei) {
      // Trail forms a loop anchored at one boundary point — just close the trail itself
      trailPoly = trail.map(t => ({ x: t.x, y: t.z }));
    } else {
      // Two possible arcs to connect the trail ends through boundary: pick the shorter one
      const arcFwd = []; // ei -> ei+1 -> ... -> si
      for (let i = ei; ; i = (i + 1) % av.length) {
        arcFwd.push({ x: av[i].x, y: av[i].z });
        if (i === si) break;
        if (arcFwd.length > av.length) break;
      }
      const arcBwd = []; // ei -> ei-1 -> ... -> si
      for (let i = ei; ; i = (i - 1 + av.length) % av.length) {
        arcBwd.push({ x: av[i].x, y: av[i].z });
        if (i === si) break;
        if (arcBwd.length > av.length) break;
      }
      // Use the shorter arc
      const arc = arcFwd.length <= arcBwd.length ? arcFwd : arcBwd;

      // Trail polygon: trail forward + arc from ei back to si
      trailPoly = trail.map(t => ({ x: t.x, y: t.z }));
      // Add arc points (skipping first since it duplicates trail end, and last since it duplicates trail start)
      for (let i = 1; i < arc.length - 1; i++) {
        trailPoly.push(arc[i]);
      }
    }

    if (trailPoly.length < 3) {
      if (this.isPlayer) dlog("CLAIM", "aborted: trail polygon too small", { trailPolyLen: trailPoly.length });
      this._clearTrail();
      return;
    }

    // Union the trail polygon with existing territory using polygon-clipping library
    const existingPoly2D = to2D(av);
    const unionResult = unionPolygons(existingPoly2D, trailPoly);

    if (unionResult.length < 3) {
      if (this.isPlayer) {
        dlog("CLAIM", "FAILED: union produced empty result", {
          existingVerts: existingPoly2D.length,
          trailPolyVerts: trailPoly.length
        });
      }
      this._clearTrail();
      return;
    }

    const newArea = polyArea(unionResult);

    // Safety: never shrink territory
    if (newArea < prevArea - 0.1) {
      if (this.isPlayer) {
        dlog("CLAIM", "ABORTED: union would shrink territory", {
          prevArea: prevArea.toFixed(2), newArea: newArea.toFixed(2)
        });
      }
      this._clearTrail();
      return;
    }

    // Clean up: full pipeline (dedup, spike removal, RDP, protrusion removal, CCW)
    let cleanPoly2D = cleanPolygon(unionResult);

    // Validate: try triangulating before committing
    const testIdx = triangulate(cleanPoly2D);
    if (testIdx.length > 0) {
      this.areaVerts = cleanPoly2D.map(p => new THREE.Vector3(p.x, 0, p.y));
      this._rebuildAreaMesh();
      if (CONQUEST_MODE === "REPLACE_OWNER") {
        this._subtractFromOthers();
      }
      const finalArea = polyArea(to2D(this.areaVerts));
      if (this.isPlayer) {
        dlog("CLAIM", "SUCCESS (union)", {
          newVertCount: this.areaVerts.length, newArea: finalArea.toFixed(2),
          areaChange: (finalArea - prevArea).toFixed(2),
          triangles: testIdx.length / 3,
          areaGrew: finalArea > prevArea
        });
      }
    } else {
      if (this.isPlayer) {
        dlog("CLAIM", "FAILED triangulation after union", {
          unionVerts: cleanPoly2D.length
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

      // Use subtractPolygonAll to get ALL fragments (the library handles this natively)
      const allFragments = subtractPolygonAll(victimPoly2D, claimerPoly2D);

      if (allFragments.length === 0 || allFragments.every(f => f.length < 3)) {
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

      // CONTINUOUS_LAND: if subtraction produced multiple fragments, keep only the connected one
      let resultPoly2D;
      if (CONTINUOUS_LAND && allFragments.length > 1) {
        const fragAreas = allFragments.map(f => polyArea(f));
        dlog("CONTINUOUS_LAND", `${victim.name}: subtraction produced ${allFragments.length} fragments`, {
          areas: fragAreas.map(a => a.toFixed(2))
        });

        // Determine which fragment the victim is connected to:
        // 1. Check if the victim's character is physically inside a fragment
        // 2. If outside all fragments, check which fragment contains trail start
        // 3. Fallback: keep the largest fragment
        let keepIdx = -1;

        // Strategy 1: player position inside a fragment
        for (let fi = 0; fi < allFragments.length; fi++) {
          if (pointInPoly(victim.pos.x, victim.pos.z, allFragments[fi])) {
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
          for (let fi = 0; fi < allFragments.length; fi++) {
            if (pointInPoly(trailStart.x, trailStart.z, allFragments[fi])) {
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
          for (let fi = 1; fi < allFragments.length; fi++) {
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
        for (let fi = 0; fi < allFragments.length; fi++) {
          if (fi !== keepIdx) discardedArea += fragAreas[fi];
        }
        dlog("CONTINUOUS_LAND", `${victim.name}: discarding ${allFragments.length - 1} fragments`, {
          keptFragment: keepIdx,
          keptArea: fragAreas[keepIdx].toFixed(2),
          discardedArea: discardedArea.toFixed(2),
          totalFragments: allFragments.length
        });

        resultPoly2D = allFragments[keepIdx];
      } else {
        // Single fragment or CONTINUOUS_LAND disabled: use the largest
        resultPoly2D = allFragments.reduce((best, f) => polyArea(f) > polyArea(best) ? f : best, allFragments[0]);
      }

      // Clean up result: full pipeline (dedup, spike removal, RDP, protrusion removal, CCW)
      let cleanResult = cleanPolygon(resultPoly2D);

      // Convert result back to 3D
      const newVerts3D = cleanResult.map(p => new THREE.Vector3(p.x, 0, p.y));

      // Validate: try triangulating and check area didn't increase
      const testIdx = triangulate(cleanResult);
      if (testIdx.length > 0) {
        const newArea = polyArea(cleanResult);
        // Safety: subtraction must never INCREASE the victim's area
        if (newArea > prevArea + 0.1) {
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
