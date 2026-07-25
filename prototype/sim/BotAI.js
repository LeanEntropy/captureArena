import { ARENA_RADIUS } from "./constants.js";
import {
  polyArea,
  closestIdx,
} from "./grid_geom.js";

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
        // Fallback: head toward the arena center. Any random hop relative to
        // the bot's current pos can land outside the arena when the bot is
        // already at the rim — and the boundary clamp in Simulation pins the
        // bot at the wall, so the waypoint distance never drops below the
        // 1.2-unit consume threshold and the queue never drains.
        bot.botWaypoints = [{ x: 0, z: 0 }];
      }
    }

    // Defensive clamp: if the next waypoint is outside the arena interior,
    // pull it inward. This guards against any planner path that produces an
    // unreachable waypoint (the bot would otherwise burn forever pushed into
    // the wall by Simulation._stepCharacter's boundary clamp).
    const SAFE_R = ARENA_RADIUS - 2;
    const wp0 = bot.botWaypoints[0];
    if (wp0) {
      const wpR = Math.hypot(wp0.x, wp0.z);
      if (wpR > SAFE_R) {
        const inv = SAFE_R / wpR;
        wp0.x *= inv;
        wp0.z *= inv;
      }
    }

    // Abandon a route that is no longer making progress. This is deliberately
    // slow to trigger so normal wide turns remain fair; it only breaks the
    // obvious wall/waypoint circles that can otherwise last indefinitely.
    if (wp0) {
      const waypointDist = Math.hypot(wp0.x - bot.pos.x, wp0.z - bot.pos.z);
      if (waypointDist < bot.botLastWaypointDist - 0.02) bot.botStallTicks = 0;
      else bot.botStallTicks = (bot.botStallTicks || 0) + 1;
      bot.botLastWaypointDist = waypointDist;
      if (bot.botStallTicks > 120) {
        bot.botWaypoints = [];
        bot.botLastWaypointDist = Infinity;
        bot.botStallTicks = 0;
        return BotAI.planTargetDir(bot, sim);
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
        bot.botLastWaypointDist = Infinity;
        bot.botStallTicks = 0;
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
    const cellCount = sim.getCachedCellCount(bot.factionId);
    if (cellCount === 0) {
      bot.botWaypoints = [
        { x: bot.pos.x * 0.5, z: bot.pos.z * 0.5 },
        { x: (Math.random() - 0.5) * ARENA_RADIUS * 0.5,
          z: (Math.random() - 0.5) * ARENA_RADIUS * 0.5 },
      ];
      return;
    }

    const contours = sim.getCachedContours(bot.factionId);
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
        sim.getCachedCellCount(o.factionId) > 0
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
      // Follow the actual territory edge, then push outward. The previous
      // centroid-radius points could land back inside irregular territory and
      // produce circles without a claim. Basing each point on the contour
      // makes the route a clear leave-edge / expand / re-enter loop.
      const ray = { x: cx + Math.sin(angle) * 50, z: cz + Math.cos(angle) * 50 };
      const edge = boundaryV[closestIdx(boundaryV, ray)];
      const edgeDx = edge.x - cx;
      const edgeDz = edge.z - cz;
      const edgeLen = Math.hypot(edgeDx, edgeDz) || 1;
      const pushOut = 1.5 + loopRadius * Math.sin(t * Math.PI);
      let wx = edge.x + (edgeDx / edgeLen) * pushOut;
      let wz = edge.z + (edgeDz / edgeLen) * pushOut;
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
