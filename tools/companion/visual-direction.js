// Visual Direction mockup — five live Three.js scenes (reference + 4 directions).
// Round 2: per-direction claim FX, kill FX, respawn FX, notifications, banners,
// countdown, and game-win FX. Each direction is now visually DISTINCT across
// all moments of feedback, not just the background.
//
// What's faithful to the actual game:
//   - Character mesh: stacked BoxGeometry body + head + box eyes + box pupils
//   - Territory texture: CanvasTexture, NearestFilter, alphaTest cutout
//   - Lighting model: AmbientLight + DirectionalLight with shadows
//
// What's deliberately simplified:
//   - Smaller arena (~16u radius) so the panel reads at 360px
//   - 3 characters per scene (one per visible faction)
//   - Simulated trails (static polylines)
//   - 64x64 territory texture instead of 1024x1024

import * as THREE from "three";

// ============================================================================
// Shared constants
// ============================================================================

const ARENA_RADIUS = 16;
const TEX_SIZE = 64;
const FACTION_COLORS_DEFAULT = [0xE53935, 0x1E88E5, 0x43A047, 0xFDD835, 0x8E24AA];
const FACTION_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple"];
const VICTIM_NAMES = ["Daisy Stick", "Cube Knight", "Boxley", "Pixel Pete", "Squarezilla"];

// Per-direction art tokens. Each direction is a config object consumed by the
// scene builder. Adding a new direction = adding an entry here + a panel in HTML.
const DIRECTIONS = {
  REF: {
    name: "Current",
    bg: 0xf0f0f0,
    fog: null,
    groundColor: 0xffffff,
    outerGround: null,
    factionColors: FACTION_COLORS_DEFAULT,
    ambient: { color: 0xffffff, intensity: 0.8 },
    directional: { color: 0xffffff, intensity: 0.6 },
    charRoughness: 0.4,
    charEmissive: 0,
    trailWidth: 0.18,
    trailDarkenOutline: false,
    territoryDither: false,
    claimFlashColor: 0xffffff,
    claimFlashStyle: "flash",
    killBurstStyle: "scatter",
    respawnStyle: "pop",
    backgroundType: "solid",
    notificationFont: "system-ui",
    notificationStyle: "plain",
    bannerStyle: "plain",
    countdownStyle: "plain",
    countdownAccent: "#666",
    winStyle: "plain",
  },
  A: {
    // SUNSET ARCADE — friendly, warm, paper.io-cousin
    name: "Sunset Arcade",
    bg: 0xFFD8A8,
    bgGradientTop: 0xFFD8A8,
    bgGradientBottom: 0xFF8E72,
    backgroundType: "gradient",
    fog: { color: 0xFFB890, near: 18, far: 55 },
    groundColor: 0xFFF6E8,
    outerGround: { color: 0xE8C49A, ringColor: 0xB89060 },
    factionColors: [0xD4332E, 0x1B7DCC, 0x3D8E3F, 0xE5C42E, 0x7E1E97],
    ambient: { color: 0xfff0e0, intensity: 0.85 },
    directional: { color: 0xffe0a0, intensity: 0.5 },
    charRoughness: 0.4,
    charEmissive: 0,
    charStyle: "warm-glow",        // soft warm rim emissive at low intensity
    trailWidth: 0.22,
    trailDarkenOutline: true,
    trailStyle: "ribbon",          // smooth solid ribbon
    territoryDither: false,
    minimapStyle: "soft-glow",
    // FX: soft and bouncy. "Confetti" feel.
    claimFlashColor: 0xFFF8C8,     // cream glow
    claimFlashStyle: "sunburst",   // radial rays from claim center
    killBurstStyle: "confetti",    // colorful triangular shards (warm)
    respawnStyle: "sunrise",       // light beam + warm halo
    notificationFont: "Fredoka, system-ui",
    notificationStyle: "card-warm",
    bannerStyle: "warm-banner",
    countdownStyle: "chunky-warm",
    countdownAccent: "#FF6F4D",
    winStyle: "fireworks",         // confetti from corners + center burst
  },
  B: {
    // NEON PULSE — TRON, club, streamer-bait
    name: "Neon Pulse",
    bg: 0x0A0F2C,
    bgGradientTop: 0x0A0F2C,
    bgGradientBottom: 0x000000,
    backgroundType: "radial",
    fog: { color: 0x05071a, near: 20, far: 60 },
    groundColor: 0x1B2240,
    outerGround: { color: 0x05071a, gridColor: 0x2a4488 },
    factionColors: [0xFF3B6B, 0x3B9BFF, 0x5BFF6B, 0xFFE03B, 0xC24BFF],
    ambient: { color: 0x4060a0, intensity: 0.6 },
    directional: { color: 0xb0c8ff, intensity: 0.5 },
    charRoughness: 0.4,
    charEmissive: 0.15,
    charStyle: "neon-edge",        // emissive faction color
    trailWidth: 0.22,
    trailGlow: true,
    trailDarkenOutline: false,
    trailStyle: "fluorescent",     // wide low-opacity glow + bright inner stroke
    territoryDither: false,
    minimapStyle: "scope-lines",
    // FX: instantaneous, sharp, electric.
    claimFlashColor: 0x00FFFF,
    claimFlashStyle: "shockwave",  // expanding ring + high-frequency strobe
    killBurstStyle: "implode",     // particles converge then vanish in white flash
    respawnStyle: "glitch-in",     // 3-step horizontal scanline reconstruction
    notificationFont: "'Space Mono', monospace",
    notificationStyle: "terminal",
    bannerStyle: "neon-stripe",
    countdownStyle: "monospace-pulse",
    countdownAccent: "#00FFFF",
    winStyle: "laser-grid",        // grid lines pulse, faction lasers cross arena
  },
  C: {
    // PAINTED PLAINS — storybook, watercolor, cozy
    name: "Painted Plains",
    bg: 0xC8DCE8,
    bgGradientTop: 0xB8DCD8,
    bgGradientBottom: 0xD4C4E8,
    backgroundType: "gradient",
    fog: { color: 0xC8DCE8, near: 16, far: 48 },
    groundColor: 0xF4ECD8,
    outerGround: { color: 0x7BA8C4 },
    factionColors: [0xD45A4F, 0x5078A8, 0x7BAB5C, 0xE0C75A, 0x9168A8],
    ambient: { color: 0xfff5e8, intensity: 0.9 },
    directional: { color: 0xffeec0, intensity: 0.4 },
    charRoughness: 0.6,
    charEmissive: 0,
    charOutline: true,             // inverted-hull ink outline pass
    charStyle: "ink-outline",
    trailWidth: 0.26,
    trailDarkenOutline: true,
    trailStyle: "brush-stroke",    // varying-width with darker edge
    territoryDither: false,
    minimapStyle: "parchment",
    // FX: soft, slow, organic.
    claimFlashColor: 0xFFF8E8,
    claimFlashStyle: "ink-bleed",  // ink spreads from entry point with wobble
    killBurstStyle: "petals",      // white plane fragments float upward
    respawnStyle: "page-turn",     // ink-spot grows then character appears
    notificationFont: "'Caveat Brush', cursive",
    notificationStyle: "parchment",
    bannerStyle: "scroll",
    countdownStyle: "hand-lettered",
    countdownAccent: "#7B5A3A",
    winStyle: "watercolor-bloom",  // entire arena washes with winning color
  },
  D: {
    // VOXEL PLATE — Crossy Road / tabletop diorama
    name: "Voxel Plate",
    bg: 0xA8D0E8,
    bgGradientTop: 0xCEE6F0,
    bgGradientBottom: 0xA8D0E8,
    backgroundType: "gradient",
    fog: { color: 0xA8D0E8, near: 20, far: 60 },
    groundColor: 0xA8C854,
    outerGround: { color: 0x5C3F2A, plate: true },
    factionColors: [0xF04B41, 0x2496EE, 0x52B856, 0xFFE140, 0x9F31B9],
    ambient: { color: 0xeef4ff, intensity: 0.7 },
    directional: { color: 0xffffff, intensity: 0.7 },
    bounceLight: { color: 0xffd0a0, intensity: 0.2 },
    charRoughness: 0.5,
    charEmissive: 0,
    charStyle: "voxel-cubed",      // optional: rim of darker color (faked AO)
    trailWidth: 0.2,
    trailDarkenOutline: true,
    trailStyle: "pixelated",       // chevron-segmented, looks stamped
    territoryDither: true,
    minimapStyle: "tabletop-chip",
    // FX: tactile, physical, "stamp and fall" feel.
    claimFlashColor: 0xFFFFFF,
    claimFlashStyle: "stamp-wave", // wave from entry point, stamp-thump animation
    killBurstStyle: "voxel-debris",// 3D bouncy cube fragments with gravity
    respawnStyle: "build-up",      // cubes assemble from below ground (Minecraft-y)
    notificationFont: "'Lilita One', system-ui",
    notificationStyle: "wooden-tag",
    bannerStyle: "stamp",
    countdownStyle: "blocky-flip",
    countdownAccent: "#3B2412",
    winStyle: "voxel-rain",        // cubes rain down from sky in winning color
  },
  F: {
    // ATOLL HYBRID — E's island/water + D's voxel kill/respawn + A's cream notif
    // Director request 2026-04-30: "Theme E with the following changes:
    //   1. Flat cylinder island (not dome).
    //   2. Island floor Y must be DISTINCT from battlefield Y (no Z-fighting).
    //   3. Use D's kill + respawn animations.
    //   4. Use A's cream notification style. Position BELOW the leaderboard.
    //   5. Use D's countdown/banner/win animations."
    // Construction: flat cylinder island at Y0; territory mesh sits on top at
    // Y=0.65 (cylinder height = 0.6); water fills outside cylinder radius and
    // sits at Y=-0.4 — three CLEARLY distinct Y planes, no overlap.
    name: "Atoll Hybrid",
    bg: 0xCDE5EE,
    bgGradientTop: 0xFFD9B8,
    bgGradientBottom: 0x8FC8DA,
    backgroundType: "gradient",
    fog: { color: 0xBCD8DE, near: 28, far: 90 },
    groundColor: 0x9CC15A,
    // outerGround: water=true triggers ocean shader; cylinder=true switches the
    // island builder from sand+grass dome stack to a single flat cylinder.
    outerGround: { water: true, cylinder: true, color: 0x1E6F7E, foam: 0xFFFFFF, sun: 0xFFE8B0 },
    factionColors: [0xE74A3F, 0x3D6CD0, 0x52B856, 0xFFCF2A, 0xA94BBE],
    ambient: { color: 0xfff0d8, intensity: 0.78 },
    directional: { color: 0xfff2c8, intensity: 0.7 },
    bounceLight: { color: 0x88B8D0, intensity: 0.18 },
    charRoughness: 0.5,
    charEmissive: 0,
    charStyle: "castaway",            // sailor cap from E
    trailWidth: 0.22,
    trailDarkenOutline: true,
    trailStyle: "ribbon",             // sea-themed ribbon from E
    territoryDither: false,
    minimapStyle: "nautical-chart",
    // FX: E's claim (wave-ripple), D's kill (voxel debris), D's respawn (build-up).
    claimFlashColor: 0xC8F0FF,
    claimFlashStyle: "wave-ripple",   // from E — concentric water ripples
    killBurstStyle: "voxel-debris",   // from D — bouncy cube fragments
    respawnStyle: "build-up",         // from D — assemble from below
    notificationFont: "Fredoka, system-ui",
    // notificationStyle="card-warm" reuses A's cream card; the new
    // notificationAnchor key tells SceneOverlay to position the stack
    // BELOW a (mocked) leaderboard rectangle rather than at top-right.
    notificationStyle: "card-warm",
    notificationAnchor: "below-leaderboard",
    // Banner (Endangered/Eliminated/Recovered) + countdown + win FX all from D.
    bannerStyle: "stamp",             // from D — wooden stamp
    countdownStyle: "blocky-flip",    // from D — voxel digit
    countdownAccent: "#3B2412",
    winStyle: "voxel-rain",           // from D — voxel cube rain
    // Show a faint dashed "leaderboard ghost" in the panel so the Director can
    // visually verify the notifications-below-leaderboard positioning rule.
    showLeaderboardGhost: true,
  },
  E: {
    // CASTAWAY ATOLL — island floating in animated water
    name: "Castaway Atoll",
    bg: 0xCDE5EE,
    bgGradientTop: 0xFFD9B8,       // dawn peach above the horizon
    bgGradientBottom: 0x8FC8DA,    // pale teal at horizon (meets the sea)
    backgroundType: "gradient",
    fog: { color: 0xBCD8DE, near: 28, far: 90 },
    groundColor: 0x9CC15A,         // warm grass top — slightly more saturated than D
    outerGround: { water: true, color: 0x1E6F7E, foam: 0xFFFFFF, sun: 0xFFE8B0 },
    // Faction palette: Blue desaturated AWAY from the water hue so it doesn't blur with the sea.
    // Yellow boosted to read against deep teal water reflections at distance.
    factionColors: [0xE74A3F, 0x3D6CD0, 0x52B856, 0xFFCF2A, 0xA94BBE],
    ambient: { color: 0xfff0d8, intensity: 0.78 },
    directional: { color: 0xfff2c8, intensity: 0.7 }, // golden hour
    bounceLight: { color: 0x88B8D0, intensity: 0.18 },// soft cool sea bounce
    charRoughness: 0.5,
    charEmissive: 0,
    charStyle: "castaway",         // sailor-cap add-on (one tiny cube on the head)
    trailWidth: 0.22,
    trailDarkenOutline: true,
    trailStyle: "ribbon",          // sandy footprint trail with darker outline
    territoryDither: false,
    minimapStyle: "nautical-chart",
    // FX: aquatic, splashy, "shore" feel.
    claimFlashColor: 0xC8F0FF,
    claimFlashStyle: "wave-ripple",// concentric water ripples + droplet splatter
    killBurstStyle: "splash",      // upward water-droplet cubes + foam ring
    respawnStyle: "wash-ashore",   // rises from below + foam wave passes through
    notificationFont: "Fredoka, system-ui",
    notificationStyle: "driftwood",// driftwood plank with rope edge
    bannerStyle: "sail-banner",    // canvas sail with rope border
    countdownStyle: "sundial",     // sandy dial + brass numbers
    countdownAccent: "#3F5F6F",
    winStyle: "tide-rise",         // foam rings sweep + DOM seagulls + flag rise
  },
};

