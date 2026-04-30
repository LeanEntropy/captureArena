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
});
