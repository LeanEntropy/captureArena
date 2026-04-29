import * as THREE from "three";
import { lerp, clamp } from "@template/shared";

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private targetX = 0;
  private targetZ = 0;
  private currentX = 0;
  private currentZ = 0;
  private orbitAngle = 0;
  private orbitPitch = 0.8;
  private orbitDistance = 22;
  private dragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.addEventListener("mousedown", this.onMouseDown);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 2) { this.dragging = true; this.lastMouseX = e.clientX; this.lastMouseY = e.clientY; }
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.orbitAngle -= dx * 0.005;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, 0.2, 1.4);
  };
  private onMouseUp = (e: MouseEvent) => { if (e.button === 2) this.dragging = false; };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.orbitDistance = clamp(this.orbitDistance + e.deltaY * 0.01, 4, 30); };

  setTarget(x: number, z: number) { this.targetX = x; this.targetZ = z; }

  update(dt: number) {
    const smoothing = 1 - Math.pow(0.05, dt);
    this.currentX = lerp(this.currentX, this.targetX, smoothing);
    this.currentZ = lerp(this.currentZ, this.targetZ, smoothing);
    const camX = this.currentX + Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDistance;
    const camY = Math.sin(this.orbitPitch) * this.orbitDistance;
    const camZ = this.currentZ + Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDistance;
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.currentX, 0, this.currentZ);
  }

  dispose() {
    const canvas = document.querySelector("canvas");
    if (canvas) canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
  }
}
