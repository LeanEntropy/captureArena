# Visual Direction Plan — captureArena

_Author: Jen (Art Director). Date: 2026-04-30. **Updated 2026-04-30 — Round 3.**_

> **Companion live mockup:** `tools/companion/visual-direction.html` — five art-direction options rendered side-by-side as real Three.js scenes with the actual cube character mesh, territory texture, and proposed VFX. Open it after starting the companion server. **The mockup page is the primary deliverable; this document is the rationale.**

> **Round 3 additions:**
> - **Direction E — Castaway Atoll (NEW)**: animated cartoon water + raised grass-on-sand island with cube cliff-rocks. Sailor-cap character treatment, sundial countdown, sail-banner faction announcements, driftwood notifications, wave-ripple claim FX, water-splash kill FX, wash-ashore respawn FX, victory flag rises on a wooden pole at game end. Section 16 below.
> - All round-2 deliverables for A/B/C/D unchanged.

> **Round 2 additions** (round-1 content unchanged below in Sections 1–6):
> - Per-direction claim FX (4 distinct, not 1)
> - Per-direction kill FX (4 distinct, not 2)
> - Per-direction respawn FX (new)
> - Side-notification system spec + per-direction styling
> - Faction-state banner system (endangered / eliminated / recovered)
> - Countdown widget spec with last-minute intensification
> - Game-win FX per direction
> - Distinct character + trail + minimap treatment per direction (the "feel different" pass)
> - All 7 above are LIVE in the companion mockup with one trigger button each per direction.

---

## TL;DR

The current build has the bones of a great paper.io game and a strong gameplay loop, but visually it reads like a *programmer art* prototype:

- The arena is white, the sky is white, the HUD is white-on-white. There is no atmosphere.
- Kills, deaths, respawns, and claims happen with **zero** screen feedback. The player can't tell when they killed someone or claimed land.
- The faction palette is correct in chroma but flat in execution — same value, same saturation, no hierarchy.
- Characters are recognizable but inert: no walk cycle, no idle bob, no death/spawn animation.

**The gap from "prototype" to "eye candy" here is not detail — it's *moments*.** Paper.io clones live or die on three feedback loops:
1. **The claim moment** ("ka-ching" — area pops, score ticks)
2. **The kill moment** (juicy, screen-shaking, instant)
3. **The trail-vs-territory readability** (you can always see who owns what and where the danger is)

Everything below is ranked against those three loops.

---

## Section 1 — Prioritized Add List

Ranked by **impact ÷ effort**. Each item carries a perf-budget note. Effort scale: S (≤2 hr), M (half-day), L (1–2 days), XL (multi-day + needs approval).

### Tier 0 — Critical feedback loops (do first, in this order)

| # | Item | Effort | Perf cost | Why it matters |
|---|---|---|---|---|
| 1 | **Claim flash + scale-pop** — when a polygon is claimed, briefly flash the new territory white→faction-color over 250ms. Optionally scale the pop region from 0.95→1.0 with a small sprite burst at the trail entry point. | S | Free (one-shot uniform on the territory shader OR a brief overlay sprite). Zero per-frame cost after the flash ends. | Right now claiming is invisible; this is the core gameplay action. Without feedback, the game feels broken. |
| 2 | **Kill burst** — when a character dies, spawn a small particle burst at their position (8–12 cube fragments in faction color, scattered with gravity, lifetime ~600ms). Add a subtle screen-shake (4–6 frames) if the LOCAL player is the killer. | M | ~12 BoxGeometry instances pooled and reused. < 0.1ms/frame, zero allocations after pool init. Pool size: 60 (covers max 5 simultaneous kills). | The current "mesh disappears" reads as a bug. Need to communicate the kill happened. |
| 3 | **Death screen polish** — instead of grey text on grey overlay, flash the screen red (200ms), zoom camera in slightly on the corpse, then fade to a death card with kill attribution + respawn timer + faction territory %. | S | One DOM element animation + one camera tween. No per-frame cost. | Currently the death overlay is functional but doesn't *feel* like dying. |
| 4 | **Trail glow / outline** — render the trail with a slightly darker outline (one extra inset polygon strip, same color, 30% darker) so it pops against same-faction territory. Currently if you trail through your own faction's land, the trail nearly disappears. | S | One extra triangle strip per trail (×30 chars × ~50 verts avg = 3000 triangles). Negligible. | Critical for online play: if your trail blends into ally territory, opponents can't tell where you came from and you can't tell where allies are vulnerable. |
| 5 | **Score pop + kill counter pop** — when score increases or a kill registers, scale the relevant HUD number 1.0→1.3→1.0 over 250ms with a color flash. | S | Pure CSS keyframe. Free. | Standard juice; missing right now. |

### Tier 1 — Atmosphere / "I'm in a world" (do second)

| # | Item | Effort | Perf cost | Why it matters |
|---|---|---|---|---|
| 6 | **Replace the `#f0f0f0` background** with a dark gradient sky OR a subtle vignette-blur of out-of-arena geometry. Currently the white void around the arena is the most damaging thing in the screenshot — it breaks immersion. | S | Free (one ShaderMaterial OR CSS background on the body). | The single highest-impact visual change. |
| 7 | **Out-of-arena terrain** — instead of WebGL clear color showing through, add a wider ground plane (radius ARENA_RADIUS × 3) in a dark neutral with a soft circular gradient toward the arena. | S | One extra plane (CircleGeometry). 1 extra draw call. ~Zero ms. | Frames the play area; the arena reads as an island instead of a hole. |
| 8 | **Camera tilt + slight FOV bump** — current camera is angled-down but quite top-down. Lowering the angle 3–5° and bumping FOV from 45→55 makes characters feel more "in the world" without losing readability. | S | Free. Just constant tweaks. | Direct lift in cinematic feel. Test against minimap: as long as the player can still see the immediate trail/territory contrast, lower angle wins. |
| 9 | **Soft territory boundary anti-alias / pixel-art edge** — current boundary is binary (alphaTest cutout, fully opaque or fully transparent). Add a 1–2 px AA ring rendered as a second pass with `transparent: true, opacity: 0.5` darkened color. | M | One extra plane with the texture, alpha-blended. Adds fillrate on the boundary cells (which is most of the visible cells). Estimated cost: ~0.3ms on integrated GPU at 1920×1080. | The current jaggies from `NearestFilter` look intentional ("pixel art") but make the territory feel cheap rather than crisp. A soft outline elevates it. |
| 10 | **Subtle ambient particles inside the arena** — 30–50 floating dust motes / sparks at low opacity. Faction-tinted near territory borders to suggest ownership "pressure." | M | Single Points geometry, 50 vertices. Free. | Adds life without obscuring gameplay. Skip if the chosen art direction is "stark/minimalist." |

### Tier 2 — Character life (do third)

