import { GRID_SIZE, WORLD_RADIUS, CELL_SIZE, BOUNDARY_CELL } from "./constants.js";

export function worldToGrid(wx: number, wy: number): { gx: number; gy: number } {
  const gx = Math.floor((wx + WORLD_RADIUS) / CELL_SIZE);
  const gy = Math.floor((wy + WORLD_RADIUS) / CELL_SIZE);
  return {
    gx: Math.max(0, Math.min(GRID_SIZE - 1, gx)),
    gy: Math.max(0, Math.min(GRID_SIZE - 1, gy)),
  };
}

export function gridToWorld(gx: number, gy: number): { wx: number; wy: number } {
  return {
    wx: gx * CELL_SIZE - WORLD_RADIUS + CELL_SIZE / 2,
    wy: gy * CELL_SIZE - WORLD_RADIUS + CELL_SIZE / 2,
  };
}

export function gridIndex(gx: number, gy: number): number {
  return gy * GRID_SIZE + gx;
}

export function gridFromIndex(index: number): { gx: number; gy: number } {
  return {
    gx: index % GRID_SIZE,
    gy: Math.floor(index / GRID_SIZE),
  };
}

export function isInBounds(gx: number, gy: number): boolean {
  return gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE;
}

export function initBoundaryGrid(): Uint8Array {
  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const center = GRID_SIZE / 2;
  const radiusCells = WORLD_RADIUS / CELL_SIZE;
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const dx = gx - center + 0.5;
      const dy = gy - center + 0.5;
      if (Math.sqrt(dx * dx + dy * dy) > radiusCells) {
        grid[gy * GRID_SIZE + gx] = BOUNDARY_CELL;
      }
    }
  }
  return grid;
}

export function bresenhamLine(
  x0: number, y0: number, x1: number, y1: number,
  callback: (x: number, y: number) => void
): void {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    callback(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export function fillCircle(
  grid: Uint8Array,
  cx: number, cy: number,
  radius: number, value: number
): number[] {
  const changed: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (isInBounds(gx, gy)) {
          const idx = gridIndex(gx, gy);
          if (grid[idx] !== BOUNDARY_CELL && grid[idx] !== value) {
            grid[idx] = value;
            changed.push(idx);
          }
        }
      }
    }
  }
  return changed;
}
