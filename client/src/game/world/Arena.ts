import * as THREE from "three";
import { WORLD_RADIUS } from "@template/shared";

export class Arena {
  group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();

    // Ground circle
    const groundGeom = new THREE.CircleGeometry(WORLD_RADIUS, 128);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Border ring
    const ringGeom = new THREE.RingGeometry(WORLD_RADIUS - 0.2, WORLD_RADIUS + 0.2, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xcccccc,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.group.add(ring);

    // Faint grid dots for spatial reference
    const dotCount = 40;
    const spacing = (WORLD_RADIUS * 2) / dotCount;
    const dotGeom = new THREE.CircleGeometry(0.08, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    for (let i = 0; i <= dotCount; i++) {
      for (let j = 0; j <= dotCount; j++) {
        const x = -WORLD_RADIUS + i * spacing;
        const z = -WORLD_RADIUS + j * spacing;
        if (Math.sqrt(x * x + z * z) < WORLD_RADIUS - 1) {
          const dot = new THREE.Mesh(dotGeom, dotMat);
          dot.rotation.x = -Math.PI / 2;
          dot.position.set(x, 0.01, z);
          this.group.add(dot);
        }
      }
    }
  }
}
