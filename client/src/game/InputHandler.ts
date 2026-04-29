import * as THREE from "three";

export class InputHandler {
  targetHeading: number = 0;
  hasInput: boolean = false;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    // Stub — fully implemented in Task 6
    void camera;
    void domElement;
  }

  update() {}

  setPlayerPosition(x: number, z: number) {
    void x;
    void z;
  }

  dispose() {}
}
