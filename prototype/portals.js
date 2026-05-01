// ─────────────────────────────────────────────────────────────────────
// Vibe Jam 2026 — Three.js portal sample (ES module form)
// https://vibej.am/portal/2026
//
// Adapted from the official sample. Logic is unchanged; only the IIFE
// + window-globals envelope was swapped for ES module imports/exports
// so it can integrate with this prototype's importmap-driven THREE.
//
//   import { initVibeJamPortals, animateVibeJamPortals, arrivedViaPortal } from "./portals.js";
//   initVibeJamPortals({ scene, getPlayer, spawnPoint, exitPosition });
//   // every frame:
//   animateVibeJamPortals();
//
// Read the full portal guide: https://vibej.am/2026#portals
// ─────────────────────────────────────────────────────────────────────

import * as THREE from "three";

const qs = new URLSearchParams(window.location.search);
export const arrivedViaPortal = qs.get('portal') === 'true' || qs.get('portal') === '1';

// Populated by initVibeJamPortals()
let cfg = null;
let startPortal = null;
let exitPortal = null;
let startPortalActivateAt = 0;

// ── Portal factory ──────────────────────────────────────────────
function makePortal({ color, position, rotationX = 0, label = '', scale = 0.10 }) {
  const group = new THREE.Group();
  group.position.set(position.x, position.y, position.z);
  group.rotation.x = rotationX;
  group.scale.setScalar(scale);

  // Torus ring
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(15, 2, 16, 100),
    new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      transparent: true,
      opacity: 0.8,
    })
  ));

  // Inner disc
  group.add(new THREE.Mesh(
    new THREE.CircleGeometry(13, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    })
  ));

  // Optional label above the portal
  if (label) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 5),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    mesh.position.y = 20;
    group.add(mesh);
  }

  // Swirling particle ring
  const particleCount = 1000;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  for (let i = 0; i < particleCount * 3; i += 3) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 15 + (Math.random() - 0.5) * 4;
    positions[i] = Math.cos(angle) * radius;
    positions[i + 1] = Math.sin(angle) * radius;
    positions[i + 2] = (Math.random() - 0.5) * 4;
    const jitter = 0.8 + Math.random() * 0.2;
    colors[i] = r * jitter;
    colors[i + 1] = g * jitter;
    colors[i + 2] = b * jitter;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particleSystem = new THREE.Points(geom, new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  }));
  group.add(particleSystem);

  return {
    group,
    particles: geom,
    box: new THREE.Box3().setFromObject(group),
  };
}

// ── Per-frame helpers ──────────────────────────────────────────
function animateParticles(p) {
  const positions = p.attributes.position.array;
  const t = Date.now() * 0.001;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] += 0.05 * Math.sin(t + i);
  }
  p.attributes.position.needsUpdate = true;
}

// Start portal: sends the player BACK to the game they came from.
// Only active if the player arrived via ?portal=true&ref=<host>.
function checkStartPortal() {
  if (!arrivedViaPortal || !startPortal) return;
  // Activation delay — so players aren't instantly bounced on spawn.
  // Correct way: compare to an activation timestamp set ONCE. Do NOT put
  // setTimeout() inside your animate loop — it queues a new callback every
  // frame and triggers an avalanche 5 seconds later.
  if (Date.now() < startPortalActivateAt) return;

  const player = cfg.getPlayer && cfg.getPlayer();
  if (!player) return;

  const playerBox = new THREE.Box3().setFromObject(player);
  const dist = playerBox.getCenter(new THREE.Vector3())
    .distanceTo(startPortal.box.getCenter(new THREE.Vector3()));
  if (dist > 50) return;
  if (!playerBox.intersectsBox(startPortal.box)) return;

  const params = new URLSearchParams(window.location.search);
  const refUrl = params.get('ref');
  if (!refUrl) return;

  let url = refUrl;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // Pass everything else back (minus ref, since it's now the base URL)
  params.delete('ref');
  const s = params.toString();
  window.location.href = url + (s ? '?' + s : '');
}

// Exit portal: sends the player to vibej.am/portal/2026, which picks
// a random 2026 game with a working portal and 302s them there.
function checkExitPortal() {
  if (!exitPortal) return;

  const player = cfg.getPlayer && cfg.getPlayer();
  if (!player) return;

  const playerBox = new THREE.Box3().setFromObject(player);
  const dist = playerBox.getCenter(new THREE.Vector3())
    .distanceTo(exitPortal.box.getCenter(new THREE.Vector3()));
  if (dist > 50) return;
  // Only trigger on actual intersection
  if (!playerBox.intersectsBox(exitPortal.box)) return;

  // Build forwarded params.
  // IMPORTANT: start from current URL params and use .set() so you don't
  // accidentally produce duplicates like ?username=you&username=other.
  const params = new URLSearchParams(window.location.search);
  params.set('portal', 'true');
  // This game is the new source — overwrite ref with our hostname
  params.set('ref', window.location.hostname);

  // Optional player state — only set if your game defines them.
  // Replace these with your own variable names.
  if (typeof selfUsername !== 'undefined') params.set('username', String(selfUsername));
  if (typeof currentSpeed !== 'undefined') params.set('speed', String(currentSpeed));
  // Other supported keys (all optional):
  //   color, avatar_url, team, hp,
  //   speed_x, speed_y, speed_z,
  //   rotation_x, rotation_y, rotation_z

  window.location.href = 'https://vibej.am/portal/2026?' + params.toString();
}

// ── Public API ─────────────────────────────────────────────────
export function initVibeJamPortals(options) {
  cfg = Object.assign({
    spawnPoint:   { x: 0, y: 0, z: 0 },
    exitPosition: { x: -200, y: 200, z: -300 },
    exitLabel:    'VIBE JAM PORTAL',
  }, options || {});

  if (!cfg.scene) {
    console.warn('[VibeJam] initVibeJamPortals: missing scene option');
    return;
  }

  // Only draw the start portal if the player actually arrived through one
  if (arrivedViaPortal) {
    startPortal = makePortal({
      color: 0xff0000,
      position: cfg.spawnPoint,
    });
    cfg.scene.add(startPortal.group);
    // 5s grace period so the player sees where they spawned before the
    // game can auto-route them back (only triggers if they walk into it).
    startPortalActivateAt = Date.now() + 5000;
  }

  exitPortal = makePortal({
    color: 0x00ff00,
    position: cfg.exitPosition,
    label: cfg.exitLabel,
  });
  cfg.scene.add(exitPortal.group);
}

export function animateVibeJamPortals() {
  if (startPortal) animateParticles(startPortal.particles);
  if (exitPortal)  animateParticles(exitPortal.particles);
  checkStartPortal();
  checkExitPortal();
}
