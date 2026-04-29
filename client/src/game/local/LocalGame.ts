// client/src/game/local/LocalGame.ts
import { Simulation } from "@template/simulation";
import {
  BOT_COUNT, SERVER_TICK_RATE,
} from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientPlayer } from "../../store.js";

export class LocalGame {
  sim: Simulation;
  private tickAccumulator = 0;
  private tickInterval = 1 / SERVER_TICK_RATE;

  constructor() {
    this.sim = new Simulation();
  }

  start(playerName: string): void {
    const store = useStore.getState();

    // Add human player
    this.sim.addPlayer("local", playerName);
    store.setPlayerId("local");
    store.setGameStarted(true);
    store.setPlayableCells(this.sim.territory.playableCells);

    // Add bots
    this.sim.fillBots(BOT_COUNT);

    this.syncToStore();
  }

  tick(dt: number): void {
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= this.tickInterval) {
      this.sim.tick(this.tickInterval);
      this.tickAccumulator -= this.tickInterval;
    }

    // Flush events
    const events = this.sim.events.flush();
    if (events.length > 0) {
      useStore.getState().pushEvents(events);
    }

    this.syncToStore();
  }

  sendHeading(targetHeading: number): void {
    this.sim.queueInput("local", { targetHeading });
  }

  private syncToStore(): void {
    const store = useStore.getState();

    // Sync players
    const newPlayers = new Map<string, ClientPlayer>();
    for (const [id, p] of this.sim.players) {
      newPlayers.set(id, {
        id: p.id,
        slotId: p.slotId,
        x: p.x,
        y: p.y,
        heading: p.heading,
        alive: p.alive,
        respawnTimer: p.respawnTimer,
        invulnTimer: p.invulnTimer,
        killCount: p.killCount,
        territoryCount: p.territoryCount,
        name: p.name,
        color: p.color,
        trail: [...p.trail],
      });
    }
    store.setPlayers(newPlayers);

    // Sync territory grid
    store.setTerritoryGrid(this.sim.territory.getFullGridCopy());
  }
}
