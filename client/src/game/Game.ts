import * as THREE from "three";
import { WORLD_SIZE } from "@template/shared";
import { Loop } from "./Loop.js";
import { CameraRig } from "./CameraRig.js";
import { InputHandler } from "./InputHandler.js";
import { Ground } from "./world/Ground.js";
import { EntityRenderer } from "./entities/EntityRenderer.js";

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cameraRig: CameraRig;
  inputHandler: InputHandler;
  entityRenderer: EntityRenderer;
  private loop: Loop | null = null;

  onUpdate: ((dt: number) => void) | null = null;
  onRender: (() => void) | null = null;

  constructor() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 40, 70);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(10, 15, 10);
    directional.castShadow = true;
    directional.shadow.mapSize.set(1024, 1024);
    directional.shadow.camera.near = 0.5;
    directional.shadow.camera.far = 60;
    directional.shadow.camera.left = -20;
    directional.shadow.camera.right = 20;
    directional.shadow.camera.top = 20;
    directional.shadow.camera.bottom = -20;
    this.scene.add(directional);

    // Ground
    const ground = new Ground();
    this.scene.add(ground.group);

    // Entity Renderer
    this.entityRenderer = new EntityRenderer(this.scene);

    // Camera Rig
    this.cameraRig = new CameraRig(this.camera);

    // Input Handler
    this.inputHandler = new InputHandler(
      this.camera,
      this.renderer.domElement,
      this.scene
    );
    this.inputHandler.entityMeshes = this.entityRenderer.meshes;

    // Resize
    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  update(dt: number) {
    this.cameraRig.update(dt);
    this.entityRenderer.update();
    if (this.onUpdate) this.onUpdate(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    if (this.onRender) this.onRender();
  }

  start() {
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.loop.start();
  }
}
