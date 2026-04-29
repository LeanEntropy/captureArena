// client/src/game/InputHandler.ts
import * as THREE from "three";

export class InputHandler {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouseWorld = new THREE.Vector3();
  private mouseNDC = new THREE.Vector2();
  private keysDown = new Set<string>();

  targetHeading: number = 0;
  hasInput: boolean = false;
  playerWorldX: number = 0;
  playerWorldZ: number = 0;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.domElement.addEventListener("mousemove", this.onMouseMove);
    this.domElement.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.domElement.addEventListener("touchstart", this.onTouchMove, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.domElement.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHeadingFromMouse();
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = this.domElement.getBoundingClientRect();
      this.mouseNDC.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
      this.updateHeadingFromMouse();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keysDown.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.key.toLowerCase());
  };

  private updateHeadingFromMouse(): void {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      this.mouseWorld.copy(hit);
      // Note: in our game, world Y maps to Three.js Z
      const dx = hit.x - this.playerWorldX;
      const dz = hit.z - this.playerWorldZ;
      if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
        // Game uses (x, y) where y maps to three.js z. heading = atan2(dy, dx) in game coords.
        // In three.js: dx is game dx, dz is negative game dy (three.js z = -game y typically)
        // But in our setup: game y maps to three.js -z (since three.js z is forward-toward-camera)
        // So game heading = atan2(-dz, dx)
        this.targetHeading = Math.atan2(-dz, dx);
        this.hasInput = true;
      }
    }
  }

  update(): void {
    // Keyboard overrides mouse
    let kx = 0;
    let ky = 0;
    if (this.keysDown.has("w") || this.keysDown.has("arrowup")) ky += 1;
    if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) ky -= 1;
    if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) kx -= 1;
    if (this.keysDown.has("d") || this.keysDown.has("arrowright")) kx += 1;
    if (kx !== 0 || ky !== 0) {
      this.targetHeading = Math.atan2(ky, kx);
      this.hasInput = true;
    }
  }

  setPlayerPosition(worldX: number, worldZ: number): void {
    this.playerWorldX = worldX;
    this.playerWorldZ = worldZ;
  }

  dispose() {
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("touchmove", this.onTouchMove);
    this.domElement.removeEventListener("touchstart", this.onTouchMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
