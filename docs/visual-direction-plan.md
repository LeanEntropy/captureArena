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

---

# Round 4 — Execution Plan: Direction E + Tier 0–4 (minus Trail Outline)

_Director decisions on 2026-04-30:_
> 1. Drop Trail Outline (Tier 0 #4) entirely.
> 2. Lock direction: **E — Castaway Atoll**. A/B/C/D are out of execution scope.

This section is the build plan to land E + the remaining Tier 0–4 items in the actual game (`prototype/`), shipped slice-by-slice so any executor (subagent or human) can pick up where the last slice ended. It is **not** an implementation; it's the recipe.

> Companion artifacts the executor reads when implementing each slice:
> - `tools/companion/visual-direction.js` — port FROM here. The relevant config + helpers are listed per-slice below by line number.
> - `tools/companion/visual-direction.html` — visual reference. Open in a browser to compare against in-game output during each slice.
> - `docs/visual-direction-mockups/r3/r3-e-baseline-viewport.png` — the visual target for slice 1 ("game looks like an island").

**Key scale gotcha.** In the mockup, `ARENA_RADIUS = 10`. In the actual game, `ARENA_RADIUS = 66.89` (per `prototype/sim/constants.js`, after the recent +30% arena expansion). All mockup geometry that uses `ARENA_RADIUS * <multiplier>` (water plane, sand cylinder, distant atolls) ports cleanly. **Hardcoded heights/widths** (sand cylinder height `0.45u`, grass Y `0.18u`, foam ring widths `1.2u`, cliff-rock sizes `0.5–1.0u`, sailor cap dims, flag pole `0.12 × 4 × 0.12`) all stay **the same in absolute world units** — they don't scale with arena. Re-eyeball each at game scale during slice 1.

---

## Section 18 — Execution Plan: Direction E + Tier 0–4 (minus Trail Outline)

### 18.1 — Tier 0–4 with Trail Outline removed

Original list had 24 items in 5 tiers (Section 1). With #4 Trail Outline dropped, **23 items remain.** Below: each remaining item with its actual-game landing notes — what file in `prototype/`, what to add, hours, perf cost, dependencies.

Item numbering preserved from Section 1 / Section 2 round-2 sections so grep-search of the original plan still maps cleanly.

#### Tier 0 — Critical feedback loops (do first, in this order)

| # | Item | File(s) in `prototype/` | What to add | Effort | Perf cost | Depends on |
|---|---|---|---|---|---|---|
| 1 | **Claim flash + scale-pop** (E variant: `wave-ripple` — 3 concentric rings + 8 droplets) | `main.js` (renderer FX), reads `sim.onClaim` hook (already wired) | Port `wave-ripple` block from `visual-direction.js:1507–1545`. Add a per-Game `_fxParticles` pool (BoxGeometry + RingGeometry meshes, lifetime-driven) that ticks in `Game.tick()`. Trigger in `sim.onClaim` callback — entry point = first vertex of the consumed trail, available pre-clear. | M (3–4h) | Pool = 32 BoxGeometry + 8 RingGeometry, allocated once. Active FX <0.15ms/frame; 0 at rest. | E base (slice A) for the `_islandTopY` reference; can land before that with `Y=0.06` and re-tune later. |
| 2 | **Kill burst** (E variant: `splash` — 14 light-blue droplets + 2 white foam rings) | `main.js` — extend `sim.onKill` hook | Port `splash` block from `visual-direction.js:1668–1708`. Same `_fxParticles` pool as #1. Add screen-shake on `this.camera.position` for ~5 frames if `victimR === this.player` is replaced by `killerR === this.player`. | M (3h) | Same pool; +0.1ms peak. | Item #1 (shared particle pool). |
| 3 | **Death screen polish** | `index.html` (CSS for `#death-screen`), `main.js` `sim.onKill` callback | Add red flash overlay (200ms CSS keyframe) before the death card. Camera zoom: tween `this.camera.fov` from current → -8°FOV over 300ms, then back. Death card shows kill attribution + respawn timer + own faction's territory %. | S (1.5h) | Free (CSS + 1 tween). | None. |
| ~~4~~ | ~~Trail outline~~ | — | **DROPPED per Director.** | — | — | — |
| 5 | **Score pop + kill counter pop** | `ui.js` (`_updateStats`, `_updateRanking`) | When `total` or `kills` increases vs cached prev value, add a CSS class `.score-pop` for 250ms (scale 1.0→1.3→1.0 + color flash). Cache prev values on `this`. | S (1h) | Pure CSS. Free. | None. |

#### Tier 1 — Atmosphere / "I'm in a world"

E's island geometry replaces all four of #6, #7, #8, #9 with E-specific equivalents. Items #6/#7/#9 collapse into slice A (E base build). Item #8 (camera tilt + FOV bump) is independent and survives.

| # | Item | File(s) | What to add | Effort | Perf cost | Depends on |
|---|---|---|---|---|---|---|
| 6+7 | **Replace `#f0f0f0` background + add water + island geometry** (E base) | `main.js` `Game.constructor` — replace `scene.background = 0xf0f0f0` and the white CircleGeometry ground with the E stack: gradient sky, fog, water shader, sand cylinder, grass top, cliff-rocks, distant atolls. Lighting also retuned. | Port from `visual-direction.js:902–1037` (`_buildWaterAndIsland`) + lighting block at `:830–847` + bg/fog block from `_initializeMockup` near `:780`. Adapt to game scale (ARENA_RADIUS=66.89). Raise `territoryMesh.position.y` to `_islandTopY + 0.01` (was 0.02 on a flat plane). | L (1 day; this is slice A) | Water shader ~0.4ms; sand+grass+rocks+atolls ~0.07ms; sky/fog free. **+0.5ms total over current.** | None. Highest-impact slice — game becomes E. |
| 8 | **Camera tilt + slight FOV bump** | `main.js` `Game.constructor` (camera setup) + `tick()` (cam follow) | Lower `CAMERA_HEIGHT` slightly (e.g. 28 → 26) and bump `this.camera.fov` from 45 → 55 (and `updateProjectionMatrix`). Test against minimap visibility at ARENA_RADIUS=66.89 — the player must still see immediate trail/territory contrast. | S (30min) | Free. | None. Independent of slice A. |
| 9 | ~~Soft territory boundary anti-alias~~ | — | **Skip for slice A.** Drop or defer. The current `NearestFilter` jaggies suit E's chunky stylized look (cliff-rocks, sailor caps are all blocky); a soft AA edge would clash. **Recommend dropping** — flag for Director to confirm. If kept, lives in `_createTerritoryTexture` as a second pass. | (drop) | (drop) | — |
| 10 | **Subtle ambient particles (E: gulls / sea spray)** | `main.js` (renderer-only) | Optional. 30–50 small white BoxGeometry "spray" motes in a ring just outside the island, drifting horizontally at low opacity. OR: 2–3 procedural seagull cubes drifting at high altitude. Skip if the win-FX seagull is enough. | S (1h) | One Points geometry. Free. | Slice A. |

#### Tier 2 — Character life

| # | Item | File(s) | What to add | Effort | Perf cost | Depends on |
|---|---|---|---|---|---|---|
| 11 | **Idle bob animation** | `main.js` `Character` class — add `_updateAnim(dt)`, called from `Game.tick` | Procedural sin on `body.position.y` and `head.position.y`. ±0.05 at 2Hz. Mockup version at `visual-direction.js:2190–2195`. | S (45min) | Free. One sin/char/frame. | None. |
| 12 | **Walk wobble** | `main.js` `Character._updateAnim` | When `velocity > 0`, add tilt forward 5° (`body.rotation.x`) and rock side-to-side ±3° (`body.rotation.z`) at stride frequency tied to speed. Currently `Character` has no per-tick anim state — add `this._strideT` and step it in `_updateAnim`. | S (1h) | Free. | #11 (same hook). |
| 13 | **Death dissolve** | `main.js` `Character.onDieVisual` | Replace `this.group.visible = false` with a 200ms scale-down + Y-rotation tween. Add a `_dyingTween` field; while active, `syncVisuals` skips the position write so the corpse stays put. | S (1h) | Free. Tween on existing transforms. | #2 (kill FX should fire at the *start* of the dissolve, not *after*). |
| 14 | **Respawn pop (E variant: `wash-ashore` — character rises from below + 2 foam rings + 5 droplets)** | `main.js` `Character.onRespawnVisual` | Port `wash-ashore` block from `visual-direction.js:1853–1895`. Set `victim.group.position.y = baseY - 1.2`, tween up to baseY over 0.6s. baseY = `_islandTopY` (per slice A). Spawn 2 foam rings + 5 droplets via the same `_fxParticles` pool from #1. | S (1.5h) | Reuses pool. Free. | Slice A (for `_islandTopY`), #1 (pool). |
| 15 | **Direction indicator on character** | `main.js` `Character._buildChar` | Add a small darker BoxGeometry strip (0.1 × 0.1 × 0.05) on the front face of the head, color = head color × 0.6. | S (30min) | One extra mesh/char. Trivial. | None. |

#### Tier 3 — HUD pass

E's HUD is themed around "weathered nautical paper / driftwood." All four directions had their own font+style. For E we use Fredoka 600 + driftwood/sundial/sail-banner styling.

| # | Item | File(s) | What to add | Effort | Perf cost | Depends on |
|---|---|---|---|---|---|---|
| 16 | **Replace `Segoe UI` with Fredoka (E theme)** | `index.html` `<head>` | Add `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap">`. Update `body { font-family: ... }` to `Fredoka, system-ui`. | S (15min) | One Google Font. <50KB. | None. |
| 17a | **HUD card restyle: countdown → `sundial`** | `index.html` (CSS for `#hud-tl`), `ui.js` `_updateTimer` | Port `countdown-sundial` styling from `visual-direction.js:350–360` + companion's CSS `cd-pulse` keyframe. Sandy radial-gradient disc, brass border, slate-blue text normal / coral text + scale-pulse critical. | S (1h) | Pure CSS. Free. | #16 (font). |
| 17b | **HUD card restyle: faction ranking → `sail-banner` styling for endangered / eliminated / recovered** | `index.html` (CSS additions), `ui.js` `_updateRanking` (emit DOM banners on state change) | Port `bannerStyle: "sail-banner"` from `visual-direction.js:519–566` (DOM construction). Hook: `ui.js` polls `factionManager.getAllFactions()` each frame; cache prev `endangered` + `alive` per faction; on transition, call a new `_showSailBanner(text, kind, color)` that builds the sail DOM, animates in (scale 0.6→1.0 cubic-bezier overshoot), holds 2.0s (eliminated 2.8s), animates out. | M (2.5h) | Pure CSS. Free. | #16, requires no sim changes (read existing faction state). |
| 17c | **HUD card restyle: notifications → `driftwood`** | `index.html` (CSS), `ui.js` (new `pushNotification` method) | Port `notif-driftwood` styling from `visual-direction.js:427+`. New DOM stack `<div id="notif-stack">` top-right (or bottom-right; see Section 15 Q2). Trigger sources: extend `sim.onKill` (to push "You killed [Name]" if killer is local), extend `sim.onClaim` (to push "You captured X% of [Faction]" if claimer is local), extend `sim.onKill` (to push "You died" if victim is local), extend respawn detection (push "You spawned (invuln 2s)"). | M (3h) | Pure CSS. Free. | #16. Depends on the same delta-detection scaffold as #17b. |
| 18 | **Minimap polish (E: `nautical-chart`)** | `ui.js` `_updateMinimap` + `index.html` (CSS for `#minimap-container`) | E mockup describes parchment with compass-rose corner, lat/lon grid lines, ink-blot dots. Mockup did NOT implement the chart canvas (only a `minimapStyle: "nautical-chart"` config key). For shipping: add parchment-color background, brass `#a08560` 3px ring border, optional compass-rose corner sprite (procedurally drawn in 2D context). Player dot stays white→pulses. | M (3h) | Existing minimap canvas + CSS. Free. | #16 (font for any minimap labels). |
| 19 | **Leaderboard row hover / own-row highlight** | `ui.js` `_renderLeaderboardRow` + `index.html` CSS | Add faction-color border-left on local-player row, top-3 medal prefix (gold/silver/bronze SVG inline). Already partially done (own row gets bg+bold); add the medal + faction-color accent. | S (1h) | Pure CSS. Free. | None. |
| 20 | **Title screen redesign (E theme)** | `index.html` `#name-entry` block | "Castaway Arena" or keep "Territory War" wordmark — see Section 17 Q5. Background: animated water shader (small canvas, low res, ~0.1ms one-time) OR static screenshot of slice A's water. Input field styled as a polished control with sand/cream theme. | M (2h) | One canvas with scaled-down water shader, ~0.1ms while title visible (0 once entered). | Slice A (water shader code) for the live-water title bg, OR independent if static. |

#### Tier 4 — Polish & moments

| # | Item | File(s) | What to add | Effort | Perf cost | Depends on |
|---|---|---|---|---|---|---|
| 21 | **Killstreak indicator** | `ui.js` (new `_showKillstreak(n)`), `main.js` `sim.onKill` | Track local-player kill timestamps; when 2 within 5s → flash a small banner ("DOUBLE!"). Use the same DOM stack scaffold as #17c notifications, distinct CSS. | M (2h) | Pure CSS. Free. | #17c (notification scaffold). |
| 22 | **"Endangered faction" warning — screen-edge tell** | `index.html` (CSS pulse animation), `ui.js` (toggle class on `#ui` parent based on local-faction endangered) | When local player's faction is endangered: pulse left edge in faction color at 1Hz, 30% opacity. When enemy faction endangered: pulse their leaderboard row red at 2Hz. | S (1h) | CSS keyframes. Free. | #17b (delta-detection scaffold for endangered transition). |
| 23 | **Match-end celebration: `tide-rise` (E variant)** | `main.js` (new `_runWinFX(winnerColor)`), `index.html` (DOM seagulls + foam wash) | Port `tide-rise` block from `visual-direction.js:2032–2075` (WebGL: territory bloom + 3 staggered foam rings + flag rises on a wooden pole at center, stays in the scene as permanent victory marker) + `_spawnSeagullsAndWash` from `:579–625` (DOM seagulls + foam wash gradient). Trigger when `matchManager.phase` transitions to `"ended"`. | L (1 day) | Active ~3s, +0.3ms peak. Pole+flag are 2 meshes after — trivial. | Slice A (for `_islandTopY` and water shader interaction), #16 (font). |
| 24 | **Audio (out of scope for this round)** | — | Flagged for separate workstream. Sound list to spec: claim ring, kill splash, death thud, respawn rise, killstreak, win flag-up, sundial tick at <10s. | L | <1% CPU per sound | N/A — not in execution scope. |

---

### 18.2 — Direction E's actual-game landing (per-feature breakdown)

This section is what the executor needs to port from the mockup into `prototype/`. Each row maps a mockup source range → target file, plus integration notes.

| Feature | Mockup source | Target file in `prototype/` | Integration notes |
|---|---|---|---|
| **Sky gradient + fog** | `visual-direction.js:780–810` (config + `_initializeMockup` setup of `scene.background` and `scene.fog`) | `prototype/main.js` `Game.constructor`, replacing `this.scene.background = new THREE.Color(0xf0f0f0)` | Use a CSS-style background fallback OR a gradient via `THREE.CanvasTexture` rendered to a 1×256 ramp. Set `scene.fog = new THREE.Fog(0xBCD8DE, 28, 90)`. Bump fog `far` to ~120 since arena is 6.7× larger than mockup. |
| **Water plane + ShaderMaterial** | `visual-direction.js:902–977` (`_buildWaterAndIsland` first half) | `prototype/main.js` new method `_buildEWaterAndIsland()`, called from `Game.constructor` after light setup | ShaderMaterial code ports verbatim. Geometry size already scales with `ARENA_RADIUS × 6`. **Tessellation:** `80×80` is fine at game scale (waves still readable at 6.7× radius); bump to 120×120 if foam strands look too coarse. Add `this._waterMat.uniforms.uTime.value = perfNowSec` to `Game.tick()`. |
| **Sand cylinder + grass top** | `visual-direction.js:980–1003` | Same method as above | Hardcoded `height: 0.45` and `Y: -0.05/0.18`. At game scale (player is 1u tall), eyeball whether 0.45u sand height reads as "the island is on a beach" — likely fine since the beach-rim is purely silhouette. **Don't scale these**; they're absolute. |
| **Cliff-rocks rim (14 cubes)** | `visual-direction.js:1005–1022` | Same method | Sizes 0.5–1.0u absolute. At ARENA_RADIUS=66.89 these will look like little pebbles. **Bump to 1.5–3.0u** at game scale to read as actual cliff-rocks. Verify against `r3-e-baseline-viewport.png` aspect ratio. |
| **Distant atolls (3 cubes)** | `visual-direction.js:1024–1036` | Same method | At game scale these need scaling: `dwidth: 1.6 + Math.random() * 1.2` → multiply by ~6.7 to keep apparent visual size in the fog. Or: leave dimensions and place them further out (radius `4.0 × ARENA_RADIUS`). |
| **Lighting retune (warm dawn)** | `visual-direction.js:830–847` (config: ambient `0xfff0d8` @ 0.78, directional `0xfff2c8` @ 0.7, bounce `0x88B8D0` @ 0.18) | `prototype/main.js` `Game.constructor` lighting block | Replace existing `0xffffff @ 0.8` ambient + `0xffffff @ 0.6` directional. Keep shadow map config (1024² works fine). Add the bounce light as a second directional from `(-3, 3, -3)`. |
| **Faction palette retune** | `visual-direction.js:205` (`factionColors: [0xE74A3F, 0x3D6CD0, 0x52B856, 0xFFCF2A, 0xA94BBE]`) | `prototype/sim/faction.js` `FACTION_COLORS` array | **Game-affecting:** these colors flow into both renderer (mesh tint) AND minimap AND HUD AND territory texture. Update one constant; everything reads it. **NOTE**: This is a sim-package file change — coordinate with subagent a674740c11bd011d8 if they're touching faction.js. They probably aren't (they're in Simulation.js claim()), but verify before commit. |
| **Sailor cap (E character treatment)** | `visual-direction.js:1251–1271` (`charStyle === "castaway"` block) | `prototype/main.js` `Character._buildChar`, after the head | Add 3 extra meshes per character: faction-color band cube (Y=1.72), white top cube (Y=1.85), darker rim feet block (Y=0.04). Mockup applies same color to body/head — keep. |
| **Trail style (smooth ribbon, no outline change)** | `visual-direction.js:1314–1340` (default ribbon path) | `prototype/main.js` `Character._rebuildTrailMesh` | **No change required.** Current trail is already a smooth ribbon. Trail-outline pass dropped per Director. Keep the current ribbon Y at `0.05` but raise to `_islandTopY + 0.05` once slice A lands. |
| **Territory mesh Y-lift** | `visual-direction.js:1080–1082` (`territoryMesh.position.y = _islandTopY + 0.01`) | `prototype/main.js` `_createTerritoryTexture` (post-mesh-creation), and update `Character` mesh Y, and trail Y | Single global change: characters, trails, territory, particles all need to render *on the island top*, not at world Y=0. Add a `Game._islandTopY` constant (0.19 in mockup) and use it consistently. |
| **Wave-ripple claim FX** | `visual-direction.js:1507–1545` | `prototype/main.js` new method `_spawnClaimFX(entry, factionColor)`, called from `sim.onClaim` callback | Need to know the trail entry point: the first vertex of the trail (`simChar.trailVerts[0]`) — accessible before the sim clears the trail. Modify `sim.onClaim` callback in `main.js` to capture entry before calling `_clearTrail`. |
| **Splash kill FX** | `visual-direction.js:1668–1708` | `prototype/main.js` new method `_spawnKillFX(pos, victimColor)`, called from `sim.onKill` callback | Use `victimR.simChar.pos` as `pos`. Add Y offset to `_islandTopY + 1.0` so the splash starts at chest height. |
| **Wash-ashore respawn FX** | `visual-direction.js:1853–1895` | `prototype/main.js` `Character.onRespawnVisual` (extend) | Set `this.group.position.y = _islandTopY - 1.2`, tween up to `_islandTopY` over 0.6s using a per-Character `_respawnTween` field stepped in `syncVisuals` or `_updateAnim`. Spawn 2 foam rings + 5 droplets via shared particle system. |
| **Driftwood notifications (DOM)** | `visual-direction.js:427–445` (style block) + `pushNotification` mechanism `:376–478` | `prototype/index.html` (CSS for `.notif-driftwood`), `prototype/ui.js` (new `pushNotification` method on UIManager) | Build a `<div id="notif-stack">` in `index.html` (top-right or bottom-right). UIManager exposes `pushNotification(text, kind, factionColor)` that appends a div, animates it in (slide+fade 0.2s), holds 3s, animates out. Cap at 4 visible. Triggered from main.js `sim.onKill`/`sim.onClaim` when local player. |
| **Sail-banner (DOM, faction-state announcements)** | `visual-direction.js:519–566` (style block) + banner mechanism `:280+` (`bannerContainer` in `SceneOverlay`) | `prototype/index.html` (banner container), `prototype/ui.js` (new `_showSailBanner(text, kind, color)` + delta detection in `_updateRanking`) | Cache prev `endangered`/`alive` per faction in UIManager. Each frame, compare current vs prev; on transition, build a banner div, animate in (scale+opacity, cubic-bezier overshoot), hold 2-2.8s, animate out. Banner styling = `linear-gradient(180deg, #f8efd6, #e8d9b0)` + brown side+bottom borders + faction-color 6px top stripe + asymmetric border-radius. |
| **Sundial countdown (DOM)** | `visual-direction.js:350–360` (style block) | `prototype/index.html` (CSS for `#hud-tl` / new `.countdown-sundial`), `prototype/ui.js` `_updateTimer` | Wrap timer text in a sundial-styled div: round (50% border-radius), sandy radial-gradient bg, brass border, inset shadow. Apply `.intense` class when `timeRemaining <= 60` (warning, switch to coral text); add `.critical` class when `<= 10` (scale-pulse 0.6s loop). |
| **Tide-rise win FX (WebGL flag + foam rings + DOM seagulls + foam wash)** | `visual-direction.js:2032–2075` (WebGL part) + `:579–625` (DOM part) | `prototype/main.js` new method `_runWinFX(winnerColor)`, triggered when `matchManager.phase` transitions to `"ended"` (poll in `Game.tick`) | WebGL: territory tint pulse, 3 staggered foam rings from arena center, flag pole + flag rise (BoxGeometry, 0.12×4 pole + 1.4×0.9 flag, tween Y from `_islandTopY + 0.1` to `_islandTopY + 3.5` over 2.2s). DOM: seagull silhouettes via CSS gradient drift across viewport, foam wash gradient at bottom 60%. Pole+flag remain in scene as permanent victory marker. |
| **Minimap restyle (`nautical-chart`)** | mockup describes only the config key (`minimapStyle: "nautical-chart"`); not implemented | `prototype/ui.js` `_updateMinimap` + `prototype/index.html` (CSS for `#minimap-container`) | Build from spec: parchment background canvas-fill, brass `#a08560` 3px border (CSS), optional compass-rose corner ornament (4 small lines drawn into the canvas in `_updateMinimap`). Player dot stays white with pulse. **Net-new** — no mockup code to port; this is original work guided by Section 14 spec. |

---

### 18.3 — Suggested execution ORDER (slice by slice)

Each slice ends in a committable, visible improvement. The cheapest first slice gives the biggest visual delta — the game *looks* like Direction E after slice A. Subsequent slices add the FX/HUD/feel.

#### Slice A — "The game looks like an island" (1 day)

**Goal:** Director can open the game and see Castaway Atoll at game scale.

- **6+7** Replace background + add water plane (shader) + sand cylinder + grass top + cliff-rocks rim + distant atolls.
- Lighting retune (warm dawn ambient + directional + bounce).
- Faction palette retune (cooler Blue, boosted Yellow).
- Sailor cap on every character (`Character._buildChar` extension).
- Territory mesh Y-lift (so claims appear on the grass top, not below the water).
- Trail Y-lift (so trails appear on the grass top).

**Why first:** This is the visual identity. After this commit, screenshots match `r3-e-baseline-viewport.png`. Everything else is layered on top. Highest-impact ÷ effort ratio in the whole plan.

**What's NOT in slice A:** No FX, no HUD restyle, no animations. Pure look.

**Verification:** Take a screenshot mid-game; compare to `docs/visual-direction-mockups/r3/r3-e-baseline-viewport.png`. They should match conceptually (water animating, sailor caps visible, cliff-rocks at rim, distant atoll on horizon).

---

#### Slice B — "Moments feel right" (1 day)

**Goal:** Claims, kills, respawns now feel like Direction E.

- **#1** Wave-ripple claim FX (port from mockup) — wired to `sim.onClaim`.
- **#2** Splash kill FX (port from mockup) — wired to `sim.onKill`.
- **#14** Wash-ashore respawn FX (port from mockup) — wired to `Character.onRespawnVisual`.
- Shared particle pool (`_fxParticles`): 32 BoxGeometry + 8 RingGeometry meshes, lifetime-driven, recycled.
- **#13** Death dissolve (200ms scale-down + Y-rotation tween in `Character.onDieVisual`).
- **#3** Death screen polish (red flash + camera FOV zoom + restyled card).
- **#15** Direction indicator on character (small darker front-face strip).

**Why second:** These are the three core gameplay-feedback loops (Section TL;DR). Without them, slice A still looks like a polished prototype. With them, the game *feels* alive.

**Verification:** Play-test for 60s. Every claim, kill, respawn should produce a visible distinct FX. Compare against the mockup's E panel (click the per-direction trigger buttons to compare).

---

#### Slice C — "Characters are alive" (0.5 day)

**Goal:** Even when nothing is happening, the world has motion.

- **#11** Idle bob animation.
- **#12** Walk wobble.
- **#8** Camera tilt + FOV bump (45 → 55, lower height slightly).

**Why third:** Cheap but adds enormous "life" feel. Camera change validates that slice A's water/island still reads at the new angle.

---

#### Slice D — "HUD pass" (1 day)

**Goal:** HUD looks like it belongs in Direction E, not a debug overlay.

- **#16** Fredoka font.
- **#17a** Sundial countdown styling.
- **#17b** Sail-banner system (faction-state announcements: endangered / eliminated / recovered).
- **#17c** Driftwood notifications (DOM stack: kills, captures, deaths, respawn).
- **#5** Score pop + kill counter pop (CSS keyframe).
- **#19** Leaderboard own-row highlight + medal prefix.

**Why fourth:** HUD restyle is independent of in-world FX. Wire after FX so the notification system's DOM scaffold is in place for #21 killstreak.

---

#### Slice E — "Match-end is a moment" (1 day)

**Goal:** Match-end stops feeling like a black overlay.

- **#23** Tide-rise win FX (WebGL flag rise + foam rings + DOM seagulls + foam wash).
- **#21** Killstreak indicator (depends on slice D notification scaffold).
- **#22** Endangered screen-edge tell (depends on slice D banner-state cache).

---

#### Slice F — "Polish (optional, do based on time)" (0.5 day)

**Goal:** Nice-to-haves that don't gate ship.

- **#10** Ambient particles (sea spray motes around the island OR procedural seagulls during gameplay).
- **#18** Minimap restyle (nautical chart with brass border + compass-rose corner).
- **#20** Title screen redesign (animated water bg or static screenshot).

---

#### Total estimate

| Slice | Hours | Cumulative |
|---|---|---|
| A — Island look | 8h | 8h |
| B — Moments feel right | 8h | 16h |
| C — Characters alive | 4h | 20h |
| D — HUD pass | 8h | 28h |
| E — Match-end moment | 8h | 36h |
| F — Polish (optional) | 4h | 40h |

**Core (A–E):** ~36h ≈ 4.5 days for one focused dev. Matches Section 16's "Total ~4.5 days" estimate from round 3.

---

### 18.4 — Conflicts with in-flight work

#### Subagent a674740c11bd011d8 — debugging `Simulation.js claim()`

- **Risk:** They commit between this plan and slice A.
- **Why low risk:** Their work is in `prototype/sim/Simulation.js` (claim algorithm). All slice A–F changes are in:
  - `prototype/main.js` (renderer + FX + scene setup)
  - `prototype/ui.js` (HUD)
  - `prototype/index.html` (CSS, fonts, DOM scaffold)
  - `prototype/sim/faction.js` — **only one** sim-package file touched, and only a constant array (`FACTION_COLORS`)
- **Mitigation:** Slice A's faction palette change in `faction.js` is a 1-line array update. If a674740c is touching `faction.js`, coordinate or rebase. Otherwise no overlap.

#### Recent commit `2f5ed2c` — trail starts inside own territory

- Trail-gap fix already landed. Slice A's trail Y-lift to `_islandTopY + 0.05` is independent of the trail-start logic. No conflict.

#### Recent commit `3c6438b` — BlocklyIO BFS-sub-fill claim algorithm

- Algorithm change in `Simulation.js`. Doesn't affect renderer FX hooks (`sim.onClaim` still fires with the same callback signature `(charId, trailPoints, factionId)`). Slice B claim FX uses the entry point from `simChar.trailVerts[0]` — verify this field is still populated by the new algorithm. **Likely yes** (trail vertices are the renderer's input regardless of claim algorithm), but **verify on first port** of wave-ripple FX in slice B.

#### Recent commit `eb17810` — heal pass + disconnected territory reassignment

- Affects `Simulation.js` and `_updateTerritoryTexture` upload throttling. No FX dependency. Slice A's `territoryMesh.position.y` lift doesn't conflict.

#### Recent commit `9bb0f58` — texture-based territory renderer

- This is the foundation slice B and slice E build on (they expect `this.territoryTexture` and `_updateTerritoryTexture`). Already landed; nothing to do.

---

### 18.5 — Open questions / recommendations for Director

These don't block any slice from starting but should be answered before slice ships to main:

1. **Drop or keep #9 (soft territory boundary AA)?** I recommend dropping for E (the chunky NearestFilter look fits the cliff-rocks/sailor-caps aesthetic). Default: drop.
2. **Keep wordmark "Territory War" or rename to "Castaway Arena" / something nautical?** Default: keep "Territory War" — game works with either, no time wasted on rename.
3. **Sailor cap variants** (Section 17 Q6) — I'm building universal cap (faction-color band, white top) per the mockup. If Director wants per-faction headwear (bandana, sun hat, helmet), bump slice A by ~2h.
4. **Mobile water shader fallback** (Section 17 Q3) — does mobile ship matter for v1? If yes, slice A grows by ~1h to add a `quality` toggle that swaps animated shader for a static gradient texture.
5. **Flag persistence after match-end** (Section 17 Q5) — current spec leaves flag + pole in the scene as a permanent victory marker. Default: keep persistent until next match start.
6. **Faction-blue palette commit** (Section 17 Q4) — slice A locks `Blue = #3D6CD0` (cooler/desaturated). This becomes canonical. Confirm before the `faction.js` edit lands.

---

_Companion live mockup → `tools/companion/visual-direction.html` (E panel = primary visual reference for ports)._
_Source-of-truth FX code → `tools/companion/visual-direction.js` (line ranges per row in §18.2)._
_Status: 🟢 Plan ready. Direction picked. Awaiting Director slice-pick to begin execution._

---

## Section 19 — Direction F: Atoll Hybrid (post-Slice-A revert)

**Status:** mockup only (companion). NOT shipped to game-side.

**Origin.** The previous Slice A landed Direction E in the actual game (`prototype/`) but had two visible breakages and was reverted:

1. The dome island geometry overlapped the territory texture plane at the same Y, causing Z-fighting "blinking" at oblique camera angles.
2. The water shader's wave animation crossed onto the playable area where the foam ring met the grass top.

After the revert, the Director requested a hybrid that locks down both failure modes structurally and swaps several moment FX to the heavier-feeling D (Voxel Plate) language. Verbatim Director request, 2026-04-30:

> I want to implement Theme E again but with the following changes:
> 1. The island is a flat cylinder above the sea, not a dome shape.
> 2. Make sure the floor of the island is not the same height as the base of the battlefield so not to have them intersecting.
> 3. Use the Kill animation and the respawn animation of option D (voxel)
> 4. Use the Notification styles of Theme A (sunset). Make sure they appear BELOW the leaderboard, not on top of any other UI element.
> 5. Use the game win animation, Endangered, Eliminated, recovered and countdown animations from Theme D (voxel).

### 19.1 — Geometry: three distinct Y planes

| Y    | What                  | Geometry                                                                                                | Material                                            |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| -0.4 | Sea surface           | `PlaneGeometry(ARENA_RADIUS*6, _, 80, 80)` rotated flat. Shader discards everything inside `r * 1.04`.  | `ShaderMaterial` (E's water shader, reused as-is).  |
| 0.0  | Cylinder base         | `CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 0.6, 64)`                                                  | Multi-material: `[sandy sides, grass top, dark base]`. |
| 0.6  | Cylinder TOP face     | (the top face of the cylinder above)                                                                    | grass `MeshLambertMaterial`                          |
| 0.65 | Territory mesh        | `PlaneGeometry(ARENA_RADIUS*2, ARENA_RADIUS*2)` (alphaTest cutout, 64×64 NearestFilter)                 | Existing `MeshBasicMaterial` faction-tinted texture |
| 0.67 | FX rings + trails     | Various `RingGeometry` for foam-rings, `BoxGeometry` voxel debris bouncing on `floorY = 0.7`            | Existing FX materials                                |

**Hard rule (from Director):** the floor of the island and the base of the battlefield are NEVER at the same Y. F's `0.6` (cylinder top) vs `0.65` (territory) gives 0.05 units of clearance — enough that even at grazing camera angles the depth buffer can resolve the order without precision tearing. (Compare to E which uses `0.18` grass + `0.19` territory — only 0.01 of separation. E's transparent-mesh render order works around the issue, but F's geometry doesn't rely on render-order tricks; it's structurally separated.)

**Water-overlap rule (from Director).** The water shader's `discard` happens when `length(vWorldXZ) < uIslandRadius - 0.05`. For F we widen `uIslandRadius` from `ARENA_RADIUS * 1.02` (E's value) to `ARENA_RADIUS * 1.04`, and widen the foam ring from `1.2` to `1.5` — so the foam line sits OUTSIDE the cylinder edge and waves can't visually creep onto the playable surface even when crests rise.

### 19.2 — Per-feature spec

| #  | Feature             | Source     | Companion impl                                                                                                                                | Notes                                                                                                  |
| -- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1  | Sky + sea           | E          | Reused. Dawn-peach gradient + animated teal water shader.                                                                                     | Mobile fallback path documented in §17 Q3 still applies.                                              |
| 2  | Island              | NEW        | `_buildWaterAndIsland()` branches on `outerGround.cylinder` flag → flat `CylinderGeometry` instead of sand+grass dome stack.                  | Top face of cylinder IS the grass surface (no separate plane). Cleanest possible.                     |
| 3  | Cliff rocks         | E          | Reused, 14 cubes around the rim. For F, base Y shifted from 0.05 → `_islandTopY` so they sit on the top edge.                                  | Read as a rocky lip on the cylinder edge.                                                              |
| 4  | Distant atolls      | E          | Reused, 3 background cubes. Y baseline shifted to match water Y.                                                                              | Renders below fog line.                                                                                |
| 5  | Sailor caps         | E          | Reused. `charStyle: "castaway"` adds white-cube top + faction-color band on each character's head.                                            | Optional per Director spec — kept because it sells the world.                                          |
| 6  | Faction palette     | E          | Reused. `[E74A3F, 3D6CD0, 52B856, FFCF2A, A94BBE]` — Blue cooler/desat from sea, Yellow boosted vs teal reflections.                          | Locks faction-blue choice from §18.5.                                                                 |
| 7  | Trail style         | E          | Reused. Smooth ribbon + darker outline. Trail Y now `_islandTopY + 0.07` (above territory mesh).                                              | Reads as a damp footprint trail.                                                                       |
| 8  | Claim FX            | E          | Reused. `wave-ripple` — 3 concentric water rings + 8 droplet splatters.                                                                       | Sea-themed feedback fits the world.                                                                   |
| 9  | Kill FX             | **D**      | Switched. `voxel-debris` — 12 bouncy cube fragments, gravity + rotation. **Bounce floor lifted to `_islandTopY + 0.1` so cubes bounce on the cylinder top, NOT through it.** | Critical fix vs leaving the legacy Y=0.1 floor — would have appeared to fall into the water.          |
| 10 | Respawn FX          | **D**      | Switched. `build-up` — character rises from below + dust puffs. **Build-up startY/endY made baseY-aware** so the rise origin matches F's island top. | Without the baseY fix the character would have respawned at Y=0 (under the cylinder) and snapped to baseY visibly. |
| 11 | Notification toast  | **A**      | Switched. `card-warm` — cream card, brown text, faction-color left border, Fredoka.                                                            | NEW `notificationAnchor: "below-leaderboard"` flag in config repositions the stack.                    |
| 12 | Notification anchor | NEW        | `SceneOverlay._build` reads `config.notificationAnchor`. When `"below-leaderboard"` it positions the stack at `top:146px right:16px` (below a 88px leaderboard ghost rectangle). | Width 200px to match a real-game leaderboard column.                                                  |
| 13 | HUD ghosts          | NEW        | `SceneOverlay._buildLeaderboardGhost` renders 4 dashed placeholder rectangles (FACTIONS / LEADERBOARD / MINIMAP / PLAYER STATS) so the spatial constraint can be verified visually. | Mockup-only. Real game's UI replaces these.                                                            |
| 14 | Faction banner      | **D**      | Switched. `stamp` — wooden stamp, Lilita One block lettering, solid faction-color BG.                                                          | Used for ENDANGERED / ELIMINATED / RECOVERED.                                                         |
| 15 | Countdown           | **D**      | Switched. `blocky-flip` — dark wood block, yellow Lilita One text, chunky shadow. Pulses when intense.                                         | Replaces E's sundial.                                                                                  |
| 16 | Game-win FX         | **D**      | Switched. `voxel-rain` — 30 cubes rain down in winning color, bounce on island top.                                                            | The flag-rise from E is dropped (it's E-specific).                                                    |
| 17 | Minimap             | E (planned)| Nautical chart placeholder spec carried forward.                                                                                              | Implementation not in mockup.                                                                          |
| 18 | Motes               | E          | Sea-spray light blue (`0xe8f4ff`) instead of warm cream.                                                                                      | Cosmetic; auto-baseline-Y per island top.                                                              |

### 19.3 — Configuration flags introduced for F

Two new config keys + one new `outerGround` sub-flag, all backward-compatible:

```js
F: {
  // ...
  outerGround: {
    water: true,
    cylinder: true,        // NEW — switches builder to flat cylinder
    color: 0x1E6F7E, foam: 0xFFFFFF, sun: 0xFFE8B0,
  },
  notificationAnchor: "below-leaderboard",  // NEW
  showLeaderboardGhost: true,                // NEW (companion-only)
}
```

The legacy E config still works (no `cylinder`, no `notificationAnchor`, no `showLeaderboardGhost`) — F is purely additive.

### 19.4 — Game-side porting notes (when/if Slice A is retried with F)

**This section is SPECULATIVE — it assumes the Director picks F as the future game-side direction. F is currently mockup-only.**

Mapping for `prototype/` if F is later landed in the actual game:

| Companion file/section                       | Game file                       | Notes                                                                                                                                  |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `_buildWaterAndIsland()` flat-cylinder branch | `prototype/main.js`             | Replace E's sand+grass stack (lines added by commit b9e4c59) with a single CylinderGeometry. Set `_islandTopY = 0.6` at game scale (×6.689 if ARENA_RADIUS scaling kicks in — actually NO, cylinder dims tied to ARENA_RADIUS scale fine; only the height 0.6 may need a small bump for game-scale readability). |
| Bounce-floor `floorY = (_islandTopY + 0.1)`   | `prototype/main.js` particle update | Current game has hardcoded `Y < 0.1` checks in kill-FX physics. Change to `Y < islandTopY + 0.1`.                                       |
| `respawnStyle: "build-up"` baseY awareness    | `Character.respawn()`           | If respawn is implemented, it must use `Character.baseY = _islandTopY`, not Y=0.                                                       |
| `notificationStyle: "card-warm"` + anchor     | `prototype/ui.js`                | Replace driftwood plank notif with cream card. Anchor below `#player-leaderboard` element using its actual rect (similar to ui.js line 269 `getBoundingClientRect`). Real game has dynamic leaderboard height — anchor must be relative to its bottom, not a fixed pixel offset. |
| `bannerStyle: "stamp"`, `countdownStyle: "blocky-flip"`, `winStyle: "voxel-rain"` | new files / `prototype/ui.js` | Direct CSS port from §11/§12/§13 styles. |

**Estimated effort for full F port to game-side:** ~2 days (~16h) — most savings vs E come from reusing E's water shader and palette. The structural cylinder change is ~2h. The bounce-floor + respawn baseY fix is ~1h. The DOM HUD swap (notif/banner/countdown/win) is ~6h. Verification + screenshots is ~3h. The remainder is buffer.

### 19.5 — Verification screenshots

All taken at `http://127.0.0.1:7891/tools/companion/visual-direction.html` with viewport 1500×1100, scrolled to F's panel:

- `docs/visual-direction-mockups/r3/r3-f-baseline.png` — F at rest. Visible: flat cylinder, sandy cliff side, grass top with faction territory, cliff rocks on the rim, animated water outside, distant atoll, sailor-cap characters, all 4 HUD ghost rectangles, D's wood-block countdown.
- `docs/visual-direction-mockups/r3/r3-f-notif-anchored-below-leaderboard.png` — three A-style cream cards visible directly below the LEADERBOARD ghost rectangle. Spatial constraint satisfied: notifs do not overlap factions, leaderboard, minimap, or player-stats.
- `docs/visual-direction-mockups/r3/r3-f-voxel-rain-win.png` — D's voxel-rain mid-fall. Red cubes visible bouncing ON THE ISLAND TOP (no cubes falling into water), confirming the bounce-floor fix.
- `docs/visual-direction-mockups/r3/r3-e-regression-after-f.png` — E in its original sundial-countdown, dome-island form. Confirms F's additions did not regress E.
- `docs/visual-direction-mockups/r3/r3-fullpage-with-f.png` — full companion page with all 6 panels (REF / A / B / C / D / E / F).

### 19.6 — Open questions for Director

1. **Is F the future direction?** F is built mockup-only. The Director's request did not say "lock F as the new direction" — it said "implement Theme E again with the following changes." The mockup is one valid reading; another is "use the mockup to evaluate, then decide." Default assumption: mockup-only until explicitly approved.
2. **Cylinder height 0.6 vs alternative.** F uses 0.6 in mockup (mockup ARENA_RADIUS=16); at game scale (ARENA_RADIUS=66.89) the same ratio gives ~2.5u of cliff height. Does the Director want the cliffs visually taller (~3-4u) or shorter (1-2u)? Affects how dramatic the sea→island transition reads.
3. **Drop sailor caps?** The Director's request said "Optional — keep if it fits the cylinder vibe." Jen's call: keep them. They stitch F to E and add character at no perf cost. Confirm or override.
4. **Drop the wave-ripple claim FX?** It's E's. The Director's request enumerated kill/respawn/notification/countdown/banner/win as switching to D — claim was not explicitly mentioned. Default: keep E's wave-ripple (sea-themed, fits the world). If the Director wants D's stamp-wave for tactile consistency with the kill+respawn, easy switch (one config key).
5. **Real-game leaderboard anchor.** The mockup uses a fixed `top:146px` because the leaderboard ghost is fixed-height. Real game's `#player-leaderboard` has dynamic height (collapsed vs expanded with Tab). Notifications in the real game must anchor to `leaderboard.getBoundingClientRect().bottom + 8` so they always sit below regardless of state.

---

_F panel live mockup → `tools/companion/visual-direction.html` (panel id `scene-F`)._
_F's FX dispatch → `tools/companion/visual-direction.js` `DIRECTIONS.F` config + `_buildWaterAndIsland()` cylinder branch + `_buildLeaderboardGhost()` HUD ghosts._
_Status: 🟢 Mockup ready. Awaiting Director feedback on §19.6 questions before considering a game-side port._


---

## 20. Land Capture — Title-Screen Concepts (Round 1)

> **Status:** 🟡 Mockup ready, awaiting Director pick (or hybrid). 5 designs delivered, 4 posters delivered. Companion page: `tools/companion/title-screens.html`.

**Why this round.** Director request (verbatim, 2026-04-30): *"design a nice entrance page to the game, not just the white simple page we have now with user name + Solo / Online. I want a new page in the companion with about 5 web pages designs. the game is called Land Capture - generate a title and maybe add at the bottom a threeJS animation of an island and the water effect we just added? Generate some action-movie type posters using runcomfy and the characters and colors of the game."*

The current entry screen at `prototype/index.html#name-entry` is a flat white card with the heading "Territory War", a 16-char name input, and two unstyled buttons (green Solo / blue Online). The game has been rebranded **Land Capture**; this round delivers five entrance-screen design directions plus four action-movie poster studies for Director review.

**Constraint respected.** Mockup-only round. Zero changes to `prototype/`. New files live exclusively in `tools/companion/` and `docs/visual-direction-mockups/title-screens/`.

### 20.1 — Five title-screen designs

All five designs share the same primitive set so they compare apples to apples:

- 16-char name input
- "Solo" button (green/yellow per design)
- "Online" button (blue/black per design)
- "Land Capture" title (in-direction typography)
- Some form of supporting tagline

What varies is **everything else** — background, typography, palette source, layout, and animation cost.

| # | Design | Background | Title font / size | Live? | Perf est. |
|---|--------|-----------|-------------------|-------|-----------|
| 1 | **Cinematic Poster** | Pre-rendered Theme F overview, vignetted, faction-stripe edges | Bebas Neue 124px, 6px tracking, white knockout | No | ~0.0 ms/frame |
| 2 | **Live Atoll** | Live Three.js: Vanta water shader + cylinder island + cube character + 3 atolls + sky gradient | Lilita One 96px on cream "driftwood" card | **Yes** | ~0.5 ms/frame |
| 3 | **Faction Stripes** | Five vertical color stripes (Red/Blue/Green/Yellow/Purple) + bottom shadow gradient | Bowlby One SC 132px, 8px tracking, white knockout | **Yes** (5 cube chars on a shared canvas) | ~0.3 ms/frame |
| 4 | **Voxel Block Type** | Theme F sky gradient + procedural voxel-block letters in faction colors | Procedural — title IS the geometry (~330 BoxGeometry instances) | **Yes** | ~0.7 ms/frame |
| 5 | **Minimal Arcade** | Cream paper + flat SVG island silhouette w/ 5 mini cube characters | Lilita One 168px, deep-brown ink, -2px tracking | No | ~0.0 ms/frame |

Three of five include a live ThreeJS scene as the Director requested. The two static designs (Cinematic Poster, Minimal Arcade) are the lowest-cost-and-easiest-to-ship; the live ones are the most "this is what you'll get."

### 20.2 — Per-design specs

#### Design 1 — Cinematic Poster

- **Background**: Theme F overview screenshot, brightness ×0.78, vignetted (radial gradient corners → black). Faction-stripe hairlines (6px) at top and bottom.
- **Typography**: Bebas Neue 124px, white with 4px black drop-shadow stroke. Subtitle: Space Mono 18px, peach `#ffd29c`, 4px tracking.
- **Palette source**: Theme F game palette + faction key. Yellow Solo button + blue Online button match in-game wooden-stamp banners.
- **Layout**: Title + subtitle upper third, name input + buttons centered. Faction stripes top and bottom anchor the eye to the brand.
- **Perf**: Static — single CSS background-image, no canvas, ~0.0ms/frame.
- **When to ship this**: if the Director wants maximum drama at zero engineering cost. Drops in as a single CSS file on top of the existing `#name-entry` div.

#### Design 2 — Live Atoll · ThreeJS background

- **Background**: Live ThreeJS canvas reusing the EXACT Vanta water shader from `prototype/main.js` (vertex + fragment ported 1:1, MIT-attributed). Flat cylinder island (sand sides + grass top + dark base, multi-material), 6 cliff rocks scattered on the rim, 3 distant atolls fading into fog. Sky gradient (peach top → pale-teal bottom). Hero cube character standing on the island rim, idle-bobbing, cycling through faction colors every 4 seconds.
- **Typography**: Lilita One 96px (matches Theme F banner exactly). Subtitle Fredoka 17px. Both in `#5a3a20` (sailor-card warm brown).
- **Palette source**: Theme F notification palette (cream `#fff6e8`, warm-brown text `#5a3a20`, faction-color buttons). The cream card extends Theme F's notification system to the entry screen so the brand reads instantly.
- **Layout**: Cream "driftwood" card centered horizontally, slightly above center vertically. The character is positioned to the LEFT of the card so it peeks out and signals "this is gameplay."
- **Perf**: ~0.5 ms/frame on a typical laptop iGPU. Water shader alone is ~0.3ms (measured in the Theme F game ship). Plus character idle bob + 3 atolls + 6 cliff rocks. Capped at 60fps.
- **When to ship this**: if the Director wants the entrance to feel cinematic AND continuous with gameplay (the same water you'll see in-game animates behind the menu). Highest fidelity to the request.

#### Design 3 — Faction Stripes

- **Background**: Five equal vertical stripes in the exact game faction colors. Bottom 50% has a subtle gradient (transparent → black 35%) to ground the eye and add depth. A small ThreeJS canvas overlays the bottom of the stripes hosting five rotating cube characters (one per faction stripe) with sailor caps.
- **Typography**: Bowlby One SC 132px (a chunky SC-only display face), 8px tracking, knockout white with heavy 4px black drop-shadow. Subtitle Fredoka Bold 18px, white with 2px black shadow.
- **Palette source**: Faction palette IS the design. Title white is the only neutral. Button: white "SOLO" + black "ONLINE" with a 3px white border for high contrast against any stripe.
- **Layout**: Title spans all five stripes (the white knockout reads cleanly against any color). Form is centered in the lower-mid area, above the rotating chars.
- **Perf**: ~0.3 ms/frame — five small cubes orbiting on a single shared canvas, no shaders, no shadows, transparent bg.
- **When to ship this**: if the Director wants the strongest brand statement — "this is the faction war game." Reads from across the room. Fits the "blocky" north-star (Crossy Road, Paper.io 2). Carries the strongest faction-identity message.

#### Design 4 — Voxel Block Type

- **Background**: Sky gradient (peach `#FFD9AA` top → pale teal `#88B8D0` bottom) matching Theme F's sky.
- **Typography**: PROCEDURAL. The title IS the geometry. Each letter is a 5×7 voxel grid extruded to depth 2, ~330 BoxGeometry instances total ("LAND CAPTURE" = 11 letters × ~30 cubes/letter on average). Each letter is colored with a different faction color (rotation through the palette). Letters wobble subtly (sin-wave on Y rotation + Y position) so the type breathes.
- **Palette source**: Theme F sky + game faction palette literally on the title. Cream input + dark borders match the in-game wooden-stamp HUD.
- **Layout**: Title fills upper 70% of frame. Lower 28% has a cream gradient backdrop so the form panel reads cleanly without fighting the voxel letters.
- **Perf**: ~0.7 ms/frame. With InstancedMesh (one geometry, per-instance transforms) draw calls drop to 1 per material; without instancing it's ~330 draw calls but still under 1ms on integrated graphics.
- **When to ship this**: if the Director wants the most "authored, this game has personality" entrance. Maximum expression of the BoxGeometry-only ART_ETHOS principle. Most expensive of the five but still under budget.

#### Design 5 — Minimal Arcade

- **Background**: Cream paper `#f6efde` (matches Theme F notification card). SVG island silhouette across the bottom 32%: flat-color faceted waves (two layers, the back layer 50% opacity for depth), sand cylinder with grass strip, 5 cliff rocks, 5 faction-colored cube characters with sailor caps lined up across the rim, 2 distant atolls on the horizon faded.
- **Typography**: Lilita One 168px (matches Theme F banner exactly), -2px tracking, deep-brown ink `#1a0f08`. Subtitle Fredoka Bold 18px, 8px tracking, warm-brown.
- **Palette source**: Theme F notification card + deep-brown ink + faction-color cube chars. Buttons echo the in-game wooden-stamp banner: yellow Solo + black Online with 3px black borders and 5px hard-shadow offset (arcade-button feel).
- **Layout**: Title + subtitle upper-half. Form centered. Island silhouette anchors the bottom edge — the player can see at a glance "this is the world I'll play in."
- **Perf**: ~0.0 ms/frame — pure SVG, no canvas, no shaders.
- **When to ship this**: if the Director wants the entrance to be readable, accessible, mobile-friendly, and lowest-cost. Highest contrast of the five. The most "indie-arcade-cabinet" vibe.

### 20.3 — Action-movie posters

Four poster studies, each 1200×1500 (4:5 poster ratio), saved under `docs/visual-direction-mockups/title-screens/posters/`:

| File | Title / Tagline | Visual hook |
|------|----------------|-------------|
| `poster_a_five_factions.png` | **LAND CAPTURE — Five Factions. One Island.** | Theme F overview wide shot, vignetted, cinema-color graded; faction-color hairline stripes top/bot; black slab tagline + 5-square faction key in the lower third. |
| `poster_b_dominate_the_tide.png` | **DOMINATE THE TIDE — Land Capture** | Hero shot of a green character on the cylinder rim, teal+orange split-tone, diagonal green faction slash bar. Sequel-poster framing. |
| `poster_c_last_one_standing.png` | **LAND CAPTURE — LAST ONE STANDING** | Lone-survivor framing, near-monochrome desaturated grade, blue faction slash up the left side. Horror-film tension. |
| `poster_d_paint_the_world.png` | **LAND CAPTURE — PAINT THE WORLD** | Color-explosion starburst (alternating faction colors), inner cream disc with the title and 5 voxel-cube-with-sailor-cap avatars. Pure brand. |

**Generation note.** The Director's request mentioned "runcomfy." `RUNCOMFY_TOKEN` was not set in `jen/.env` and the local ComfyUI on port 8000 was not reachable from this WSL session, so the AI-gen path was unavailable. Fallback path used: PIL composition of the existing Theme F game screenshots with vignettes, cinema color grades, faction-stripe motifs, and procedural typography. This produces ON-BRAND posters built from in-game art, which is arguably stronger for the brief than off-brand AI-gen anyway. If the Director wants AI-generated alternatives, set `RUNCOMFY_TOKEN` in `jen/.env` and re-run the pipeline (`jen/tools/artgen/`).

Generator script: `jen/scripts/generate_title_posters.py`. Re-run anytime via `python3 jen/scripts/generate_title_posters.py` from the repo root.

### 20.4 — Recommendation

Jen's recommendation, in order of preference:

1. **Design 2 (Live Atoll)** — best matches the Director's explicit request ("threeJS animation of an island and the water effect we just added"), highest fidelity to in-game look, ~0.5ms/frame is well under budget. The cream card on top is a small cost vs the brand continuity it earns.
2. **Design 5 (Minimal Arcade)** — highest readability, mobile-friendly, lowest cost. Best fallback if the live scene causes any compatibility issues. Could also be the LOADING state that swaps to Design 2 once the WebGL is ready.
3. **Design 4 (Voxel Block Type)** — strongest brand statement that's also the most "authored" feel. Aligns hardest with the BoxGeometry-only ART_ETHOS. Most expensive but still well under budget.

If the Director wants a hybrid: **Design 2's live-atoll background + Design 5's huge Lilita One title + Design 4's faction-color cube avatars ON the island rim** would be a strong synthesis. (Adds ~0.1ms over Design 2 alone.)

### 20.5 — Verification

All taken at `http://127.0.0.1:7893/tools/companion/title-screens.html` with viewport 1440×900:

- `docs/visual-direction-mockups/title-screens/screens/r1-fullpage.png` — full page with all 5 designs + posters strip
- `docs/visual-direction-mockups/title-screens/screens/r1-design-1-cinematic.png` — Design 1 alone, 1280×720 mock
- `docs/visual-direction-mockups/title-screens/screens/r1-design-2-atoll.png` — Design 2 alone (live water visible, sand cylinder visible right of card)
- `docs/visual-direction-mockups/title-screens/screens/r1-design-3-stripes.png` — Design 3 alone (5 cube characters with sailor caps on each stripe)
- `docs/visual-direction-mockups/title-screens/screens/r1-design-4-voxel.png` — Design 4 alone (LAND CAPTURE in voxel cubes, faction-color rotation)
- `docs/visual-direction-mockups/title-screens/screens/r1-design-5-arcade.png` — Design 5 alone (cream paper, big bold title, SVG island)

Console: 0 errors, 0 warnings (only the cosmetic favicon 404). All three live ThreeJS scenes render cleanly.

### 20.6 — Open questions for Director

1. **Design pick (or hybrid).** Pick a primary direction; Jen will then port it to `prototype/index.html` + a small CSS file.
2. **Real water shader vs simplified.** Design 2 reuses the full Vanta shader from `main.js`. On low-end mobile the shader may be more than the entry screen needs. Should Jen prepare a "Design 2 mobile fallback" using a static gradient?
3. **Animation lock vs polish loop.** When porting the chosen design, should the screen auto-fade to gameplay after a name is entered (smooth transition) or hard-cut (current behavior)? Recommend smooth fade — adds ~10 lines of CSS, sells the entrance.
4. **AI-generated posters.** Should Jen retry the poster generation via RunComfy once a token is provided, or are the PIL-composed posters acceptable as-is? They're built from the actual game art so they're more "honest" than AI-gen would be.
5. **Tagline lock.** The 5 designs use 4 different taglines: "FIVE FACTIONS · ONE ISLAND" (Designs 1, 4, 5), "Claim territory. Hold the line. Dominate." (Design 2), "CLAIM · HOLD · DOMINATE" (Design 3). Pick a primary; Jen will lock it across the chosen design.

---

_Title-screens live mockup → `tools/companion/title-screens.html`._
_Logic + ThreeJS scenes → `tools/companion/title-screens.js`._
_Posters → `docs/visual-direction-mockups/title-screens/posters/`._
_Poster generator → `jen/scripts/generate_title_posters.py`._
_Status: 🟡 Mockup ready. Awaiting Director pick before any `prototype/` port._
