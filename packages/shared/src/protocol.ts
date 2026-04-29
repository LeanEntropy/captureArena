import type { Vec3 } from "./types.js";
import type { EventType, PlayerCommand } from "./types.js";

export interface EntitySnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  hp: number;
  maxHp: number;
  actionState: number;
  ownerId: string;
  size: number;
}

export interface ResourceSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  remaining: number;
}

export interface GameEvent {
  type: EventType;
  entityId: number;
  position: Vec3;
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface PlayerInput {
  type: PlayerCommand;
  x?: number;
  z?: number;
  targetId?: number;
}

export interface PlayerState {
  id: string;
  score: number;
  resources: number;
}

export interface MatchState {
  version: number;
  tickRate: number;
  matchTime: number;
  matchDuration: number;
  phase: "waiting" | "playing" | "ended";
}
