import { describe, it, expect } from "vitest";
import { Character } from "../Character.js";

describe("Character", () => {
  it("constructs with default state", () => {
    const c = new Character({ id: 0, factionId: 1, name: "Alpha" });
    expect(c.id).toBe(0);
    expect(c.factionId).toBe(1);
    expect(c.name).toBe("Alpha");
    expect(c.alive).toBe(true);
    expect(c.isHuman).toBe(false);
    expect(c.pos).toEqual({ x: 0, z: 0 });
    expect(c.dir).toEqual({ x: 0, z: 1 });
    expect(c.targetDir).toEqual({ x: 0, z: 1 });
    expect(c.trailVerts).toEqual([]);
    expect(c.killCount).toBe(0);
    expect(c.invulnTimer).toBe(0);
    expect(c.respawnTimer).toBe(0);
    expect(c.wasOutside).toBe(false);
  });

  it("setPos updates position immutably (new object)", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X" });
    const before = c.pos;
    c.setPos(3, 5);
    expect(c.pos).toEqual({ x: 3, z: 5 });
    expect(before).toEqual({ x: 0, z: 0 }); // original not mutated
  });

  it("kill sets alive=false and starts respawn timer", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X", respawnDelay: 3 });
    c.kill();
    expect(c.alive).toBe(false);
    expect(c.respawnTimer).toBe(3);
  });

  it("kill clears trail vertices and zeros invulnTimer", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X", respawnDelay: 3 });
    c.invulnTimer = 1.5;
    c.trailVerts = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    c.kill();
    expect(c.invulnTimer).toBe(0);
    expect(c.trailVerts).toEqual([]);
  });

  it("respawn restores alive state, sets pos, applies invuln, clears trail", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X" });
    c.kill();
    expect(c.alive).toBe(false);
    c.respawn(7, 9);
    expect(c.alive).toBe(true);
    expect(c.pos).toEqual({ x: 7, z: 9 });
    expect(c.respawnTimer).toBe(0);
    expect(c.invulnTimer).toBeGreaterThan(0); // INVULN_TIME from constants
    expect(c.trailVerts).toEqual([]);
  });

  it("constructor accepts custom speed (player faster than bot)", () => {
    const player = new Character({ id: 0, factionId: 1, name: "P", speed: 8 });
    const bot = new Character({ id: 1, factionId: 1, name: "B" });
    expect(player.speed).toBe(8);
    expect(bot.speed).toBe(6);
  });
});
