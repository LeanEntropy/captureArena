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

  it("character.wasOutside flips true when leaving own territory", () => {
    const c = sim.characters[0]; // faction 1, lives in faction 1's pie slice
    // Faction 1's pie slice is at angle 0-72°, so put char at 180° (opposite side)
    c.setPos(-15, 0);
    c.dir = { x: 0, z: 0 };
    c.targetDir = { x: 0, z: 0 };
    expect(c.wasOutside).toBe(false);
    sim.tick(0.05);
    // After ticking once at this position, the trail-step logic should detect outside
    expect(c.wasOutside).toBe(true);
  });

  it("claim with a triangle trail fills enclosed cells with the faction id", () => {
    const c = sim.characters[0]; // faction 1
    c.setPos(0, 0);
    c.factionId = 1;
    c.trailVerts = [
      { x: -1.0, z: -1.0 },
      { x:  1.0, z: -1.0 },
      { x:  1.0, z:  1.0 },
      { x: -1.0, z:  1.0 },
      { x: -0.5, z:  0.0 }, // 5+ verts required
    ];
    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    expect(c.trailVerts.length).toBe(0);
    // Claim must have gained cells — the trail covers neutral/enemy area.
    expect(after).toBeGreaterThan(before);
  });

  it("claim with too-short trail returns false (no-op)", () => {
    const c = sim.characters[0];
    c.trailVerts = [{ x: 0, z: 0 }];
    const before = countCellsOwnedBy(sim.grid, c.factionId);
    const ok = sim.claim(c);
    expect(ok).toBe(false);
    expect(countCellsOwnedBy(sim.grid, c.factionId)).toBe(before);
  });

  it("setHumanControl flips isHuman on the indexed character", () => {
    const c = sim.characters[3];
    expect(c.isHuman).toBe(false);
    sim.setHumanControl(3, true);
    expect(c.isHuman).toBe(true);
    sim.setHumanControl(3, false);
    expect(c.isHuman).toBe(false);
  });

  it("setTargetDir normalizes the input", () => {
    const c = sim.characters[0];
    sim.setTargetDir(0, 3, 4); // length 5
    expect(c.targetDir.x).toBeCloseTo(0.6, 5);
    expect(c.targetDir.z).toBeCloseTo(0.8, 5);
  });

  it("setTargetDir ignores zero-length input", () => {
    const c = sim.characters[0];
    c.targetDir = { x: 1, z: 0 };
    sim.setTargetDir(0, 0, 0);
    expect(c.targetDir).toEqual({ x: 1, z: 0 }); // unchanged
  });

  it("onHeal hook fires with changed cells when heal pass mutates the grid", () => {
    // After start() the arena is fully claimed — no 0-cells remain.
    // Zero out an interior cell that has faction neighbors so the heal pass
    // will re-assign it. We call _healUnclaimedCells() directly rather than
    // routing through claim(), which could stamp over the cell before the heal.
    let healCalled = false;
    let healChanges = null;
    sim.onHeal = (changed) => { healCalled = true; healChanges = changed; };

    // Find an interior faction-1 cell (not on grid edge) with at least 2
    // faction-valued neighbors so the heal pass can re-assign it.
    let targetIdx = -1;
    for (let i = 0; i < sim.grid.length; i++) {
      if (sim.grid[i] !== 1) continue;
      const gx = i % GRID_SIZE;
      const gy = Math.floor(i / GRID_SIZE);
      if (gx <= 1 || gx >= GRID_SIZE - 2 || gy <= 1 || gy >= GRID_SIZE - 2) continue;
      const n = sim.grid[i - 1];
      const s = sim.grid[i + 1];
      const w = sim.grid[i - GRID_SIZE];
      const e = sim.grid[i + GRID_SIZE];
      const factionNeighbors = [n, s, w, e].filter(v => v > 0 && v !== GRID_SENTINEL);
      if (factionNeighbors.length >= 2) { targetIdx = i; break; }
    }
    expect(targetIdx).toBeGreaterThan(0); // sanity check

    sim.grid[targetIdx] = 0;

    // Directly invoke the heal pass — no claim needed
    sim._healUnclaimedCells();

    expect(healCalled).toBe(true);
    expect(healChanges.length).toBeGreaterThan(0);
    // The zeroed cell must have been re-assigned
    expect(sim.grid[targetIdx]).toBeGreaterThan(0);
    expect(sim.grid[targetIdx]).not.toBe(GRID_SENTINEL);
  });

  it("restart resets characters and grid", () => {
    sim.characters[0].alive = false;
    sim.characters[0].killCount = 7;
    sim.characters[0].trailVerts = [{ x: 0, z: 0 }];
    sim.characters[0].wasOutside = true;
    sim.restart();
    expect(sim.characters[0].alive).toBe(true);
    expect(sim.characters[0].killCount).toBe(0);
    expect(sim.characters[0].trailVerts).toEqual([]);
    expect(sim.characters[0].wasOutside).toBe(false);
  });
});

function countCellsOwnedBy(grid, factionId) {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === factionId) n++;
  return n;
}
