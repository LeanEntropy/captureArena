// client/src/game/world/TerritoryRenderer.ts
import * as THREE from "three";
import { GRID_SIZE, WORLD_RADIUS, PLAYER_COLORS, BOUNDARY_CELL } from "@template/shared";

export class TerritoryRenderer {
  private mesh: THREE.Mesh;
  private texture: THREE.DataTexture;
  private textureData: Uint8Array;
  private colorCache: Map<number, [number, number, number]> = new Map();

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

    // Pre-cache default colors
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
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = grid[i];
      const pi = i * 4;
      if (cell === 0 || cell === BOUNDARY_CELL) {
        this.textureData[pi] = 0;
        this.textureData[pi + 1] = 0;
        this.textureData[pi + 2] = 0;
        this.textureData[pi + 3] = 0;
      } else {
        const [r, g, b] = this.getColorForSlot(cell);
        this.textureData[pi] = r;
        this.textureData[pi + 1] = g;
        this.textureData[pi + 2] = b;
        this.textureData[pi + 3] = 180;
      }
    }
    this.texture.needsUpdate = true;
  }
}
