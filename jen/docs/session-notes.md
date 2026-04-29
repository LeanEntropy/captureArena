# my-game — Session Notes

_Installed: 2026-04-29_

## Current Phase

Character visual design v2: box-based characters per Director feedback.

## Active Threads

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
