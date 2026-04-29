// client/src/game/entities/TrailRenderer.ts
import * as THREE from "three";
import type { Vec2 } from "@template/shared";

const TRAIL_WIDTH = 0.4;
const TRAIL_HEIGHT = 0.15;

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

    // Get or create material
    let mat = this.materials.get(playerId);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      this.materials.set(playerId, mat);
    }

    // Build ribbon geometry from trail points
    // Each segment: 2 triangles forming a quad, extruded perpendicular to the trail direction
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      // Compute perpendicular direction
      let dx = 0, dy = 0;
      if (i < trail.length - 1) {
        dx = trail[i + 1].x - p.x;
        dy = trail[i + 1].y - p.y;
      } else if (i > 0) {
        dx = p.x - trail[i - 1].x;
        dy = p.y - trail[i - 1].y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      // Game y → three.js -z
      const wx = p.x;
      const wz = -p.y;

      // Bottom-left, bottom-right, top-left, top-right of the ribbon cross-section
      const hw = TRAIL_WIDTH / 2;
      positions.push(
        wx + nx * hw, 0, wz - ny * hw,            // bottom-left
        wx - nx * hw, 0, wz + ny * hw,            // bottom-right
        wx + nx * hw, TRAIL_HEIGHT, wz - ny * hw,  // top-left
        wx - nx * hw, TRAIL_HEIGHT, wz + ny * hw,  // top-right
      );

      if (i > 0) {
        const base = (i - 1) * 4;
        const curr = i * 4;
        // Bottom face
        indices.push(base, base + 1, curr + 1, base, curr + 1, curr);
        // Top face
        indices.push(base + 2, curr + 2, curr + 3, base + 2, curr + 3, base + 3);
        // Left side
        indices.push(base, curr, curr + 2, base, curr + 2, base + 2);
        // Right side
        indices.push(base + 1, base + 3, curr + 3, base + 1, curr + 3, curr + 1);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geom;
    } else {
      mesh = new THREE.Mesh(geom, mat);
      this.scene.add(mesh);
      this.meshes.set(playerId, mesh);
    }
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
