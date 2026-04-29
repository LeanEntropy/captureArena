import { Simulation } from "@template/simulation";
import type { SimEntity } from "@template/simulation";
import {
  STARTING_RESOURCES,
  WORLD_SIZE,
  PlayerCommand,
  randomRange,
  MATCH_DURATION,
} from "@template/shared";
import type { PlayerInput } from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientEntity, ClientResource, ClientPlayer } from "../../store.js";

export class LocalGame {
  sim: Simulation;
  private aiTimer = 0;
  private aiInterval = 2;

  constructor() {
    this.sim = new Simulation();
  }

  start() {
    this.sim.addPlayer("local", STARTING_RESOURCES);
    this.sim.addPlayer("ai_1", STARTING_RESOURCES);
    this.sim.spawnResources();
    this.sim.spawnStartingEntities("local");
    this.sim.spawnStartingEntities("ai_1");

    const store = useStore.getState();
    store.setPlayerId("local");
    store.setConnected(true);
    store.setMatchPhase("playing");
    store.setMatchDuration(MATCH_DURATION);

    this.syncToStore();
  }

  tick(dt: number) {
    this.sim.tick(dt);

    // AI logic: wander randomly every ~2 seconds
    this.aiTimer += dt;
    if (this.aiTimer >= this.aiInterval) {
      this.aiTimer = 0;
      this.aiInterval = 1.5 + Math.random() * 1.0;
      const half = WORLD_SIZE / 2;
      const x = randomRange(-half + 2, half - 2);
      const z = randomRange(-half + 2, half - 2);
      this.sim.queueInput("ai_1", { type: PlayerCommand.Move, x, z });
    }

    // Flush events
    const events = this.sim.events.flush();
    if (events.length > 0) {
      useStore.getState().pushEvents(events);
    }

    this.syncToStore();
  }

  sendCommand(input: PlayerInput) {
    this.sim.queueInput("local", input);
  }

  private syncToStore() {
    const store = useStore.getState();

    // Sync entities
    const newEntities = new Map<number, ClientEntity>();
    const oldEntities = store.entities;
    for (const [id, e] of this.sim.entities) {
      if (!e.alive) continue;
      const old = oldEntities.get(id);
      newEntities.set(id, {
        id: e.id,
        x: e.x,
        y: e.y,
        z: e.z,
        vx: e.vx,
        vy: e.vy,
        vz: e.vz,
        heading: e.heading,
        hp: e.hp,
        maxHp: e.maxHp,
        actionState: e.actionState,
        ownerId: e.ownerId,
        size: e.size,
        prevX: old ? old.x : e.x,
        prevZ: old ? old.z : e.z,
        targetX: e.x,
        targetZ: e.z,
        interpT: 1,
      });
    }
    store.setEntities(newEntities);

    // Sync resources
    const newResources = new Map<number, ClientResource>();
    for (const [id, r] of this.sim.resources) {
      newResources.set(id, {
        id: r.id,
        x: r.x,
        y: r.y,
        z: r.z,
        remaining: r.remaining,
      });
    }
    store.setResources(newResources);

    // Sync players
    const newPlayers = new Map<string, ClientPlayer>();
    for (const [id, p] of this.sim.players) {
      newPlayers.set(id, {
        id: p.id,
        score: p.score,
        resources: p.resources,
      });
    }
    store.setPlayers(newPlayers);

    store.setMatchTime(this.sim.matchTime);
  }
}
