import {
  GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS,
} from "./constants.js";

// ---- Local geometry helpers (ported from prototype/main.js) ----

function gridToWorld(gx, gy) {
  return {
    wx: WORLD_MIN + (gx + 0.5) * CELL_SIZE,
    wy: WORLD_MIN + (gy + 0.5) * CELL_SIZE,
  };
}

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
  result.pop();
  return result.length >= 3 ? result : points;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a / 2);
}

function closestIdx(verts, target) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const dx = verts[i].x - target.x, dz = verts[i].z - target.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function countCells(grid, ownerId) {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === ownerId) count++;
  }
  return count;
}

// Marching-squares contour extraction. Returns an array of closed loops, each a
// list of {x, y} points in world coords (y is the second axis, i.e. z).
// Faithful port of prototype/main.js territoryGrid.extractContours.
function extractContours(grid, ownerId) {
  const owned = (gx, gy) => {
    if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return 0;
    return grid[gy * GRID_SIZE + gx] === ownerId ? 1 : 0;
  };

  let minGX = GRID_SIZE, maxGX = 0, minGY = GRID_SIZE, maxGY = 0;
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      if (grid[gy * GRID_SIZE + gx] === ownerId) {
        if (gx < minGX) minGX = gx;
        if (gx > maxGX) maxGX = gx;
        if (gy < minGY) minGY = gy;
        if (gy > maxGY) maxGY = gy;
      }
    }
  }
  if (minGX > maxGX) return [];

  minGX = Math.max(0, minGX - 1);
  minGY = Math.max(0, minGY - 1);
  maxGX = Math.min(GRID_SIZE - 1, maxGX + 1);
  maxGY = Math.min(GRID_SIZE - 1, maxGY + 1);

  const segments = [];
  for (let gy = minGY; gy < maxGY; gy++) {
    for (let gx = minGX; gx < maxGX; gx++) {
      const tl = owned(gx, gy);
      const tr = owned(gx + 1, gy);
      const br = owned(gx + 1, gy + 1);
      const bl = owned(gx, gy + 1);
      const caseIdx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caseIdx === 0 || caseIdx === 15) continue;

      const top = { gx: gx + 0.5, gy: gy };
      const right = { gx: gx + 1, gy: gy + 0.5 };
      const bottom = { gx: gx + 0.5, gy: gy + 1 };
      const left = { gx: gx, gy: gy + 0.5 };

      switch (caseIdx) {
        case 1:  segments.push([bottom, left]); break;
        case 2:  segments.push([right, bottom]); break;
        case 3:  segments.push([right, left]); break;
        case 4:  segments.push([top, right]); break;
        case 5:  segments.push([top, left]); segments.push([right, bottom]); break;
        case 6:  segments.push([top, bottom]); break;
        case 7:  segments.push([top, left]); break;
        case 8:  segments.push([left, top]); break;
        case 9:  segments.push([bottom, top]); break;
        case 10: segments.push([left, bottom]); segments.push([top, right]); break;
        case 11: segments.push([right, top]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
      }
    }
  }

  if (segments.length === 0) return [];

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

      const endKey = key(seg[1]);
      current = -1;
      const candidates = adjMap.get(endKey);
      if (candidates) {
        for (const ci of candidates) {
          if (!used[ci]) { current = ci; break; }
        }
      }
    }

    if (loop.length >= 3) {
      const worldLoop = loop.map(p => {
        const { wx, wy } = gridToWorld(p.gx, p.gy);
        return { x: wx, y: wy };
      });
      const simplified = simplifyContour(worldLoop, 0.08);
      if (simplified.length >= 3) loops.push(simplified);
    }
  }

  return loops;
}

// ---- BotAI ----

export class BotAI {
  /**
   * Compute a unit-length target direction for the given bot character.
   * Plans a new claiming loop into bot.botWaypoints when the queue is empty,
   * then returns a unit vector toward the next waypoint.
   * @param {object} bot - sim Character (needs pos, factionId, botWaypoints, etc.)
   * @param {object} sim - Simulation (provides grid + characters)
   * @returns {{x: number, z: number}} unit direction
   */
  static planTargetDir(bot, sim) {
    if (bot.botWaypoints.length === 0) {
      try {
        BotAI._planLoop(bot, sim);
      } catch (e) {
        // Fallback: random short hop.
        const angle = Math.random() * Math.PI * 2;
        bot.botWaypoints = [{
          x: bot.pos.x + Math.sin(angle) * 5,
          z: bot.pos.z + Math.cos(angle) * 5,
        }];
      }
    }

    // Walk the waypoint queue. Pop any waypoints we are already standing on,
    // and steer toward the first remaining one.
    while (bot.botWaypoints.length > 0) {
      const wp = bot.botWaypoints[0];
      const dx = wp.x - bot.pos.x;
      const dz = wp.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) {
        bot.botWaypoints.shift();
        continue;
      }
      return { x: dx / d, z: dz / d };
    }