// ============================================================================
// DOM Overlay (notifications, banners, countdown)
// ============================================================================
//
// Each scene gets a positioned DOM overlay layered on top of its canvas.
// The overlay renders notifications, faction-state banners, the countdown,
// and the game-win banner — all styled per direction so the Director can
// see how the same event reads in each style.

class SceneOverlay {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.notificationContainer = null;
    this.bannerContainer = null;
    this.countdown = null;
    this.winBanner = null;
    this._notifQueue = [];
    this._maxNotifs = 4;
    this._build();
  }

  _build() {
    const wrap = this.canvas.parentElement;
    // Make the canvas wrapper relative-positioned so absolute overlays anchor.
    if (getComputedStyle(wrap).position === "static") {
      wrap.style.position = "relative";
    }

    // -- Mocked HUD elements (so the panel reads as a real game frame) ---
    // Some directions (e.g. F — Atoll Hybrid) need a leaderboard placeholder
    // so the Director can visually verify spatial constraints like
    // "notifications must appear BELOW the leaderboard, not on top of it".
    if (this.config.showLeaderboardGhost) {
      this._buildLeaderboardGhost(wrap);
    }

    // Notification stack — anchor depends on direction.
    //   default                       → top-right (legacy A/B/C/D/E behavior)
    //   anchor="below-leaderboard"   → top-right but below the ghost rect.
    //                                  Width ≈ 200px to match a real-game
    //                                  leaderboard column. Constraint from
    //                                  Director: must NOT overlap timer
    //                                  (top-left), factions (top-right above
    //                                  leaderboard), player stats (bottom-
    //                                  center), minimap (bottom-left).
    this.notificationContainer = document.createElement("div");
    this.notificationContainer.className = `notif-stack notif-${this.config.notificationStyle}`;
    const anchorBelow = this.config.notificationAnchor === "below-leaderboard";
    Object.assign(this.notificationContainer.style, {
      position: "absolute",
      // 130px = 10px (top margin) + ~110px (mocked leaderboard) + 10px gap
      top: anchorBelow ? "146px" : "10px",
      right: anchorBelow ? "16px" : "10px",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      pointerEvents: "none",
      zIndex: "5",
      maxWidth: anchorBelow ? "200px" : "200px",
      width: anchorBelow ? "200px" : "auto",
    });
    wrap.appendChild(this.notificationContainer);

    // Center banner — for faction-state announcements + game-win
    this.bannerContainer = document.createElement("div");
    Object.assign(this.bannerContainer.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none",
      zIndex: "6",
    });
    wrap.appendChild(this.bannerContainer);

    // Countdown — top-left
    this.countdown = document.createElement("div");
    this.countdown.className = `countdown countdown-${this.config.countdownStyle}`;
    Object.assign(this.countdown.style, {
      position: "absolute",
      top: "10px",
      left: "10px",
      pointerEvents: "none",
      zIndex: "5",
      fontFamily: this.config.notificationFont,
    });
    this.countdown.textContent = "15:00";
    this._styleCountdown(false);
    wrap.appendChild(this.countdown);

    // Click-through canvas overlay for win-state full-screen FX (e.g. confetti DOM elements)
    this.winFXLayer = document.createElement("div");
    Object.assign(this.winFXLayer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "4",
      overflow: "hidden",
    });
    wrap.appendChild(this.winFXLayer);
  }

  // Mocked HUD anchors that surround the canvas in the real game. Renders only
  // a leaderboard placeholder for now (other anchors are inferred via the labels)
  // so the Director can confirm notification position relative to existing UI.
  _buildLeaderboardGhost(wrap) {
    // -- Top-right: factions strip (above the leaderboard) ----------------
    const factions = document.createElement("div");
    Object.assign(factions.style, {
      position: "absolute",
      top: "10px",
      right: "16px",
      width: "200px",
      height: "32px",
      background: "rgba(20,30,55,0.55)",
      border: "1px dashed rgba(255,255,255,0.35)",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "3",
      color: "rgba(255,255,255,0.7)",
      fontSize: "10px",
      letterSpacing: "1px",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
      lineHeight: "32px",
      fontWeight: "600",
    });
    factions.textContent = "FACTIONS  •  R B G Y P";
    wrap.appendChild(factions);

    // -- Top-right: leaderboard ghost (anchor for F's notifications) ------
    const lb = document.createElement("div");
    Object.assign(lb.style, {
      position: "absolute",
      top: "50px",   // 10 + 32 + 8 gap
      right: "16px",
      width: "200px",
      height: "88px",
      background: "rgba(20,30,55,0.55)",
      border: "1px dashed rgba(255,255,255,0.35)",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "3",
      color: "rgba(255,255,255,0.7)",
      fontSize: "10px",
      letterSpacing: "1px",
      fontFamily: "system-ui, sans-serif",
      padding: "6px 10px",
      boxSizing: "border-box",
      fontWeight: "600",
    });
    lb.innerHTML =
      "LEADERBOARD<br>" +
      "<span style='opacity:0.55;font-weight:400;'>1. Cube Knight 12</span><br>" +
      "<span style='opacity:0.55;font-weight:400;'>2. Boxley 9</span><br>" +
      "<span style='opacity:0.55;font-weight:400;'>3. Pixel Pete 7</span>";
    wrap.appendChild(lb);

    // -- Bottom-left: minimap ghost (so we can see we're not overlapping) -
    const mm = document.createElement("div");
    Object.assign(mm.style, {
      position: "absolute",
      bottom: "10px",
      left: "10px",
      width: "120px",
      height: "120px",
      background: "rgba(20,30,55,0.45)",
      border: "1px dashed rgba(255,255,255,0.3)",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "3",
      color: "rgba(255,255,255,0.55)",
      fontSize: "10px",
      letterSpacing: "1px",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
      lineHeight: "120px",
      fontWeight: "600",
    });
    mm.textContent = "MINIMAP";
    wrap.appendChild(mm);

    // -- Bottom-center: player stats strip --------------------------------
    const stats = document.createElement("div");
    Object.assign(stats.style, {
      position: "absolute",
      bottom: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "300px",
      height: "32px",
      background: "rgba(20,30,55,0.5)",
      border: "1px dashed rgba(255,255,255,0.3)",
      borderRadius: "4px",
      pointerEvents: "none",
      zIndex: "3",
      color: "rgba(255,255,255,0.65)",
      fontSize: "10px",
      letterSpacing: "1px",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
      lineHeight: "32px",
      fontWeight: "600",
    });
    stats.textContent = "PLAYER STATS  •  HP  KILLS  TERRITORY";
    wrap.appendChild(stats);
  }

  _styleCountdown(intense) {
    const cd = this.countdown;
    const c = this.config;
    cd.style.fontWeight = "700";
    cd.style.padding = "6px 12px";
    cd.style.borderRadius = "6px";

    const accent = c.countdownAccent;
    if (c.countdownStyle === "chunky-warm") {
      cd.style.background = "rgba(255,246,232,0.92)";
      cd.style.color = intense ? accent : "#5a3a20";
      cd.style.border = `2px solid ${accent}`;
      cd.style.fontSize = intense ? "22px" : "18px";
      cd.style.boxShadow = "0 2px 6px rgba(180,90,40,0.3)";
    } else if (c.countdownStyle === "monospace-pulse") {
      cd.style.background = "rgba(10,15,40,0.9)";
      cd.style.color = accent;
      cd.style.border = `1px solid ${accent}`;
      cd.style.fontSize = intense ? "22px" : "16px";
      cd.style.letterSpacing = "2px";
      cd.style.textShadow = `0 0 8px ${accent}`;
      cd.style.boxShadow = `inset 0 0 8px ${accent}30`;
    } else if (c.countdownStyle === "hand-lettered") {
      cd.style.background = "rgba(244,236,216,0.92)";
      cd.style.color = accent;
      cd.style.border = "1px dashed #b8a070";
      cd.style.fontSize = intense ? "26px" : "20px";
      cd.style.boxShadow = "0 1px 3px rgba(140,110,70,0.2)";
    } else if (c.countdownStyle === "blocky-flip") {
      cd.style.background = "#3B2412";
      cd.style.color = "#FFE140";
      cd.style.border = "2px solid #1a0f08";
      cd.style.fontSize = intense ? "22px" : "18px";
      cd.style.boxShadow = "inset 0 -3px 0 rgba(0,0,0,0.4), 0 2px 0 rgba(0,0,0,0.5)";
      cd.style.fontFamily = "'Lilita One', sans-serif";
    } else if (c.countdownStyle === "sundial") {
      // E — sandy circle with brass numerals; warning shifts to coral; critical pulses
      cd.style.background = "radial-gradient(circle at 30% 30%, #f5e6c3 0%, #d8c590 100%)";
      cd.style.color = intense ? "#a04030" : accent;
      cd.style.border = `2px solid ${intense ? "#a04030" : "#a08560"}`;
      cd.style.borderRadius = "50%";
      cd.style.padding = intense ? "10px 16px" : "8px 14px";
      cd.style.fontSize = intense ? "22px" : "17px";
      cd.style.fontFamily = "Fredoka, sans-serif";
      cd.style.fontWeight = "700";
      cd.style.boxShadow = "inset 0 -3px 6px rgba(120,80,40,0.3), 0 2px 5px rgba(60,40,20,0.4)";
    } else {
      // REF
      cd.style.background = "rgba(255,255,255,0.85)";
      cd.style.color = "#222";
      cd.style.fontSize = "16px";
    }

    if (intense) {
      cd.style.animation = "cd-pulse 0.6s ease-in-out infinite";
    } else {
      cd.style.animation = "";
    }
  }

  // -- Notifications -------------------------------------------------------
  pushNotification(text, kind = "info", factionColor = null) {
    const c = this.config;
    const el = document.createElement("div");
    el.className = `notif notif-${kind}`;
    el.textContent = text;
    el.style.fontFamily = c.notificationFont;
    el.style.fontSize = "12px";
    el.style.lineHeight = "1.3";
    el.style.padding = "6px 10px";
    el.style.borderRadius = "4px";
    el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    el.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    el.style.pointerEvents = "none";
    el.style.maxWidth = "180px";
    el.style.wordWrap = "break-word";

    const factionHex = factionColor != null
      ? "#" + factionColor.toString(16).padStart(6, "0")
      : null;

    // Per-direction styling
    if (c.notificationStyle === "card-warm") {
      el.style.background = "rgba(255,246,232,0.95)";
      el.style.color = "#5a3a20";
      el.style.border = `1px solid ${factionHex || "#d4a370"}`;
      el.style.borderLeft = `4px solid ${factionHex || "#d4a370"}`;
      el.style.fontWeight = "500";
    } else if (c.notificationStyle === "terminal") {
      el.style.background = "rgba(10,15,40,0.92)";
      el.style.color = factionHex || "#5BFF6B";
      el.style.border = `1px solid ${factionHex || "#3B9BFF"}`;
      el.style.fontWeight = "400";
      el.style.textShadow = `0 0 4px ${factionHex || "#3B9BFF"}`;
      el.style.borderLeft = `2px solid ${factionHex || "#3B9BFF"}`;
      el.textContent = "> " + text;
    } else if (c.notificationStyle === "parchment") {
      el.style.background = "rgba(244,236,216,0.95)";
      el.style.color = "#5a3a20";
      el.style.border = "1px solid #b8a070";
      el.style.borderLeft = `3px dashed ${factionHex || "#7B5A3A"}`;
      el.style.fontWeight = "400";
      el.style.fontSize = "14px";
    } else if (c.notificationStyle === "wooden-tag") {
      el.style.background = "#5C3F2A";
      el.style.color = "#FFE6B8";
      el.style.border = "2px solid #3B2412";
      el.style.borderLeft = `5px solid ${factionHex || "#FFE140"}`;
      el.style.fontWeight = "700";
      el.style.boxShadow = "inset 0 -2px 0 rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.4)";
    } else if (c.notificationStyle === "driftwood") {
      // E — sun-bleached driftwood plank with rope edge + faction-colored flag
      el.style.background = "linear-gradient(180deg, #f0e2c0 0%, #d8c590 100%)";
      el.style.color = "#3a2e1c";
      el.style.border = "1px solid #a08560";
      el.style.borderLeft = `5px double ${factionHex || "#3F5F6F"}`;
      el.style.borderRadius = "2px 12px 2px 12px";
      el.style.fontWeight = "600";
      el.style.boxShadow = "inset 0 -1px 0 rgba(120,80,40,0.25), 0 2px 5px rgba(60,40,20,0.4)";
      el.style.fontFamily = c.notificationFont;
    } else {
      // REF
      el.style.background = "rgba(255,255,255,0.85)";
      el.style.color = "#222";
    }

    this.notificationContainer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(0)";
    });

    // Cap stack at maxNotifs — remove oldest
    while (this.notificationContainer.children.length > this._maxNotifs) {
      this.notificationContainer.removeChild(this.notificationContainer.firstChild);
    }

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(20px)";
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }, 3000);
  }

  // -- Faction-state banners -----------------------------------------------
  showBanner(text, kind = "info", factionColor = null, duration = 2200) {
    const c = this.config;
    // Clear existing banner
    while (this.bannerContainer.firstChild) {
      this.bannerContainer.removeChild(this.bannerContainer.firstChild);
    }
    const el = document.createElement("div");
    el.style.fontFamily = c.notificationFont;
    el.style.padding = "10px 22px";
    el.style.borderRadius = "8px";
    el.style.fontWeight = "700";
    el.style.fontSize = "20px";
    el.style.textAlign = "center";
    el.style.whiteSpace = "nowrap";
    el.style.opacity = "0";
    el.style.transform = "scale(0.6)";
    el.style.transition = "opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)";
    el.textContent = text;

    const factionHex = factionColor != null
      ? "#" + factionColor.toString(16).padStart(6, "0")
      : null;

    if (c.bannerStyle === "warm-banner") {
      // Sunset Arcade — warm parchment banner with rounded soft border
      el.style.background = "rgba(255,246,232,0.96)";
      el.style.color = "#5a3a20";
      el.style.border = `3px solid ${factionHex || "#FF6F4D"}`;
      el.style.boxShadow = "0 4px 16px rgba(180,90,40,0.4)";
    } else if (c.bannerStyle === "neon-stripe") {
      // Neon Pulse — sharp horizontal cyber stripe
      el.style.background = "rgba(10,15,40,0.95)";
      el.style.color = factionHex || "#00FFFF";
      el.style.border = "none";
      el.style.borderTop = `2px solid ${factionHex || "#00FFFF"}`;
      el.style.borderBottom = `2px solid ${factionHex || "#00FFFF"}`;
      el.style.textShadow = `0 0 12px ${factionHex || "#00FFFF"}`;
      el.style.letterSpacing = "3px";
      el.style.borderRadius = "0";
      el.style.padding = "12px 40px";
      el.style.fontFamily = "'Space Mono', monospace";
    } else if (c.bannerStyle === "scroll") {
      // Painted Plains — rolled scroll
      el.style.background = "rgba(244,236,216,0.97)";
      el.style.color = factionHex || "#5a3a20";
      el.style.border = "2px solid #b8a070";
      el.style.borderRadius = "20px 4px 20px 4px";
      el.style.boxShadow = "0 3px 10px rgba(140,110,70,0.4), inset 0 0 12px rgba(184,160,112,0.3)";
      el.style.fontStyle = "italic";
    } else if (c.bannerStyle === "stamp") {
      // Voxel Plate — wooden stamp
      el.style.background = factionHex || "#FFE140";
      el.style.color = "#1a0f08";
      el.style.border = "3px solid #1a0f08";
      el.style.boxShadow = "inset 0 -4px 0 rgba(0,0,0,0.25), 0 4px 0 rgba(0,0,0,0.4)";
      el.style.fontFamily = "'Lilita One', sans-serif";
      el.style.letterSpacing = "1px";
    } else if (c.bannerStyle === "sail-banner") {
      // Castaway Atoll — canvas sail with rope border + faction-colored top stripe
      el.style.background = "linear-gradient(180deg, #f8efd6 0%, #e8d9b0 100%)";
      el.style.color = "#2a3a48";
      el.style.border = `2px solid #b89868`;
      el.style.borderTop = `6px solid ${factionHex || "#E74A3F"}`;
      el.style.borderRadius = "2px 2px 14px 14px";
      el.style.boxShadow = "0 4px 14px rgba(60,40,20,0.4), inset 0 -3px 0 rgba(120,90,50,0.3)";
      el.style.fontFamily = "Fredoka, sans-serif";
      el.style.letterSpacing = "1px";
      el.style.fontWeight = "700";
      el.style.padding = "12px 28px";
    } else {
      el.style.background = "rgba(0,0,0,0.7)";
      el.style.color = "#fff";
    }

    this.bannerContainer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "scale(1)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "scale(0.85)";
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, duration);
  }

  // -- Countdown -----------------------------------------------------------
  setCountdown(seconds, intense = false) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    this.countdown.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    this._styleCountdown(intense);
  }

  // -- Win FX --------------------------------------------------------------
  triggerWinDOM(factionColor) {
    const c = this.config;
    const factionHex = "#" + factionColor.toString(16).padStart(6, "0");

    if (c.winStyle === "fireworks") {
      // Sunset: confetti from corners + center burst
      this._spawnConfetti(40, factionColor);
    } else if (c.winStyle === "laser-grid") {
      // Neon: full-canvas grid pulse + faction-color sweep
      this._spawnGridSweep(factionHex);
    } else if (c.winStyle === "watercolor-bloom") {
      // Painted: full-canvas radial wash
      this._spawnWatercolorWash(factionHex);
    } else if (c.winStyle === "voxel-rain") {
      // Voxel: 3D handled in DirectionScene; DOM layer just shows banner
    } else if (c.winStyle === "tide-rise") {
      // Castaway: 3 seagull silhouettes drift across + DOM foam wash
      this._spawnSeagullsAndWash(factionHex);
    }
  }

  _spawnSeagullsAndWash(factionHex) {
    // Soft horizontal foam wash, mid-canvas
    const wash = document.createElement("div");
    Object.assign(wash.style, {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "0",
      height: "60%",
      background: `linear-gradient(0deg, ${factionHex}55 0%, transparent 100%)`,
      mixBlendMode: "screen",
      opacity: "0",
      transition: "opacity 0.6s ease",
    });
    this.winFXLayer.appendChild(wash);
    requestAnimationFrame(() => { wash.style.opacity = "1"; });
    setTimeout(() => { wash.style.opacity = "0"; }, 1800);
    setTimeout(() => { if (wash.parentNode) wash.parentNode.removeChild(wash); }, 2600);

    // Three seagull silhouettes (chunky pixel V's). Pure CSS shape, no images.
    for (let i = 0; i < 3; i++) {
      const gull = document.createElement("div");
      const startTop = 25 + Math.random() * 20;
      const drift = (Math.random() - 0.5) * 10;
      Object.assign(gull.style, {
        position: "absolute",
        left: "-30px",
        top: `${startTop}%`,
        width: "20px",
        height: "8px",
        // V-shape via two angled rectangles (pseudo-gradient)
        background: "linear-gradient(135deg, transparent 45%, #2a3a48 45%, #2a3a48 55%, transparent 55%), linear-gradient(45deg, transparent 45%, #2a3a48 45%, #2a3a48 55%, transparent 55%)",
        backgroundSize: "10px 8px, 10px 8px",
        backgroundPosition: "0 0, 10px 0",
        backgroundRepeat: "no-repeat",
        opacity: "0.85",
        transition: `left 2.4s linear, top 2.4s ease-in-out, opacity 0.4s ease 2.0s`,
      });
      this.winFXLayer.appendChild(gull);
      setTimeout(() => {
        gull.style.left = "calc(100% + 30px)";
        gull.style.top = `${startTop + drift}%`;
        gull.style.opacity = "0";
      }, 50 + i * 250);
      setTimeout(() => { if (gull.parentNode) gull.parentNode.removeChild(gull); }, 2700 + i * 250);
    }
  }

  _spawnConfetti(count, factionColor) {
    const factionHex = "#" + factionColor.toString(16).padStart(6, "0");
    const accents = ["#FFE140", "#FFB070", "#FF6F4D", factionHex, "#FFFFFF"];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      const sz = 6 + Math.random() * 8;
      Object.assign(piece.style, {
        position: "absolute",
        width: `${sz}px`,
        height: `${sz * 1.6}px`,
        background: accents[Math.floor(Math.random() * accents.length)],
        left: `${Math.random() * 100}%`,
        top: `-20px`,
        opacity: "1",
        transform: `rotate(${Math.random() * 360}deg)`,
        transition: `top 1.8s linear, left 1.8s ease-out, transform 1.8s linear, opacity 0.4s ease 1.4s`,
        borderRadius: Math.random() > 0.5 ? "0" : "2px",
      });
      this.winFXLayer.appendChild(piece);
      requestAnimationFrame(() => {
        piece.style.top = "110%";
        piece.style.left = `${parseFloat(piece.style.left) + (Math.random() - 0.5) * 30}%`;
        piece.style.transform = `rotate(${Math.random() * 720 + 360}deg)`;
        piece.style.opacity = "0";
      });
      setTimeout(() => { if (piece.parentNode) piece.parentNode.removeChild(piece); }, 1900);
    }
  }

  _spawnGridSweep(factionHex) {
    const sweep = document.createElement("div");
    Object.assign(sweep.style, {
      position: "absolute",
      inset: "0",
      background: `linear-gradient(90deg, transparent 0%, ${factionHex}80 50%, transparent 100%)`,
      backgroundSize: "200% 100%",
      backgroundPosition: "-100% 0",
      transition: "background-position 1.5s linear",
      mixBlendMode: "screen",
    });
    this.winFXLayer.appendChild(sweep);
    requestAnimationFrame(() => { sweep.style.backgroundPosition = "200% 0"; });
    setTimeout(() => { if (sweep.parentNode) sweep.parentNode.removeChild(sweep); }, 1600);
  }

  _spawnWatercolorWash(factionHex) {
    const wash = document.createElement("div");
    Object.assign(wash.style, {
      position: "absolute",
      inset: "0",
      background: `radial-gradient(circle at 50% 50%, ${factionHex}A0 0%, ${factionHex}40 40%, transparent 80%)`,
      opacity: "0",
      transition: "opacity 0.6s ease, transform 1.8s ease-out",
      transform: "scale(0.4)",
      mixBlendMode: "multiply",
    });
    this.winFXLayer.appendChild(wash);
    requestAnimationFrame(() => {
      wash.style.opacity = "1";
      wash.style.transform = "scale(1.2)";
    });
    setTimeout(() => { wash.style.opacity = "0"; }, 1500);
    setTimeout(() => { if (wash.parentNode) wash.parentNode.removeChild(wash); }, 2200);
  }

  destroy() {
    [this.notificationContainer, this.bannerContainer, this.countdown, this.winFXLayer].forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }
}