| # | Item | Effort | Perf cost | Why it matters |
|---|---|---|---|---|
| 11 | **Idle bob animation** — head bobs Y by ±0.05 at 2Hz, body stays still. Procedural — no rig needed. | S | Free. One sin() per character per frame. | Characters read as alive instead of figurines. |
| 12 | **Walk wobble** — when moving, body tilts forward 5° and rocks side-to-side ±3° with stride frequency tied to speed. | S | Free. Same cost as #11. | Reinforces the "marching" feel; sells direction of motion. |
| 13 | **Death dissolve** — instead of `visible = false`, scale down to 0 over 200ms with a Y-axis rotation. | S | Free. Tween on existing transforms. | Prevents the "popping" feel of instant disappearance. |
| 14 | **Respawn pop** — character scales 0→1 over 300ms with a small puff of particles. Existing invuln blink stays. | S | Particle pool already created for kill burst (#2). Free. | Spawn currently looks like a teleport-in glitch. |
| 15 | **Direction indicator on character** — a small darker stripe on the front face of the head, OR slight nose-cube. Helps the local player track which way they're facing without looking at the trail. | S | One extra small BoxGeometry per character. ×30 = 30 extra meshes. Trivial. | Boxes are hard to tell which way they face from above. The trail tells you, but only when moving. Director's box-only constraint is preserved. |

### Tier 3 — HUD pass (do fourth)

| # | Item | Effort | Perf cost | Why it matters |
|---|---|---|---|---|
| 16 | **Replace `Segoe UI` with a chunky display font** for headers (timer, score). Recommend a free font like *Bungee*, *Lilita One*, or *Fredoka*. Body text stays Segoe. | S | One Google Font import. <50KB. Free. | Current HUD reads as a debug overlay. |
| 17 | **HUD card styling** — replace `rgba(255,255,255,0.85)` grey-ish boxes with: dark navy `rgba(20,30,50,0.85)` background, white text, faction-colored left border accent, soft drop shadow. | S | Pure CSS. Free. | Immediate "AAA" elevation. The light glassmorphism look is dated; opaque dark cards read better on a colorful arena. |
| 18 | **Minimap polish** — current minimap is functional but the white border + transparent background doesn't read. Replace with: dark inner background, faction-colored 3px ring, player dot that pulses, faction icons in legend. | M | The minimap renders to its own canvas. Already cheap; styling is CSS. Free. | Minimap is one of the most-read UI elements; current treatment is the weakest. |
| 19 | **Leaderboard row hover/own-row highlight** — local player's row gets a faction-colored background highlight + bold name. Top 3 get a small medal icon or rank prefix color. | S | Pure CSS. Free. | Currently your own name doesn't stand out in the list. |
| 20 | **Title screen redesign** — "Territory War" in giant chunky font, animated faction-colored particles in background, the input field styled as a polished control. | M | The title screen renders only once; performance budget irrelevant. | First impression. Currently looks like a registration form. |

### Tier 4 — Polish & moments

| # | Item | Effort | Perf cost | Why it matters |
|---|---|---|---|---|
| 21 | **Killstreak indicator** — when local player kills 2+ enemies within 5s, flash a small banner ("DOUBLE!"). | M | Pure CSS. Free. | Gameplay reward. |
| 22 | **"Endangered faction" warning** — when a faction crosses below 10%, bottom of screen flashes their faction color briefly + a red pulse on the faction's row in HUD. | S | CSS keyframe. Free. | Tie a tutorial-y warning to existing endangered/recovery state machine. |
| 23 | **Match-end celebration** — confetti burst from winning faction's color when match ends. Currently there's just a black overlay with text. | M | One particle burst, ~200 sprites. ~1ms for ~3 seconds, then GC. Free at steady state. | The match is the climax; should feel like one. |
| 24 | **Audio (out of scope but flagging)** — claim, kill, death, respawn, killstreak, end-of-match. Even free Kenney-license SFX would 2× the perceived production value. | L | <1% CPU per active sound. | Mention to Director as separate workstream. |

### NOT recommended (rejected ideas)

- **Per-character variation / cosmetics.** Director's boxes-only constraint + 30 entities × 5 factions = 150 cosmetic states. Maintenance cost is huge. Stay tuned-faction; let player skill / kill-count earn the standout.
- **Toon shader on characters.** Cool but hits draw call count + readability hard at game scale. Procedural BoxGeometry is right.
- **Postprocessing bloom on faction colors.** Tempting, but at this faction palette saturation, bloom turns the screen into a smear. If we want glow, it goes on trails only (see direction "Neon Pulse" below).
- **Trail "wobble" / Bezier smoothing.** The trail's straight-line aesthetic is a feature: it telegraphs intent.

---

## Section 2 — Four Art Directions

Each direction is a coherent answer to: *what world is this?* The Director picks one (or a hybrid). All four respect the box-character constraint.

I built **live mockups for all four** in `tools/companion/visual-direction.html` — they render real Three.js scenes with the actual cube characters, territory texture rendering, and proposed VFX where applicable. Open that page first; this section is for the rationale.

---

### Direction A — **Sunset Arcade** (recommended starting point)

**Pitch:** Paper.io 2's friendliest cousin. Warm sky, flat saturated colors, big readable shapes. Pure arcade joy.

**Visual rules:**
- **Background:** vertical gradient sky, peach `#FFD8A8` (top) → coral `#FF8E72` (bottom).
- **Out-of-arena ground:** soft sand `#E8C49A` with a darker ring near the arena edge (`#B89060`).
- **Arena ground (unclaimed):** warm cream `#FFF6E8` (was pure white).
- **Faction palette:** keep current 5 colors but desaturate by ~10% and darken value by ~5% so they don't burn against the warm sky. (Specific hex values listed in companion mockup.)
- **Characters:** keep StandardMaterial + roughness 0.4. No outline.
- **Lighting:** ambient warmer (`0xfff0e0`, intensity 0.85), directional with golden tint (`0xffe0a0`, intensity 0.5).
- **Trail:** 12% darker than territory color, thin black 1-pixel inner outline.
- **VFX:** white-flash claim pop, cube-burst kill (faction-color shards), confetti match-end.
- **HUD:** cream cards with brown text, drop shadow, chunky font (Fredoka).

**Effort to ship:** M (half-day). Reuses everything; just retunes colors, adds backdrop, adds VFX from list.
**Perf cost vs. current:** +1 plane geometry (sky), +1 plane (sand), +particle pool. Net <0.5ms/frame.
**Best for:** "I want to ship a polished arcade game in 2 weeks."
**Risk:** Looks similar to Paper.io 2. That's a feature, not a bug.

---

### Direction B — **Neon Pulse**

**Pitch:** A vector grid in the void. The arena floats. Trails *glow*. This is your "TRON meets paper.io" mode.

**Visual rules:**
- **Background:** deep navy radial gradient — `#0A0F2C` center, fading to pure black at edges.
- **Out-of-arena ground:** none. The arena floats on a dark ocean of grid lines (1-pixel-wide cyan grid at 4u spacing, 12% opacity).
- **Arena ground (unclaimed):** dark slate `#1B2240`.
- **Faction palette:** push to neon — current colors at +25% saturation, +15% value. (Red→`#FF3B6B`, Blue→`#3B9BFF`, Green→`#5BFF6B`, Yellow→`#FFE03B`, Purple→`#C24BFF`.)
- **Characters:** add a 5% emissive of the faction color via `MeshStandardMaterial.emissive`. No bloom.
- **Lighting:** ambient cool (`0x4060a0`, intensity 0.6), directional pale (`0xb0c8ff`, intensity 0.5). Slight rim from a second weak directional opposite the main.
- **Trail:** rendered as **2 stacked planes** — outer plane at 60% opacity, +0.25u wider, faction-color (fakes a glow without bloom). Inner plane at 100% opacity. Net cost: 2 draw calls per trail instead of 1.
- **VFX:** trail "energy crackle" — small white flickers along the trail every ~5 segments. Claim flash is a bright cyan burst before the territory pops. Kill is a faction-colored implosion (cubes scaling DOWN to a point and vanishing).
- **HUD:** dark glass cards (`rgba(15,20,40,0.85)`), neon faction-colored left border, monospace font (`JetBrains Mono` or `Space Mono`).

**Effort to ship:** L (1–2 days). Trail-glow needs a custom material; emissive integration; grid background shader.
**Perf cost vs. current:** +1 grid-shader plane (cheap fragment), +1 trail plane per character (×30 = 30 extra draw calls), +emissive in standard material (free). Estimated: +0.8ms/frame. The fillrate of the trail-glow plane on a 1920×1080 screen is the main concern.
**Best for:** "I want the game to feel like a club. Streamer bait."
**Risk:** Saturated colors on dark backgrounds reduce per-faction distinction at a glance — yellow and green look very similar in neon mode. Mitigation: bake unique micro-pattern into territory texture per faction (see Direction D), but only if combining.

---

### Direction C — **Painted Plains**

**Pitch:** A storybook map. The arena is a hand-painted island. Ghibli-meets-Threes! comfort food.

**Visual rules:**
- **Background:** soft watercolor sky — pale teal `#B8DCD8` to lavender `#D4C4E8`.
- **Out-of-arena ground:** painted sea `#7BA8C4` with subtle wave-line texture (procedural fragment shader, very low frequency).
- **Arena ground (unclaimed):** parchment `#F4ECD8` with a faint paper-grain noise (8-bit noise texture overlay at 5% opacity).
- **Faction palette:** reduce current saturation by 25%; the colors become muted gouache tones. (Red→`#D45A4F`, Blue→`#5078A8`, Green→`#7BAB5C`, Yellow→`#E0C75A`, Purple→`#9168A8`.)
- **Characters:** roughness 0.6 (slightly more matte). Add a thin 1px black "ink line" outline using a back-face-culled inverted-hull pass. Cost: 2× character draw calls (60 → still trivial).
- **Lighting:** ambient (`0xfff5e8`, intensity 0.9), directional warm soft (`0xffeec0`, intensity 0.4). Shadow softness up.
- **Trail:** wider (1.0u instead of 0.8u), translucent, with a darker outline (same as Direction A).
- **VFX:** claim is a watercolor "bloom" — territory color radiates outward over 400ms with a slight wobble, instead of a hard flash. Kill is a small white-petal scatter instead of cube fragments. Subtle floating leaves/butterflies as ambient particles.
- **HUD:** parchment cards, dark brown text, hand-lettered display font (`Caveat Brush` or `Patrick Hand`).

**Effort to ship:** L (1–2 days). Inverted-hull outlines, watercolor-bloom shader, paper-grain texture, palette retune.
**Perf cost vs. current:** +30 extra character draw calls (outline pass), +paper-grain alpha overlay plane (negligible). Estimated: +0.5ms/frame.
**Best for:** "I want this to feel cozy. Mobile-first vibe. Wide audience appeal."
**Risk:** Outlines on cubes can look messy at oblique angles unless the inverted-hull thickness is well-tuned. Test at gameplay distance.

---

### Direction D — **Voxel Plate** (Crossy Road / Townscaper energy)

**Pitch:** Lean *all the way* into the cubes. The world is voxels. The territory is grass and dirt. The arena is a tabletop diorama.

**Visual rules:**
- **Background:** soft pale blue sky `#A8D0E8`. Subtle clouds (offset noise).
- **Out-of-arena ground:** **the arena sits ON a tabletop.** A larger plate (square, 200×200) of dark wood `#5C3F2A` extends beyond the arena. The arena radius is "carved" from the wood as a circular cutout.
- **Arena ground (unclaimed):** light grass `#A8C854` with low-frequency noise dither (per-cell value ±5%).
- **Faction territory:** instead of solid color, each faction's territory has a subtle 2-tone dither — `colorA` and `colorB` (10% darker) in a checkerboard at the grid-cell level. This makes territory feel like *terrain* rather than paint. **Bonus: this is the answer to the readability concern in Direction B.** Different dither patterns per faction ID for accessibility.
- **Faction palette:** keep current saturation; punch up value by 5% so the light grass doesn't make them look dim. The dither does the rest of the work.
- **Characters:** unchanged (already perfect for this direction). Maybe slight roughness bump to 0.5.
- **Lighting:** ambient (`0xeef4ff`, intensity 0.7), directional cool sun (`0xffffff`, intensity 0.7), slight warm bounce (`0xffd0a0`, intensity 0.2). Crossy Road's lighting cookbook.
- **Trail:** keep simple, slightly raised Y from current. Solid faction color, 0.6u wide. Direction-of-travel arrow chevrons every 8u? (optional).
- **VFX:** kill spawns 8 *cube fragments* (proper voxel debris), they bounce on the ground twice with tiny rotations and dissolve. Claim plays a "stamping" animation: territory color rolls across the new region from the trail entry point in a wave (1u/30ms).
- **HUD:** clean white cards with subtle thick black borders (Crossy-style), bold display font (`Lilita One`).

**Effort to ship:** L (1–2 days). Dither pattern in territory texture (cheap — modify the existing `_updateTerritoryTexture` loop), voxel-burst particle pool, wood-grain plate plane, "stamping wave" claim shader.
**Perf cost vs. current:** +1 plate plane, +1 cloud noise plane, dither computed in existing texture-write loop (no extra cost — just change which RGB you write per cell). Estimated: +0.3ms/frame. **This is the cheapest of the four to ship without losing fidelity.**
**Best for:** "I want this to feel like a *toy*. Tactile. The Director's box-aesthetic ratified maximally."
**Risk:** Lowest. This is the most "natural" extension of where the art already is.

---

## Section 3 — Comparison Matrix

| Criterion | A: Sunset Arcade | B: Neon Pulse | C: Painted Plains | D: Voxel Plate |
|---|---|---|---|---|
| Faction readability at game scale | Excellent | Risky (mitigated by dither) | Good | Excellent |
| Implementation effort | M | L | L | L |
| Perf cost vs. current | +0.5ms | +0.8ms | +0.5ms | +0.3ms |
| "Authored feel" (ETHOS principle 6) | Good | Strong | Strongest | Strong |
| Maintenance cost (consistency for new content) | Low | Medium | Medium | Low |
| Streamer / TikTok appeal | Medium | High | Low | Medium |
| Mobile-first appeal | High | Medium | High | High |
| Originality (vs. obvious paper.io clones) | Low | High | High | Medium-High |
| Aligns with Director's box-only constraint | Yes | Yes | Yes (with care on outlines) | **Best fit** |
| Risk of going wrong | Low | Medium-High | Medium | Lowest |

---

## Section 4 — Jen's Recommendation

**Ship Tier 0 (#1–#5) immediately, regardless of art direction.** They are universally needed and direction-neutral. They alone will make the game *feel* 3× better.

**For art direction: D (Voxel Plate) primary, A (Sunset Arcade) as the safe secondary.** Reasoning:
- Voxel Plate is the maximum expression of the Director's already-locked box constraint.
- It has the lowest perf cost and lowest risk of the four.
- It introduces faction-distinguishing territory texture (the dither) which solves a future readability problem regardless of palette tuning.
- It has the strongest "tabletop diorama" identity — there are very few paper.io clones that look like this.

**If the Director wants more energy: B (Neon Pulse) as a cosmetic mode.** Build D as the base; keep B as a "Neon Mode" toggle for streaming/marketing. The trail-glow tech from B can be unlocked for the local player only as a "look at me" cosmetic in a future patch.

**C (Painted Plains)** is artistically the most distinctive but has the highest tuning cost. Reserve it for if the team wants to differentiate hard from competitors and is willing to spend an extra week on outline tuning.

---

## Section 5 — Implementation Notes

### Tools / libraries needed
- **Three.js** (already in use, 0.170). All proposed VFX use only built-ins: `BufferGeometry`, `Points`, `ShaderMaterial`, `MeshStandardMaterial`, `MeshBasicMaterial`.
- **No postprocessing required.** I am explicitly recommending against `EffectComposer` + `UnrealBloomPass`. Bloom on saturated faction colors at this fillrate will destroy mobile perf and blur the readability that the gameplay needs.
- **Particles:** plain `Points` geometry with a custom material (`PointsMaterial` or shader). Pool of 60 max simultaneous bursts.
- **Tweens:** roll a tiny tweener (10 lines) or use the `tween.js` library if a tween-heavy direction is picked. Most of the proposed VFX are single-shot enough that hand-rolled `requestAnimationFrame` accumulators work fine.
- **Fonts:** Google Fonts (Fredoka, Lilita One, Caveat Brush). One `<link>` tag in `index.html`. ~50KB.
- **Audio (future):** Howler.js or native HTMLAudioElement pool. Out of scope for this pass.

### Architecture-level changes
- **`Game._createParticlePool()`** — add a class-level shared pool of 60 small BoxGeometry meshes for kill bursts. Reuse on each kill.
- **`Game._spawnClaimFlash(polygon)`** — paints the new territory white in the canvas texture for one frame, then transitions to faction color over 250ms by re-uploading the texture. Costs one extra `_updateTerritoryTexture` call per claim, which we already throttle to 10Hz.
- **`Game._spawnKillBurst(x, z, factionId)`** — pulls 8–12 boxes from the pool, sets positions, gives velocities, animates them in `update(dt)`.
- **`Character._updateAnim(dt)`** — handles idle bob and walk wobble. Pure procedural sin/cos on `head.position.y`, `body.rotation.x/z`. Zero allocations.
- **`scene.fog = new THREE.Fog(skyColor, 80, 200)`** for directions A/D — fades out-of-arena ground softly. Free.

### Files to modify
- `prototype/main.js` — `_buildChar`, `_createTerritoryTexture`, `Game.constructor` (lighting + sky), `Game.update` (animation hooks).
- `prototype/index.html` — font import, HUD CSS, name-entry redesign, death-screen redesign.
- `prototype/sim/faction.js` — palette retune (per chosen direction).
- `prototype/sim/constants.js` — possibly `TRAIL_WIDTH` (move from main.js to here, retune per direction).

### Estimated total ship time per direction
| Direction | Tier 0 | Direction-specific work | Total |
|---|---|---|---|
| A: Sunset Arcade | 1 day | 1 day | **~2 days** |
| B: Neon Pulse | 1 day | 2 days (custom shaders) | **~3 days** |
| C: Painted Plains | 1 day | 2 days (outlines + watercolor) | **~3 days** |
| D: Voxel Plate | 1 day | 1.5 days (dither + cube debris + plate) | **~2.5 days** |

---

## Section 6 — Open Questions for Director

1. **Pick a primary art direction** (A / B / C / D / hybrid). My recommendation is D primary, A safety. Locked answer needed before I retune the faction palette.
2. **Audio in scope this pass?** If yes, I'll spec a sound list. If no, I'll note it as the next workstream.
3. **Mobile target?** Some Tier-1 effects (heavy particles, fog) need to be conditional on `devicePixelRatio` or a quality toggle if the game ships on mobile.
4. **Background world content?** D proposes a wooden tabletop. Does the game's lore/setting suggest a different "what is this arena sitting on" answer (e.g., a giant board game, a holographic projector, a piece of paper)?
5. **Title screen completely replaceable, or keep "Territory War" wordmark?** Either way I can mock it up.

---

_Companion live mockup → `tools/companion/visual-direction.html`._
_Status: 🟡 Director input needed on direction pick + open questions above._

---

# Round 2 — Per-Direction Differentiation

_Director feedback (2026-04-30): "You only give 4 background/atmosphere theme options. The trigger claim is identical in all 4 options, and there are only 2 different trigger kill. Suggest bigger changes between the themes. Suggest different claim FX and kill FX. Suggest how to show notifications on the side of events... Suggest player's own respawn FX. Suggest announcements like 'Team in 10% (no more respawns)', 'team eliminated', 'Team bounced back'... Suggest how to handle the countdown visually."_

The fix below replaces "different background, same FX" with **end-to-end visual identity per direction**. Same gameplay event reads differently in each direction at every layer: in-world FX, particles, character treatment, trails, HUD, notifications, banners, countdown, and win celebration.

All 7 features below are **live in the mockup page** — click the per-direction trigger buttons to preview each one.

---

## Section 7 — Per-Direction Claim FX

The claim moment is the core gameplay payoff. Each direction now has its own.

| Direction | Style key | Visual | Duration | Tech | Perf cost |
|---|---|---|---|---|---|
| **A — Sunset Arcade** | `sunburst` | 8 light-yellow rays radiate from the trail entry point, expanding outward over 0.4s. Territory itself flashes cream → faction-color over the same window. Friendly, "ka-ching" feel. | 0.4s | 8 PlaneGeometry rays, alpha-blended, animated outward. Territory flash via existing texture re-tint. | ~0.05ms/frame during flash, free at rest. |
| **B — Neon Pulse** | `shockwave` | A bright cyan ring expands from the entry point and disappears at the territory edge. Simultaneously the territory cells *strobe* (60 Hz) between faction color and cyan for 0.28s. Sharp, electric. | 0.28s | 1 RingGeometry mesh + texture re-tint with strobe modulation. | ~0.1ms/frame during flash. |
| **C — Painted Plains** | `ink-bleed` | Slow watercolor "bloom" on the territory (ramp up, then fade — sin curve, 0.7s). 5 small dark ink-splat cubes land near the entry point and slowly fade. Soft, organic. | 0.7s | Texture flash with sin-modulated strength + 5 BoxGeometry splats. | ~0.05ms/frame during flash. |
| **D — Voxel Plate** | `stamp-wave` | A circular wave radiates from the trail entry across the *faction's territory* — only cells inside a moving radius band light up white, like a stamp impact rippling out. Plus a vertical dust-puff (6 small white cubes) at the entry. | 0.45s | Distance-from-entry computed in territory tint loop (cheap) + 1 RingGeometry stamp + 6 BoxGeometry puffs. | ~0.15ms/frame (band math costs slightly more); free at rest. |

**Implementation notes for the real game:**
- All four use the same `_renderTerritoryWithFlash()` hook in `Game.update`. Style is dispatched on `config.claimFlashStyle`.
- Particles (rays, splats, puffs) come from a shared pool of 32 small BoxGeometry / PlaneGeometry meshes. Reused across kill, claim, and respawn FX.
- The stamp-wave (D) does the most work in the texture re-tint loop; throttle the per-claim re-tint at 30 Hz (game already throttles at 10 Hz, fine to bump for the 0.45s window).

---

## Section 8 — Per-Direction Kill FX

| Direction | Style key | Visual | Duration | Particle count | Cost |
|---|---|---|---|---|---|
| **A — Sunset Arcade** | `confetti` | 14 thin rectangular shards (0.12 × 0.03 × 0.18u), mixed colors (faction + cream + coral + white), launched in a dome with gravity. Reads as "celebration of the kill." | 1.4s | 14 PlaneGeometry shards | Pool, ~0.1ms |
| **B — Neon Pulse** | `implode` | 14 cube particles spawn on a ring around the corpse and *converge* to the death point, scaling to 0 with opacity fadeout. White shockwave ring expands from impact. Reads as "particles being sucked in." | 0.65s | 14 BoxGeometry + 1 RingGeometry | Pool, ~0.1ms |
| **C — Painted Plains** | `petals` | 14 white square "petals" (PlaneGeometry, double-sided) float upward with a horizontal sin-wobble. Slow gravity (-0.6) so they linger. Reads as "soul leaving the body." | 1.6s | 14 PlaneGeometry petals | Pool, ~0.1ms |
| **D — Voxel Plate** | `voxel-debris` | 12 cube fragments (mixed sizes, 30% darker variants) launched up & out with proper gravity (-10) and rotation. Bounce on the ground (Y velocity × 0.3 reflection) before fading. Reads as "the player shattered into voxels." | 1.2s | 12 BoxGeometry with shadows | Pool, ~0.15ms (shadows) |

**Killer screen-shake** (Tier 0, applies to all directions): 4–6 frame shake on the camera when the *local* player is the killer. Magnitude 0.05u, frequency 30 Hz, exponential decay. ~free.

---

## Section 9 — Per-Direction Respawn FX (player's own)

When the local player respawns at their faction spawn point, the moment should feel like a *return*. Brief invuln signal (Tier 0 #14 already covered the puff — round 2 makes it direction-specific).

| Direction | Style key | Sequence | Duration | Tech |
|---|---|---|---|---|
| **A — Sunset Arcade** | `sunrise` | (0–0.2s) Golden halo ring expands from spawn point on the ground. (0.1–0.6s) Vertical light beam (warm cream) fades in then out, slowly rotating. (0–0.5s) Character scales 0.01 → 1.0 with slight Y-only stretch. | 0.7s total | 1 RingGeometry + 1 PlaneGeometry beam + scale tween |
| **B — Neon Pulse** | `glitch-in` | (0–0.55s) Bright cyan scanline plane sweeps from ground up to character height. Character flickers visible 3 times (120ms / 280ms / 440ms) then locks visible. Reads as "digital reconstruction." | 0.55s | 1 PlaneGeometry scanline + 3 timed `visible` toggles |
| **C — Painted Plains** | `page-turn` | (0–0.7s) Faction-colored ink drop spreads on the ground (CircleGeometry, scale 0.5 → 2.5, opacity 0.7 → 0). Character "blooms" with soft scale-up + tiny overshoot (0 → 1.05 → 1) over 0.6s. | 0.7s | 1 CircleGeometry ink-drop + ease-overshoot scale |
| **D — Voxel Plate** | `build-up` | (0–0.5s) Character starts at Y = -1.5 (below ground), rises linearly to Y = 0. 5 white dust-puff cubes pop out at ground level on appearance. Reads as "block teleported in from the world below" — Minecraft-y. | 0.5s | Y-tween + 5 dust BoxGeometry puffs |

**Invuln blink** (universal, Tier 0): During 2 seconds after respawn, the character's body opacity oscillates 0.4 ↔ 1.0 at 6 Hz. Already in the existing client; the FX above runs *on top* of that.

---

## Section 10 — Side Notification System

A toast stack on the right edge of the screen, near the top. Notifies the local player of events involving them: kills they made, captures they completed, deaths they suffered.

### Universal behavior

| Property | Value | Rationale |
|---|---|---|
| Position | Top-right of game viewport, 10px inset | Doesn't overlap with the timer top-left or minimap top-right (note: minimap moves to bottom-right per Tier 3). |
| Stack max | 4 visible | More than 4 = visual noise that competes with gameplay. |
| Auto-dismiss | 3 seconds after spawn | Long enough to read at-a-glance, short enough not to linger. |
| Spawn animation | Slide in from right (20px), fade in over 0.2s | Subtle, doesn't pull eye from arena. |
| Despawn animation | Fade + slide right over 0.2s | Same path, reversed. |
| Faction tint | Left border or accent in the relevant faction's color | Color-codes who/what the notification is about at a glance. |
| Click-through | `pointer-events: none` on the entire stack | Notifications never block input. |
| Truncation | `max-width: 180px`, word-wrap. | Prevents long names from spilling. |

### Notification kinds and example text

| Kind | Trigger | Text format | Faction tint |
|---|---|---|---|
| `kill` | Local player kills another character | "You killed [Name]" | Killed player's faction color |
| `capture` | Local player completes a claim ≥ 5% of an enemy faction's territory | "You captured 8% of Red" | Affected faction's color |
| `death` | Local player dies | "You died" | None / red border |
| `respawn` | Local player respawns | "You spawned (invuln 2s)" | Local player's faction color |
| `streak` | Local player kills 2+ within 5s | "DOUBLE!" / "TRIPLE!" | Local color, brighter |

### Per-direction styling

| Direction | Style key | Visual | Font |
|---|---|---|---|
| **A — Sunset Arcade** | `card-warm` | Cream BG (rgba 255,246,232,0.95), brown text, faction-colored 4px left border, subtle drop shadow. | Fredoka 500 |
| **B — Neon Pulse** | `terminal` | Dark navy BG (rgba 10,15,40,0.92), faction-colored text with neon glow (text-shadow), monospace, "&gt; " prefix to read like terminal output. | Space Mono 400 |
| **C — Painted Plains** | `parchment` | Parchment cream BG, brown text, dashed faction-colored left border, slightly italic. | Caveat Brush, 14px |
| **D — Voxel Plate** | `wooden-tag` | Dark wood BG (#5C3F2A), cream text, 5px solid faction-color left edge, inset bottom shadow + drop shadow (faked depth). | Lilita One 400 |

---

## Section 11 — Faction-State Announcements (Banners)

Server-driven center-screen banners for major faction state transitions. Bigger than per-player notifications — these affect the whole match.

### Universal behavior

| Property | Value |
|---|---|
| Position | Center of game viewport, behind UI but above arena |
| Visibility | One at a time. New banner replaces existing. |
| Spawn animation | Scale 0.6 → 1.0 with cubic-bezier overshoot (0.34, 1.56, 0.64, 1), opacity 0 → 1 over 0.25s |
| Despawn | Scale 1.0 → 0.85, opacity → 0 over 0.25s |
| Default duration | 2.0s (regular) / 2.8s (eliminated) / 3.5s (game win) |
| Click-through | `pointer-events: none` |
| Audio cue (future) | Distinct stinger per kind; for now, just visual |

### Banner kinds

| Kind | Trigger | Text | Color treatment |
|---|---|---|---|
| `endangered` | Faction crosses below 10% territory (no more respawns until recovered) | "[FACTION] ENDANGERED · NO RESPAWNS" | Faction color border |
| `eliminated` | Faction reaches 0% — final | "[FACTION] ELIMINATED" | Faction color, fade to grey |
| `recovered` | Endangered faction climbs back above 12% | "[FACTION] RECOVERED · RESPAWNS BACK" | Faction color, brighter glow |
| `win` | Match ends | "[FACTION] WINS" | Winning color, full glow |

### Per-direction styling

| Direction | Style key | Visual |
|---|---|---|
| **A — Sunset Arcade** | `warm-banner` | Cream parchment with rounded 8px border, 3px solid faction-color border, soft drop shadow. Friendly arcade title-card. |
| **B — Neon Pulse** | `neon-stripe` | Sharp horizontal cyber stripe — rectangular, no border-radius, faction-colored 2px borders top + bottom, monospace, glowing text-shadow, 3px letter-spacing. |
| **C — Painted Plains** | `scroll` | Asymmetric border-radius (20px 4px 20px 4px) with parchment fill, italic text, inner glow + drop shadow. Reads as a rolled scroll. |
| **D — Voxel Plate** | `stamp` | Solid faction-color BG with 3px dark border + inset bottom shadow + 4px drop shadow (faked physical depth). Lilita One block lettering. Reads as a wooden stamp slammed onto the table. |

### "Eliminated" extra treatment (universal)

When a faction is eliminated:
1. Banner shows for 2.8s.
2. Their territory texture fades to grey (desaturate over 1.5s) — this is a one-time gameplay-affecting visual change, lives forever after.
3. Their characters disappear with a single direction-appropriate kill FX (one per still-alive character, rate-limited to 2/sec to avoid frame-rate cliff).

### "Endangered" + "Recovered" — screen-edge tells

In addition to the banner:
- **Endangered (your team):** local player's faction-color pulses on the LEFT edge of the screen at low frequency (1 Hz, 30% opacity) until recovered. Subtle but constant — "your team is in trouble."
- **Endangered (enemy team):** that faction's row in the leaderboard pulses red border at 2 Hz. No screen-edge tell (would be too noisy).

---

## Section 12 — Countdown Widget

Top-left match timer (15:00 → 0:00). Currently plain `Segoe UI` text. Round 2 design:

### States

| State | When | Behavior |
|---|---|---|
| **Normal** | 15:00 → 1:01 | Direction-appropriate styling, static. |
| **Warning** | 1:00 → 0:11 | Same styling, but text color shifts to faction `accent`, subtle pulse animation (1.05× scale at 1 Hz). |
| **Critical** | 0:10 → 0:00 | Full intensified styling: bigger font, stronger color, faster pulse (0.6s loop, 1.08× scale). |
| **Match-end freeze** | 0:00 hit | Countdown text frozen at "0:00" for 0.5s with a flash, then game-win banner takes over (countdown stays as static "0:00" element). |

### Per-direction styling

| Direction | Style key | Normal | Critical |
|---|---|---|---|
| **A — Sunset Arcade** | `chunky-warm` | Cream card, brown 18px text, 2px coral border, soft shadow. Fredoka. | 22px text, full coral color, drop shadow stronger. |
| **B — Neon Pulse** | `monospace-pulse` | Dark navy card, cyan 16px text, cyan border, 2px letter-spacing, neon text-shadow. Space Mono. | 22px, brighter cyan, 0.6s pulse loop. |
| **C — Painted Plains** | `hand-lettered` | Parchment card, dashed border, brown 20px text. Caveat Brush. | 26px, slight wobble. |
| **D — Voxel Plate** | `blocky-flip` | Dark wood card, yellow 18px Lilita One text, 2px dark border, inset shadow. | 22px, darker accent, faster pulse. |

The mockup shows this with the **Countdown** trigger button — first click drops the timer to 0:09 in critical mode, then ticks down. Second click resets to 15:00.

---

## Section 13 — Game-Win FX

When the match ends, the winning faction's victory should play out as a 3–5 second "moment" before the end-screen modal. Two layers per direction:

1. **WebGL layer** — in-world FX in the arena
2. **DOM layer** — overlay FX on top of the canvas (DOM-rendered, scales independently of the WebGL frame budget)

| Direction | Style key | WebGL FX | DOM FX | Total duration |
|---|---|---|---|---|
| **A — Sunset Arcade** | `fireworks` | 3 staggered 3D firework bursts (16 cubes each, exploding from elevated positions over 0–0.8s). Each burst fades over 1s. | 40 confetti pieces fall from `top: -20px`, drift sideways, rotate, fade out over 1.8s. | ~3.5s |
| **B — Neon Pulse** | `laser-grid` | 3 expanding ring pulses from arena center in winning color (1 every 0.3s, scale to 30× over 1.4s, fade). Territory tinted in winning color (sin-modulated bloom over 1.5s). | Horizontal gradient sweep: faction-color band slides across canvas with `mix-blend-mode: screen`, 1.5s. | ~2.5s |
| **C — Painted Plains** | `watercolor-bloom` | Territory-wide bloom in winning color (sin-curve, 1.5s) — every claimed cell tints toward the winner. | Full-canvas radial gradient from center with `mix-blend-mode: multiply`, scale 0.4 → 1.2 over 1.8s. | ~2.5s |
| **D — Voxel Plate** | `voxel-rain` | 30 voxel cubes (mixed sizes 0.3–0.7u, faction-color + 30% darker variants) rain from sky height 8–12. Stagger spawn over 0.8s. They fall, hit ground, bounce twice, settle. Each casts a shadow. | (none — banner is the DOM layer) | ~2.5s |

After the FX completes, the existing match-end modal fades in. The countdown stays frozen at "0:00." All other UI elements (HUD cards, leaderboard) freeze in place.

---

## Section 14 — Distinct Character / Trail / Minimap Treatment

The "make the directions feel different overall" pass. Characters keep BoxGeometry (Director constraint) but get direction-specific treatment.

### Character treatment

| Direction | Treatment | Implementation |
|---|---|---|
| **A — Sunset Arcade** | Soft warm-glow rim (subtle) | `MeshStandardMaterial.emissive = 0xfff0c0`, `emissiveIntensity = 0.06`. Almost imperceptible at distance, but adds warmth. |
| **B — Neon Pulse** | Neon LED edge | `emissive: faction color, intensity 0.15` + 2 thin BoxGeometry trim cubes (top + bottom of body, faction-color non-emissive). Reads as glowing edges. |
| **C — Painted Plains** | Ink outline | Inverted-hull pass — body & head get a slightly larger BackSide-rendered black BoxGeometry behind them. Cost: 2 extra draw calls per char × 30 = 60 extra. |
| **D — Voxel Plate** | Voxel-cubed (faked AO) | A small `1.04 × 0.1 × 1.04` darker (color × 0.7) BoxGeometry "feet" block at Y = 0.05 grounds the character to the diorama. Reads as a printed Crossy Road token. |

### Trail treatment

| Direction | Trail style | Implementation |
|---|---|---|
| **A — Sunset Arcade** | Smooth ribbon | Standard ribbon mesh + darker outline pass (Tier 0 #4). |
| **B — Neon Pulse** | Fluorescent stroke | Standard ribbon + 2.4× wider glow plane underneath at 32% opacity. Twin-pass = visible glow without bloom. |
| **C — Painted Plains** | Brush-stroke | Wider (1.3×) ribbon with 78% opacity + darker outline pass. Reads as a paint-stroke on parchment. |
| **D — Voxel Plate** | Pixelated chevron | Trail rendered as a sequence of separate BoxGeometry chevron segments (0.5u long each), oriented along the path direction. Reads as a stamp-pattern. |

### Minimap treatment (planned for Tier 3 implementation)

| Direction | Style |
|---|---|
| **A — Sunset Arcade** | Soft-glow rounded card, warm border, faction-tinted glow on player dots. |
| **B — Neon Pulse** | Scope-lines style — black BG with cyan crosshair, monospace coordinate readouts, sharp corners. |
| **C — Painted Plains** | Parchment circle with hand-drawn dashed border, ink-blot dots for players. |
| **D — Voxel Plate** | Wooden tabletop chip — wood-frame border, slight inset shadow, square flat dots for players. |

---

## Section 15 — Round 2 Open Questions for Director

(Round 1 questions still apply.)

1. **Is the FX vocabulary distinct enough now?** Each direction now has its own claim FX, kill FX, respawn FX, notification, banner, countdown, win — but ultimately you have to feel them. Open the mockup and click around. If anything still reads as "more or less the same," tell me which moment and which direction-pair.
2. **Notification placement.** I put the stack top-right because the timer is top-left and the minimap is currently top-right (but moving to bottom-right per Tier 3). If the minimap stays top-right, notifications need to move (suggest: bottom-right, opposite the minimap-bottom-right relocation).
3. **Faction-state banners — pause gameplay?** Right now they're 2-second animations that play *over* live gameplay. If a faction is eliminated mid-fight, that's potentially distracting. Options: (a) keep as-is, (b) brief 0.5s slow-mo or fade behind the banner, (c) banner shows in a dedicated lower-third strip instead of center. Recommend (a) for now; revisit if playtest shows it's distracting.
4. **Countdown — show all 4 minutes intensified or just last minute?** Current spec: only 1:00 → 0:11 is "warning," 0:10 → 0:00 is "critical." Could shift earlier (e.g., 2:00 warning) for more drama.
5. **Game-win — does the existing end-screen modal need a redesign?** Round 2 spec adds 3–5 sec of FX *before* the modal appears. Modal styling is unchanged. If the Director wants the modal restyled per direction too, that's a separate pass (~ 1 day).
6. **Did the Director want any of the "make directions feel more distinct" treatment to apply in the actual game NOW** (e.g., a per-direction trail style for one direction the Director wants to commit to), or is the round 2 mockup purely a comparison aid until a direction is picked?

---

## Round 2 Implementation Effort Estimate

**Assuming a primary direction is picked**, total ship time including round 1 Tier 0 + round 2 features:

| Direction | Round 1 Tier 0 | Round 1 Direction Tier | Round 2 (claim/kill/respawn/notif/banner/countdown/win) | **Total** |
|---|---|---|---|---|
| A: Sunset Arcade | 1 day | 1 day | 2 days | **~4 days** |
| B: Neon Pulse | 1 day | 2 days | 2.5 days | **~5.5 days** |
| C: Painted Plains | 1 day | 2 days | 2.5 days | **~5.5 days** |
| D: Voxel Plate | 1 day | 1.5 days | 2 days | **~4.5 days** |

The round 2 work is mostly DOM + small in-world particles. The big costs are: faction-banner state machine wiring (server → client → DOM), notification queue management, and tuning each direction's kill-burst pool to feel right. 80% of the work is shared infrastructure; 20% is per-direction tuning.

---

_Companion live mockup → `tools/companion/visual-direction.html` (now 8 trigger buttons per direction)._
_Status: 🟡 Director input needed on direction pick + round-2 open questions above._

---

# Round 3 — Direction E: Castaway Atoll

_Director feedback (2026-04-30): "at least one suggestion should be of the background as water or sea and the arena as an island."_

The previous four directions all assume a flat ground plane stretching to a clean horizon. Direction E breaks that — the playable circular battlefield sits on a small island, with animated water surrounding it and distant atolls in the haze. This is the only direction where the game has a literal *place* you can name.

Why add it (vs. swap one of A–D out): A/B/C/D each have distinct aesthetic identities the Director may still want to compare. E adds a fifth option without losing the comparison — the Director can now pick the most compelling *world*, not just the most compelling *FX vocabulary*.

---

## Section 16 — Direction E: Castaway Atoll (round 3)

**Pitch:** A small grass-and-sand island floating in animated cartoon sea. Stylized stylized waves, foam ring, sun-glitter, distant atolls, sailor-cap characters, a sundial timer, and a victory flag that rises on a wooden pole when a faction wins. Crossy Road meets Wind Waker meets paper.io.

### Visual rules

| Layer | Spec |
|---|---|
| **Sky** | Vertical gradient — dawn peach `#FFD9B8` (top) → pale teal `#8FC8DA` (horizon). Reads as golden-hour over open water. |
| **Fog** | `0xBCD8DE`, near 28, far 90. Hides edge of the water plane and softens distant atolls. |
| **Sea** | Custom `ShaderMaterial` on a 6×ARENA_RADIUS square plane subdivided 80×80. Vertex stage: two summed sin waves at different frequencies/directions create chop. Fragment stage: deep teal `#1E6F7E` base, foam ring near island (1.2u wide), animated foam strands (sin-noise), sun-glitter stripes scrolling along a diagonal direction vector. **Cost: ~0.4ms/frame** at 1920×1080 — vertex math is cheap (5 ops/vert, 6,400 verts), fragment is mostly mix() calls. |
| **Island base** | Cylinder geometry (sand). Top radius `ARENA_RADIUS × 1.08`, bottom radius `ARENA_RADIUS × 1.18`, height 0.45u. Color sand `#E2C58A`. The wider bottom + narrower top reads as a beach taper. |
| **Island top** | `CircleGeometry(ARENA_RADIUS)` painted grass `#9CC15A`, raised to Y=0.18 (sits on sand). All territory + characters + trails are translated up to this Y. |
| **Cliff-rocks rim** | 14 small `BoxGeometry` chunks (0.5–1.0u, two stone colors) scattered in a ring at radius 1.05× near sea level. Reads as rocky shoreline; helps separate "playable green" from "sea blue" visually. |
| **Distant atolls** | 3 box shapes at radius 2.6× ARENA_RADIUS, 1.6–2.8u wide, low height. Mostly hidden by fog — they hint at a wider archipelago. |
| **Faction palette** | Red `#E74A3F`, Blue `#3D6CD0` (cooler/desaturated to clearly differ from sea), Green `#52B856`, Yellow `#FFCF2A` (boosted to pop against teal water reflections), Purple `#A94BBE`. Sea hue `#1E6F7E` and sand `#E2C58A` are non-faction. |
| **Lighting** | Ambient `0xfff0d8` @ 0.78 (warm dawn), directional `0xfff2c8` @ 0.7 (golden hour), bounce `0x88B8D0` @ 0.18 (cool sea reflection). Reads soft and sun-kissed. |

### Character treatment — sailor cap

Each character's BoxGeometry stack is unchanged (Director's box-only constraint preserved). Add one stacked top-block above the head:
- Faction-color band (`0.78 × 0.08 × 0.78`, faction color, roughness 0.5) at Y=1.72.
- White cube top (`0.6 × 0.18 × 0.6`, `#fafafa`) at Y=1.85.
- Optional darker rim "feet" block (echoes Direction D — keeps the figure planted on the diorama).

Total cost: 3 extra meshes per character × 30 chars = 90 extra meshes. Trivial.

### Trail style

Smooth ribbon (same as Direction A) with darker outline pass. Reads as a *damp footprint trail* on grass — ribbons on sand-grass surface evoke shoreline tracks.

### Per-feature spec

| Layer | Direction-specific FX | Effort | Perf budget |
|---|---|---|---|
| **Claim FX** (`wave-ripple`) | 3 staggered concentric water-rings expand from claim entry point + 8 light-blue droplet cubes splatter upward + slow watercolor bloom on the new territory (0.55s). | M | ~0.05ms/frame during flash, 0 at rest |
| **Kill FX** (`splash`) | 14 water-droplet cubes (light blue + faction + white mix) shoot up & out with proper gravity and bounce, + 2 white foam-ring shockwaves expand on the ground. (1.1s) | M | Pool, ~0.1ms |
| **Respawn FX** (`wash-ashore`) | Character starts at Y = baseY − 1.2 and rises linearly over 0.6s + 2 staggered foam-ring shockwaves sweep outward + 5 water-droplet puffs at ground level. | S | <0.05ms |
| **Notification toast** (`driftwood`) | Sun-bleached driftwood plank: linear-gradient `#f0e2c0 → #d8c590`, brown text `#3a2e1c`, asymmetric border-radius `2px 12px 2px 12px` (suggests a chipped wood card), faction-colored *double-stripe* left edge (5px), Fredoka 600. Reads as a wooden tag washed onto the beach. | S | Pure CSS |
| **Faction banner** (`sail-banner`) | Canvas/sail panel: gradient `#f8efd6 → #e8d9b0`, brown side+bottom borders, **faction-colored 6px top stripe**, asymmetric border-radius (sharp top, rounded bottom — suggests a hung sail), letter-spacing 1px, Fredoka 700. Reads as a flag-of-state hoisted over the arena. | S | Pure CSS |
| **Countdown** (`sundial`) | Round (50% border-radius) sandy radial-gradient disc with brass-tone border `#a08560`. Normal: slate-blue text `#3F5F6F`, 17px Fredoka. Critical: coral text `#a04030`, 22px, scale-pulse 0.6s. Inset shadow gives the disc dimension. | S | Pure CSS + 50% border-radius |
| **Game win FX** (`tide-rise`) | **WebGL:** territory-wide bloom in winner color (sin curve, 1.5s) + 3 staggered white foam-ring shockwaves expand from arena center across the island (rings live 1.6s each, scaleTo=32) + a faction-colored flag rises on a wooden pole at center (pole 0.12×4×0.12, flag 1.4×0.9×0.06, easing-cubic over 2.2s with breeze-wobble rotation). The flag stays in the scene as a permanent victory marker. **DOM:** 3 seagull silhouettes (chunky pixel V's via CSS gradient) drift across the canvas top + a horizontal foam-wash gradient at the bottom 60%. | M | <0.3ms while active; flag is 2 meshes after. |
| **Character treatment** | Sailor cap (white cube + faction-color band) + dark rim feet block. | S | 3 extra meshes per char |
| **Trail style** | Smooth ribbon + darker outline (same tech as A). | S | Free |
| **Minimap (planned)** | Nautical chart — parchment with a compass-rose corner ornament, lat/lon grid lines, ink-blot dots for players, brass border. | M | Pure canvas |

### Live mockup

All 10 trigger buttons are wired in the companion at `tools/companion/visual-direction.html` (panel E, full-width row). Verified renders cleanly via Playwright; visual screenshots saved at `docs/visual-direction-mockups/r3/`:
- `r3-fullpage.png` — full companion page with all 5 directions
- `r3-e-baseline-viewport.png` — Direction E in resting state (water animating, characters with sailor caps, cliff-rocks rim, distant atoll on horizon)
- `r3-e-kill-fx.png` — kill FX mid-flight
- `r3-e-win-flag-up.png` — win FX with the faction flag fully raised on the central pole
- `r3-e-static-overlays.png` — sundial countdown + 3 driftwood notifications + sail banner ("YELLOW ENDANGERED · NO RESPAWNS") all visible together for clear UI styling reference

### Performance budget rollup

| Component | Cost (1920×1080, integrated GPU) |
|---|---|
| Water shader (vertex + fragment) | ~0.40ms/frame |
| Sand cylinder + grass top | ~0.02ms (2 extra draw calls) |
| 14 cliff-rock cubes | ~0.04ms (14 draw calls, all cast shadows) |
| 3 distant atolls | ~0.01ms (no shadows, behind fog) |
| Per-character cap (3 cubes × 30 = 90) | ~0.10ms |
| Active claim/kill/respawn particles | matches D budget (~0.15ms peak) |
| **Total over Direction D baseline** | **+0.7ms/frame** |

Within the 16ms budget. The big cost is the water shader's fillrate — at lower resolution (mobile devicePixelRatio=1) the cost drops to ~0.2ms.

### Faction-readability check

The biggest risk in this direction is sea blue muddying with Blue faction. Mitigations baked in:

1. Sea hue is **deep teal** `#1E6F7E` — sufficiently dark + green-shifted from Blue faction `#3D6CD0`.
2. Blue faction is **desaturated and cooler-shifted** away from earlier rounds' more saturated blue.
3. **Cliff-rocks rim** is the strong visual divider between green-island and teal-water at the boundary.
4. Yellow `#FFCF2A` boosted to read against teal water reflections at distance.
5. Sand `#E2C58A` is non-faction — no risk of the beach reading as a faction territory.

At 64px game-scale (faction-readability test from ART_ETHOS principle 10): with the cliff-rocks rim and the saturation gap between sea-teal and faction-blue, the test passes. The remaining risk is at heavily zoomed-out spectator views, where the bottom of the arena could read more "blue-ish" overall. If the Director picks E, I'd recommend a playtest at the actual game's camera distance to confirm.

### Effort estimate

| Phase | Est. |
|---|---|
| Round 1 Tier 0 (universal) | 1 day |
| Direction E base — water shader, island, cliff-rocks rim, distant atolls, palette retune | 2 days |
| Direction E FX — wave-ripple claim, splash kill, wash-ashore respawn, sail banner, sundial countdown, tide-rise win + flag rise | 1.5 days |
| **Total** | **~4.5 days** |

Within the same range as the other directions. The water shader is the long pole (1 day to tune the foam strands + sun-glitter so they don't read as noise), and the flag-rise win sequence (0.5 day to time the seagulls + DOM wash + flag ease).

### Lore note

Direction E *answers* round 1 open question #4 ("Background world content? D proposes a wooden tabletop. Does the game's lore/setting suggest a different 'what is this arena sitting on' answer?"). E's answer: **the arena is a contested island in an unmarked sea**. Cube characters are castaways fighting over territory. The win condition becomes: plant your flag.

If the Director picks E, this lore can extend: title screen could be a "captain's map" with the island marked, faction names could become ship names, end-of-match could note "Captain [Name] of the [Faction] now holds the atoll." Out of scope for this pass — flagged for a future title-screen workstream.

---

## Section 17 — Round 3 Open Questions for Director

(Round 1 + Round 2 questions still apply.)

1. **Pick: replace one of A–D, or keep all 5?** I added E rather than swapping. If the Director wants to cull, my recommendation is to keep at minimum D (lowest risk) and E (most distinct world) and have C (most artistically distinctive) as third for variety. A and B are incrementally distinct from D and could be dropped if the comparison is feeling cluttered.
2. **Sea/island lore commit?** Direction E proposes the lore answer "contested island in open sea." If the Director wants to use this world even with a different aesthetic direction, I can port the island geometry into A/B/C/D as a layout option (water/island under, e.g., the sunset-sky of A). This would be a hybrid pass.
3. **Mobile water cost.** The water shader is the main perf risk if shipping on mobile. If mobile is in scope, I'll add a quality toggle that swaps the animated shader for a static gradient texture (saves ~0.4ms; loses the wave animation; foam ring becomes a baked ring texture).
4. **Faction-blue palette commit.** Direction E uses a desaturated cooler Blue (`#3D6CD0`) to keep distance from the sea hue. If E is picked, I'd lock that as the canonical Blue across the game. If E is not picked, the existing brighter Blue stays.
5. **Flag remains permanent?** Currently the round-3 win FX leaves the flag + pole in the scene as a permanent victory marker (until reset). Director may prefer the flag to fade out with the rest of the end-screen. Trivial to change either way.
6. **Sailor cap as a per-faction variant or universal?** I built it as universal (every faction wears the same cap silhouette, just with their faction band color). An alternative is per-faction headwear: Red gets a bandana, Yellow gets a sun hat, etc. Costs more to maintain but adds character identity. **My default: universal cap.** Per ART_ETHOS principle 9, faction identity is already in the body color — adding cap variants risks dilution.

---

_Companion live mockup → `tools/companion/visual-direction.html` (now 5 directions × 10 trigger buttons each)._
_Status: 🟡 Director input needed on direction pick + round-3 open questions above._

