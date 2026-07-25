// ─────────────────────────────────────────────────────────────────────
// Vibe Jam 2026 — Three.js portal sample (ES module form)
// https://vibej.am/portal/2026
//
// Adapted from the official sample. Logic is unchanged; only the IIFE
// + window-globals envelope was swapped for ES module imports/exports
// so it can integrate with this prototype's importmap-driven THREE.
//
//   import { initVibeJamPortals, animateVibeJamPortals, arrivedViaPortal } from "./portals.js";
//   initVibeJamPortals({ scene, getPlayer, spawnPoint, exitPosition,
//                        getUsername, getColor, getSpeed });
//   // every frame:
//   animateVibeJamPortals();
//
// Read the full portal guide: https://vibej.am/2026#portals
// ─────────────────────────────────────────────────────────────────────

import * as THREE from "./vendor/three.module.js";

const qs = new URLSearchParams(window.location.search);
export const arrivedViaPortal = qs.get('portal') === 'true' || qs.get('portal') === '1';

// Snapshot ALL query params at module-load time (before anything mutates the URL).
// These are the params the incoming player brought from the previous game — we
// must forward them all on the return journey.
const ORIGINAL_PARAMS = new URLSearchParams(window.location.search);

// Tunables
const PORTAL_PARTICLE_COUNT = 1000;
const PORTAL_PROXIMITY_DIST = 50;
const PORTAL_DEFAULT_SCALE = 0.10;
const PORTAL_TORUS_RADIUS = 15;
const PORTAL_DISC_RADIUS = 13;
const START_PORTAL_GRACE_MS = 5000; // delay before start-portal can return player
const HP_MIN = 1;
const HP_MAX = 100;
const USERNAME_MAX_LEN = 32;

// Populated by initVibeJamPortals()
let cfg = null;
let startPortal = null;
let exitPortal = null;
let startPortalActivateAt = 0;

// ── Portal factory ──────────────────────────────────────────────
function makePortal({ color, position, rotationX = 0, label = '', scale = PORTAL_DEFAULT_SCALE }) {
  const group = new THREE.Group();
  group.position.set(position.x, position.y, position.z);
  group.rotation.x = rotationX;
  group.scale.setScalar(scale);

  // Torus ring
  group.add(new THREE.Mesh(
    new THREE.TorusGeometry(PORTAL_TORUS_RADIUS, 2, 16, 100),
    new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      transparent: true,
      opacity: 0.8,
    })
  ));

  // Inner disc
  group.add(new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_DISC_RADIUS, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    })
  ));

  // Optional label above the portal
  if (label) {
    group.add(_buildLabelMesh(label, color));
  }

  // Swirling particle ring — keep a direct geometry reference for animate.
  const particleSystem = _buildParticleRing(color);
  group.add(particleSystem);

  return {
    group,
    particles: particleSystem.geometry,
    box: new THREE.Box3().setFromObject(group),
  };
}

function _buildLabelMesh(label, color) {
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
  return mesh;
}

function _buildParticleRing(color) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(PORTAL_PARTICLE_COUNT * 3);
  const colors = new Float32Array(PORTAL_PARTICLE_COUNT * 3);
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  for (let i = 0; i < PORTAL_PARTICLE_COUNT * 3; i += 3) {
    const angle = Math.random() * Math.PI * 2;
    const radius = PORTAL_TORUS_RADIUS + (Math.random() - 0.5) * 4;
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
  return new THREE.Points(geom, new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  }));
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

// ── Convert a THREE hex color integer to a CSS hex string ──────
// e.g. 0xE74A3F → "e74a3f"
function hexIntToCssHex(hexInt) {
  return hexInt.toString(16).padStart(6, '0');
}

// ── Collect live player state from the cfg callbacks ────────────
function getPlayerParams() {
  const params = {};
  const u = cfg.getUsername?.();
  if (u) params.username = String(u).slice(0, USERNAME_MAX_LEN);

  const c = cfg.getColor?.();
  // Accept either a numeric THREE hex color or a CSS string
  if (c !== undefined && c !== null) {
    params.color = typeof c === 'number' ? hexIntToCssHex(c) : String(c);
  }

  const s = cfg.getSpeed?.();
  if (s !== undefined && s !== null) params.speed = String(s);

  const hp = cfg.getHp?.();
  if (hp !== undefined && hp !== null) {
    params.hp = String(Math.round(Math.max(HP_MIN, Math.min(HP_MAX, hp))));
  }

  const t = cfg.getTeam?.();
  if (t) params.team = String(t);

  return params;
}

