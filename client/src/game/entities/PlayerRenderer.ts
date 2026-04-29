// client/src/game/entities/PlayerRenderer.ts
import * as THREE from "three";
import type { ClientPlayer } from "../../store.js";

export class PlayerRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Group> = new Map();
  private labels: Map<string, HTMLDivElement> = new Map();
  private camera: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }

  update(players: Map<string, ClientPlayer>): void {
    // Remove meshes for players that left
    for (const [id, group] of this.meshes) {
      if (!players.has(id)) {
        this.scene.remove(group);
        this.meshes.delete(id);
        const label = this.labels.get(id);
        if (label) { label.remove(); this.labels.delete(id); }
      }
    }

    for (const [id, player] of players) {
      if (!player.alive) {
        const existing = this.meshes.get(id);
        if (existing) existing.visible = false;
        const label = this.labels.get(id);
        if (label) label.style.display = "none";
        continue;
      }

      let group = this.meshes.get(id);
      if (!group) {
        group = this.createPlayerMesh(player.color);
        this.scene.add(group);
        this.meshes.set(id, group);
      }

      group.visible = true;

      // Game coords: x → three.js x, y → three.js -z
      group.position.set(player.x, 0.4, -player.y);
      group.rotation.y = -player.heading + Math.PI / 2;

      // Invulnerability flash
      if (player.invulnTimer > 0) {
        const flash = Math.sin(performance.now() * 0.01) > 0;
        group.visible = flash;
      }

      // Name label
      this.updateLabel(id, player, group);
    }
  }

  private createPlayerMesh(color: number): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeom = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.0;
    group.add(body);

    // Head
    const headGeom = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 0.5;
    group.add(head);

    // Eyes
    const eyeGeom = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeom = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-0.1, 0.52, 0.22);
    group.add(leftEye);
    const leftPupil = new THREE.Mesh(pupilGeom, pupilMat);
    leftPupil.position.set(-0.1, 0.52, 0.25);
    group.add(leftPupil);

    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.1, 0.52, 0.22);
    group.add(rightEye);
    const rightPupil = new THREE.Mesh(pupilGeom, pupilMat);
    rightPupil.position.set(0.1, 0.52, 0.25);
    group.add(rightPupil);

    return group;
  }

  private updateLabel(id: string, player: ClientPlayer, group: THREE.Group): void {
    let label = this.labels.get(id);
    if (!label) {
      label = document.createElement("div");
      label.style.cssText = "position:fixed;pointer-events:none;font-size:12px;font-weight:bold;color:#333;text-shadow:0 0 3px white;white-space:nowrap;transform:translate(-50%,-100%);z-index:5;";
      document.getElementById("ui-overlay")!.appendChild(label);
      this.labels.set(id, label);
    }

    label.style.display = "";
    label.textContent = player.name;

    // Project 3D position to screen
    const pos = new THREE.Vector3().copy(group.position);
    pos.y += 1.2;
    pos.project(this.camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
  }

  dispose(): void {
    for (const [_id, group] of this.meshes) {
      this.scene.remove(group);
    }
    this.meshes.clear();
    for (const label of this.labels.values()) {
      label.remove();
    }
    this.labels.clear();
  }
}
