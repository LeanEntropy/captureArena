import type { Vec2 } from "@template/shared";
import {
  MAX_TRAIL_LENGTH, MIN_TRAIL_LENGTH_FOR_SELF_KILL,
  worldToGrid, gridIndex, GRID_SIZE,
  bresenhamLine,
} from "@template/shared";
import type { TerritoryGrid } from "./TerritoryGrid.js";

export interface TrailHolder {
  trail: Vec2[];
  slotId: number;
  wasOutsideTerritory: boolean;
}

export function recordTrailPoint(
  holder: TrailHolder,
  x: number, y: number,
  territoryGrid: TerritoryGrid
): void {
  holder.trail.push({ x, y });
  // Rasterize line from previous point to current point onto trail grid
  if (holder.trail.length >= 2) {
    const prev = holder.trail[holder.trail.length - 2];
    const curr = holder.trail[holder.trail.length - 1];
    const p0 = worldToGrid(prev.x, prev.y);
    const p1 = worldToGrid(curr.x, curr.y);
    bresenhamLine(p0.gx, p0.gy, p1.gx, p1.gy, (gx, gy) => {
      territoryGrid.addTrailPoint(holder.slotId,
        gx * 0.25 - 50 + 0.125,  // gridToWorld inline
        gy * 0.25 - 50 + 0.125
      );
    });
  } else {
    territoryGrid.addTrailPoint(holder.slotId, x, y);
  }
}

export function isTrailTooLong(holder: TrailHolder): boolean {
  return holder.trail.length >= MAX_TRAIL_LENGTH;
}

export interface TrailCollisionResult {
  type: "none" | "self" | "enemy";
  victimSlotId?: number;
}

export function checkTrailCollision(
  movingSlotId: number,
  worldX: number, worldY: number,
  territoryGrid: TerritoryGrid,
  trailLength: number
): TrailCollisionResult {
  const trailOwner = territoryGrid.getTrailOwnerAt(worldX, worldY);
  if (trailOwner === 0) return { type: "none" };
  if (trailOwner === movingSlotId) {
    if (trailLength > MIN_TRAIL_LENGTH_FOR_SELF_KILL) {
      return { type: "self" };
    }
    return { type: "none" };
  }
  return { type: "enemy", victimSlotId: trailOwner };
}
