import {
  ActionState,
  PlayerCommand,
  EventType,
  ENTITY_DEFAULT_HP,
  ENTITY_DEFAULT_SPEED,
  ENTITY_DEFAULT_SIZE,
  WORLD_SIZE,
  INITIAL_RESOURCE_COUNT,
  RESOURCE_VALUE_MIN,
  RESOURCE_VALUE_MAX,
  STARTING_RESOURCES,
  STARTING_ENTITIES_PER_PLAYER,
  randomRange,
  randomInt,
  distance2D,
} from "@template/shared";
import { EventBus } from "./EventBus.js";

export interface SimEntity {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  hp: number;
  maxHp: number;
  size: number;
  actionState: ActionState;
  alive: boolean;
  speed: number;
}

export interface SimResource {
  id: number;
  x: number;
  y: number;
  z: number;
  remaining: number;
}

export interface SimPlayer {
  id: string;
  score: number;
  resources: number;
}

export class Simulation {
  entities: Map<number, SimEntity> = new Map();
  resources: Map<number, SimResource> = new Map();
  players: Map<string, SimPlayer> = new Map();
  events: EventBus = new EventBus();
  matchTime = 0;
  private nextId = 1;
  private inputQueue: { playerId: string; input: { type: PlayerCommand; x?: number; z?: number; targetId?: number } }[] = [];

  genId(): number {
    return this.nextId++;
  }

  addPlayer(playerId: string, startResources: number) {
    this.players.set(playerId, {
      id: playerId,
      score: 0,
      resources: startResources,
    });
  }

  removePlayer(playerId: string) {
    this.players.delete(playerId);
    for (const [id, entity] of this.entities) {
      if (entity.ownerId === playerId) {
        entity.alive = false;
        this.entities.delete(id);
      }
    }
  }

  spawnStartingEntities(playerId: string) {
    const half = WORLD_SIZE / 2;
    const angle = Math.random() * Math.PI * 2;
    const spawnRadius = half * 0.6;
    const cx = Math.cos(angle) * spawnRadius;
    const cz = Math.sin(angle) * spawnRadius;

    for (let i = 0; i < STARTING_ENTITIES_PER_PLAYER; i++) {
      const id = this.genId();
      const offset = (i - 0.5) * 2;
      this.entities.set(id, {
        id,
        ownerId: playerId,
        x: cx + offset,
        y: 0,
        z: cz + offset,
        vx: 0,
        vy: 0,
        vz: 0,
        heading: 0,
        hp: ENTITY_DEFAULT_HP,
        maxHp: ENTITY_DEFAULT_HP,
        size: ENTITY_DEFAULT_SIZE,
        actionState: ActionState.Idle,
        alive: true,
        speed: ENTITY_DEFAULT_SPEED,
      });
      this.events.emit(EventType.Spawn, id, { x: cx + offset, y: 0, z: cz + offset }, playerId);
    }
  }

  spawnResources() {
    const half = WORLD_SIZE / 2;
    for (let i = 0; i < INITIAL_RESOURCE_COUNT; i++) {
      const id = this.genId();
      const x = randomRange(-half + 1, half - 1);
      const z = randomRange(-half + 1, half - 1);
      this.resources.set(id, {
        id,
        x,
        y: 0,
        z,
        remaining: randomInt(RESOURCE_VALUE_MIN, RESOURCE_VALUE_MAX),
      });
    }
  }

  queueInput(playerId: string, input: { type: PlayerCommand; x?: number; z?: number; targetId?: number }) {
    this.inputQueue.push({ playerId, input });
  }

  entityCountForPlayer(playerId: string): number {
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.ownerId === playerId && e.alive) count++;
    }
    return count;
  }

  tick(dt: number) {
    this.matchTime += dt;
    this.processInputs();
    this.moveEntities(dt);
    this.cleanup();
  }

  private processInputs() {
    for (const { playerId, input } of this.inputQueue) {
      switch (input.type) {
        case PlayerCommand.Move:
          if (input.x !== undefined && input.z !== undefined) {
            for (const entity of this.entities.values()) {
              if (entity.ownerId === playerId && entity.alive) {
                const dx = input.x - entity.x;
                const dz = input.z - entity.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > 0.1) {
                  entity.vx = (dx / dist) * entity.speed;
                  entity.vz = (dz / dist) * entity.speed;
                  entity.heading = Math.atan2(dx, dz);
                  entity.actionState = ActionState.Moving;
                }
              }
            }
          }
          break;
        case PlayerCommand.Attack:
          if (input.targetId !== undefined) {
            const target = this.entities.get(input.targetId);
            if (target && target.alive) {
              for (const entity of this.entities.values()) {
                if (entity.ownerId === playerId && entity.alive) {
                  const dx = target.x - entity.x;
                  const dz = target.z - entity.z;
                  const dist = Math.sqrt(dx * dx + dz * dz);
                  if (dist > 0.1) {
                    entity.vx = (dx / dist) * entity.speed;
                    entity.vz = (dz / dist) * entity.speed;
                    entity.heading = Math.atan2(dx, dz);
                    entity.actionState = ActionState.Attacking;
                  }
                }
              }
            }
          }
          break;
      }
    }
    this.inputQueue = [];
  }

  private moveEntities(dt: number) {
    const half = WORLD_SIZE / 2;
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue;

      entity.x += entity.vx * dt;
      entity.z += entity.vz * dt;

      entity.x = Math.max(-half, Math.min(half, entity.x));
      entity.z = Math.max(-half, Math.min(half, entity.z));

      entity.vx *= 0.95;
      entity.vz *= 0.95;

      if (Math.abs(entity.vx) < 0.01 && Math.abs(entity.vz) < 0.01) {
        entity.vx = 0;
        entity.vz = 0;
        if (entity.actionState === ActionState.Moving) {
          entity.actionState = ActionState.Idle;
        }
      }

      // Gather nearby resources
      if (entity.actionState !== ActionState.Attacking) {
        for (const [resId, resource] of this.resources) {
          if (distance2D(entity, resource) < 1.5 && resource.remaining > 0) {
            const gather = Math.min(resource.remaining, 2 * dt);
            resource.remaining -= gather;
            const player = this.players.get(entity.ownerId);
            if (player) {
              player.resources += gather;
              player.score += gather * 0.5;
            }
            if (resource.remaining <= 0) {
              this.resources.delete(resId);
              this.events.emit(EventType.Collect, resId, resource, entity.ownerId);
            }
          }
        }
      }
    }
  }

  private cleanup() {
    for (const [id, entity] of this.entities) {
      if (!entity.alive || entity.hp <= 0) {
        entity.alive = false;
        this.entities.delete(id);
        this.events.emit(EventType.Destroy, id, entity, entity.ownerId);
      }
    }
  }
}
