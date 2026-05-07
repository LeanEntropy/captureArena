import { describe, it, expect } from "vitest";
import { boot } from "@colyseus/testing";
import type { Server } from "@colyseus/core";
import { PrivateGameRoom } from "../rooms/PrivateGameRoom.js";
import { _resetForTest } from "../rooms/roomCodeRegistry.js";

describe("PrivateGameRoom", () => {
  it("creates with config, transitions waiting → playing on min humans", async () => {
    _resetForTest();
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("private", PrivateGameRoom).filterBy(["code"]);
      },
    });
    try {
      const room = await colyseus.createRoom("private", {
        factions: 3, bots: true, botsPerFaction: 2, minHumans: 2,
      });
      // settle
      await new Promise((r) => setTimeout(r, 100));
      expect(room.state.phase).toBe("waiting");
      expect(room.state.factions.length).toBe(3);
      expect(room.state.characters.length).toBe(0); // no bots yet
      expect(room.state.roomCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(room.state.minHumans).toBe(2);

      const code = room.state.roomCode;
      const c1 = await colyseus.connectTo(room, { code });
      await new Promise((r) => setTimeout(r, 100));
      c1.send("hello", { name: "T1" });
      await new Promise((r) => setTimeout(r, 100));
      expect(room.state.phase).toBe("waiting"); // 1/2 humans
      expect(room.state.humanCount).toBeGreaterThanOrEqual(1);

      const c2 = await colyseus.connectTo(room, { code });
      await new Promise((r) => setTimeout(r, 100));
      c2.send("hello", { name: "T2" });
      await new Promise((r) => setTimeout(r, 200));
      expect(room.state.phase).toBe("playing");
      expect(room.state.characters.length).toBeGreaterThanOrEqual(3 * 2); // bots spawned
    } finally {
      await colyseus.shutdown();
    }
  }, 15000);

  it("rejects oversized config", async () => {
    _resetForTest();
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("private", PrivateGameRoom).filterBy(["code"]);
      },
    });
    try {
      // 5 factions × 9 bots = 45 bots; +10 min humans = 55 > 50 → reject
      await expect(
        colyseus.createRoom("private", { factions: 5, bots: true, botsPerFaction: 9, minHumans: 10 }),
      ).rejects.toThrow();
    } finally {
      await colyseus.shutdown();
    }
  }, 10000);
});
