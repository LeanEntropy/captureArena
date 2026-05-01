// title-screens.js — Three.js for the title-screen design previews.
//
// Three independent scenes:
//   Design 2 — buildAtollScene()   — full Vanta water + cylinder island + cube char + atolls
//   Design 3 — buildStripesScene() — five rotating cube characters (one per faction)
//   Design 4 — buildVoxelScene()   — "LAND CAPTURE" rendered as voxel blocks
//
// Each scene owns its own renderer/camera/clock and pauses when its
// canvas leaves the viewport (IntersectionObserver) so this page never
// burns CPU for offscreen scenes.

import * as THREE from "three";

const FACTION_COLORS = [0xE74A3F, 0x3D6CD0, 0x52B856, 0xFFCF2A, 0xA94BBE];

// Vanta water shader extracted from prototype/main.js (port 1:1).
// Wave amplitude scaled DOWN to 0.6 because the title-screen camera
// sits closer than the in-game camera, so taller waves would dominate
// the frame.
const WATER_VERTEX = `
  uniform float uTime;
  varying vec2 vWorldXZ;
  varying vec3 vViewPosition;
  varying float vViewDist;
  void main() {
    vec3 p = position;
    float wsp = 1.0;
    float phase = sqrt(wsp) * cos(-p.x - 0.7 * p.y);
    float o = sin(wsp * uTime * 0.02 * 60.0
                - wsp * p.x * 0.025
                + wsp * p.y * 0.015
                + phase);
    float n = pow(o + 1.0, 2.0) / 4.0;
    p.z += n * 0.6;
    vWorldXZ = p.xy;
    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = mvPos.xyz;
    vViewDist = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const WATER_FRAGMENT = `
  uniform float uIslandRadius;
  uniform vec3 uDeepColor;
  uniform vec3 uLightColor;
  uniform vec3 uLightDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vWorldXZ;
  varying vec3 vViewPosition;
  varying float vViewDist;
  void main() {
    float dist = length(vWorldXZ);
    if (dist < uIslandRadius) discard;
    vec3 dx = dFdx(vViewPosition);
    vec3 dy = dFdy(vViewPosition);
    vec3 faceNormal = normalize(cross(dx, dy));
    float light = clamp(abs(dot(faceNormal, normalize(uLightDir))), 0.0, 1.0);
    float t = smoothstep(0.55, 1.0, light);
    vec3 col = mix(uDeepColor, uLightColor, t);
    float fogF = clamp((vViewDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    col = mix(col, uFogColor, fogF);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Shared helpers ──────────────────────────────────────────────

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(canvas.clientWidth, canvas.clientHeight, false);
  return r;
}

function makeSkyGradient(topHex, bottomHex) {
  const cv = document.createElement("canvas");
  cv.width = 4; cv.height = 256;
  const ctx = cv.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#" + topHex.toString(16).padStart(6, "0"));
  grad.addColorStop(1, "#" + bottomHex.toString(16).padStart(6, "0"));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build a sailor-cap cube character. Faction-colored body + white sailor cap.
 * Matches the in-game Character mesh (BoxGeometry only, ART_ETHOS principle 1). */
function makeCharacter(factionColor) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: factionColor, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 1), bodyMat);
  body.position.y = 0.45;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // Head — slightly smaller cube, same color
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.85),
    new THREE.MeshStandardMaterial({ color: factionColor, roughness: 0.85 }));
  head.position.y = 1.25;
  g.add(head);

  // Eyes (two black quads on the head's front face)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), eyeMat);
  eyeL.position.set(-0.18, 1.32, 0.43);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.set(0.18, 1.32, 0.43);
  g.add(eyeR);

  // Sailor cap — faction-color band + white top (Theme F universal cap).
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9),
    new THREE.MeshStandardMaterial({ color: factionColor, roughness: 0.7 }));
  band.position.y = 1.7;
  g.add(band);
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.22, 0.78),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  capTop.position.y = 1.92;
  g.add(capTop);

  return g;
}

// ─── Pause/play loop helper ──────────────────────────────────────

function watchVisibility(canvas, onVisible, onHidden) {
  const obs = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) onVisible(); else onHidden();
  }, { threshold: 0.05 });
  obs.observe(canvas);
}

function startLoop(renderFn) {
  let running = true;
  let raf = 0;
  const tick = () => {
    if (!running) return;
    renderFn();
    raf = requestAnimationFrame(tick);
  };
  return {
    start() { if (!running) { running = true; tick(); } else if (!raf) tick(); },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; },
  };
}

