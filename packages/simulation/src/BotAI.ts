import {
  BotState, WORLD_RADIUS,
  randomRange, distance2D, angleToward,
} from "@template/shared";
import type { SimPlayer } from "./Simulation.js";
import type { TerritoryGrid } from "./TerritoryGrid.js";

export interface BotContext {
  state: BotState;
  targetX: number;
  targetY: number;
  distanceTraveled: number;
  maxLoopDistance: number;
  attackProbability: number;
}

export function createBotContext(): BotContext {
  return {
    state: BotState.Expanding,
    targetX: 0,
    targetY: 0,
    distanceTraveled: 0,
    maxLoopDistance: randomRange(5, 15),
    attackProbability: randomRange(0.1, 0.3),
  };
}

export function updateBot(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid,
  allPlayers: Map<string, SimPlayer>,
  dt: number
): void {
  if (!player.alive) return;

  switch (ctx.state) {
    case BotState.Expanding:
      updateExpanding(player, ctx, territory, allPlayers);
      break;
    case BotState.Returning:
      updateReturning(player, ctx, territory);
      break;
    case BotState.Attacking:
      updateExpanding(player, ctx, territory, allPlayers);
      break;
  }

  // Track distance traveled while outside territory
  if (player.wasOutsideTerritory) {
    ctx.distanceTraveled += player.speed * dt;
  }

  // Safety: if trail is getting long, return immediately
  if (player.trail.length > 200 && ctx.state !== BotState.Returning) {
    switchToReturning(player, ctx, territory);
  }

  // Danger: if another player is close and we have a trail, return
  if (player.trail.length > 10) {
    for (const other of allPlayers.values()) {
      if (other.id === player.id || !other.alive) continue;
      if (distance2D(player, other) < 8) {
        switchToReturning(player, ctx, territory);
        break;
      }
    }
  }
}

function updateExpanding(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid,
  allPlayers: Map<string, SimPlayer>
): void {
  // If we've traveled enough distance, switch to returning
  if (ctx.distanceTraveled >= ctx.maxLoopDistance) {
    switchToReturning(player, ctx, territory);
    return;
  }

  // If we don't have a target or we're close to it, pick a new one
  const distToTarget = distance2D(player, { x: ctx.targetX, y: ctx.targetY });
  if (distToTarget < 2 || (ctx.targetX === 0 && ctx.targetY === 0)) {
    pickExpandTarget(player, ctx);
  }

  player.targetHeading = angleToward(player, { x: ctx.targetX, y: ctx.targetY });
}

function updateReturning(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid
): void {
  // Steer toward own territory — find a point back on our territory
  const onOwn = territory.isOnOwnTerritory(player.slotId, player.x, player.y);
  if (onOwn && player.trail.length > 0) {
    // We made it back — claim will happen automatically in Simulation.checkClaims
    ctx.state = BotState.Expanding;
    ctx.distanceTraveled = 0;
    ctx.maxLoopDistance = randomRange(5, 15);
    ctx.targetX = 0;
    ctx.targetY = 0;
    return;
  }

  // Steer back toward where we started our trail
  if (player.trail.length > 0) {
    const start = player.trail[0];
    player.targetHeading = angleToward(player, start);
  }
}

function switchToReturning(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid
): void {
  ctx.state = BotState.Returning;
}

function pickExpandTarget(player: SimPlayer, ctx: BotContext): void {
  // Pick a point outside current position, roughly away from center
  const outwardAngle = Math.atan2(player.y, player.x);
  const angle = outwardAngle + randomRange(-Math.PI / 3, Math.PI / 3);
  const dist = randomRange(5, 12);
  ctx.targetX = player.x + Math.cos(angle) * dist;
  ctx.targetY = player.y + Math.sin(angle) * dist;

  // Clamp to stay within world
  const targetDist = Math.sqrt(ctx.targetX * ctx.targetX + ctx.targetY * ctx.targetY);
  if (targetDist > WORLD_RADIUS * 0.85) {
    const scale = (WORLD_RADIUS * 0.85) / targetDist;
    ctx.targetX *= scale;
    ctx.targetY *= scale;
  }
}

const BOT_NAMES = [
  "Toe", "K-9", "Lime", "Leaf Assassin", "Helmet Destroyer",
  "Star Jammer", "Sky Bully", "Daisy Stick", "Nova", "Pixel",
  "Shadow", "Blitz", "Frost", "Echo", "Spark",
];

export function pickBotName(usedNames: Set<string>): string {
  for (const name of BOT_NAMES) {
    if (!usedNames.has(name)) return name;
  }
  return `Bot_${Math.floor(Math.random() * 999)}`;
}
