import { GRID_SIZE, BOUNDARY_CELL } from "./constants.js";
import { gridIndex, isInBounds } from "./grid.js";

export interface ClaimResult {
  claimedCells: number[];
  stolenFrom: Map<number, number>;
}

export function claimTerritory(
  territoryGrid: Uint8Array,
  trailGrid: Uint8Array,
  playerSlotId: number,
  trailPoints: { gx: number; gy: number }[]
): ClaimResult {
  const totalCells = GRID_SIZE * GRID_SIZE;

  for (const p of trailPoints) {
    const idx = gridIndex(p.gx, p.gy);
    if (territoryGrid[idx] !== BOUNDARY_CELL) {
      territoryGrid[idx] = playerSlotId;
    }
  }

  const visited = new Uint8Array(totalCells);

  for (let i = 0; i < totalCells; i++) {
    if (territoryGrid[i] === BOUNDARY_CELL || territoryGrid[i] === playerSlotId) {
      visited[i] = 1;
    }
  }

  const queue: number[] = [];
  for (let gx = 0; gx < GRID_SIZE; gx++) {
    const topIdx = gridIndex(gx, 0);
    const botIdx = gridIndex(gx, GRID_SIZE - 1);
    if (!visited[topIdx]) { visited[topIdx] = 1; queue.push(topIdx); }
    if (!visited[botIdx]) { visited[botIdx] = 1; queue.push(botIdx); }
  }
  for (let gy = 1; gy < GRID_SIZE - 1; gy++) {
    const leftIdx = gridIndex(0, gy);
    const rightIdx = gridIndex(GRID_SIZE - 1, gy);
    if (!visited[leftIdx]) { visited[leftIdx] = 1; queue.push(leftIdx); }
    if (!visited[rightIdx]) { visited[rightIdx] = 1; queue.push(rightIdx); }
  }

  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const gx = idx % GRID_SIZE;
    const gy = (idx - gx) / GRID_SIZE;
    for (let d = 0; d < 4; d++) {
      const nx = gx + dx[d];
      const ny = gy + dy[d];
      if (!isInBounds(nx, ny)) continue;
      const nIdx = ny * GRID_SIZE + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  const claimedCells: number[] = [];
  const stolenFrom = new Map<number, number>();

  for (let i = 0; i < totalCells; i++) {
    if (!visited[i] && territoryGrid[i] !== BOUNDARY_CELL && territoryGrid[i] !== playerSlotId) {
      const prevOwner = territoryGrid[i];
      if (prevOwner !== 0) {
        stolenFrom.set(prevOwner, (stolenFrom.get(prevOwner) || 0) + 1);
      }
      territoryGrid[i] = playerSlotId;
      claimedCells.push(i);
    }
  }

  for (const p of trailPoints) {
    const idx = gridIndex(p.gx, p.gy);
    claimedCells.push(idx);
  }

  for (let i = 0; i < totalCells; i++) {
    if (trailGrid[i] === playerSlotId) {
      trailGrid[i] = 0;
    }
  }

  return { claimedCells, stolenFrom };
}

export function countTerritory(grid: Uint8Array, slotId: number): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === slotId) count++;
  }
  return count;
}

export function countPlayableCells(grid: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== BOUNDARY_CELL) count++;
  }
  return count;
}
