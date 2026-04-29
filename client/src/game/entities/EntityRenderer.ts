import * as THREE from "three";
import { useStore } from "../../store.js";
import type { ClientEntity } from "../../store.js";

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return ((hash % 360) + 360) % 360;
}

export class EntityRenderer {
  meshes: Map<number, THREE.Mesh> = new Map();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update() {
    const state = useStore.getState();
    const entities = state.entities;

    // Remove meshes for entities that no longer exist
    for (const [id, mesh] of this.meshes) {
      if (!entities.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.meshes.delete(id);
      }
    }

    // Create or update meshes
    for (const [id, entity] of entities) {
      let mesh = this.meshes.get(id);
      if (!mesh) {
        const size = entity.size;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const hue = hashStringToHue(entity.ownerId);
        const color = new THREE.Color(`hsl(${hue}, 70%, 50%)`);
        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.2,
        });
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.meshes.set(id, mesh);
      }

      mesh.position.set(entity.x, entity.size * 0.5, entity.z);
      mesh.rotation.y = entity.heading;
    }
  }
}
