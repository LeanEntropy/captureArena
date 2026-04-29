import * as THREE from "three";
import { Loop } from "./Loop.js";
import { CameraRig } from "./CameraRig.js";
import { InputHandler } from "./InputHandler.js";
import { Arena } from "./world/Arena.js";

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cameraRig: CameraRig;
  inputHandler: InputHandler;
  private loop: Loop | null = null;

  onUpdate: ((dt: number) => void) | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    this.camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 200
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(10, 20, 10);
    this.scene.add(directional);

    // Arena
    const arena = new Arena();
    this.scene.add(arena.group);

    // Camera
    this.cameraRig = new CameraRig(this.camera);

    // Input
    this.inputHandler = new InputHandler(this.camera, this.renderer.domElement);

    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  update(dt: number) {
    this.cameraRig.update(dt);
    if (this.onUpdate) this.onUpdate(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.loop.start();
  }
}
