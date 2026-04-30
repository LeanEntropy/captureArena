import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../Simulation.js";
import { GRID_SIZE, GRID_SENTINEL } from "../constants.js";
import { FACTION_COUNT, CHARS_PER_FACTION } from "../faction.js";

describe("Simulation", () => {
  let sim;
  beforeEach(() => {
    sim = new Simulation({ seed: 1234 });
    sim.start();
  });

  it("creates a 1024x1024 grid initialized with sentinel outside arena", () => {
    expect(sim.grid).toBeInstanceOf(Uint8Array);
    expect(sim.grid.length).toBe(GRID_SIZE * GRID_SIZE);
    // top-left corner is outside the circular arena → sentinel
    expect(sim.grid[0]).toBe(GRID_SENTINEL);
    // center of arena is inside → not sentinel
    const ci = (GRID_SIZE / 2) * GRID_SIZE + (GRID_SIZE / 2);
    expect(sim.grid[ci]).not.toBe(GRID_SENTINEL);
  });

  it("creates 30 characters spread across 5 factions", () => {
    expect(sim.characters.length).toBe(FACTION_COUNT * CHARS_PER_FACTION);
    const byFaction = new Map();
    for (const c of sim.characters) {
      byFaction.set(c.factionId, (byFaction.get(c.factionId) ?? 0) + 1);
    }
    for (let f = 1; f <= FACTION_COUNT; f++) {
      expect(byFaction.get(f)).toBe(CHARS_PER_FACTION);
    }
  });

  it("all characters start with isHuman=false", () => {
    expect(sim.characters.every(c => c.isHuman === false)).toBe(true);
  });

  it("has a tick method that decrements match timeRemaining", () => {
    const before = sim.matchManager.timeRemaining;
    sim.tick(0.1);
    expect(sim.matchManager.timeRemaining).toBeCloseTo(before - 0.1, 5);
  });

  it("counts arena cells (totalArenaCells > 0 and < grid size)", () => {
    expect(sim.totalArenaCells).toBeGreaterThan(0);
    expect(sim.totalArenaCells).toBeLessThan(GRID_SIZE * GRID_SIZE);
  });

  it("tick advances a character along its dir vector", () => {
    const c = sim.characters[0];
    c.setPos(0, 0);
    c.dir = { x: 1, z: 0 };
    c.targetDir = { x: 1, z: 0 };
    const speedBefore = c.speed;
    sim.tick(0.1);
    // After 0.1s at default bot speed (6), char should have moved approximately 0.6 along x
    expect(c.pos.x).toBeGreaterThan(0.3);
    expect(c.pos.x).toBeLessThan(0.9);
    expect(Math.abs(c.pos.z)).toBeLessThan(0.05);
  });

  it("invuln timer decreases over time", () => {
    const c = sim.characters[0];
    c.invulnTimer = 1.0;
    sim.tick(0.5);
    expect(c.invulnTimer).toBeCloseTo(0.5, 1);
  });
});
