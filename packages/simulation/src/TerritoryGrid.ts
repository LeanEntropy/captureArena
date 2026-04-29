import {
  GRID_SIZE, BOUNDARY_CELL, STARTING_TERRITORY_RADIUS, UNCLAIMED_CELL,
  initBoundaryGrid, fillCircle, worldToGrid, gridIndex,
  claimTerritory, countTerritory, countPlayableCells,
} from "@template/shared";
import type { ClaimResult } from "@template/shared";

export class TerritoryGrid {
  grid: Uint8Array;
  trailGrid: Uint8Array;
  playableCells: number;

  constructor() {
    this.grid = initBoundaryGrid();
    this.trailGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.playableCells = countPlayableCells(this.grid);
  }

  grantStartingTerritory(slotId: number, worldX: number, worldY: number): number[] {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return fillCircle(this.grid, gx, gy, STARTING_TERRITORY_RADIUS, slotId);
  }

  isOnOwnTerritory(slotId: number, worldX: number, worldY: number): boolean {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.grid[gridIndex(gx, gy)] === slotId;
  }

  isOutsideBoundary(worldX: number, worldY: number): boolean {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.grid[gridIndex(gx, gy)] === BOUNDARY_CELL;
  }

  addTrailPoint(slotId: number, worldX: number, worldY: number): void {
    const { gx, gy } = worldToGrid(worldX, worldY);
    const idx = gridIndex(gx, gy);
    if (this.grid[idx] !== BOUNDARY_CELL) {
      this.trailGrid[idx] = slotId;
    }
  }

  getTrailOwnerAt(worldX: number, worldY: number): number {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.trailGrid[gridIndex(gx, gy)];
  }

  claim(slotId: number, trailWorldPoints: { x: number; y: number }[]): ClaimResult {
    const gridPoints = trailWorldPoints.map(p => worldToGrid(p.x, p.y));
    return claimTerritory(this.grid, this.trailGrid, slotId, gridPoints);
  }

  clearTrail(slotId: number): void {
    for (let i = 0; i < this.trailGrid.length; i++) {
      if (this.trailGrid[i] === slotId) {
        this.trailGrid[i] = UNCLAIMED_CELL;
      }
    }
  }

  getTerritoryCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < this.grid.length; i++) {
      const v = this.grid[i];
      if (v !== UNCLAIMED_CELL && v !== BOUNDARY_CELL) {
        counts.set(v, (counts.get(v) || 0) + 1);
      }
    }
    return counts;
  }

  getFullGridCopy(): Uint8Array {
    return new Uint8Array(this.grid);
  }
}