// ─── Resize observer (per canvas) ────────────────────────────────

function resizeIfNeeded(renderer, camera, canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Design 2 — Live Atoll
// Reuses the EXACT Vanta water shader from prototype/main.js so the
// background reads as "this is the actual game."
// ═══════════════════════════════════════════════════════════════════
function buildAtollScene() {
  const canvas = document.getElementById("atoll-canvas");
  if (!canvas) return;
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.background = makeSkyGradient(0xffd9aa, 0xbcd8de);
  scene.fog = new THREE.Fog(0xbcd8de, 30, 90);

  const camera = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
  // Camera framed so the cylinder island sits in the LEFT third of frame
  // and the cube character peeks out to the LEFT of the cream card. The
  // card sits center-right so character + island read on its left side.
  camera.position.set(20, 12, 28);
  camera.lookAt(-6, 1, 0);

  // Lighting (matches prototype Theme F)
  scene.add(new THREE.AmbientLight(0xfff0d8, 0.55));
  const dl = new THREE.DirectionalLight(0xfff2c8, 0.95);
  dl.position.set(8, 14, 6);
  scene.add(dl);
  const fill = new THREE.DirectionalLight(0x88B8D0, 0.18);
  fill.position.set(-3, 3, -3);
  scene.add(fill);

  // Water — Vanta-style faceted shader. ARENA_RADIUS shrunk to ~10 here
  // (the design preview only needs to cover the canvas, not 130-unit arena).
  const ARENA_R = 10;
  const WATER_Y = -2.0;
  const ISLAND_TOP = 0.0;

  const waterSize = ARENA_R * 6;
  const waterGeom = new THREE.PlaneGeometry(waterSize, waterSize, 80, 80);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIslandRadius: { value: ARENA_R + 0.5 },
      uDeepColor: { value: new THREE.Color(0x0d3556) },
      uLightColor: { value: new THREE.Color(0x5093d0) },
      uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() },
      uFogColor: { value: new THREE.Color(0xbcd8de) },
      uFogNear: { value: 30.0 },
      uFogFar: { value: 90.0 },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
  });
  const water = new THREE.Mesh(waterGeom, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // Cylinder island (sand sides, grass top, dark base)
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xC9B077, roughness: 0.95 });
  const topMat = new THREE.MeshLambertMaterial({ color: 0x9CC15A });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x8a7152, roughness: 1.0 });
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA_R, ARENA_R, 3.0, 64),
    [sideMat, topMat, bottomMat],
  );
  cyl.position.y = ISLAND_TOP - 1.5;
  scene.add(cyl);

  // 6 cliff rocks around the rim (smaller count than in-game since this is
  // a smaller arena and rocks would crowd the silhouette)
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.4;
    const r = ARENA_R * 0.94;
    const sz = 0.4 + Math.random() * 0.4;
    const rock = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz * 0.7, sz),
      new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0x6d6045 : 0x8a7d5c, roughness: 0.95 }),
    );
    rock.position.set(Math.cos(ang) * r, ISLAND_TOP + sz * 0.35, Math.sin(ang) * r);
    rock.rotation.y = Math.random() * Math.PI;
    scene.add(rock);
  }

  // 3 distant atolls
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 4 + i * 0.6;
    const r = ARENA_R * 2.4;
    const dwidth = 1.5 + Math.random() * 1.0;
    const dheight = 0.6 + Math.random() * 0.4;
    const atoll = new THREE.Mesh(
      new THREE.BoxGeometry(dwidth, dheight, dwidth),
      new THREE.MeshStandardMaterial({ color: 0x7a8b62, roughness: 1.0 }),
    );
    atoll.position.set(Math.cos(ang) * r, WATER_Y + dheight / 2, Math.sin(ang) * r);
    scene.add(atoll);
  }

  // Hero cube character on the rim — cycles through faction colors every 4s
  // so the Director sees the palette in motion. Positioned on the LEFT side
  // of the island so it's not occluded by the centered cream card.
  const charGroup = new THREE.Group();
  charGroup.position.set(-ARENA_R * 0.65, ISLAND_TOP, ARENA_R * 0.2);
  scene.add(charGroup);
  let currentFaction = 0;
  let char = makeCharacter(FACTION_COLORS[0]);
  charGroup.add(char);

  const clock = new THREE.Clock();
  let factionSwapAt = 0;
  const loop = startLoop(() => {
    resizeIfNeeded(renderer, camera, canvas);
    const t = clock.getElapsedTime();
    waterMat.uniforms.uTime.value = t;
    // Idle bob on the body (not on the group — lift is reserved for respawn FX)
    char.children[0].position.y = 0.45 + Math.sin(t * 2.0) * 0.05;
    char.rotation.y = Math.sin(t * 0.4) * 0.3;
    if (t - factionSwapAt > 4.0) {
      factionSwapAt = t;
      currentFaction = (currentFaction + 1) % FACTION_COLORS.length;
      charGroup.remove(char);
      char = makeCharacter(FACTION_COLORS[currentFaction]);
      charGroup.add(char);
    }
    renderer.render(scene, camera);
  });
  watchVisibility(canvas, () => loop.start(), () => loop.stop());
  loop.start();
}

