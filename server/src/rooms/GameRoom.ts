import { Room, Client } from "colyseus";
import { GameStateSchema, PlayerSchema } from "../schema/GameState.js";
import { SERVER_TICK_RATE, BOT_COUNT } from "@template/shared";
import { Simulation } from "@template/simulation";

export class GameRoom extends Room<GameStateSchema> {
  state = new GameStateSchema();
  sim!: Simulation;
  private trailBroadcastTimer = 0;
  private readonly trailBroadcastInterval = 1 / 5; // 5 Hz

  onCreate() {
    this.sim = new Simulation();

    // Fill with bots initially
    this.sim.fillBots(BOT_COUNT);
    this.syncPlayersToSchema();

    this.setSimulationInterval(
      (delta) => this.tick(delta),
      1000 / SERVER_TICK_RATE
    );

    this.onMessage("input", (client, data: { targetHeading: number }) => {
      if (typeof data.targetHeading === "number") {
        this.sim.queueInput(client.sessionId, { targetHeading: data.targetHeading });
      }
    });
  }

  onJoin(client: Client, options?: { name?: string }) {
    const name = (options?.name || `Player${Math.floor(Math.random() * 999)}`).slice(0, 16);
    this.sim.addPlayer(client.sessionId, name);
    this.syncPlayersToSchema();

    // Send full territory grid to the new player as binary
    const gridCopy = this.sim.territory.getFullGridCopy();
    client.sendBytes("territory_full", gridCopy);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private tick(delta: number) {
    const dt = delta / 1000;
    this.sim.tick(dt);

    // Sync player schema
    this.syncPlayersToSchema();

    // Broadcast territory patches as binary:
    // [slotId (1 byte)] [cellIndex low (1 byte)] [cellIndex mid (1 byte)] [cellIndex high (1 byte)] ...
    for (const patch of this.sim.pendingTerritoryPatches) {
      const buffer = new Uint8Array(1 + patch.cells.length * 3);
      buffer[0] = patch.slotId;
      for (let i = 0; i < patch.cells.length; i++) {
        const cellIdx = patch.cells[i];
        buffer[1 + i * 3]     =  cellIdx        & 0xff;
        buffer[1 + i * 3 + 1] = (cellIdx >> 8)  & 0xff;
        buffer[1 + i * 3 + 2] = (cellIdx >> 16) & 0xff;
      }
      this.broadcast("territory_patch", buffer);
    }

    // Broadcast trail updates at reduced rate (5 Hz)
    this.trailBroadcastTimer += dt;
    if (this.trailBroadcastTimer >= this.trailBroadcastInterval) {
      this.trailBroadcastTimer = 0;
      const trailUpdates = this.sim.getTrailUpdates();
      if (trailUpdates.length > 0) {
        this.broadcast("trails", trailUpdates);
      }
    }

    // Broadcast game events (kills, deaths, territory claims)
    const events = this.sim.events.flush();
    if (events.length > 0) {
      this.broadcast("events", events);
    }
  }

  private syncPlayersToSchema() {
    const activeIds = new Set<string>();
    for (const [id, p] of this.sim.players) {
      activeIds.add(id);
      let schema = this.state.players.get(id);
      if (!schema) {
        schema = new PlayerSchema();
        this.state.players.set(id, schema);
      }
      schema.slotId = p.slotId;
      schema.x = p.x;
      schema.y = p.y;
      schema.heading = p.heading;
      schema.alive = p.alive;
      schema.respawnTimer = p.respawnTimer;
      schema.invulnTimer = p.invulnTimer;
      schema.killCount = p.killCount;
      schema.territoryCount = p.territoryCount;
      schema.name = p.name;
      schema.color = p.color;
    }
    // Remove schema entries for players no longer in simulation
    for (const key of this.state.players.keys()) {
      if (!activeIds.has(key)) this.state.players.delete(key);
    }
  }
}
