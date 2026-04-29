import {
  PLAYER_SPEED, PLAYER_TURN_RATE, WORLD_RADIUS,
  shortestAngleDist, clamp,
} from "@template/shared";

export interface Movable {
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  speed: number;
  turnRate: number;
}

export function updateMovement(entity: Movable, dt: number): void {
  // Steer toward target heading
  const angleDiff = shortestAngleDist(entity.heading, entity.targetHeading);
  const maxTurn = entity.turnRate * dt;
  if (Math.abs(angleDiff) <= maxTurn) {
    entity.heading = entity.targetHeading;
  } else {
    entity.heading += Math.sign(angleDiff) * maxTurn;
  }
  // Normalize heading to [-PI, PI]
  entity.heading = ((entity.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // Advance position
  entity.x += Math.cos(entity.heading) * entity.speed * dt;
  entity.y += Math.sin(entity.heading) * entity.speed * dt;
}

export function isOutOfBounds(x: number, y: number): boolean {
  return Math.sqrt(x * x + y * y) > WORLD_RADIUS;
}