// ═══════════════════════════════════════════════════════════════════
// Design 3 — Faction Stripes (5 cube chars on a single shared canvas)
// One canvas, five characters spaced across X — each above its stripe.
// Transparent canvas overlays the colored stripe divs.
// ═══════════════════════════════════════════════════════════════════
function buildStripesScene() {
  const canvas = document.getElementById("stripes-canvas");
  if (!canvas) return;
  const renderer = makeRenderer(canvas);
  renderer.setClearColor(0x000000, 0); // transparent so stripes show through
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 2, 12);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 0.5);
  dl.position.set(2, 6, 4);
  scene.add(dl);

  // 5 chars positioned across the bottom — one per faction stripe.
  // Each in its own group so we can rotate independently.
  const chars = [];
  const spacing = 3.4;
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const x = (i - 2) * spacing;
    g.position.set(x, -2.6, 0);
    g.scale.setScalar(0.92);
    const c = makeCharacter(FACTION_COLORS[i]);
    g.add(c);
    scene.add(g);
    chars.push(g);
  }

  const clock = new THREE.Clock();
  const loop = startLoop(() => {
    resizeIfNeeded(renderer, camera, canvas);
    const t = clock.getElapsedTime();
    chars.forEach((g, i) => {
      g.rotation.y = t * 0.4 + i * 0.6;
      g.children[0].children[0].position.y = 0.45 + Math.sin(t * 2 + i * 0.7) * 0.08;
    });
    renderer.render(scene, camera);
  });
  watchVisibility(canvas, () => loop.start(), () => loop.stop());
  loop.start();
}

// ═══════════════════════════════════════════════════════════════════
// Design 4 — Voxel Block Type
// "LAND CAPTURE" rendered as voxel-stack letters. Each letter is a 5x7
// pixel font extruded to depth 1. Letters are colored by faction.
// ═══════════════════════════════════════════════════════════════════
//
// 5x7 bitmap font (lowest line is ground, highest line is row 0).
// '#' = filled cube, ' ' = empty.
const FONT_5X7 = {
  L: [
    "#    ",
    "#    ",
    "#    ",
    "#    ",
    "#    ",
    "#    ",
    "#####",
  ],
  A: [
    " ### ",
    "#   #",
    "#   #",
    "#####",
    "#   #",
    "#   #",
    "#   #",
  ],
  N: [
    "#   #",
    "##  #",
    "## #",   /* will be padded by getGlyph */
    "# # #",
    "#  ##",
    "#  ##",
    "#   #",
  ],
  D: [
    "#### ",
    "#   #",
    "#   #",
    "#   #",
    "#   #",
    "#   #",
    "#### ",
  ],
  C: [
    " ####",
    "#    ",
    "#    ",
    "#    ",
    "#    ",
    "#    ",
    " ####",
  ],
  P: [
    "#### ",
    "#   #",
    "#   #",
    "#### ",
    "#    ",
    "#    ",
    "#    ",
  ],
  T: [
    "#####",
    "  #  ",
    "  #  ",
    "  #  ",
    "  #  ",
    "  #  ",
    "  #  ",
  ],
  U: [
    "#   #",
    "#   #",
    "#   #",
    "#   #",
    "#   #",
    "#   #",
    " ### ",
  ],
  R: [
    "#### ",
    "#   #",
    "#   #",
    "#### ",
    "# #  ",
    "#  # ",
    "#   #",
  ],
  E: [
    "#####",
    "#    ",
    "#    ",
    "#####",
    "#    ",
    "#    ",
    "#####",
  ],
  " ": [
    "     ",
    "     ",
    "     ",
    "     ",
    "     ",
    "     ",
    "     ",
  ],
};

