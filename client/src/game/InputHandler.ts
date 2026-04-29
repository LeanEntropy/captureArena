import * as THREE from "three";
import { PlayerCommand } from "@template/shared";
import type { PlayerInput } from "@template/shared";

export class InputHandler {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLCanvasElement;
  private scene: THREE.Scene;

  entityMeshes: Map<number, THREE.Object3D> = new Map();
  onCommand: ((input: PlayerInput) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement, scene: THREE.Scene) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;

    this.domElement.addEventListener("mousedown", this.onMouseDown);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;

    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check entity hits
    const entityObjects = Array.from(this.entityMeshes.values());
    if (entityObjects.length > 0) {
      const hits = this.raycaster.intersectObjects(entityObjects, true);
      if (hits.length > 0) {
        let hitObject: THREE.Object3D | null = hits[0].object;
        while (hitObject && !this.findEntityId(hitObject)) {
          hitObject = hitObject.parent;
        }
        if (hitObject) {
          const targetId = this.findEntityId(hitObject);
          if (targetId !== null && this.onCommand) {
            this.onCommand({ type: PlayerCommand.Attack, targetId });
            return;
          }
        }
      }
    }

    // Ground intersection
    const intersection = new THREE.Vector3();
    const ray = this.raycaster.ray;
    if (ray.intersectPlane(this.groundPlane, intersection)) {
      if (this.onCommand) {
        this.onCommand({ type: PlayerCommand.Move, x: intersection.x, z: intersection.z });
      }
    }
  };

  private findEntityId(obj: THREE.Object3D): number | null {
    for (const [id, mesh] of this.entityMeshes) {
      if (mesh === obj) return id;
    }
    return null;
  }

  dispose() {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
  }
}
