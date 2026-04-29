export enum ActionState {
  Idle = 0,
  Moving = 1,
  Attacking = 2,
  Gathering = 3,
  Dead = 4,
}

export enum EventType {
  Spawn = "SPAWN",
  Destroy = "DESTROY",
  Hit = "HIT",
  Collect = "COLLECT",
}

export enum PlayerCommand {
  Move = 0,
  Attack = 1,
  Select = 2,
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