function buildVoxelScene() {
  const canvas = document.getElementById("voxel-canvas");
  if (!canvas) return;
  const renderer = makeRenderer(canvas);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();

  // Camera framed wider so "CAPTURE" (7 letters × 5.6u spacing ≈ 39u wide) fits
  // comfortably with margin even at 16:9. FOV 28, z=58, eye slightly above
  // the title midpoint so we get a gentle top-down rake on the voxels.
  // lookAt y=4 puts the title visual center in the upper half of the canvas
  // (so the bottom 30% is reserved for the form gradient + inputs).
  const camera = new THREE.PerspectiveCamera(28, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
  camera.position.set(0, 8, 58);
  camera.lookAt(0, 4, 0);

  scene.add(new THREE.AmbientLight(0xfff0d8, 0.55));
  const dl = new THREE.DirectionalLight(0xfff2c8, 1.0);
  dl.position.set(6, 12, 8);
  scene.add(dl);
  const fill = new THREE.DirectionalLight(0x88B8D0, 0.25);
  fill.position.set(-4, 3, -3);
  scene.add(fill);

  const cubeGeo = new THREE.BoxGeometry(0.95, 0.95, 0.95);

  // Build "LAND" on row 1 (top), "CAPTURE" on row 2 (bottom).
  // Letters per faction color, but reordered so adjacent letters never
  // share a faction (so the eye reads each glyph distinctly).
  const lines = ["LAND", "CAPTURE"];
  const groups = [];
  const lineSpacing = 8.5;   // vertical gap between LAND and CAPTURE rows
  const charSpacing = 5.6;   // horizontal gap between letters (5-wide glyph + ~0.6 gap)

  lines.forEach((line, lineIdx) => {
    const lineWidth = line.length * charSpacing;
    const lineGroup = new THREE.Group();
    // Title fully fits in upper 70% of canvas. Glyph rows 0..7 stack from
    // local y=0 to +7. Top line at y=+5 (LAND glyph spans y=5..12), bottom at
    // y=-3.5 (CAPTURE glyph spans y=-3.5..+3.5). Both above the form-bg gradient
    // which masks bottom 28%.
    lineGroup.position.y = (lines.length - 1 - lineIdx) * lineSpacing - 3.5;
    lineGroup.position.x = -lineWidth / 2 + charSpacing / 2;
    scene.add(lineGroup);

    [...line].forEach((char, charIdx) => {
      const rawG = FONT_5X7[char] || FONT_5X7[" "];
      // Defensive pad: any glyph row shorter than 5 chars gets right-padded
      // with spaces so g[row][col] never returns undefined.
      const g = rawG.map(r => (r + "     ").slice(0, 5));
      const factionIdx = (lineIdx * 4 + charIdx * 3) % 5;
      const color = FACTION_COLORS[factionIdx];
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
      const letterGroup = new THREE.Group();
      letterGroup.position.x = charIdx * charSpacing;
      // Center-align the letter on its column
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row][col] === '#') {
            // Two cubes deep for thickness
            for (let depth = 0; depth < 2; depth++) {
              const cube = new THREE.Mesh(cubeGeo, mat);
              cube.position.set(col - 2, 6 - row, -depth);
              letterGroup.add(cube);
            }
          }
        }
      }
      lineGroup.add(letterGroup);
      groups.push(letterGroup);
    });
  });

  const clock = new THREE.Clock();
  const loop = startLoop(() => {
    resizeIfNeeded(renderer, camera, canvas);
    const t = clock.getElapsedTime();
    // Subtle breathing wobble — letters rock around their own Y axis
    groups.forEach((g, i) => {
      g.rotation.y = Math.sin(t * 0.7 + i * 0.5) * 0.18;
      g.position.y = Math.sin(t * 1.2 + i * 0.4) * 0.15;
    });
    // Slow camera dolly so the parallax sells the depth
    camera.position.x = Math.sin(t * 0.2) * 2.5;
    camera.lookAt(0, 1.5, 0);
    renderer.render(scene, camera);
  });
  watchVisibility(canvas, () => loop.start(), () => loop.stop());
  loop.start();
}

// ═══════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════
function boot() {
  try { buildAtollScene(); } catch (e) { console.error("[atoll]", e); }
  try { buildStripesScene(); } catch (e) { console.error("[stripes]", e); }
  try { buildVoxelScene(); } catch (e) { console.error("[voxel]", e); }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
