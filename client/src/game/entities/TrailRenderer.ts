import * as THREE from "three";
import type { Vec2 } from "@template/shared";

const TRAIL_WIDTH = 1.2;
const TRAIL_Y = 0.15;

export class TrailRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Mesh> = new Map();
  private materials: Map<string, THREE.MeshBasicMaterial> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  updateTrail(playerId: string, trail: Vec2[], color: number): void {
    let mesh = this.meshes.get(playerId);

    if (trail.length < 2) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(playerId);
      }
      return;
    }

    let mat = this.materials.get(playerId);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
      });
      this.materials.set(playerId, mat);
    }

    // Subsample trail for performance (keep every 2nd point, always keep first and last)
    const sampled = this.subsample(trail, 2);

    // Build flat ribbon from trail points
    const positions: number[] = [];
    const indices: number[] = [];
    const hw = TRAIL_WIDTH / 2;

    for (let i = 0; i < sampled.length; i++) {
      const p = sampled[i];

      // Smooth normal: average direction from both neighbors
      let dx: number, dy: number;
      if (i > 0 && i < sampled.length - 1) {
        dx = sampled[i + 1].x - sampled[i - 1].x;
        dy = sampled[i + 1].y - sampled[i - 1].y;
      } else if (i < sampled.length - 1) {
        dx = sampled[i + 1].x - p.x;
        dy = sampled[i + 1].y - p.y;
      } else {
        dx = p.x - sampled[i - 1].x;
        dy = p.y - sampled[i - 1].y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      const wx = p.x;
      const wz = -p.y;

      // Two vertices per point (left and right of ribbon)
      positions.push(
        wx + nx * hw, TRAIL_Y, wz - ny * hw,
        wx - nx * hw, TRAIL_Y, wz + ny * hw,
      );

      if (i > 0) {
        const prev = (i - 1) * 2;
        const curr = i * 2;
        indices.push(prev, prev + 1, curr + 1, prev, curr + 1, curr);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);

    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geom;
    } else {
      mesh = new THREE.Mesh(geom, mat);
      this.scene.add(mesh);
      this.meshes.set(playerId, mesh);
    }
  }

  private subsample(trail: Vec2[], step: number): Vec2[] {
    if (trail.length <= 20) return trail;
    const result: Vec2[] = [trail[0]];
    for (let i = step; i < trail.length - 1; i += step) {
      result.push(trail[i]);
    }
    result.push(trail[trail.length - 1]);
    return result;
  }

  removeTrail(playerId: string): void {
    const mesh = this.meshes.get(playerId);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(playerId);
    }
    const mat = this.materials.get(playerId);
    if (mat) {
      mat.dispose();
      this.materials.delete(playerId);
    }
  }

  dispose(): void {
    for (const [id] of this.meshes) {
      this.removeTrail(id);
    }
  }
}
