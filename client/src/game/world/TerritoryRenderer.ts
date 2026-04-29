import * as THREE from "three";
import { GRID_SIZE, WORLD_RADIUS, PLAYER_COLORS, BOUNDARY_CELL } from "@template/shared";

export class TerritoryRenderer {
  private mesh: THREE.Mesh;
  private texture: THREE.DataTexture;
  private textureData: Uint8Array;
  private colorCache: Map<number, [number, number, number]> = new Map();
  private lastGridRef: Uint8Array | null = null;

  constructor(scene: THREE.Scene) {
    this.textureData = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
    this.texture = new THREE.DataTexture(
      this.textureData, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    const geom = new THREE.PlaneGeometry(WORLD_RADIUS * 2, WORLD_RADIUS * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.02;
    scene.add(this.mesh);

    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const c = PLAYER_COLORS[i];
      this.colorCache.set(i + 1, [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
    }
  }

  getColorForSlot(slotId: number): [number, number, number] {
    let cached = this.colorCache.get(slotId);
    if (!cached) {
      const c = PLAYER_COLORS[(slotId - 1) % PLAYER_COLORS.length];
      cached = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      this.colorCache.set(slotId, cached);
    }
    return cached;
  }

  registerPlayerColor(slotId: number, color: number): void {
    this.colorCache.set(slotId, [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]);
  }

  updateFromGrid(grid: Uint8Array): void {
    if (grid === this.lastGridRef) return;
    this.lastGridRef = grid;

    const size = GRID_SIZE;
    const data = this.textureData;

    for (let i = 0; i < size * size; i++) {
      const cell = grid[i];
      const pi = i * 4;
      if (cell === BOUNDARY_CELL) {
        data[pi] = 0;
        data[pi + 1] = 0;
        data[pi + 2] = 0;
        data[pi + 3] = 0;
      } else if (cell === 0) {
        // Unclaimed = white (opaque)
        data[pi] = 255;
        data[pi + 1] = 255;
        data[pi + 2] = 255;
        data[pi + 3] = 255;
      } else {
        const [r, g, b] = this.getColorForSlot(cell);
        data[pi] = r;
        data[pi + 1] = g;
        data[pi + 2] = b;
        data[pi + 3] = 255;
      }
    }
    this.texture.needsUpdate = true;
  }
}
