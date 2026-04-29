import { Client, Room, getStateCallbacks } from "colyseus.js";
import type { PlayerInput, GameEvent } from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientEntity, ClientResource, ClientPlayer } from "../../store.js";

export class NetClient {
  private client: Client;
  private room: Room | null = null;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
  }

  async connect() {
    this.room = await this.client.joinOrCreate("game_room");
    const store = useStore.getState();
    store.setPlayerId(this.room.sessionId);
    store.setConnected(true);

    const $ = getStateCallbacks(this.room);

    // Entity listeners
    $(this.room.state).entities.onAdd((entity: any, key: string) => {
      const id = entity.id as number;
      const clientEntity: ClientEntity = {
        id,
        x: entity.x,
        y: entity.y,
        z: entity.z,
        vx: entity.vx,
        vy: entity.vy,
        vz: entity.vz,
        heading: entity.heading,
        hp: entity.hp,
        maxHp: entity.maxHp,
        actionState: entity.actionState,
        ownerId: entity.ownerId,
        size: entity.size,
        prevX: entity.x,
        prevZ: entity.z,
        targetX: entity.x,
        targetZ: entity.z,
        interpT: 1,
      };
      const entities = new Map(useStore.getState().entities);
      entities.set(id, clientEntity);
      useStore.getState().setEntities(entities);

      $(entity).onChange(() => {
        const entities = new Map(useStore.getState().entities);
        const existing = entities.get(id);
        if (existing) {
          existing.prevX = existing.targetX;
          existing.prevZ = existing.targetZ;
          existing.targetX = entity.x;
          existing.targetZ = entity.z;
          existing.interpT = 0;
          existing.vx = entity.vx;
          existing.vy = entity.vy;
          existing.vz = entity.vz;
          existing.heading = entity.heading;
          existing.hp = entity.hp;
          existing.maxHp = entity.maxHp;
          existing.actionState = entity.actionState;
          existing.ownerId = entity.ownerId;
          existing.size = entity.size;
        }
        useStore.getState().setEntities(entities);
      });
    });

    $(this.room.state).entities.onRemove((_entity: any, key: string) => {
      const id = Number(key);
      const entities = new Map(useStore.getState().entities);
      entities.delete(id);
      useStore.getState().setEntities(entities);
    });

    // Resource listeners
    $(this.room.state).resources.onAdd((resource: any, key: string) => {
      const id = resource.id as number;
      const clientResource: ClientResource = {
        id,
        x: resource.x,
        y: resource.y,
        z: resource.z,
        remaining: resource.remaining,
      };
      const resources = new Map(useStore.getState().resources);
      resources.set(id, clientResource);
      useStore.getState().setResources(resources);

      $(resource).onChange(() => {
        const resources = new Map(useStore.getState().resources);
        const existing = resources.get(id);
        if (existing) {
          existing.remaining = resource.remaining;
        }
        useStore.getState().setResources(resources);
      });
    });

    $(this.room.state).resources.onRemove((_resource: any, key: string) => {
      const id = Number(key);
      const resources = new Map(useStore.getState().resources);
      resources.delete(id);
      useStore.getState().setResources(resources);
    });

    // Player listeners
    $(this.room.state).players.onAdd((player: any, key: string) => {
      const clientPlayer: ClientPlayer = {
        id: player.id,
        score: player.score,
        resources: player.resources,
      };
      const players = new Map(useStore.getState().players);
      players.set(key, clientPlayer);
      useStore.getState().setPlayers(players);

      $(player).onChange(() => {
        const players = new Map(useStore.getState().players);
        const existing = players.get(key);
        if (existing) {
          existing.score = player.score;
          existing.resources = player.resources;
        }
        useStore.getState().setPlayers(players);
      });
    });

    $(this.room.state).players.onRemove((_player: any, key: string) => {
      const players = new Map(useStore.getState().players);
      players.delete(key);
      useStore.getState().setPlayers(players);
    });

    // Match state listeners
    $(this.room.state).listen("phase", (value: string) => {
      useStore.getState().setMatchPhase(value as "waiting" | "playing" | "ended");
    });

    $(this.room.state).listen("matchTime", (value: number) => {
      useStore.getState().setMatchTime(value);
    });

    $(this.room.state).listen("matchDuration", (value: number) => {
      useStore.getState().setMatchDuration(value);
    });

    // Event messages
    this.room.onMessage("events", (events: GameEvent[]) => {
      useStore.getState().pushEvents(events);
    });

    this.room.onMessage("match_end", () => {
      useStore.getState().setMatchPhase("ended");
    });
  }

  sendInput(input: PlayerInput) {
    if (this.room) {
      this.room.send("input", input);
    }
  }

  disconnect() {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    useStore.getState().setConnected(false);
  }
}
