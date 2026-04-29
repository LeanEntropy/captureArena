import * as THREE from "three";
import { WORLD_RADIUS } from "@template/shared";

export class Arena {
  group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();

    // Ground circle — white
    const groundGeom = new THREE.CircleGeometry(WORLD_RADIUS, 128);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    // Subtle border ring
    const ringGeom = new THREE.RingGeometry(WORLD_RADIUS - 0.3, WORLD_RADIUS + 0.3, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xe0e0e0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.group.add(ring);
  }
}
