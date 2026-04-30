# my-game — Session Notes

_Installed: 2026-04-29_

## Current Phase

Visual direction LOCKED to Direction E (Castaway Atoll). Trail outline (Tier 0 #4) dropped per Director. Execution plan ready (Section 18 of plan doc); awaiting Director slice-pick to begin execution.

## Active Threads

- **Visual Direction Plan — Round 4: Execution Plan (2026-04-30)** — Director picked E + dropped Trail outline. Built Section 18 in `docs/visual-direction-plan.md` (lines 663–920, +260 lines):
  - **18.1** — Tier 0–4 with #4 dropped (23 items remain, each with target file in `prototype/`, effort, perf cost, deps).
  - **18.2** — Per-feature breakdown of E's actual-game landing: 16 features, each with mockup source range → target file → integration notes. Key gotcha flagged: ARENA_RADIUS in mockup=10 vs game=66.89 — geometry tied to ARENA_RADIUS scales fine, but absolute-unit sizes (cliff-rock 0.5–1.0u, atoll widths) need re-scaling at game scale.
  - **18.3** — 6 execution slices (A: island look 8h, B: moments feel right 8h, C: characters alive 4h, D: HUD pass 8h, E: match-end moment 8h, F: polish optional 4h). Total core ≈ 36h matching round-3 estimate.
  - **18.4** — Conflicts with in-flight subagent a674740c (Simulation.js claim debug) flagged as low-risk — only 1 sim file touched (`faction.js` palette constant). Trail-gap fix `2f5ed2c` and BFS algo `3c6438b` verified non-conflicting.
  - **18.5** — 6 open questions for Director (drop AA item #9, wordmark rename, sailor cap variants, mobile water fallback, flag persistence, lock faction-blue palette).
  - 🟡 Director input still needed: pick a slice to begin (recommend slice A — biggest visual delta for 1-day spend).

- **Visual Direction Plan — Round 3 (2026-04-30)** — Director feedback on round 2: "at least one suggestion should be of the background as water or sea and the arena as an island." Round 3 adds Direction E — Castaway Atoll. Deliverables shipped:
  - `docs/visual-direction-plan.md` — appended Section 16 (Direction E full spec) + Section 17 (round 3 open questions). E uses procedural ShaderMaterial water (~0.4ms vertex+fragment, 80×80 plane, two summed sin waves + foam ring + sun-glitter), grass-on-sand cylindrical island (sand cylinder Y=-0.05 r1.18→1.08, grass top Y=+0.18 at r=ARENA_RADIUS), 14 cube cliff-rocks scattered around the rim, 3 distant atolls in the fog. Faction palette retuned for sea-readability (Blue desaturated cooler, Yellow boosted vs teal). Sailor cap (white cube + faction-color band) on every character. Per-direction FX: wave-ripple claim, splash kill, wash-ashore respawn, driftwood notifications, sail banner, sundial countdown, tide-rise win (3 foam-ring sweeps + faction flag rises on a wooden pole at center as a permanent victory marker + DOM seagulls).
  - `tools/companion/visual-direction.html` + `visual-direction.js` — added Direction E config, water+island builder, all per-direction FX, 5th panel as full-width row at bottom of grid. JS now ~2700 lines (added ~600 lines for E). FX matrix table extended to 5 columns.
  - `tools/companion/index.html` card updated to "Round 3" with E summary.
  - All 10 trigger buttons (claim/kill/respawn/notif/endangered/eliminated/recovered/countdown/win/reset) verified clickable + renders cleanly via Playwright (no JS errors, only favicon 404).
  - Verification screenshots saved at `docs/visual-direction-mockups/r3/`:
    - `r3-fullpage.png` — full companion page with all 5 directions
    - `r3-e-baseline-viewport.png` — E in resting state (water glittering, sailor caps, cliff-rocks, distant atoll)
    - `r3-e-kill-fx.png` — kill FX mid-flight
    - `r3-e-win-flag-up.png` — victory flag fully raised on the wooden pole at center
    - `r3-e-static-overlays.png` — sundial + 3 driftwood notifications + sail banner all visible together
  - Performance: +0.7ms over Direction D baseline. Within 16ms budget. Mobile fallback path noted (swap shader for static gradient texture, drops to ~0.2ms).
  - 🟡 Director input still needed: direction pick (now A/B/C/D/E or hybrid) + round-2 questions (audio, mobile, lore) + 6 new round-3 questions (cull or keep all 5, sea/island as a layout overlay for non-E directions, mobile water cost, faction-blue palette commit, flag persistence, cap variant strategy).
  - **Note:** my round-3 staged changes were bundled into commit `eb6a092` ("fix: leaderboard scroll wheel + max-height interaction") by a parallel session — they're in HEAD but the commit history is muddled. Future round-3 reverts would need cherry-picking those file paths only. Commits before the bundling: `2af41f7` (leaderboard wiring) and `125f5fc` (round 1+2 art).

- **Visual Direction Plan — Round 2 (2026-04-30)** — Director feedback on round 1: directions felt too similar (same trigger claim across all 4, only 2 distinct kill FX). Round 2 fixes via end-to-end visual differentiation. Deliverables shipped:
  - `docs/visual-direction-plan.md` — appended Round 2 sections 7–15: per-direction claim FX, kill FX, respawn FX, notification system spec, faction-state banner spec, countdown spec, game-win FX, distinct character/trail/minimap treatment, round-2 open questions, updated effort estimates.
  - `tools/companion/visual-direction.html` + `visual-direction.js` — fully reworked. Each scene now has 8 trigger buttons per direction (Claim, Kill, Respawn, Notify ×3, Endangered banner, Eliminated banner, Recovered banner, Countdown toggle, Game Win, Reset). New `SceneOverlay` class wraps each canvas with a DOM layer that hosts notifications, faction banners, countdown widget, and DOM win-FX (confetti / grid sweep / watercolor wash). Per-direction FX dispatch via `config.{claimFlashStyle, killBurstStyle, respawnStyle, notificationStyle, bannerStyle, countdownStyle, winStyle}` keys. ~1300 lines.
  - Companion index card updated to reflect Round 2.
  - All 40 trigger buttons (4 directions × 10 actions) verified clickable without throwing via Playwright.
  - Verification screenshots saved at `docs/visual-direction-mockups/r2/` (`r2-fullpage.png`, `r2-kill-fx-comparison.png`, `r2-win-fx-comparison.png`, `r2-claim-notif-countdown.png`).
  - Per-direction FX summary:
    - **A (Sunset)**: claim sunburst rays, kill confetti, respawn sunrise halo+beam, win 3D fireworks + DOM confetti. Cream/coral HUD, Fredoka.
    - **B (Neon)**: claim shockwave + strobe, kill implode, respawn glitch-in scanline, win 3 expanding rings + grid sweep. Dark/cyan HUD, Space Mono terminal-prefix notifications.
    - **C (Painted)**: claim ink-bleed + splotches, kill petals, respawn ink-drop bloom, win arena-wide watercolor wash. Parchment/dashed HUD, Caveat Brush.
    - **D (Voxel)**: claim stamp-wave + dust puff, kill voxel debris, respawn build-up from below + dust, win voxel rain. Dark wood HUD, Lilita One block lettering.
  - 🟡 Director input still needed on direction pick + audio + mobile + lore + title-screen direction (round 1 questions). Round 2 adds 6 new questions.

- **Visual Direction Plan — Round 1 (2026-04-30)** — Director asked for full visual analysis: prioritized add-list (kill/death/respawn FX, claim feedback, background treatment, character look) plus several art-direction options with mockups. Deliverables shipped:
  - `docs/visual-direction-plan.md` — full markdown plan: 24 prioritized items across 5 tiers, 4 art directions (A: Sunset Arcade, B: Neon Pulse, C: Painted Plains, D: Voxel Plate), comparison matrix, recommendation, 5 open questions for Director.
  - `tools/companion/visual-direction.html` + `visual-direction.js` — live mockup page rendering all 4 directions as actual Three.js scenes with the real cube character mesh, real territory texture (canvas + nearest-filter, dithered for D), real lighting model, and clickable VFX triggers (Trigger Claim / Trigger Kill on each panel). 5 WebGLRenderers (well under 16 context limit). Verified renders cleanly via Playwright; full-page screenshot at `docs/visual-direction-mockups/companion-fullpage.png`.
  - Companion nav + index card updated.
  - Recommendation: Ship Tier 0 (claim flash, kill burst, death polish, trail outline, HUD pop) regardless of direction. Primary: D (Voxel Plate) — lowest cost, lowest risk, maximum expression of box-only constraint. Safety: A (Sunset Arcade). Cosmetic mode: B (Neon Pulse).
  - 🟡 Director input needed: direction pick + audio scope + mobile target + lore for "what is the arena sitting on" + title screen direction.
  - ComfyUI not reachable from WSL session at task time (port 8000/8188 not responding); pivoted to live-WebGL mockups instead of static AI-gen images. Live scenes are arguably more useful here since the directions hinge on lighting/animation/VFX behavior, not still-frame composition.

- **Character visual design v2** — Companion page rebuilt with live interactive Three.js scenes (was 2D canvas). All 8 sections now render real BoxGeometry characters with auto-rotation and drag interaction. Shared `createCharacter(options)` function ready for game reuse. Awaiting Director approval to implement in PlayerRenderer.ts.
  - **2026-04-29 fix #1:** Resolved white-container rendering bug. Root cause: 35 individual WebGLRenderers exceeded browser limit (~16 WebGL contexts). Replaced with single shared WebGLRenderer + 2D canvas blit pattern.
  - **2026-04-29 fix #2:** Complete rendering rewrite to render-to-image approach. The blit pattern still caused context-loss errors (constant setSize 35x/frame, missing preserveDrawingBuffer). New approach: ONE WebGLRenderer renders each scene to PNG data URLs at init (24 rotation frames per scene, 16 for thumbnails), then disposes the WebGL context entirely. Result: 0 WebGL contexts at runtime, zero errors/warnings. Drag-to-rotate and auto-rotation work via pre-rendered frame cycling (setInterval + IntersectionObserver for off-screen pause). Async init with requestAnimationFrame yields between sections prevents GPU shader compilation overflow.

## Resolved Questions

- Character shape: **BOXES ONLY**. Director explicitly rejected rounded/capsule forms. Paper.io 2 / Crossy Road style.
- Box aesthetic is the permanent direction, not a placeholder.

## Open Questions

- Team mode color selection: will teams pick from the existing 8-color palette, or get dedicated team colors?
- Yellow (#FFEB3B) has low contrast on white ground. Amber (#F9A825) proposed as replacement.
- Which proportion archetype to use as default? (Chunky recommended, but Director may prefer Chibi or Squat.)

## Next Steps

- [ ] Director reviews character-design-v2.html recommendations
- [ ] Implement approved box character changes in PlayerRenderer.ts
- [ ] Add player position rendering to Minimap.ts
- [ ] Begin UI/HUD art direction pass (name entry, death screen, leaderboard styling)
