import { describe, it, expect } from "vitest";
import { boot } from "@colyseus/testing";
import type { Server } from "@colyseus/core";
import { GameRoom } from "../rooms/GameRoom.js";

describe("GameRoom", () => {
  it("creates a room with 30 characters and 5 factions", async () => {
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("game", GameRoom);
      },
    });
    try {
      const room = await colyseus.createRoom("game", {});
      // Wait one tick for state to populate
      await new Promise((r) => setTimeout(r, 100));
      expect(room.state.characters.length).toBe(30);
      expect(room.state.factions.length).toBe(5);
      expect(room.state.phase).toBe("playing");
    } finally {
      await colyseus.shutdown();
    }
  }, 10000);
});