// Returns true if the current player intersects `portal` (and is within
// PORTAL_PROXIMITY_DIST of its centre as a cheap pre-check).
function _playerEnteredPortal(portal) {
  const player = cfg.getPlayer?.();
  if (!player) return false;
  const playerBox = new THREE.Box3().setFromObject(player);
  const playerCentre = playerBox.getCenter(new THREE.Vector3());
  const portalCentre = portal.box.getCenter(new THREE.Vector3());
  if (playerCentre.distanceTo(portalCentre) > PORTAL_PROXIMITY_DIST) return false;
  return playerBox.intersectsBox(portal.box);
}

// Start portal: sends the player BACK to the game they came from.
// Only active if the player arrived via ?portal=true&ref=<host>.
// Forwards ALL original query params (the user's continuity) plus our
// hostname as the new ref so the destination can bounce back here.
function checkStartPortal() {
  if (!arrivedViaPortal || !startPortal) return;
  // Activation delay — so players aren't instantly bounced on spawn.
  // Correct way: compare to an activation timestamp set ONCE. Do NOT put
  // setTimeout() inside your animate loop — it queues a new callback every
  // frame and triggers an avalanche 5 seconds later.
  if (Date.now() < startPortalActivateAt) return;
  if (!_playerEnteredPortal(startPortal)) return;

  const refUrl = ORIGINAL_PARAMS.get('ref');
  if (!refUrl) return;

  const url = /^https?:\/\//i.test(refUrl) ? refUrl : 'https://' + refUrl;

  // Start from the original incoming params so the user's username/color/etc
  // are preserved. Then overlay our updated state and set ref=us so the
  // destination can send the player back here.
  const params = new URLSearchParams(ORIGINAL_PARAMS.toString());
  params.delete('ref'); // ref goes in the base URL, not in query string
  _overlayLiveParams(params);
  // portal=true must be present so the destination knows to auto-start.
  params.set('portal', 'true');
  // Tell the destination how to bounce back to us.
  params.set('ref', window.location.hostname);

  const s = params.toString();
  _portalNavigate(url + (s ? '?' + s : ''));
}

// Navigate the TOP frame so portal hops escape any iframe sandbox (e.g.
// itch.io's game iframe). Falls back to plain window.location.href if the
// top-frame access is blocked by cross-origin policy.
function _portalNavigate(href) {
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = href;
      return;
    }
  } catch (_) {
    /* cross-origin top — fall through */
  }
  window.location.href = href;
}

// Overlay live player state (our updated values take precedence over
// whatever was in the original params for these keys).
function _overlayLiveParams(params) {
  const live = getPlayerParams();
  for (const [k, v] of Object.entries(live)) params.set(k, v);
}

// Exit portal: sends the player to vibej.am/portal/2026, which picks
// a random 2026 game with a working portal and 302s them there.
// Forwards player state and all original incoming params for continuity.
function checkExitPortal() {
  if (!exitPortal) return;
  if (!_playerEnteredPortal(exitPortal)) return;

  // Build forwarded params.
  // IMPORTANT: start from ORIGINAL incoming params (not current URL, which
  // hasn't changed) so we preserve the player's upstream continuity.
  // Use .set() so you don't accidentally produce duplicates.
  const params = new URLSearchParams(ORIGINAL_PARAMS.toString());
  params.set('portal', 'true');
  // This game is the new source — overwrite ref with our hostname
  params.set('ref', window.location.hostname);
  _overlayLiveParams(params);

  _portalNavigate('https://vibej.am/portal/2026?' + params.toString());
}

// ── Public API ─────────────────────────────────────────────────
//
// Options:
//   scene        — THREE.Scene or Group to add portals to (required)
//   getPlayer    — () => THREE.Object3D | null  (required, the player mesh/group)
//   spawnPoint   — { x, y, z }  position for the return (red) portal
//   exitPosition — { x, y, z }  position for the exit (green) portal
//   exitLabel    — string label above the exit portal (default 'VIBE JAM PORTAL')
//   getUsername  — () => string   player's display name
//   getColor     — () => number|string  faction color (THREE hex int or CSS string)
//   getSpeed     — () => number   player speed in m/s
//   getHp        — () => number   player HP 0-100
//   getTeam      — () => string   team / faction name
//
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
    // Grace period so the player sees where they spawned before the
    // game can auto-route them back (only triggers if they walk into it).
    startPortalActivateAt = Date.now() + START_PORTAL_GRACE_MS;
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
