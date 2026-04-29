import { GRID_SIZE, PLAYER_COLORS, BOUNDARY_CELL } from "@template/shared";

const MINIMAP_SIZE = 150;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = MINIMAP_SIZE;
    this.canvas.height = MINIMAP_SIZE;
    this.canvas.style.cssText = "border-radius:50%; border:3px solid rgba(0,0,0,0.2); background:#f0f0f0;";
    document.getElementById("minimap-container")!.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d")!;
    this.imageData = this.ctx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
  }

  update(grid: Uint8Array | null): void {
    if (!grid) return;

    const scale = GRID_SIZE / MINIMAP_SIZE;
    const data = this.imageData.data;
    const centerX = MINIMAP_SIZE / 2;
    const centerY = MINIMAP_SIZE / 2;
    const radius = MINIMAP_SIZE / 2;

    for (let my = 0; my < MINIMAP_SIZE; my++) {
      for (let mx = 0; mx < MINIMAP_SIZE; mx++) {
        const pi = (my * MINIMAP_SIZE + mx) * 4;

        // Circular mask
        const dx = mx - centerX;
        const dy = my - centerY;
        if (dx * dx + dy * dy > radius * radius) {
          data[pi] = 0; data[pi + 1] = 0; data[pi + 2] = 0; data[pi + 3] = 0;
          continue;
        }

        const gx = Math.floor(mx * scale);
        const gy = Math.floor(my * scale);
        const cell = grid[gy * GRID_SIZE + gx];

        if (cell === 0 || cell === BOUNDARY_CELL) {
          data[pi] = 240; data[pi + 1] = 240; data[pi + 2] = 240; data[pi + 3] = 255;
        } else {
          const c = PLAYER_COLORS[(cell - 1) % PLAYER_COLORS.length];
          data[pi] = (c >> 16) & 0xff;
          data[pi + 1] = (c >> 8) & 0xff;
          data[pi + 2] = c & 0xff;
          data[pi + 3] = 255;
        }
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
