import { createStore } from "zustand/vanilla";
import type { GameEvent } from "@template/shared";

export interface ClientEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  hp: number;
  maxHp: number;
  actionState: number;
  ownerId: string;
  size: number;
  prevX: number;
  prevZ: number;
  targetX: number;
  targetZ: number;
  interpT: number;
}

export interface ClientResource {
  id: number;
  x: number;
  y: number;
  z: number;
  remaining: number;
}

export interface ClientPlayer {
  id: string;
  score: number;
  resources: number;
}

export interface GameState {
  playerId: string;
  connected: boolean;
  matchPhase: "waiting" | "playing" | "ended";
  matchTime: number;
  matchDuration: number;
  entities: Map<number, ClientEntity>;
  resources: Map<number, ClientResource>;
  players: Map<string, ClientPlayer>;
  events: GameEvent[];

  setPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setMatchPhase: (phase: "waiting" | "playing" | "ended") => void;
  setMatchTime: (time: number) => void;
  setMatchDuration: (duration: number) => void;
  setEntities: (entities: Map<number, ClientEntity>) => void;
  setResources: (resources: Map<number, ClientResource>) => void;
  setPlayers: (players: Map<string, ClientPlayer>) => void;
  pushEvents: (events: GameEvent[]) => void;
  clearEvents: () => void;
}

export const useStore = createStore<GameState>((set) => ({
  playerId: "",
  connected: false,
  matchPhase: "waiting",
  matchTime: 0,
  matchDuration: 300,
  entities: new Map(),
  resources: new Map(),
  players: new Map(),
  events: [],

  setPlayerId: (id: string) => set({ playerId: id }),
  setConnected: (connected: boolean) => set({ connected }),
  setMatchPhase: (phase: "waiting" | "playing" | "ended") => set({ matchPhase: phase }),
  setMatchTime: (time: number) => set({ matchTime: time }),
  setMatchDuration: (duration: number) => set({ matchDuration: duration }),
  setEntities: (entities: Map<number, ClientEntity>) => set({ entities }),
  setResources: (resources: Map<number, ClientResource>) => set({ resources }),
  setPlayers: (players: Map<string, ClientPlayer>) => set({ players }),
  pushEvents: (newEvents: GameEvent[]) =>
    set((state) => ({ events: [...state.events, ...newEvents] })),
  clearEvents: () => set({ events: [] }),
}));
