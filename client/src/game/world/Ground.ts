import * as THREE from "three";
import { WORLD_SIZE } from "@template/shared";

export class Ground {
  group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();

    // Ground plane
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const material = new THREE.MeshStandardMaterial({
      color: 0x2d5a27,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Edge wireframe
    const edgeGeometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    const edges = new THREE.EdgesGeometry(edgeGeometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
    });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    wireframe.rotation.x = -Math.PI / 2;
    wireframe.position.y = 0.01;
    this.group.add(wireframe);
  }
}
