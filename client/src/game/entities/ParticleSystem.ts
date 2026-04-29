// client/src/game/entities/ParticleSystem.ts
import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawnDeathEffect(worldX: number, worldZ: number, color: number): void {
    const count = 20;
    const geom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(worldX, 0.5, worldZ);
      this.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 2 + Math.random() * 3,
        vz: Math.sin(angle) * speed,
        life: 1.0,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 9.8 * dt;
      p.life -= dt * 1.5;
      p.mesh.scale.setScalar(Math.max(0, p.life));

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
