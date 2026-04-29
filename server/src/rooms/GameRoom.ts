import { Room, Client } from "colyseus";
import {
  GameStateSchema,
  PlayerSchema,
  EntitySchema,
  ResourceSchema,
} from "../schema/GameState.js";
import {
  SERVER_TICK_RATE,
  STARTING_RESOURCES,
  MATCH_DURATION,
} from "@template/shared";
import { Simulation } from "@template/simulation";

export class GameRoom extends Room<GameStateSchema> {
  state = new GameStateSchema();
  sim!: Simulation;

  onCreate() {
    this.state.tickRate = SERVER_TICK_RATE;
    this.state.phase = "waiting";
    this.sim = new Simulation();

    this.setSimulationInterval(
      (delta) => this.tick(delta),
      1000 / SERVER_TICK_RATE
    );

    this.onMessage("input", (client, data) => {
      this.sim.queueInput(client.sessionId, data);
    });
  }

  onJoin(client: Client) {
    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.resources = STARTING_RESOURCES;
    this.state.players.set(client.sessionId, player);
    this.sim.addPlayer(client.sessionId, STARTING_RESOURCES);

    if (this.state.players.size >= 2 && this.state.phase === "waiting") {
      this.startMatch();
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.sim.removePlayer(client.sessionId);
  }

  private startMatch() {
    this.state.phase = "playing";
    this.state.matchTime = 0;

    this.sim.spawnResources();
    for (const playerId of this.sim.players.keys()) {
      this.sim.spawnStartingEntities(playerId);
    }

    this.syncState();
  }

  private tick(delta: number) {
    if (this.state.phase !== "playing") return;

    const dt = delta / 1000;
    this.sim.tick(dt);

    this.state.matchTime = this.sim.matchTime;

    if (this.sim.matchTime >= MATCH_DURATION) {
      this.state.phase = "ended";
      this.syncState();
      this.broadcast("match_end", {});
      return;
    }

    const events = this.sim.events.flush();
    if (events.length > 0) {
      this.broadcast("events", events);
    }

    this.syncState();
  }

  private syncState() {
    // Sync entities
    const activeEntityIds = new Set<string>();
    for (const [id, e] of this.sim.entities) {
      if (!e.alive) continue;
      const key = String(id);
      activeEntityIds.add(key);
      let schema = this.state.entities.get(key);
      if (!schema) {
        schema = new EntitySchema();
        this.state.entities.set(key, schema);
      }
      schema.id = e.id;
      schema.x = e.x;
      schema.y = e.y;
      schema.z = e.z;
      schema.vx = e.vx;
      schema.vy = e.vy;
      schema.vz = e.vz;
      schema.heading = e.heading;
      schema.hp = e.hp;
      schema.maxHp = e.maxHp;
      schema.actionState = e.actionState;
      schema.ownerId = e.ownerId;
      schema.size = e.size;
    }
    for (const key of this.state.entities.keys()) {
      if (!activeEntityIds.has(key)) this.state.entities.delete(key);
    }

    // Sync resources
    const activeResourceIds = new Set<string>();
    for (const [id, r] of this.sim.resources) {
      const key = String(id);
      activeResourceIds.add(key);
      let schema = this.state.resources.get(key);
      if (!schema) {
        schema = new ResourceSchema();
        this.state.resources.set(key, schema);
      }
      schema.id = r.id;
      schema.x = r.x;
      schema.y = r.y;
      schema.z = r.z;
      schema.remaining = r.remaining;
    }
    for (const key of this.state.resources.keys()) {
      if (!activeResourceIds.has(key)) this.state.resources.delete(key);
    }

    // Sync players
    for (const [playerId, p] of this.sim.players) {
      const schema = this.state.players.get(playerId);
      if (schema) {
        schema.score = p.score;
        schema.resources = p.resources;
      }
    }
  }
}
