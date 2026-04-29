import {
  PLAYER_SPEED, PLAYER_TURN_RATE, PLAYER_COLORS,
  RESPAWN_DELAY, INVULN_DURATION, WORLD_RADIUS,
  SPAWN_MIN_DISTANCE, BOT_COUNT,
  EventType, randomRange, distance2D, angleToward,
} from "@template/shared";
import type { Vec2, PlayerInput, GameEvent, TerritoryPatch, TrailUpdate } from "@template/shared";
import { EventBus } from "./EventBus.js";
import { TerritoryGrid } from "./TerritoryGrid.js";
import { updateMovement, isOutOfBounds } from "./MovementSystem.js";
import { recordTrailPoint, isTrailTooLong, checkTrailCollision } from "./TrailSystem.js";
import type { TrailHolder } from "./TrailSystem.js";

export interface SimPlayer {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  speed: number;
  turnRate: number;
  trail: Vec2[];
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
  wasOutsideTerritory: boolean;
  isBot: boolean;
}

export class Simulation {
  players: Map<string, SimPlayer> = new Map();
  territory: TerritoryGrid;
  events: EventBus = new EventBus();
  private nextSlotId = 1;
  private inputQueue: { playerId: string; input: PlayerInput }[] = [];
  pendingTerritoryPatches: TerritoryPatch[] = [];
  pendingTrailUpdates: TrailUpdate[] = [];

  constructor() {
    this.territory = new TerritoryGrid();
  }