// ============================================================================
// Scene builder
// ============================================================================

class DirectionScene {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.disposed = false;

    this.width = canvas.clientWidth || 600;
    this.height = canvas.clientHeight || 360;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this._buildBackground();

    this.camera = new THREE.PerspectiveCamera(55, this.width / this.height, 0.1, 200);
    this.camera.position.set(0, 14, 13);
    this.camera.lookAt(0, 0, 0);

    this._buildLights();
    this._buildGround();
    this._buildTerritory();
    this._buildCharacters();
    this._buildAmbientFX();

    this.particles = [];
    this.flashes = [];
    this.shockwaves = [];          // expanding ring meshes (Direction B)
    this.stampWaves = [];          // direction D stamp wave overlays
    this.winRain = [];             // direction D voxel-rain meshes
    this._countdownSeconds = 900;  // 15:00 default
    this._countdownIntense = false;

    // DOM overlay for notifications/banners/countdown/win FX
    this.overlay = new SceneOverlay(canvas, config);

    // Wire up Trigger buttons.
    if (config !== DIRECTIONS.REF) {
      const sceneId = canvas.id.replace("scene-", "");
      document.querySelectorAll(`[data-scene="${sceneId}"]`).forEach(btn => {
        btn.addEventListener("click", () => {
          const action = btn.getAttribute("data-action");
          if (action === "claim") this.triggerClaim();
          else if (action === "kill") this.triggerKill();
          else if (action === "notif") this.triggerNotification();
          else if (action === "respawn") this.triggerRespawn();
          else if (action === "endangered") this.triggerBanner("endangered");
          else if (action === "eliminated") this.triggerBanner("eliminated");
          else if (action === "recovered") this.triggerBanner("recovered");
          else if (action === "win") this.triggerWin();
          else if (action === "countdown") this.triggerCountdown();
          else if (action === "reset") this.reset();
        });
      });
    }

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.width || h !== this.height) {
      this.width = w; this.height = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  // -- Background ----------------------------------------------------------
  _buildBackground() {
    const c = this.config;
    if (c.backgroundType === "gradient") {
      this.scene.background = this._makeGradientTexture(c.bgGradientTop, c.bgGradientBottom);
    } else if (c.backgroundType === "radial") {
      this.scene.background = this._makeRadialTexture(c.bgGradientTop, c.bgGradientBottom);
    } else {
      this.scene.background = new THREE.Color(c.bg);
    }
    if (c.fog) {
      this.scene.fog = new THREE.Fog(c.fog.color, c.fog.near, c.fog.far);
    }
  }

  _makeGradientTexture(topHex, bottomHex) {
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

  _makeRadialTexture(centerHex, edgeHex) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext("2d");
    const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 180);
    grad.addColorStop(0, "#" + centerHex.toString(16).padStart(6, "0"));
    grad.addColorStop(1, "#" + edgeHex.toString(16).padStart(6, "0"));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -- Lights --------------------------------------------------------------
  _buildLights() {
    const c = this.config;
    this.scene.add(new THREE.AmbientLight(c.ambient.color, c.ambient.intensity));

    const dl = new THREE.DirectionalLight(c.directional.color, c.directional.intensity);
    dl.position.set(4, 10, 4);
    dl.castShadow = true;
    dl.shadow.mapSize.width = 512;
    dl.shadow.mapSize.height = 512;
    dl.shadow.camera.near = 0.5;
    dl.shadow.camera.far = 30;
    dl.shadow.camera.left = -ARENA_RADIUS;
    dl.shadow.camera.right = ARENA_RADIUS;
    dl.shadow.camera.top = ARENA_RADIUS;
    dl.shadow.camera.bottom = -ARENA_RADIUS;
    this.scene.add(dl);
    this.scene.add(dl.target);

    if (c.bounceLight) {
      const bl = new THREE.DirectionalLight(c.bounceLight.color, c.bounceLight.intensity);
      bl.position.set(-3, 3, -3);
      this.scene.add(bl);
    }
  }

  // -- Ground -------------------------------------------------------------
  _buildGround() {
    const c = this.config;
    if (c.outerGround) {
      if (c.outerGround.water) {
        // Direction E — Castaway Atoll. Animated sea + raised sand+grass island.
        this._buildWaterAndIsland();
      } else if (c.outerGround.plate) {
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(ARENA_RADIUS * 3.2, 0.6, ARENA_RADIUS * 3.2),
          new THREE.MeshStandardMaterial({ color: c.outerGround.color, roughness: 0.85 })
        );
        plate.position.y = -0.3;
        plate.receiveShadow = true;
        this.scene.add(plate);
      } else {
        const outer = new THREE.Mesh(
          new THREE.PlaneGeometry(ARENA_RADIUS * 4, ARENA_RADIUS * 4),
          new THREE.MeshStandardMaterial({ color: c.outerGround.color, roughness: 0.9 })
        );
        outer.rotation.x = -Math.PI / 2;
        outer.position.y = -0.05;
        outer.receiveShadow = true;
        this.scene.add(outer);

        if (c.outerGround.gridColor) {
          const gridTex = this._makeGridTexture(c.outerGround.gridColor);
          outer.material.map = gridTex;
          outer.material.needsUpdate = true;
        }
      }
    }

    // Direction E builds its own island (raised sand+grass) inside _buildWaterAndIsland.
    if (c.outerGround && c.outerGround.water) return;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 64),
      new THREE.MeshLambertMaterial({ color: c.groundColor })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // -- Water + Island (Direction E) ---------------------------------------
  // Cheap procedural water using a custom ShaderMaterial:
  //   * Vertex stage adds two summed sin waves (cost: ~5 ops/vert; geometry is 80x80).
  //   * Fragment stage mixes deep teal + foam ring near island + sun-stripe highlight.
  // No reflection probe, no Water-class FFT — this is a stylized cartoon sea
  // that fits the box-y arcade direction. Total cost: <0.4ms/frame on 1920x1080.
  _buildWaterAndIsland() {
    const c = this.config;
    // Two layouts share the water shader:
    //   E (default)        — sand cylinder + grass top, two-tier dome.
    //   F (cylinder=true)  — single FLAT cylinder; territory mesh sits on
    //                        top at a CLEARLY distinct Y from the water.
    //                        Director rule: "the floor of the island is not
    //                        the same height as the base of the battlefield
    //                        so not to have them intersecting." The water
    //                        sits at Y=-0.4, cylinder top at Y=0.6, territory
    //                        at Y=0.65 — three planes, no Z-fighting.
    const isFlatCylinder = !!c.outerGround.cylinder;

    // 1) Animated water plane (radius ARENA_RADIUS * 4, square)
    // For F we push the water LOWER and leave the cylinder edge as the only
    // surface near the cliff line — so wave animation stays OUTSIDE the
    // playable area as required.
    const waterGeom = new THREE.PlaneGeometry(ARENA_RADIUS * 6, ARENA_RADIUS * 6, 80, 80);
    const seaCol = new THREE.Color(c.outerGround.color);
    const foamCol = new THREE.Color(c.outerGround.foam);
    const sunCol = new THREE.Color(c.outerGround.sun);
    this._waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        // For F we widen the discard radius slightly so wave crests can
        // never overshoot onto the island silhouette.
        uIslandRadius: { value: ARENA_RADIUS * (isFlatCylinder ? 1.04 : 1.02) },
        uFoamWidth: { value: isFlatCylinder ? 1.5 : 1.2 },
        uSeaColor: { value: seaCol },
        uFoamColor: { value: foamCol },
        uSunColor: { value: sunCol },
        uSunDir: { value: new THREE.Vector2(0.6, 0.4).normalize() },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vWorldXZ;
        varying float vWaveY;
        void main() {
          vec3 p = position;
          // Two summed sin waves at different freq/dir for stylized chop
          float w1 = sin(p.x * 0.35 + uTime * 1.2) * 0.18;
          float w2 = sin(p.y * 0.28 - uTime * 0.9 + p.x * 0.1) * 0.13;
          float wave = w1 + w2;
          p.z += wave;
          vWaveY = wave;
          // PlaneGeometry is rotated to lie flat by the host; here we work in local XY.
          vWorldXZ = p.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIslandRadius;
        uniform float uFoamWidth;
        uniform vec3 uSeaColor;
        uniform vec3 uFoamColor;
        uniform vec3 uSunColor;
        uniform vec2 uSunDir;
        varying vec2 vWorldXZ;
        varying float vWaveY;
        void main() {
          float dist = length(vWorldXZ);
          // Discard pixels INSIDE the island radius — saves fillrate.
          if (dist < uIslandRadius - 0.05) discard;

          // Base color depth-shaded by wave height (lighter at crests)
          vec3 col = uSeaColor + vec3(0.18) * smoothstep(-0.1, 0.18, vWaveY);

          // Foam ring near the island — fade out across uFoamWidth units
          float foamMask = 1.0 - smoothstep(uIslandRadius, uIslandRadius + uFoamWidth, dist);
          // Animated foam strands
          float foamNoise = sin(vWorldXZ.x * 1.6 + uTime * 2.4) * 0.5
                          + sin(vWorldXZ.y * 1.3 - uTime * 1.7) * 0.5;
          float foamStrand = smoothstep(0.3, 0.9, foamNoise);
          float foam = foamMask * (0.7 + 0.3 * foamStrand);
          col = mix(col, uFoamColor, foam);

          // Sparse sun-glitter stripes — scrolling along uSunDir
          float glitProj = dot(vWorldXZ, uSunDir);
          float glit = sin(glitProj * 1.2 + uTime * 1.6);
          float glitMask = smoothstep(0.85, 1.0, glit) * smoothstep(0.05, 0.25, vWaveY);
          col = mix(col, uSunColor, glitMask * 0.55);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeom, this._waterMat);
    water.rotation.x = -Math.PI / 2;
    // F sits the water lower (-0.4) so it can never share Y with the cylinder
    // top (0.6). E keeps water slightly under the dome (-0.25) for a fuller
    // beach-line look.
    water.position.y = isFlatCylinder ? -0.4 : -0.25;
    this.scene.add(water);
    this._waterMesh = water;

    if (isFlatCylinder) {
      // === F — Atoll Hybrid: single FLAT cylinder island =====================
      // Director spec: "The island is a flat cylinder above the sea, not a
      // dome shape. Make sure the floor of the island is not the same height
      // as the base of the battlefield so not to have them intersecting."
      //
      // Y plan:
      //   water         Y = -0.40   (well below cylinder top)
      //   cylinder TOP  Y = +0.60   (height 0.60, base at 0.0)
      //   territory     Y = +0.65   (cylinder top + 0.05 — Director rule)
      //
      // The grass color is painted ON THE CYLINDER TOP face via vertex
      // material (not a separate plane) — fewer overlapping surfaces is
      // structurally cleaner and rules out any Z-fighting between
      // "island top" and "territory texture base".
      const cylHeight = 0.6;
      const sideMat = new THREE.MeshStandardMaterial({
        color: 0xC9B077, roughness: 0.95,   // sandy cliff sides
      });
      const topMat = new THREE.MeshLambertMaterial({
        color: c.groundColor,                // grass top
      });
      const bottomMat = new THREE.MeshStandardMaterial({
        color: 0x8a7152, roughness: 1.0,     // dark base (rarely visible)
      });
      // CylinderGeometry materials: [side, top, bottom]
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, cylHeight, 64),
        [sideMat, topMat, bottomMat],
      );
      cyl.position.y = cylHeight / 2;       // base at Y=0, top at Y=cylHeight
      cyl.receiveShadow = true;
      cyl.castShadow = true;
      this.scene.add(cyl);
      // Reference Y for everything that sits on the playable surface.
      this._islandTopY = cylHeight;          // = 0.6
      this._fxRingY = cylHeight + 0.07;      // sits above territory (which is +0.05)
    } else {
      // === E — Castaway Atoll: sand base + grass top dome ===================
      const sandMat = new THREE.MeshStandardMaterial({
        color: 0xE2C58A, roughness: 0.95,
      });
      const sand = new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA_RADIUS * 1.08, ARENA_RADIUS * 1.18, 0.45, 48),
        sandMat,
      );
      sand.position.y = -0.05;
      sand.receiveShadow = true;
      this.scene.add(sand);

      const grass = new THREE.Mesh(
        new THREE.CircleGeometry(ARENA_RADIUS, 64),
        new THREE.MeshLambertMaterial({ color: c.groundColor }),
      );
      grass.rotation.x = -Math.PI / 2;
      grass.position.y = 0.18;
      grass.receiveShadow = true;
      this.scene.add(grass);
      this._islandTopY = 0.19;
      this._fxRingY = 0.25;                  // E's existing 0.19 + 0.06 baseline
    }

    // 3) Cube cliff-rocks around the rim — 14 small chunky stones, varied color & size
    // For F (flat cylinder) rocks sit ON the cylinder's top edge so they read
    // as a rocky lip rather than floating in the sea.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7d5c, roughness: 0.95 });
    const rockMatDark = new THREE.MeshStandardMaterial({ color: 0x6d6045, roughness: 0.95 });
    const rockCount = 14;
    const rockBaseY = isFlatCylinder ? this._islandTopY : 0.05;
    for (let i = 0; i < rockCount; i++) {
      const ang = (i / rockCount) * Math.PI * 2 + (Math.random() * 0.12);
      const r = ARENA_RADIUS * (isFlatCylinder ? 0.97 : 1.05) + Math.random() * 0.5;
      const sz = 0.5 + Math.random() * 0.5;
      const rock = new THREE.Mesh(
        new THREE.BoxGeometry(sz, sz * 0.7, sz),
        i % 3 === 0 ? rockMatDark : rockMat,
      );
      rock.position.set(Math.cos(ang) * r, rockBaseY + sz * 0.35, Math.sin(ang) * r);
      rock.rotation.y = Math.random() * Math.PI;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // 4) Faraway distant atolls (background scenery, no shadows, behind fog)
    // Their base sits roughly on the water plane so they read as small
    // islands in the distance regardless of the main island's geometry.
    const atollWaterY = isFlatCylinder ? -0.4 : -0.25;
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (i - 1) * 0.6 + (Math.random() - 0.5) * 0.2;
      const r = ARENA_RADIUS * 2.6 + Math.random() * ARENA_RADIUS * 0.4;
      const dwidth = 1.6 + Math.random() * 1.2;
      const dheight = 0.5 + Math.random() * 0.4;
      const distantAtoll = new THREE.Mesh(
        new THREE.BoxGeometry(dwidth, dheight, dwidth),
        new THREE.MeshStandardMaterial({ color: 0x7a8b62, roughness: 1.0 }),
      );
      distantAtoll.position.set(
        Math.cos(ang) * r,
        atollWaterY + dheight / 2 + 0.05,
        Math.sin(ang) * r,
      );
      this.scene.add(distantAtoll);
    }
  }

  _makeGridTexture(gridColor) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + this.config.outerGround.color.toString(16).padStart(6, "0");
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#" + gridColor.toString(16).padStart(6, "0");
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    for (let i = 0; i <= 256; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -- Territory ----------------------------------------------------------
  _buildTerritory() {
    this._territoryCv = document.createElement("canvas");
    this._territoryCv.width = TEX_SIZE;
    this._territoryCv.height = TEX_SIZE;
    this._territoryCtx = this._territoryCv.getContext("2d");
    this._buildTerritoryGrid();
    this._renderTerritory();

    this.territoryTex = new THREE.CanvasTexture(this._territoryCv);
    this.territoryTex.colorSpace = THREE.SRGBColorSpace;
    this.territoryTex.minFilter = THREE.NearestFilter;
    this.territoryTex.magFilter = THREE.NearestFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.territoryTex, transparent: true, alphaTest: 0.5,
    });
    const geom = new THREE.PlaneGeometry(ARENA_RADIUS * 2, ARENA_RADIUS * 2);
    this.territoryMesh = new THREE.Mesh(geom, mat);
    this.territoryMesh.rotation.x = -Math.PI / 2;
    // Direction E lifts the playfield onto the island top.
    // Direction F (flat cylinder) uses a larger offset (0.05) per Director rule:
    // "the floor of the island is not the same height as the base of the
    // battlefield so not to have them intersecting." This guarantees the
    // territory texture cannot Z-fight with the cylinder top face even at
    // grazing camera angles.
    const isFlatCylinder = !!(this.config.outerGround && this.config.outerGround.cylinder);
    const territoryOffset = isFlatCylinder ? 0.05 : 0.01;
    this.territoryMesh.position.y = (this._islandTopY || 0) + territoryOffset;
    this.scene.add(this.territoryMesh);
  }

  _buildTerritoryGrid() {
    this._grid = new Uint8Array(TEX_SIZE * TEX_SIZE);
    const cx = TEX_SIZE / 2, cy = TEX_SIZE / 2;
    const r = TEX_SIZE / 2 - 1;
    for (let gy = 0; gy < TEX_SIZE; gy++) {
      for (let gx = 0; gx < TEX_SIZE; gx++) {
        const dx = gx - cx, dy = gy - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) { this._grid[gy * TEX_SIZE + gx] = 0; continue; }
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += 2 * Math.PI;
        const sector = Math.floor(angle / (2 * Math.PI / 5));
        const noise = (Math.sin(dx * 0.5) + Math.cos(dy * 0.5)) * 1.2;
        const noisyDist = dist + noise;
        if (noisyDist < r * 0.85) {
          this._grid[gy * TEX_SIZE + gx] = (sector % 5) + 1;
        } else {
          this._grid[gy * TEX_SIZE + gx] = 0;
        }
      }
    }
  }

  _renderTerritory() {
    const c = this.config;
    const ctx = this._territoryCtx;
    const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    const data = img.data;
    const facR = new Uint8Array(6), facG = new Uint8Array(6), facB = new Uint8Array(6);
    for (let i = 0; i < 5; i++) {
      const col = c.factionColors[i];
      facR[i + 1] = (col >> 16) & 0xFF;
      facG[i + 1] = (col >> 8) & 0xFF;
      facB[i + 1] = col & 0xFF;
    }
    for (let gy = 0; gy < TEX_SIZE; gy++) {
      for (let gx = 0; gx < TEX_SIZE; gx++) {
        const v = this._grid[gy * TEX_SIZE + gx];
        const px = (gy * TEX_SIZE + gx) * 4;
        if (v === 0) {
          data[px] = data[px + 1] = data[px + 2] = data[px + 3] = 0;
        } else {
          let r = facR[v], g = facG[v], b = facB[v];
          if (c.territoryDither) {
            const factionOffset = v;
            const checker = ((gx + gy * factionOffset) & 1) === 0;
            if (!checker) {
              r = Math.floor(r * 0.88);
              g = Math.floor(g * 0.88);
              b = Math.floor(b * 0.88);
            }
          }
          data[px] = r; data[px + 1] = g; data[px + 2] = b; data[px + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    if (this.territoryTex) this.territoryTex.needsUpdate = true;
  }

  // -- Characters ---------------------------------------------------------
  _buildCharacters() {
    const c = this.config;
    this.characters = [];
    const charSpecs = [
      { factionIdx: 0, angle: -Math.PI / 3, radius: 7 },
      { factionIdx: 2, angle: Math.PI * 0.6, radius: 6 },
      { factionIdx: 4, angle: Math.PI * 1.3, radius: 8 },
    ];
    const baseY = this._islandTopY || 0;
    for (const spec of charSpecs) {
      const color = c.factionColors[spec.factionIdx];
      const ch = this._makeCharacter(color);
      ch.group.position.x = Math.cos(spec.angle) * spec.radius;
      ch.group.position.y = baseY;
      ch.group.position.z = Math.sin(spec.angle) * spec.radius;
      ch.group.rotation.y = -spec.angle + Math.PI / 2;
      ch.factionIdx = spec.factionIdx;
      ch.factionId = spec.factionIdx + 1;
      ch.factionName = FACTION_NAMES[spec.factionIdx];
      ch.color = color;
      ch.bobOffset = Math.random() * Math.PI * 2;
      ch.spawnAngle = spec.angle;
      ch.spawnRadius = spec.radius;
      ch.baseY = baseY;
      this.scene.add(ch.group);
      this.characters.push(ch);

      this._addTrail(ch);
    }
  }

  _makeCharacter(color) {
    const c = this.config;
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: c.charRoughness,
      emissive: c.charEmissive ? color : 0x000000,
      emissiveIntensity: c.charEmissive || 0,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), bodyMat);
    head.position.y = 1.3;
    head.castShadow = true;
    g.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), eyeMat);
      eye.position.set(s * 0.18, 1.35, 0.36);
      g.add(eye);
      const pup = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), pupMat);
      pup.position.set(s * 0.18, 1.35, 0.42);
      g.add(pup);
    }

    // Direction indicator stripe on the front face of the head
    const stripeColor = new THREE.Color(color).multiplyScalar(0.55);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.06, 0.04),
      new THREE.MeshStandardMaterial({ color: stripeColor, roughness: 0.4 })
    );
    stripe.position.set(0, 1.18, 0.4);
    g.add(stripe);

    // Per-direction character treatment
    if (c.charStyle === "ink-outline") {
      // Direction C — inverted-hull outline pass
      const outlineMat = new THREE.MeshBasicMaterial({
        color: 0x222222, side: THREE.BackSide,
      });
      const bodyOutline = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.06, 1.06), outlineMat);
      bodyOutline.position.y = 0.5;
      g.add(bodyOutline);
      const headOutline = new THREE.Mesh(new THREE.BoxGeometry(0.81, 0.81, 0.81), outlineMat);
      headOutline.position.y = 1.3;
      g.add(headOutline);
    } else if (c.charStyle === "neon-edge") {
      // Direction B — extra emissive trim on bottom + top of body (faked LED edge)
      const trimMat = new THREE.MeshBasicMaterial({ color });
      const trimBottom = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.06, 1.04), trimMat);
      trimBottom.position.y = 0.04;
      g.add(trimBottom);
      const trimTop = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.06, 1.04), trimMat);
      trimTop.position.y = 0.97;
      g.add(trimTop);
    } else if (c.charStyle === "voxel-cubed") {
      // Direction D — small darker rim cubes at corners (faked AO + tactile)
      const rimColor = new THREE.Color(color).multiplyScalar(0.7);
      const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.7 });
      // Just one feet block to read as "stuck on the ground"
      const feet = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.1, 1.04), rimMat);
      feet.position.y = 0.05;
      feet.castShadow = true;
      g.add(feet);
    } else if (c.charStyle === "warm-glow") {
      // Direction A — small bottom bevel + slight warm rim emissive on body
      bodyMat.emissive = new THREE.Color(0xfff0c0);
      bodyMat.emissiveIntensity = 0.06;
    } else if (c.charStyle === "castaway") {
      // Direction E — sailor cap on the head: stacked white cube + faction-colored stripe
      const capWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7 });
      const capRingMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
      const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.78), capRingMat);
      capBase.position.y = 1.72;
      capBase.castShadow = true;
      g.add(capBase);
      const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), capWhiteMat);
      capTop.position.y = 1.85;
      capTop.castShadow = true;
      g.add(capTop);
      // Tiny darker rim feet block (echoes Direction D, fits the chunky sea theme)
      const rimColor = new THREE.Color(color).multiplyScalar(0.65);
      const feet = new THREE.Mesh(
        new THREE.BoxGeometry(1.04, 0.08, 1.04),
        new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.7 }),
      );
      feet.position.y = 0.04;
      feet.castShadow = true;
      g.add(feet);
    }

    return { group: g, body, head, bodyMat };
  }

  _addTrail(char) {
    const c = this.config;
    const trailLen = 6;
    const start = char.group.position.clone();
    const dir = new THREE.Vector3(
      -Math.sin(char.group.rotation.y), 0, -Math.cos(char.group.rotation.y),
    );
    // Trail must sit ABOVE the territory mesh (which itself sits above the
    // island top). For F (flat cylinder) the territory offset is 0.05, so
    // trail goes at +0.07; for E (dome) territory is +0.01, trail at +0.05.
    const isFlatCyl = !!(this.config.outerGround && this.config.outerGround.cylinder);
    const trailY = (this._islandTopY || 0) + (isFlatCyl ? 0.07 : 0.05);
    const pts = [];
    for (let i = 0; i < trailLen; i++) {
      pts.push(new THREE.Vector3(
        start.x + dir.x * i * 0.8, trailY, start.z + dir.z * i * 0.8,
      ));
    }
    const w = c.trailWidth;
    const trailStyle = c.trailStyle || "ribbon";

    if (trailStyle === "pixelated") {
      // Direction D — segmented chevrons (looks pixel-stamped)
      char.trailMeshes = [];
      const chevronColor = char.color;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const cx = (p0.x + p1.x) / 2;
        const cz = (p0.z + p1.z) / 2;
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(w * 1.6, 0.08, 0.5),
          new THREE.MeshLambertMaterial({ color: chevronColor }),
        );
        seg.position.set(cx, 0.04, cz);
        const segDir = new THREE.Vector3().subVectors(p1, p0);
        seg.rotation.y = Math.atan2(segDir.x, segDir.z);
        this.scene.add(seg);
        char.trailMeshes.push(seg);
      }
      return;
    }

    // Default ribbon-based trail
    const positions = [];
    const indices = [];
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      positions.push(p.x + perp.x, p.y, p.z + perp.z);
      positions.push(p.x - perp.x, p.y, p.z - perp.z);
      if (i > 0) {
        const a = (i - 1) * 2, b = i * 2;
        indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);

    if (trailStyle === "brush-stroke") {
      // Direction C — wider stroke + 2nd darker outline plane
      const mat = new THREE.MeshBasicMaterial({
        color: char.color, side: THREE.DoubleSide, transparent: true, opacity: 0.78,
      });
      const trail = new THREE.Mesh(geom, mat);
      this.scene.add(trail);
      char.trail = trail;
    } else {
      const mat = new THREE.MeshBasicMaterial({
        color: char.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
      });
      const trail = new THREE.Mesh(geom, mat);
      this.scene.add(trail);
      char.trail = trail;
    }

    // Direction B — fluorescent glow plane underneath
    if (c.trailGlow) {
      const glowGeom = new THREE.BufferGeometry();
      const glowPos = [];
      const glowPerp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w * 2.4);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        glowPos.push(p.x + glowPerp.x, p.y - 0.005, p.z + glowPerp.z);
        glowPos.push(p.x - glowPerp.x, p.y - 0.005, p.z - glowPerp.z);
      }
      glowGeom.setAttribute("position", new THREE.Float32BufferAttribute(glowPos, 3));
      const glowIndices = [];
      for (let i = 1; i < pts.length; i++) {
        const a = (i - 1) * 2, b = i * 2;
        glowIndices.push(a, a + 1, b + 1, a, b + 1, b);
      }
      glowGeom.setIndex(glowIndices);
      const glowMat = new THREE.MeshBasicMaterial({
        color: char.color, side: THREE.DoubleSide, transparent: true, opacity: 0.32,
      });
      const glow = new THREE.Mesh(glowGeom, glowMat);
      this.scene.add(glow);
    }

    // Trail outline (Tier 0)
    if (c.trailDarkenOutline) {
      const outlineColor = new THREE.Color(char.color).multiplyScalar(0.55);
      const outlinePos = [];
      const outlinePerp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w * 1.18);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        outlinePos.push(p.x + outlinePerp.x, p.y - 0.002, p.z + outlinePerp.z);
        outlinePos.push(p.x - outlinePerp.x, p.y - 0.002, p.z - outlinePerp.z);
      }
      const outlineGeom = new THREE.BufferGeometry();
      outlineGeom.setAttribute("position", new THREE.Float32BufferAttribute(outlinePos, 3));
      const outlineIndices = [];
      for (let i = 1; i < pts.length; i++) {
        const a = (i - 1) * 2, b = i * 2;
        outlineIndices.push(a, a + 1, b + 1, a, b + 1, b);
      }
      outlineGeom.setIndex(outlineIndices);
      const outlineMat = new THREE.MeshBasicMaterial({
        color: outlineColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
      });
      const outline = new THREE.Mesh(outlineGeom, outlineMat);
      this.scene.add(outline);
    }
  }

  // -- Ambient FX (motes) -------------------------------------------------
  _buildAmbientFX() {
    const c = this.config;
    if (this.canvas.id === "ref-current") return;

    const count = 40;
    const positions = new Float32Array(count * 3);
    const moteBase = (this._islandTopY || 0) + 0.5;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * ARENA_RADIUS * 0.95;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = moteBase + Math.random() * 4;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const moteColor = c.name === "Neon Pulse" ? 0x88ccff
                    : c.name === "Painted Plains" ? 0xfff8c0
                    : c.name === "Voxel Plate" ? 0xffffff
                    : c.name === "Castaway Atoll" ? 0xfff0c0
                    : c.name === "Atoll Hybrid" ? 0xe8f4ff   // sea-spray motes
                    : 0xfff0c0;
    const mat = new THREE.PointsMaterial({
      color: moteColor, size: 0.18, transparent: true, opacity: 0.55, sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geom, mat);
    this.scene.add(this.motes);
  }

  // -- VFX triggers -------------------------------------------------------

  // ===== CLAIM ===========================================================
  triggerClaim() {
    const c = this.config;
    const factionId = 1 + Math.floor(Math.random() * 5);
    const factionColor = c.factionColors[factionId - 1];
    const flashColor = c.claimFlashColor;
    const fr = (flashColor >> 16) & 0xff;
    const fg = (flashColor >> 8) & 0xff;
    const fb = flashColor & 0xff;

    // Find a random claim entry-point inside the chosen faction's territory
    let entry = { x: 0, z: 0 };
    for (let tries = 0; tries < 40; tries++) {
      const gx = Math.floor(Math.random() * TEX_SIZE);
      const gy = Math.floor(Math.random() * TEX_SIZE);
      if (this._grid[gy * TEX_SIZE + gx] === factionId) {
        entry.x = (gx / TEX_SIZE - 0.5) * ARENA_RADIUS * 2;
        entry.z = (gy / TEX_SIZE - 0.5) * ARENA_RADIUS * 2;
        break;
      }
    }

    // ==== Direction-specific claim FX ====
    if (c.claimFlashStyle === "sunburst") {
      // A — Sunset: flash + 8 light rays from entry, expanding outward
      this.flashes.push({
        factionId, t: 0, duration: 0.4, style: "flash", flashRGB: [fr, fg, fb],
      });
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const ray = new THREE.Mesh(
          new THREE.PlaneGeometry(0.18, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xFFE8A0, transparent: true, opacity: 0.85 }),
        );
        ray.rotation.x = -Math.PI / 2;
        ray.rotation.z = ang;
        ray.position.set(entry.x + Math.cos(ang) * 0.6, 0.05, entry.z + Math.sin(ang) * 0.6);
        this.scene.add(ray);
        this.particles.push({
          mesh: ray, kind: "ray", life: 0, maxLife: 0.55,
          startX: ray.position.x, startZ: ray.position.z, dirX: Math.cos(ang), dirZ: Math.sin(ang),
        });
      }
    } else if (c.claimFlashStyle === "shockwave") {
      // B — Neon: high-frequency strobe + expanding cyan ring
      this.flashes.push({
        factionId, t: 0, duration: 0.28, style: "strobe", flashRGB: [fr, fg, fb],
      });
      const ringGeom = new THREE.RingGeometry(0.4, 0.5, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00FFFF, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(entry.x, 0.08, entry.z);
      this.scene.add(ring);
      this.shockwaves.push({ mesh: ring, life: 0, maxLife: 0.5, color: 0x00FFFF });
    } else if (c.claimFlashStyle === "ink-bleed") {
      // C — Painted: slow watercolor radial bloom + ink splotches
      this.flashes.push({
        factionId, t: 0, duration: 0.7, style: "bloom", flashRGB: [fr, fg, fb],
      });
      // Ink splotches (small dark cube specks)
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 0.8;
        const splat = new THREE.Mesh(
          new THREE.BoxGeometry(0.18 + Math.random() * 0.1, 0.04, 0.18 + Math.random() * 0.1),
          new THREE.MeshBasicMaterial({
            color: factionColor, transparent: true, opacity: 0.7,
          }),
        );
        splat.position.set(entry.x + Math.cos(ang) * r, 0.06, entry.z + Math.sin(ang) * r);
        splat.rotation.y = Math.random() * Math.PI;
        this.scene.add(splat);
        this.particles.push({
          mesh: splat, kind: "splat", life: 0, maxLife: 0.9,
        });
      }
    } else if (c.claimFlashStyle === "wave-ripple") {
      // E — Castaway: 3 concentric ring ripples + droplet splatter at entry
      this.flashes.push({
        factionId, t: 0, duration: 0.55, style: "bloom",
        flashRGB: [fr, fg, fb],
      });
      const ringY = this._fxRingY != null ? this._fxRingY : 0.06;
      [0, 0.12, 0.24].forEach((delay, idx) => {
        setTimeout(() => {
          if (this.disposed) return;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.3, 0.42, 32),
            new THREE.MeshBasicMaterial({
              color: 0xC8F0FF, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(entry.x, ringY + idx * 0.005, entry.z);
          this.scene.add(ring);
          this.shockwaves.push({ mesh: ring, life: 0, maxLife: 0.7, color: 0xC8F0FF, scaleTo: 5 });
        }, delay * 1000);
      });
      // Droplet splash — small light-blue cubes shot upward + outward
      for (let i = 0; i < 8; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.4;
        const droplet = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, 0.08),
          new THREE.MeshBasicMaterial({ color: 0xCFEEFF, transparent: true, opacity: 0.95 }),
        );
        droplet.position.set(entry.x, ringY, entry.z);
        this.scene.add(droplet);
        this.particles.push({
          mesh: droplet, kind: "puff", life: 0, maxLife: 0.7,
          vel: new THREE.Vector3(Math.cos(ang) * speed, 1.4 + Math.random() * 1.2, Math.sin(ang) * speed),
          gravity: -5,
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        });
      }
    } else if (c.claimFlashStyle === "stamp-wave") {
      // D — Voxel: stamp-wave from entry; cube-based dust puff at entry
      this.flashes.push({
        factionId, t: 0, duration: 0.45, style: "stamp",
        flashRGB: [fr, fg, fb], entry, factionColor,
      });
      // Dust puff — small white cubes popping up
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.5;
        const puff = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.1),
          new THREE.MeshBasicMaterial({ color: 0xfffafa, transparent: true, opacity: 0.9 }),
        );
        puff.position.set(entry.x, 0.1, entry.z);
        this.scene.add(puff);
        this.particles.push({
          mesh: puff, kind: "puff", life: 0, maxLife: 0.5,
          vel: new THREE.Vector3(Math.cos(ang) * speed, 0.6 + Math.random() * 1.0, Math.sin(ang) * speed),
          gravity: -3.5, rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        });
      }
      // Stamp wave ring
      const stampRing = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.4, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
      );
      stampRing.rotation.x = -Math.PI / 2;
      stampRing.position.set(entry.x, 0.06, entry.z);
      this.scene.add(stampRing);
      this.stampWaves.push({ mesh: stampRing, life: 0, maxLife: 0.5 });
    } else {
      // REF — basic flash
      this.flashes.push({
        factionId, t: 0, duration: 0.35, style: "flash", flashRGB: [fr, fg, fb],
      });
    }
  }

  // ===== KILL ============================================================
  triggerKill() {
    const c = this.config;
    const victim = this.characters[Math.floor(Math.random() * this.characters.length)];
    const pos = victim.group.position.clone();
    // Spawn FX at the body center, which is baseY + 1.0 (body Y = 0.5 + half cube).
    // For F the island top sits at Y=0.6, so debris spawns at Y=1.6 (right at
    // chest height) — much better than the legacy hardcoded Y=1.0 which would
    // have spawned voxel debris INSIDE the cylinder.
    pos.y = (victim.baseY || 0) + 1.0;

    const style = c.killBurstStyle || "scatter";
    const baseColor = victim.color;

    // ==== Direction-specific kill FX ====
    if (style === "confetti") {
      // A — Sunset: warm confetti shards (mixed colors), falling with gravity
      const accents = [baseColor, 0xFFE8A0, 0xFF9A6B, 0xFFFFFF];
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 2;
        const upspeed = 2.5 + Math.random() * 2;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.03, 0.18),
          new THREE.MeshBasicMaterial({
            color: accents[Math.floor(Math.random() * accents.length)],
            transparent: true, opacity: 1, side: THREE.DoubleSide,
          }),
        );
        m.position.copy(pos);
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "confetti", life: 0, maxLife: 1.4,
          vel: new THREE.Vector3(Math.cos(angle) * speed, upspeed, Math.sin(angle) * speed),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
          gravity: -6,
        });
      }
    } else if (style === "implode") {
      // B — Neon: particles converge to center then white flash + vanish
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        const r = 1.4;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.14, 0.14),
          new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 }),
        );
        m.position.set(pos.x + Math.cos(ang) * r, pos.y + (Math.random() - 0.5) * 1.2, pos.z + Math.sin(ang) * r);
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "implode", life: 0, maxLife: 0.65,
          target: pos.clone(), startPos: m.position.clone(),
        });
      }
      // White flash ring at impact
      const flashRing = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.6, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
        }),
      );
      flashRing.rotation.x = -Math.PI / 2;
      flashRing.position.set(pos.x, 0.1, pos.z);
      this.scene.add(flashRing);
      this.shockwaves.push({ mesh: flashRing, life: 0, maxLife: 0.4, color: 0xffffff });
    } else if (style === "petals") {
      // C — Painted: white plane fragments float upward with wobble
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + Math.random() * 0.8;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.22, 0.22),
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
          }),
        );
        m.position.copy(pos);
        m.rotation.x = Math.random() * Math.PI;
        m.rotation.z = Math.random() * Math.PI;
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "petal", life: 0, maxLife: 1.6,
          vel: new THREE.Vector3(Math.cos(angle) * speed, 1.2 + Math.random() * 0.5, Math.sin(angle) * speed),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4),
          wobblePhase: Math.random() * Math.PI * 2, gravity: -0.6,
        });
      }
    } else if (style === "splash") {
      // E — Castaway: 14 light-blue droplets + 2 white foam-ring shockwaves
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.6 + Math.random() * 2;
        const upspeed = 3.2 + Math.random() * 1.5;
        const sz = 0.1 + Math.random() * 0.08;
        const dropColors = [0xCFEEFF, 0xB7E3F4, 0xFFFFFF, baseColor];
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(sz, sz, sz),
          new THREE.MeshBasicMaterial({
            color: dropColors[Math.floor(Math.random() * dropColors.length)],
            transparent: true, opacity: 1,
          }),
        );
        m.position.copy(pos);
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "voxel", life: 0, maxLife: 1.1,
          vel: new THREE.Vector3(Math.cos(ang) * speed, upspeed, Math.sin(ang) * speed),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
          gravity: -10, bounceY: 0.25, hasBounced: 0,
        });
      }
      // Two white foam-ring shockwaves on the island
      const ringY = this._fxRingY != null ? this._fxRingY : 0.06;
      [0, 0.18].forEach((delay) => {
        setTimeout(() => {
          if (this.disposed) return;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.05, 0.5, 24),
            new THREE.MeshBasicMaterial({
              color: 0xFFFFFF, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(pos.x, ringY, pos.z);
          this.scene.add(ring);
          this.shockwaves.push({ mesh: ring, life: 0, maxLife: 0.6, color: 0xFFFFFF, scaleTo: 6 });
        }, delay * 1000);
      });
    } else if (style === "voxel-debris") {
      // D — Voxel: bouncy 3D cube fragments with proper gravity and rotation
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.0 + Math.random() * 2;
        const upspeed = 2.5 + Math.random() * 1.5;
        const sz = 0.16 + Math.random() * 0.1;
        const variantColor = i % 3 === 0
          ? new THREE.Color(baseColor).multiplyScalar(0.7).getHex()
          : baseColor;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(sz, sz, sz),
          new THREE.MeshLambertMaterial({ color: variantColor, transparent: true, opacity: 1 }),
        );
        m.position.copy(pos);
        m.castShadow = true;
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "voxel", life: 0, maxLife: 1.2,
          vel: new THREE.Vector3(Math.cos(angle) * speed, upspeed, Math.sin(angle) * speed),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
          gravity: -10, bounceY: 0.3, hasBounced: 0,
        });
      }
    } else {
      // REF — basic scatter
      for (let i = 0; i < 10; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 1.5;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.16, 0.16),
          new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 }),
        );
        m.position.copy(pos);
        this.scene.add(m);
        this.particles.push({
          mesh: m, kind: "scatter", life: 0, maxLife: 0.8,
          vel: new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 2, Math.sin(angle) * speed),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
          gravity: -5,
        });
      }
    }

    // Hide the victim and queue auto-respawn
    victim.group.visible = false;
    if (victim.respawnTimeout) clearTimeout(victim.respawnTimeout);
    victim.respawnTimeout = setTimeout(() => {
      if (this.disposed) return;
      this._respawnCharacter(victim);
    }, 700);

    // Notification toast for the kill
    const victimName = VICTIM_NAMES[Math.floor(Math.random() * VICTIM_NAMES.length)];
    this.overlay.pushNotification(`You killed ${victimName}`, "kill", baseColor);
  }

  // ===== RESPAWN =========================================================
  // Called automatically after a kill, OR by the explicit Trigger Respawn button
  // (in which case we hide a random character and immediately respawn it).
  triggerRespawn() {
    const victim = this.characters[Math.floor(Math.random() * this.characters.length)];
    victim.group.visible = false;
    if (victim.respawnTimeout) clearTimeout(victim.respawnTimeout);
    victim.respawnTimeout = setTimeout(() => {
      this._respawnCharacter(victim);
    }, 200);
  }

  _respawnCharacter(victim) {
    const c = this.config;
    const style = c.respawnStyle;
    const pos = victim.group.position.clone();

    victim.group.visible = true;

    if (style === "sunrise") {
      // A — Sunset: golden halo expands + character rises with a soft scale
      victim.group.scale.set(0.01, 1, 0.01);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.6, 32),
        new THREE.MeshBasicMaterial({ color: 0xFFE8A0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(pos.x, 0.06, pos.z);
      this.scene.add(halo);
      this.shockwaves.push({ mesh: halo, life: 0, maxLife: 0.7, color: 0xFFE8A0, scaleTo: 4 });
      // Light beam (vertical plane)
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 4),
        new THREE.MeshBasicMaterial({ color: 0xFFF0B0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.set(pos.x, 2, pos.z);
      this.scene.add(beam);
      this.particles.push({
        mesh: beam, kind: "beam", life: 0, maxLife: 0.6, target: victim,
      });
      this.particles.push({
        mesh: null, kind: "respawn-scale", respawnTarget: victim, life: 0, maxLife: 0.5,
      });
    } else if (style === "glitch-in") {
      // B — Neon: 3 horizontal scanline reconstruction frames, character flickers in
      victim.group.scale.set(1, 1, 1);
      victim.group.visible = false;
      const flickerSeq = [120, 280, 440]; // ms
      flickerSeq.forEach((ms, idx) => {
        setTimeout(() => {
          if (this.disposed) return;
          victim.group.visible = idx % 2 === 0;
          if (idx === flickerSeq.length - 1) {
            victim.group.visible = true;
          }
        }, ms);
      });
      // Scanline plane sweeps up the character position
      const scanline = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x00FFFF, transparent: true, opacity: 0.9 }),
      );
      scanline.rotation.x = -Math.PI / 2;
      scanline.position.set(pos.x, 0.05, pos.z);
      this.scene.add(scanline);
      this.particles.push({
        mesh: scanline, kind: "scanline", life: 0, maxLife: 0.55,
        startY: 0.05, endY: 1.8, startPos: pos.clone(),
      });
    } else if (style === "page-turn") {
      // C — Painted: ink-drop spreads, character "blooms" up
      victim.group.scale.set(0.01, 0.01, 0.01);
      const inkDrop = new THREE.Mesh(
        new THREE.CircleGeometry(0.4, 16),
        new THREE.MeshBasicMaterial({
          color: victim.color, side: THREE.DoubleSide, transparent: true, opacity: 0.7,
        }),
      );
      inkDrop.rotation.x = -Math.PI / 2;
      inkDrop.position.set(pos.x, 0.06, pos.z);
      this.scene.add(inkDrop);
      this.particles.push({
        mesh: inkDrop, kind: "ink-drop", life: 0, maxLife: 0.7,
      });
      this.particles.push({
        mesh: null, kind: "respawn-scale-soft", respawnTarget: victim, life: 0, maxLife: 0.6,
      });
    } else if (style === "wash-ashore") {
      // E — Castaway: foam ring sweeps across the spawn point + character rises from below
      const baseY = victim.baseY || 0;
      victim.group.scale.set(1, 1, 1);
      victim.group.position.y = baseY - 1.2;
      this.particles.push({
        mesh: null, kind: "respawn-build", respawnTarget: victim, life: 0, maxLife: 0.6,
        startY: baseY - 1.2, endY: baseY,
      });
      // Two foam rings expanding outward at island top
      const ringY = this._fxRingY != null ? this._fxRingY : 0.06;
      [0, 0.15].forEach((delay) => {
        setTimeout(() => {
          if (this.disposed) return;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.1, 0.45, 24),
            new THREE.MeshBasicMaterial({
              color: 0xFFFFFF, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(pos.x, ringY, pos.z);
          this.scene.add(ring);
          this.shockwaves.push({ mesh: ring, life: 0, maxLife: 0.65, color: 0xFFFFFF, scaleTo: 4 });
        }, delay * 1000);
      });
      // 3 small water-droplet puffs
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 0.9 + Math.random() * 1.0;
        const droplet = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 0.09, 0.09),
          new THREE.MeshBasicMaterial({ color: 0xCFEEFF, transparent: true, opacity: 0.95 }),
        );
        droplet.position.set(pos.x, ringY + 0.05, pos.z);
        this.scene.add(droplet);
        this.particles.push({
          mesh: droplet, kind: "puff", life: 0, maxLife: 0.55,
          vel: new THREE.Vector3(Math.cos(ang) * speed, 0.7, Math.sin(ang) * speed),
          gravity: -3.5,
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5),
        });
      }
    } else if (style === "build-up") {
      // D / F — Voxel: cubes assemble bottom-up, head appears last.
      // baseY may be ABOVE 0 when the arena sits on a raised island
      // (Direction F = flat cylinder at Y=0.6). Compute everything relative
      // to victim.baseY so the character snaps back to the correct surface.
      const baseY = victim.baseY != null ? victim.baseY : 0;
      victim.group.scale.set(1, 1, 1);
      victim.group.position.y = baseY - 1.5;
      this.particles.push({
        mesh: null, kind: "respawn-build", respawnTarget: victim, life: 0, maxLife: 0.5,
        startY: baseY - 1.5, endY: baseY,
      });
      // Dust puffs at ground level (relative to island surface)
      const puffY = baseY + 0.1;
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.2;
        const puff = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.12, 0.12),
          new THREE.MeshBasicMaterial({ color: 0xfffafa, transparent: true, opacity: 0.9 }),
        );
        puff.position.set(pos.x, puffY, pos.z);
        this.scene.add(puff);
        this.particles.push({
          mesh: puff, kind: "puff", life: 0, maxLife: 0.5,
          vel: new THREE.Vector3(Math.cos(ang) * speed, 0.6, Math.sin(ang) * speed),
          gravity: -3, rotVel: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5),
        });
      }
    } else {
      // REF
      victim.group.scale.set(1, 1, 1);
    }

    // Notification: the player just spawned (use neutral language)
    this.overlay.pushNotification("You spawned (invuln 2s)", "respawn", victim.color);
  }

  // ===== NOTIFICATION ====================================================
  // Cycle through 3 example notifications to show variety
  triggerNotification() {
    const c = this.config;
    const examples = [
      { text: "You captured 8% of Red", kind: "capture", colorIdx: 0 },
      { text: `You killed ${VICTIM_NAMES[Math.floor(Math.random() * VICTIM_NAMES.length)]}`, kind: "kill", colorIdx: 2 },
      { text: "You died", kind: "death", colorIdx: null },
    ];
    let i = 0;
    examples.forEach(ex => {
      setTimeout(() => {
        const fc = ex.colorIdx != null ? c.factionColors[ex.colorIdx] : null;
        this.overlay.pushNotification(ex.text, ex.kind, fc);
      }, i * 350);
      i++;
    });
  }

  // ===== FACTION-STATE BANNER ============================================
  triggerBanner(kind) {
    const c = this.config;
    const factionIdx = 3; // Yellow for the demo
    const factionColor = c.factionColors[factionIdx];
    const factionName = FACTION_NAMES[factionIdx].toUpperCase();
    let text = "";
    if (kind === "endangered") text = `${factionName} ENDANGERED · NO RESPAWNS`;
    else if (kind === "eliminated") text = `${factionName} ELIMINATED`;
    else if (kind === "recovered") text = `${factionName} RECOVERED · RESPAWNS BACK`;
    this.overlay.showBanner(text, kind, factionColor, kind === "eliminated" ? 2800 : 2000);
  }

  // ===== COUNTDOWN =======================================================
  // Toggle between normal and intense (last-minute) styling
  triggerCountdown() {
    this._countdownIntense = !this._countdownIntense;
    if (this._countdownIntense) {
      this._countdownSeconds = 9; // simulate last 9 seconds
      this.overlay.setCountdown(9, true);
      // Animate countdown ticking down for ~5 seconds
      const interval = setInterval(() => {
        this._countdownSeconds--;
        if (this._countdownSeconds < 0 || this.disposed || !this._countdownIntense) {
          clearInterval(interval);
          return;
        }
        this.overlay.setCountdown(this._countdownSeconds, true);
      }, 800);
    } else {
      this._countdownSeconds = 900;
      this.overlay.setCountdown(900, false);
    }
  }

  // ===== GAME WIN =========================================================
  triggerWin() {
    const c = this.config;
    const winningIdx = Math.floor(Math.random() * 5);
    const winningColor = c.factionColors[winningIdx];
    const winningName = FACTION_NAMES[winningIdx].toUpperCase();

    // 1. Banner (every direction)
    this.overlay.showBanner(`${winningName} WINS`, "win", winningColor, 3500);

    // 2. DOM-layer FX per direction (confetti / laser / wash)
    this.overlay.triggerWinDOM(winningColor);

    // 3. WebGL FX per direction
    if (c.winStyle === "fireworks") {
      // A — Sunset: 3 staggered firework bursts in the WebGL scene
      [0, 0.4, 0.8].forEach((delay) => {
        setTimeout(() => {
          if (this.disposed) return;
          this._spawn3DFirework(winningColor);
        }, delay * 1000);
      });
    } else if (c.winStyle === "laser-grid") {
      // B — Neon: pulse the territory in winning color + dramatic flash
      this.flashes.push({
        factionId: -1, // -1 means all-faction tint
        t: 0, duration: 1.5, style: "all-bloom",
        flashRGB: [(winningColor >> 16) & 0xff, (winningColor >> 8) & 0xff, winningColor & 0xff],
      });
      // 3 expanding rings from arena center
      [0, 0.3, 0.6].forEach((delay) => {
        setTimeout(() => {
          if (this.disposed) return;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.2, 0.5, 48),
            new THREE.MeshBasicMaterial({ color: winningColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(0, 0.07, 0);
          this.scene.add(ring);
          this.shockwaves.push({ mesh: ring, life: 0, maxLife: 1.4, color: winningColor, scaleTo: 30 });
        }, delay * 1000);
      });
    } else if (c.winStyle === "watercolor-bloom") {
      // C — Painted: re-paint the entire arena in winning color (bloom flash)
      this.flashes.push({
        factionId: -1, t: 0, duration: 1.5, style: "all-bloom",
        flashRGB: [(winningColor >> 16) & 0xff, (winningColor >> 8) & 0xff, winningColor & 0xff],
      });
    } else if (c.winStyle === "tide-rise") {
      // E — Castaway: territory bloom + 3 staggered foam rings sweep across the island
      // + a faction-colored flag rises from arena center.
      this.flashes.push({
        factionId: -1, t: 0, duration: 1.5, style: "all-bloom",
        flashRGB: [(winningColor >> 16) & 0xff, (winningColor >> 8) & 0xff, winningColor & 0xff],
      });
      const ringY = this._fxRingY != null ? this._fxRingY : 0.06;
      [0, 0.35, 0.7].forEach((delay) => {
        setTimeout(() => {
          if (this.disposed) return;
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.2, 0.5, 48),
            new THREE.MeshBasicMaterial({
              color: 0xFFFFFF, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(0, ringY, 0);
          this.scene.add(ring);
          this.shockwaves.push({ mesh: ring, life: 0, maxLife: 1.6, color: 0xFFFFFF, scaleTo: 32 });
        }, delay * 1000);
      });
      // Flag pole + flag rise (pure cubes, fits the box constraint)
      const baseY = this._islandTopY || 0;
      const pole = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 4, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x6b4d2a, roughness: 0.8 }),
      );
      pole.position.set(0, baseY + 2, 0);
      pole.castShadow = true;
      this.scene.add(pole);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.9, 0.06),
        new THREE.MeshStandardMaterial({ color: winningColor, roughness: 0.5 }),
      );
      // Start the flag low on the pole, rises over time.
      flag.position.set(0.7, baseY + 0.1, 0);
      flag.castShadow = true;
      this.scene.add(flag);
      this.particles.push({
        mesh: flag, kind: "flag-rise", life: 0, maxLife: 2.2,
        startY: baseY + 0.1, endY: baseY + 3.5, removeWith: pole,
      });
    } else if (c.winStyle === "voxel-rain") {
      // D — Voxel: cubes rain down in winning color + final stamp
      const r = (winningColor >> 16) & 0xff, g = (winningColor >> 8) & 0xff, b = winningColor & 0xff;
      for (let i = 0; i < 30; i++) {
        const cx = (Math.random() - 0.5) * ARENA_RADIUS * 1.5;
        const cz = (Math.random() - 0.5) * ARENA_RADIUS * 1.5;
        const sz = 0.3 + Math.random() * 0.4;
        const variantColor = i % 4 === 0
          ? new THREE.Color(winningColor).multiplyScalar(0.7).getHex()
          : winningColor;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(sz, sz, sz),
          new THREE.MeshLambertMaterial({ color: variantColor }),
        );
        m.position.set(cx, 8 + Math.random() * 4, cz);
        m.castShadow = true;
        this.scene.add(m);
        const fallDelay = Math.random() * 0.8;
        this.particles.push({
          mesh: m, kind: "win-rain", life: -fallDelay, maxLife: 2.5,
          vel: new THREE.Vector3(0, -3 - Math.random() * 2, 0),
          rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
          gravity: -10, bounceY: 0.3, hasBounced: 0,
        });
      }
    }
  }

  _spawn3DFirework(winningColor) {
    const cx = (Math.random() - 0.5) * 6;
    const cy = 4 + Math.random() * 2;
    const cz = (Math.random() - 0.5) * 6;
    const colors = [winningColor, 0xFFE8A0, 0xFFFFFF];
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
      const elev = (Math.random() - 0.3) * Math.PI;
      const speed = 3 + Math.random() * 1.5;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.12),
        new THREE.MeshBasicMaterial({
          color: colors[Math.floor(Math.random() * colors.length)],
          transparent: true, opacity: 1,
        }),
      );
      m.position.set(cx, cy, cz);
      this.scene.add(m);
      this.particles.push({
        mesh: m, kind: "firework", life: 0, maxLife: 1.0,
        vel: new THREE.Vector3(
          Math.cos(ang) * Math.cos(elev) * speed,
          Math.sin(elev) * speed,
          Math.sin(ang) * Math.cos(elev) * speed,
        ),
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        gravity: -3,
      });
    }
  }

  reset() {
    for (const p of this.particles) {
      if (p.mesh) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    }
    this.particles = [];
    this.flashes = [];
    for (const sw of this.shockwaves) {
      if (sw.mesh) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
      }
    }
    this.shockwaves = [];
    for (const w of this.stampWaves) {
      if (w.mesh) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mesh.material.dispose();
      }
    }
    this.stampWaves = [];
    if (this._winMarkers) {
      for (const m of this._winMarkers) {
        this.scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
      this._winMarkers = [];
    }
    for (const ch of this.characters) {
      ch.group.visible = true;
      ch.group.scale.set(1, 1, 1);
      ch.group.position.x = Math.cos(ch.spawnAngle) * ch.spawnRadius;
      ch.group.position.y = ch.baseY || 0;
      ch.group.position.z = Math.sin(ch.spawnAngle) * ch.spawnRadius;
      if (ch.respawnTimeout) clearTimeout(ch.respawnTimeout);
    }
    this._buildTerritoryGrid();
    this._renderTerritory();
    this._countdownIntense = false;
    this.overlay.setCountdown(900, false);
  }

  // -- Frame loop --------------------------------------------------------
  _loop() {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // Idle bob
    for (const ch of this.characters) {
      if (!ch.group.visible) continue;
      const bob = Math.sin(t * 4 + ch.bobOffset) * 0.04;
      ch.head.position.y = 1.3 + bob;
      ch.body.position.y = 0.5 + bob * 0.3;
    }

    // Slow camera orbit (showcase rotation)
    const orbit = t * 0.12;
    const camDist = 22, camHeight = 14;
    this.camera.position.x = Math.sin(orbit) * camDist;
    this.camera.position.z = Math.cos(orbit) * camDist;
    this.camera.position.y = camHeight;
    this.camera.lookAt(0, 1, 0);

    // Animate water shader (Direction E)
    if (this._waterMat) {
      this._waterMat.uniforms.uTime.value = t;
    }

    // Animate motes
    if (this.motes) {
      const pos = this.motes.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += Math.sin(t * 0.5 + i) * 0.002;
      }
      pos.needsUpdate = true;
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;

      // delayed spawn (used by win-rain)
      if (p.life < 0) continue;

      const k = p.life / p.maxLife;

      if (p.kind === "respawn-scale") {
        const s = Math.min(1, k * 1.1);
        p.respawnTarget.group.scale.set(s, s, s);
        if (p.life >= p.maxLife) {
          p.respawnTarget.group.scale.set(1, 1, 1);
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "respawn-scale-soft") {
        // C — soft scaling with overshoot
        const ease = k < 0.7 ? k / 0.7 : 1 - (k - 0.7) / 0.3 * 0.1 + 0.1;
        const s = Math.min(1.05, ease);
        p.respawnTarget.group.scale.set(s, s, s);
        if (p.life >= p.maxLife) {
          p.respawnTarget.group.scale.set(1, 1, 1);
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "respawn-build") {
        // D — rises from below ground
        p.respawnTarget.group.position.y = p.startY + (p.endY - p.startY) * Math.min(1, k);
        if (p.life >= p.maxLife) {
          p.respawnTarget.group.position.y = p.endY;
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "scanline") {
        // B — scanline sweeps up
        p.mesh.position.y = p.startY + (p.endY - p.startY) * k;
        p.mesh.material.opacity = 0.9 * (1 - k);
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "ink-drop") {
        // C — ink drop spreads with fade
        const s = 0.5 + k * 2;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = 0.7 * (1 - k);
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "splat") {
        // C — claim ink splotches (slow fade only)
        p.mesh.material.opacity = 0.7 * (1 - k * 0.6);
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "ray") {
        // A — claim sun-rays expanding outward + fading
        const expand = k * 1.5;
        p.mesh.position.x = p.startX + p.dirX * expand;
        p.mesh.position.z = p.startZ + p.dirZ * expand;
        const sy = 1 + k * 1.5;
        p.mesh.scale.set(1, sy, 1);
        p.mesh.material.opacity = 0.85 * (1 - k);
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "implode") {
        // B — particles converge to center
        p.mesh.position.lerpVectors(p.startPos, p.target, k);
        p.mesh.scale.setScalar(1 - k * 0.7);
        p.mesh.material.opacity = 1 - k * 0.9;
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "petal") {
        // C — petals float up with horizontal wobble
        const wob = Math.sin(t * 3 + p.wobblePhase) * 0.4;
        p.vel.y += p.gravity * dt;
        p.mesh.position.x += (p.vel.x + wob * 0.3) * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += (p.vel.z + wob * 0.3) * dt;
        p.mesh.rotation.x += p.rotVel.x * dt;
        p.mesh.rotation.z += p.rotVel.z * dt;
        const fadeStart = p.maxLife * 0.4;
        if (p.life > fadeStart) {
          p.mesh.material.opacity = 0.9 * (1 - (p.life - fadeStart) / (p.maxLife - fadeStart));
        }
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "puff") {
        p.vel.y += p.gravity * dt;
        p.mesh.position.x += p.vel.x * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += p.vel.z * dt;
        if (p.rotVel) {
          p.mesh.rotation.x += p.rotVel.x * dt;
          p.mesh.rotation.y += p.rotVel.y * dt;
          p.mesh.rotation.z += p.rotVel.z * dt;
        }
        p.mesh.material.opacity = 0.9 * (1 - k);
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "beam") {
        // A — sunrise beam fades and slowly shrinks
        p.mesh.material.opacity = 0.5 * (1 - k);
        const sx = 1.4 * (1 - k * 0.4);
        p.mesh.scale.set(sx, 1, 1);
        // Rotate slowly to face camera
        p.mesh.rotation.y += dt * 1.5;
        if (p.life >= p.maxLife) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          this.particles.splice(i, 1);
        }
        continue;
      }

      if (p.kind === "flag-rise") {
        // E — flag climbs the pole with ease-out + a small breeze-wobble
        const ease = 1 - Math.pow(1 - Math.min(1, k * 1.1), 3); // ease-out cubic
        p.mesh.position.y = p.startY + (p.endY - p.startY) * ease;
        p.mesh.rotation.z = Math.sin(p.life * 6) * 0.04;
        if (p.life >= p.maxLife) {
          // Leave the flag + pole in the scene as a permanent victory marker
          // (a Reset clears them via stampWaves... actually they're in particles, will be removed).
          // Convert them to "permanent" by removing from particles array but keeping in scene.
          this.particles.splice(i, 1);
          // Mark them so reset() can find and dispose them.
          if (!this._winMarkers) this._winMarkers = [];
          this._winMarkers.push(p.mesh);
          if (p.removeWith) this._winMarkers.push(p.removeWith);
        }
        continue;
      }

      // Default physics-based particle (confetti, voxel, scatter, firework, win-rain)
      // Bounce floor sits on the playable surface, which is the island top
      // for water-based directions (E, F). For non-island directions it
      // stays at Y=0.1 to preserve original A/B/C/D behavior.
      p.vel.y += p.gravity * dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      const floorY = (this._islandTopY || 0) + 0.1;
      if (p.mesh.position.y < floorY) {
        p.mesh.position.y = floorY;
        if (p.bounceY != null) {
          p.vel.y *= -p.bounceY;
          p.vel.x *= 0.55; p.vel.z *= 0.55;
          p.hasBounced = (p.hasBounced || 0) + 1;
        } else {
          p.vel.y = 0;
        }
      }
      if (p.rotVel) {
        p.mesh.rotation.x += p.rotVel.x * dt;
        p.mesh.rotation.y += p.rotVel.y * dt;
        p.mesh.rotation.z += p.rotVel.z * dt;
      }
      const fadeStart = p.maxLife * 0.55;
      if (p.life > fadeStart) {
        p.mesh.material.opacity = 1 - (p.life - fadeStart) / (p.maxLife - fadeStart);
      }
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }

    // Shockwaves (expanding rings)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      const k = sw.life / sw.maxLife;
      const scaleTo = sw.scaleTo || 6;
      const s = 1 + k * scaleTo;
      sw.mesh.scale.set(s, s, 1);
      sw.mesh.material.opacity = 0.95 * (1 - k);
      if (sw.life >= sw.maxLife) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }

    // Stamp waves (D — claim FX on territory)
    for (let i = this.stampWaves.length - 1; i >= 0; i--) {
      const w = this.stampWaves[i];
      w.life += dt;
      const k = w.life / w.maxLife;
      const s = 1 + k * 8;
      w.mesh.scale.set(s, s, 1);
      w.mesh.material.opacity = 0.7 * (1 - k);
      if (w.life >= w.maxLife) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        w.mesh.material.dispose();
        this.stampWaves.splice(i, 1);
      }
    }

    // Claim flashes — re-render territory tinted
    if (this.flashes.length > 0) {
      let needsRender = false;
      for (let i = this.flashes.length - 1; i >= 0; i--) {
        const f = this.flashes[i];
        f.t += dt;
        if (f.t >= f.duration) { this.flashes.splice(i, 1); needsRender = true; continue; }
        needsRender = true;
      }
      if (needsRender) this._renderTerritoryWithFlash();
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

  _renderTerritoryWithFlash() {
    this._renderTerritory();
    if (this.flashes.length === 0) return;

    const ctx = this._territoryCtx;
    const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    const data = img.data;

    for (const f of this.flashes) {
      const k = 1 - (f.t / f.duration);
      let strength = k;
      if (f.style === "bloom") {
        strength = Math.sin((f.t / f.duration) * Math.PI);
      } else if (f.style === "stamp") {
        // Wave from entry point — distance-based ramp
        strength = k;
      } else if (f.style === "all-bloom") {
        // Win FX — spread to entire arena
        strength = Math.sin((f.t / f.duration) * Math.PI) * 0.85;
      } else if (f.style === "strobe") {
        // High-frequency flicker
        strength = (Math.sin(f.t * 60) > 0 ? 1 : 0) * k;
      }

      const fr = f.flashRGB[0], fg = f.flashRGB[1], fb = f.flashRGB[2];
      const TS = TEX_SIZE;

      if (f.style === "stamp" && f.entry) {
        // Wave: only cells within radius (k * maxRadius) from entry get flashed
        const maxR = TS * 0.7;
        const waveR = (1 - k) * maxR; // 0 -> maxR over time
        const waveBand = TS * 0.15;
        const eu = (f.entry.x / (ARENA_RADIUS * 2) + 0.5) * TS;
        const ev = (f.entry.z / (ARENA_RADIUS * 2) + 0.5) * TS;
        for (let gy = 0; gy < TS; gy++) {
          for (let gx = 0; gx < TS; gx++) {
            if (this._grid[gy * TS + gx] !== f.factionId) continue;
            const ddx = gx - eu, ddy = gy - ev;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            const bandStrength = Math.max(0, 1 - Math.abs(dist - waveR) / waveBand);
            const localStrength = bandStrength * strength;
            if (localStrength > 0.01) {
              const px = (gy * TS + gx) * 4;
              data[px] = data[px] * (1 - localStrength) + fr * localStrength;
              data[px + 1] = data[px + 1] * (1 - localStrength) + fg * localStrength;
              data[px + 2] = data[px + 2] * (1 - localStrength) + fb * localStrength;
            }
          }
        }
      } else if (f.factionId === -1) {
        // All factions
        for (let gy = 0; gy < TS; gy++) {
          for (let gx = 0; gx < TS; gx++) {
            if (this._grid[gy * TS + gx] === 0) continue;
            const px = (gy * TS + gx) * 4;
            data[px] = data[px] * (1 - strength) + fr * strength;
            data[px + 1] = data[px + 1] * (1 - strength) + fg * strength;
            data[px + 2] = data[px + 2] * (1 - strength) + fb * strength;
          }
        }
      } else {
        for (let gy = 0; gy < TS; gy++) {
          for (let gx = 0; gx < TS; gx++) {
            if (this._grid[gy * TS + gx] === f.factionId) {
              const px = (gy * TS + gx) * 4;
              data[px] = data[px] * (1 - strength) + fr * strength;
              data[px + 1] = data[px + 1] * (1 - strength) + fg * strength;
              data[px + 2] = data[px + 2] * (1 - strength) + fb * strength;
            }
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.territoryTex.needsUpdate = true;
  }
}

// ============================================================================
// Boot
// ============================================================================

function boot() {
  const refCanvas = document.getElementById("ref-current");
  if (refCanvas) new DirectionScene(refCanvas, DIRECTIONS.REF);

  for (const dir of ["A", "B", "C", "D", "E", "F"]) {
    const canvas = document.getElementById("scene-" + dir);
    if (canvas) new DirectionScene(canvas, DIRECTIONS[dir]);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
