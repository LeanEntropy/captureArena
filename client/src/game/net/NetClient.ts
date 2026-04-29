import { Client, Room, getStateCallbacks } from "colyseus.js";
import type { GameEvent, Vec2 } from "@template/shared";
import { initBoundaryGrid } from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientPlayer } from "../../store.js";

export class NetClient {
  private client: Client;
  private room: Room | null = null;
  private localGrid: Uint8Array;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
    this.localGrid = initBoundaryGrid();
  }

  async connect(playerName: string): Promise<void> {
    this.room = await this.client.joinOrCreate("game_room", { name: playerName });

    const store = useStore.getState();
    store.setPlayerId(this.room.sessionId);
    store.setConnected(true);
    store.setGameStarted(true);

    const $ = getStateCallbacks(this.room);

    // Player onAdd
    $(this.room.state as any).players.onAdd((player: any, key: string) => {
      const clientPlayer: ClientPlayer = {
        id: key,
        slotId: player.slotId,
        x: player.x,
        y: player.y,
        heading: player.heading,
        alive: player.alive,
        respawnTimer: player.respawnTimer,
        invulnTimer: player.invulnTimer,
        killCount: player.killCount,
        territoryCount: player.territoryCount,
        name: player.name,
        color: player.color,
        trail: [],
      };
      const players = new Map(useStore.getState().players);
      players.set(key, clientPlayer);
      useStore.getState().setPlayers(players);

      // Player onChange
      $(player).onChange(() => {
        const players = new Map(useStore.getState().players);
        const existing = players.get(key);
        if (existing) {
          players.set(key, {
            ...existing,
            slotId: player.slotId,
            x: player.x,
            y: player.y,
            heading: player.heading,
            alive: player.alive,
            respawnTimer: player.respawnTimer,
            invulnTimer: player.invulnTimer,
            killCount: player.killCount,
            territoryCount: player.territoryCount,
            name: player.name,
            color: player.color,
          });
        } else {
          players.set(key, {
            id: key,
            slotId: player.slotId,
            x: player.x,
            y: player.y,
            heading: player.heading,
            alive: player.alive,
            respawnTimer: player.respawnTimer,
            invulnTimer: player.invulnTimer,
            killCount: player.killCount,
            territoryCount: player.territoryCount,
            name: player.name,
            color: player.color,
            trail: [],
          });
        }
        useStore.getState().setPlayers(players);
      });
    });

    // Player onRemove
    $(this.room.state as any).players.onRemove((_player: any, key: string) => {
      useStore.getState().removePlayer(key);
    });

    // Full territory grid (binary)
    this.room.onMessage("territory_full", (data: Uint8Array) => {
      this.localGrid.set(data);
      useStore.getState().setTerritoryGrid(new Uint8Array(this.localGrid));
    });

    // Territory patch (binary): byte 0 = slotId, then 3 bytes per cell index
    this.room.onMessage("territory_patch", (data: Uint8Array) => {
      const slotId = data[0];
      const cellCount = (data.length - 1) / 3;
      for (let i = 0; i < cellCount; i++) {
        const offset = 1 + i * 3;
        const cellIdx = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
        this.localGrid[cellIdx] = slotId;
      }
      useStore.getState().setTerritoryGrid(new Uint8Array(this.localGrid));
    });

    // Trail updates: array of { id, trail }
    this.room.onMessage("trails", (updates: Array<{ id: string; trail: Vec2[] }>) => {
      const players = new Map(useStore.getState().players);
      for (const update of updates) {
        const existing = players.get(update.id);
        if (existing) {
          players.set(update.id, { ...existing, trail: update.trail });
        }
      }
      useStore.getState().setPlayers(players);
    });

    // Game events (kills, deaths, territory claims)
    this.room.onMessage("events", (events: GameEvent[]) => {
      useStore.getState().pushEvents(events);
    });

    this.room.onLeave(() => {
      useStore.getState().setConnected(false);
      useStore.getState().setGameStarted(false);
    });
  }

  sendHeading(targetHeading: number): void {
    if (this.room) {
      this.room.send("input", { targetHeading });
    }
  }

  disconnect(): void {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    useStore.getState().setConnected(false);
  }
}