    // No waypoint to steer toward — keep current heading.
    const cd = bot.dir;
    const cl = Math.hypot(cd.x, cd.z);
    if (cl > 1e-6) return { x: cd.x / cl, z: cd.z / cl };
    return { x: 0, z: 1 };
  }

  // Faithful port of prototype/main.js Game._planBotLoop, adapted to read
  // sim.grid and sim.characters (sim Character data, not renderer wrappers).
  static _planLoop(bot, sim) {
    const grid = sim.grid;

    // If territory was fully consumed, bot has no home — wander toward center.
    const cellCount = countCells(grid, bot.factionId);
    if (cellCount === 0) {
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 },
        { x: (Math.random() - 0.5) * ARENA_RADIUS * 0.5,
          z: (Math.random() - 0.5) * ARENA_RADIUS * 0.5 },
      ];
      return;
    }

    const contours = extractContours(grid, bot.factionId);
    if (contours.length === 0) {
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 },
      ];
      return;
    }
    contours.sort((a, b) => polyArea(b) - polyArea(a));
    const boundary = contours[0];

    let cx = 0, cz = 0;
    for (const v of boundary) { cx += v.x; cz += v.y; }
    cx /= boundary.length;
    cz /= boundary.length;

    // Convert boundary {x, y} → {x, z} for closestIdx.
    const boundaryV = boundary.map(p => ({ x: p.x, z: p.y }));

    const aggroChance = bot.botAggroChance;
    const doAggro = Math.random() < aggroChance;
    let outAngle;

    if (doAggro) {
      const others = sim.characters.filter(o =>
        o !== bot &&
        o.alive &&
        o.factionId !== bot.factionId &&
        countCells(grid, o.factionId) > 0
      );
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        outAngle = Math.atan2(target.pos.x - cx, target.pos.z - cz);
      } else {
        outAngle = Math.random() * Math.PI * 2;
      }
    } else {
      outAngle = Math.random() * Math.PI * 2;
    }

    const loopRadius = 5 + Math.random() * 6;
    const arcSteps = 4 + Math.floor(Math.random() * 3);

    const exitDir = { x: cx + Math.sin(outAngle) * 50, z: cz + Math.cos(outAngle) * 50 };
    const exitIdx = closestIdx(boundaryV, exitDir);
    const exitPt = boundaryV[exitIdx];

    const arcSpread = (Math.PI * 0.4) + Math.random() * (Math.PI * 0.4);
    const startArcAngle = outAngle - arcSpread / 2;
    const endArcAngle = outAngle + arcSpread / 2;

    const waypoints = [];
    waypoints.push({ x: exitPt.x, z: exitPt.z });

    for (let i = 0; i <= arcSteps; i++) {
      const t = i / arcSteps;
      const angle = startArcAngle + (endArcAngle - startArcAngle) * t;
      const pushOut = 2 + loopRadius * Math.sin(t * Math.PI);
      const r = pushOut;
      let wx = cx + Math.sin(angle) * r;
      let wz = cz + Math.cos(angle) * r;
      const distFromOrigin = Math.sqrt(wx * wx + wz * wz);
      if (distFromOrigin > ARENA_RADIUS - 1) {
        wx *= (ARENA_RADIUS - 1) / distFromOrigin;
        wz *= (ARENA_RADIUS - 1) / distFromOrigin;
      }
      waypoints.push({ x: wx, z: wz });
    }

    const reEntryDir = { x: cx + Math.sin(endArcAngle) * 50, z: cz + Math.cos(endArcAngle) * 50 };
    const reEntryIdx = closestIdx(boundaryV, reEntryDir);
    const reEntryPt = boundaryV[reEntryIdx];
    waypoints.push({ x: reEntryPt.x, z: reEntryPt.z });

    waypoints.push({ x: cx, z: cz });

    bot.botWaypoints = waypoints;
    bot.botLoopCount = (bot.botLoopCount || 0) + 1;
  }
}
