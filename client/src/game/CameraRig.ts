import * as THREE from "three";
import { lerp } from "@template/shared";

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private targetX = 0;
  private targetZ = 0;
  private currentX = 0;
  private currentZ = 0;
  private height = 25;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.set(0, this.height, 12);
    this.camera.lookAt(0, 0, 0);
  }

  setTarget(x: number, z: number) {
    this.targetX = x;
    this.targetZ = z;
  }

  update(dt: number) {
    const smoothing = 1 - Math.pow(0.03, dt);
    this.currentX = lerp(this.currentX, this.targetX, smoothing);
    this.currentZ = lerp(this.currentZ, this.targetZ, smoothing);
    this.camera.position.set(this.currentX, this.height, this.currentZ + 12);
    this.camera.lookAt(this.currentX, 0, this.currentZ);
  }
}
