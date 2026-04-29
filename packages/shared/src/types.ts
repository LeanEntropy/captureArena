export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export enum EventType {
  PlayerDeath = "PLAYER_DEATH",
  PlayerSpawn = "PLAYER_SPAWN",
  TerritoryClaim = "TERRITORY_CLAIM",
  PlayerKill = "PLAYER_KILL",
}

export enum BotState {
  Expanding = 0,
  Returning = 1,
  Attacking = 2,
}
