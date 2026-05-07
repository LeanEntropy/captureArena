import { describe, it, expect } from "vitest";
import { enforceConnectivity } from "../connectivity.js";

// Tiny synthetic 8x8 grid for unit tests. Faction ids: 0=unclaimed, 1,2,3.
// We don't need sentinel/arena — connectivity helper treats any non-faction
// cell as a wall, so a rectangular bbox is fine here.
//
// `chars` mock provides only the fields the helper reads: factionId, alive,
// trailVerts.length, pos.x, pos.z (where pos maps to a grid cell index via a
// passed-in cellIndexOf function — we avoid pulling in the real worldToGrid).

function makeGrid(rows, gridSize = 8) {
  const g = new Uint8Array(gridSize * gridSize);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      g[y * gridSize + x] = rows[y][x];
    }
  }
  return g;
}

function makeCellCounts(grid, numFactions) {
  const c = new Uint32Array(numFactions + 1);
  for (let i = 0; i < grid.length; i++) c[grid[i]]++;
  return c;
}

// Faction 1 has TWO disconnected blocks; resident in each. Both survive.
describe("enforceConnectivity", () => {
  it("split-with-resident-in-both-halves: both halves survive", () => {
    const grid = makeGrid([
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    // residents: char A at (1,1) (left block), char B at (6,1) (right block)
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 1 },
      { id: 1, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 6 },
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    expect(result.capturedCells).toBe(0);
    expect(result.killedCharacters).toEqual([]);
    // Both blocks unchanged — count of faction 1 cells preserved.
    expect(cellCounts[1]).toBe(12);
  });

  it("split-with-resident-in-only-one-half: empty half captured by claimer", () => {
    const grid = makeGrid([
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 1 }, // left block only
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    // Right block (6 cells) captured.
    expect(result.capturedCells).toBe(6);
    expect(result.killedCharacters).toEqual([]);
    expect(cellCounts[1]).toBe(6); // left block remains
    expect(cellCounts[2]).toBe(6); // claimer gained 6
    // Right block cells are now claimer's faction.
    expect(grid[0 * 8 + 6]).toBe(2);
    expect(grid[2 * 8 + 7]).toBe(2);
    // Left block unchanged.
    expect(grid[0 * 8 + 0]).toBe(1);
  });

  it("encircled trail-runner whose faction has only the captured region: dies", () => {
    // Faction 1 occupies a single block. The only living faction-1 char is
    // OUTSIDE that block (trail-running) — block has no resident.
    const grid = makeGrid([
      [1,1,1,0,0,0,0,0],
      [1,1,1,0,0,0,0,0],
      [1,1,1,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const trailRunner = {
      id: 7, factionId: 1, alive: true,
      trailVerts: [{ x: 0, z: 0 }], // non-empty = trailing
      cellIndex: 5 * 8 + 5, // outside the block
    };
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: [trailRunner], claimerFactionId: 2, cellCounts,
    });
    // 9-cell block captured; 0 cells left for faction 1.
    expect(result.capturedCells).toBe(9);
    expect(cellCounts[1]).toBe(0);
    expect(cellCounts[2]).toBe(9);
    expect(result.killedCharacters).toHaveLength(1);
    expect(result.killedCharacters[0]).toBe(trailRunner);
  });
});
