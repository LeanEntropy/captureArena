import { describe, it, expect } from "vitest";
import { pickWeakestFaction } from "../rooms/GameRoom.js";

describe("pickWeakestFaction", () => {
  it("picks faction with fewest humans", () => {
    const factions = [
      { id: 1, territoryPct: 30, alive: true },
      { id: 2, territoryPct: 25, alive: true },
      { id: 3, territoryPct: 20, alive: true },
    ];
    const humanCounts = new Map([[1, 3], [2, 1], [3, 2]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });

  it("breaks tie by lowest territoryPct", () => {
    const factions = [
      { id: 1, territoryPct: 30, alive: true },
      { id: 2, territoryPct: 20, alive: true },
      { id: 3, territoryPct: 25, alive: true },
    ];
    const humanCounts = new Map([[1, 0], [2, 0], [3, 0]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });

  it("ignores eliminated factions", () => {
    const factions = [
      { id: 1, territoryPct: 0, alive: false },
      { id: 2, territoryPct: 50, alive: true },
    ];
    const humanCounts = new Map([[1, 0], [2, 5]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });

  it("returns null when no factions are alive", () => {
    const factions = [
      { id: 1, territoryPct: 0, alive: false },
      { id: 2, territoryPct: 0, alive: false },
    ];
    const humanCounts = new Map();
    expect(pickWeakestFaction(factions, humanCounts)).toBeNull();
  });
});
