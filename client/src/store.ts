import { createStore } from "zustand/vanilla";
import type { GameEvent, Vec2 } from "@template/shared";

export interface ClientPlayer {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
  trail: Vec2[];
}

export interface GameState {
  playerId: string;
  playerName: string;
  connected: boolean;
  gameStarted: boolean;
  territoryGrid: Uint8Array | null;
  players: Map<string, ClientPlayer>;
  events: GameEvent[];
  playableCells: number;

  setPlayerId: (id: string) => void;
  setPlayerName: (name: string) => void;
  setConnected: (connected: boolean) => void;
  setGameStarted: (started: boolean) => void;
  setTerritoryGrid: (grid: Uint8Array) => void;
  setPlayers: (players: Map<string, ClientPlayer>) => void;
  updatePlayer: (id: string, updates: Partial<ClientPlayer>) => void;
  removePlayer: (id: string) => void;
  pushEvents: (events: GameEvent[]) => void;
  clearEvents: () => void;
  setPlayableCells: (count: number) => void;
}

export const useStore = createStore<GameState>((set) => ({
  playerId: "",
  playerName: "",
  connected: false,
  gameStarted: false,
  territoryGrid: null,
  players: new Map(),
  events: [],
  playableCells: 0,

  setPlayerId: (id) => set({ playerId: id }),
  setPlayerName: (name) => set({ playerName: name }),
  setConnected: (connected) => set({ connected }),
  setGameStarted: (started) => set({ gameStarted: started }),
  setTerritoryGrid: (grid) => set({ territoryGrid: grid }),
  setPlayers: (players) => set({ players }),
  updatePlayer: (id, updates) =>
    set((state) => {
      const players = new Map(state.players);
      const existing = players.get(id);
      if (existing) {
        players.set(id, { ...existing, ...updates });
      }
      return { players };
    }),
  removePlayer: (id) =>
    set((state) => {
      const players = new Map(state.players);
      players.delete(id);
      return { players };
    }),
  pushEvents: (newEvents) =>
    set((state) => ({ events: [...state.events, ...newEvents] })),
  clearEvents: () => set({ events: [] }),
  setPlayableCells: (count) => set({ playableCells: count }),
}));
