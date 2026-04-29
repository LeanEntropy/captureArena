import type { Vec2 } from "./types.js";
import type { EventType } from "./types.js";

export interface PlayerInput {
  targetHeading: number;
}

export interface GameEvent {
  type: EventType;
  playerId: string;
  position: Vec2;
  killerId?: string;
  data?: Record<string, unknown>;
}

export interface PlayerSnapshot {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
}

export interface TrailUpdate {
  playerId: string;
  trail: Vec2[];
}

export interface TerritoryPatch {
  slotId: number;
  cells: number[];
}