  addPlayer(id: string, name: string, isBot = false): SimPlayer {
    const slotId = this.nextSlotId++;
    const color = PLAYER_COLORS[(slotId - 1) % PLAYER_COLORS.length];
    const { x, y } = this.findSpawnPosition();
    const heading = randomRange(-Math.PI, Math.PI);

    const player: SimPlayer = {
      id, slotId, x, y, heading,
      targetHeading: heading,
      speed: PLAYER_SPEED,
      turnRate: PLAYER_TURN_RATE,
      trail: [],
      alive: true,
      respawnTimer: 0,
      invulnTimer: INVULN_DURATION,
      killCount: 0,
      territoryCount: 0,
      name,
      color,
      wasOutsideTerritory: false,
      isBot,
    };

    this.players.set(id, player);

    const changed = this.territory.grantStartingTerritory(slotId, x, y);
    player.territoryCount = changed.length;

    this.pendingTerritoryPatches.push({ slotId, cells: changed });
    this.events.emit(EventType.PlayerSpawn, id, { x, y });

    return player;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      this.territory.clearTrail(player.slotId);
      this.players.delete(id);
    }
  }

  queueInput(playerId: string, input: PlayerInput): void {
    this.inputQueue.push({ playerId, input });
  }

  tick(dt: number): void {
    this.pendingTerritoryPatches = [];
    this.pendingTrailUpdates = [];

    this.processInputs();
    this.updateTimers(dt);
    this.updateMovement(dt);
    this.checkCollisions();
    this.checkClaims();
    this.updateTerritoryCounts();
  }

  private processInputs(): void {
    for (const { playerId, input } of this.inputQueue) {
      const player = this.players.get(playerId);
      if (player && player.alive) {
        player.targetHeading = input.targetHeading;
      }
    }
    this.inputQueue = [];
  }

  private updateTimers(dt: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
          this.respawnPlayer(player);
        }
      } else if (player.invulnTimer > 0) {
        player.invulnTimer -= dt;
        if (player.invulnTimer < 0) player.invulnTimer = 0;
      }
    }
  }

  private updateMovement(dt: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      updateMovement(player, dt);

      // Boundary check
      if (isOutOfBounds(player.x, player.y)) {
        this.killPlayer(player.id);
        continue;
      }

      // Trail recording
      const onOwn = this.territory.isOnOwnTerritory(player.slotId, player.x, player.y);
      if (!onOwn && player.alive) {
        if (!player.wasOutsideTerritory) {
          player.wasOutsideTerritory = true;
        }
        recordTrailPoint(
          { trail: player.trail, slotId: player.slotId, wasOutsideTerritory: player.wasOutsideTerritory },
          player.x, player.y,
          this.territory
        );

        if (isTrailTooLong({ trail: player.trail, slotId: player.slotId, wasOutsideTerritory: true })) {
          this.killPlayer(player.id);
        }
      }
    }
  }

  private checkCollisions(): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.invulnTimer > 0) continue;
      if (player.trail.length === 0 && !player.wasOutsideTerritory) continue;

      const collision = checkTrailCollision(
        player.slotId, player.x, player.y,
        this.territory, player.trail.length
      );

      if (collision.type === "self") {
        this.killPlayer(player.id);
      } else if (collision.type === "enemy" && collision.victimSlotId) {
        // Find the player whose trail was hit
        const victim = this.findPlayerBySlotId(collision.victimSlotId);
        if (victim && victim.alive && victim.invulnTimer <= 0) {
          this.killPlayer(victim.id, player.id);
          player.killCount++;
        }
      }
    }
  }

  private checkClaims(): void {
    for (const player of this.players.values()) {
      if (!player.alive || !player.wasOutsideTerritory) continue;
      if (player.trail.length === 0) continue;

      const onOwn = this.territory.isOnOwnTerritory(player.slotId, player.x, player.y);
      if (onOwn) {
        // Claim territory
        const result = this.territory.claim(player.slotId, player.trail);

        // Update stolen-from players
        for (const [stolenSlotId, count] of result.stolenFrom) {
          const victim = this.findPlayerBySlotId(stolenSlotId);
          if (victim) {
            victim.territoryCount -= count;
          }
        }

        this.pendingTerritoryPatches.push({
          slotId: player.slotId,
          cells: result.claimedCells,
        });

        this.events.emit(EventType.TerritoryClaim, player.id, { x: player.x, y: player.y }, undefined, {
          cellCount: result.claimedCells.length,
        });

        player.trail = [];
        player.wasOutsideTerritory = false;

        this.pendingTrailUpdates.push({ playerId: player.id, trail: [] });
      }
    }
  }

  private updateTerritoryCounts(): void {
    const counts = this.territory.getTerritoryCounts();
    for (const player of this.players.values()) {
      player.territoryCount = counts.get(player.slotId) || 0;
    }
  }

  killPlayer(playerId: string, killerId?: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    player.alive = false;
    player.respawnTimer = RESPAWN_DELAY;
    this.territory.clearTrail(player.slotId);
    player.trail = [];
    player.wasOutsideTerritory = false;

    this.events.emit(EventType.PlayerDeath, playerId, { x: player.x, y: player.y }, killerId);
    this.pendingTrailUpdates.push({ playerId, trail: [] });

    if (killerId) {
      this.events.emit(EventType.PlayerKill, killerId, { x: player.x, y: player.y }, undefined, {
        victimId: playerId,
      });
    }
  }

  private respawnPlayer(player: SimPlayer): void {
    const { x, y } = this.findSpawnPosition();
    player.x = x;
    player.y = y;
    player.heading = randomRange(-Math.PI, Math.PI);
    player.targetHeading = player.heading;
    player.alive = true;
    player.invulnTimer = INVULN_DURATION;
    player.trail = [];
    player.wasOutsideTerritory = false;

    const changed = this.territory.grantStartingTerritory(player.slotId, x, y);
    this.pendingTerritoryPatches.push({ slotId: player.slotId, cells: changed });
    this.events.emit(EventType.PlayerSpawn, player.id, { x, y });
  }

  private findSpawnPosition(): { x: number; y: number } {
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = randomRange(-Math.PI, Math.PI);
      const dist = randomRange(WORLD_RADIUS * 0.3, WORLD_RADIUS * 0.7);
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;

      let tooClose = false;
      for (const other of this.players.values()) {
        if (other.alive && distance2D({ x, y }, other) < SPAWN_MIN_DISTANCE) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) return { x, y };
    }
    // Fallback: random position
    const angle = randomRange(-Math.PI, Math.PI);
    const dist = randomRange(WORLD_RADIUS * 0.3, WORLD_RADIUS * 0.7);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  }

  private findPlayerBySlotId(slotId: number): SimPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.slotId === slotId) return player;
    }
    return undefined;
  }

  getTrailUpdates(): TrailUpdate[] {
    const updates: TrailUpdate[] = [...this.pendingTrailUpdates];
    for (const player of this.players.values()) {
      if (player.alive && player.trail.length > 0) {
        updates.push({ playerId: player.id, trail: [...player.trail] });
      }
    }
    return updates;
  }
}
