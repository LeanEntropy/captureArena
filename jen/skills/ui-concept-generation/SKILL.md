---
description: Generate multiple UI concept options for a game screen, review with director, produce ui-spec.json
globs: ["**/screens-spec.json", "**/art-direction.json", "**/ui-spec*.json"]
---

# UI Concept Generation

## When to Use
- Director asks: "show me options for [screen name]"
- Director asks: "design the [menu/HUD/settings] screen"
- Starting UI work for a new game
- Iterating on a screen after feedback

## Prerequisites
Before generating concepts, ensure these exist:
1. `screens-spec.json` — defines screen structure (elements, flow). If missing, generate it from the GDD first.
2. `art-direction.json` — defines palette, style, mood. Usually at `docs/art-direction.json` in the game project.
3. Art Companion server running — `python -m tools.artgen serve` (for browser review)

## Workflow

### Step −1: Prerequisite check (art-direction.json MUST exist)

Before anything else, verify that the project has a **locked art direction**:

```bash
test -f "<project>/art-direction.json" || echo "NO_ART_DIRECTION"
```

If `art-direction.json` is missing or unlocked, **stop this skill and invoke `concept-moodboard` first**. `ui-concept-generation` is downstream of `concept-moodboard`; it runs per-screen with a pre-established visual language. Attempting to generate per-screen concepts without a locked direction produces one of two failure modes:

1. **Style drift across screens**: each screen picks its own palette/mood, the game fragments visually (violates ART_ETHOS principle 7, cohesion over individual excellence)
2. **Hallucinated direction**: Jen invents a direction on the fly that the Director never approved, wasting review cycles when every generated variant gets rejected for off-brand palette

The correct response is:
```
🟡 art-direction.json not found for <project>. This skill requires a
   locked art direction. Run `concept-moodboard` first to establish
   the visual language, then return here for per-screen work.
```

This check is non-negotiable. Do not proceed without it.

**Exception**: if the Director explicitly says "just show me options, no direction yet" (exploration mode, one-off prototype, pre-greenlight spike), Jen may proceed but must flag that outputs are throwaway and NOT to be used as production reference.

### Step 0: Load Pattern Library (lazy-load 1-2 files per screen)

For the target `screen_id`, match it against the metagame UI pattern library and load the matching pattern file(s):

```bash
# Match screen_id against references/metagame_ui_library/*.md
# Load only the 1-2 matching files, not all 18
case "$screen_id" in
  main_menu|title_screen)    pattern="main_menu.md" ;;
  settings|options)          pattern="settings.md" ;;
  pause_menu|pause)          pattern="pause_menu.md" ;;
  shop|iap|store)            pattern="shop_iap.md" ;;
  inventory|bag)             pattern="inventory.md" ;;
  progression|skill_tree)    pattern="progression_skill_tree.md" ;;
  achievements|trophies)     pattern="achievements.md" ;;
  leaderboard|ranking)       pattern="leaderboards.md" ;;
  daily_rewards|calendar)    pattern="daily_rewards.md" ;;
  lives|energy)              pattern="lives_energy.md" ;;
  results|summary|end_level) pattern="results_summary.md" ;;
  confirm|dialog|modal)      pattern="confirm_dialog.md" ;;
  onboarding|tutorial)       pattern="onboarding_overlay.md" ;;
  toast|notification)        pattern="notification_toast.md" ;;
  loading|load_screen)       pattern="loading_screen.md" ;;
  profile|avatar)            pattern="profile_avatar.md" ;;
  language|locale)           pattern="language_select.md" ;;
  ads|ad_gate)               pattern="ads_gate.md" ;;
  *)                         pattern="" ;;  # novel screen — freeform fallback
esac

if [ -n "$pattern" ] && [ -f "references/metagame_ui_library/$pattern" ]; then
  cat "references/metagame_ui_library/$pattern"
fi
```

Extract from the loaded pattern file:
- **Layout skeleton** — the reference structure for this screen type
- **Interaction model** — taps/swipes/gestures expected
- **Asset requirements** — what images/icons/fonts this pattern needs
- **Engine component recipe** — the three.js / DOM / scene hierarchy that's known to work for this screen type
- **Contrarian alternatives** — any "actually this other approach is better" positions flagged in the pattern file

Use the pattern as the **default scaffold**; concept variants explore within its bounds. Each variant Jen produces should acknowledge the pattern's contrarian alternatives — e.g., if `progression_skill_tree.md` flags "tier list > node graph for >30 nodes on mobile," Jen should generate at least one tier-list variant when the game has many nodes.

**If no pattern matches** (novel screen, unusual game), fall back to freeform generation — but log a learning via `learnings_cli.py log --skill ui-concept-generation --type pattern --domain art-direction --key new-ui-pattern-<id>` so the pattern library can grow over time.

**Budget**: load 1-2 pattern files maximum per screen. Do NOT `cat` the whole library at session start.

### Step 0.5: Load Taste Memory

Before generating any concepts, load the Director's accumulated taste signals:

```bash
# Read the last 10 approved concepts and their feedback
ls -t experiments/ui-concepts/*/approved.json 2>/dev/null | head -10 | while read f; do
  cat "$f"
done
```

Extract the patterns across approved concepts:
- **Layout preferences** — centered vertical? left-aligned? split panel? radial?
- **Color treatment** — moody/dark? vibrant? high-contrast?
- **Visual density** — minimal? balanced? dense?
- **Director phrases** — specific words they used to explain picks ("too busy," "loved the gold accent," etc.)

Write a **Taste Bias** note at the start of this session: "Based on last N approved concepts, the Director leans toward [patterns]. I'll weight new concepts with this bias — but NOT make all variants look the same; I still need to present real alternatives."

The taste memory is a bias, not a mandate. It steers the center of the distribution, not the variance. The stretch concept should still challenge the bias.

If `experiments/ui-concepts/` is empty or has fewer than 3 entries, note that Jen is still in taste-calibration mode and should explicitly present more divergent concepts to help the Director reveal preferences.

### Step 1: Load Context
- Read `screens-spec.json` to find the target screen's elements, transitions, and type
- Read `art-direction.json` for palette, artStyle, mood, resolution
- Identify the screen type (menu, overlay, hud, dialog, fullscreen) — this affects layout patterns

### Step 2: Design Concepts (3-5 variations)

**Optional: Infinite Agentic Loop pattern for N-variant sweeps.**
When the Director asks for a wide exploration (>5 variants, or "show me everything"), use parallel subagents instead of generating concepts inline:

1. Write a short brief (screen spec + art direction + taste bias from Step 0) — ≤300 lines.
2. Dispatch N parallel subagents, each with the same brief but a different assigned axis to vary (layout / color treatment / density / mood).
3. Each subagent returns exactly one concept with full HTML, palette, and rationale.
4. Synthesize + rank using taste bias; present the top 3-5 to the Director.

This pattern costs tokens but produces genuinely divergent concepts instead of Jen's hand-rolled variations (which tend to cluster around Jen's own default). Use it for big screens (main menu, first-impression screens) and skip it for routine sub-screens.

**For each concept**, vary ONE major axis while keeping others consistent:
- **Layout variations:** centered vertical, left-aligned, split panel, radial, bottom-anchored
- **Color treatment:** dark/moody, vibrant/saturated, muted/elegant, high-contrast
- **Visual density:** minimal/spacious, medium/balanced, dense/information-rich

Each concept needs:
- A name (e.g., "Concept A: Dark Cathedral")
- A brief description (1 sentence)
- The palette (4-6 hex colors extracted from art-direction.json + variations)

**Taste-bias application**: when picking which 3-5 concepts to present, weight toward the taste patterns from Step 0. BUT always include at least one concept that deliberately breaks the pattern — this is how Jen discovers when the Director's taste has shifted.

### Step 3: Generate HTML/CSS Previews
For each concept, generate a self-contained HTML page that visually represents the screen at the target viewport size.

Template structure:
```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: {viewport.width}px;
    height: {viewport.height}px;
    background: {palette.background};
    font-family: 'Segoe UI', system-ui, sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  /* ... concept-specific styles ... */
</style>
</head>
<body>
  <!-- Screen elements matching screens-spec.json -->
</body>
</html>
```

Rules for HTML concepts:
- Use the EXACT viewport dimensions from screens-spec.json
- Include ALL elements from the screen spec (every button, label, etc.)
- Apply palette colors from art-direction.json
- Use web-safe fonts that approximate the intended game fonts
- Make buttons look like game buttons (not web buttons)
- Add subtle visual effects (gradients, borders, shadows) appropriate to the art style
- Each concept should look genuinely different — not just color swaps

### Step 4: Generate Flux Mockup Images (Optional)
If the director wants visual mood exploration alongside coded previews:
```bash
python -m tools.artgen gen \
  --prompt "Game {screen_type} screen, {art_style} style, {mood}, {viewport.width}x{viewport.height}, {palette_description}, {element_description}, UI design mockup, sharp, high quality" \
  --session {session_id} \
  --asset-type ui_concept \
  --asset-name {screen_id}_concept_{letter} \
  --aspect-ratio {aspect_ratio}
```

Prompt engineering for UI mockups:
- Always include "UI design mockup" or "game menu screen" in prompt
- Describe the layout verbally: "centered vertical button layout with 3 buttons"
- Include color descriptions: "dark purple and gold color palette"
- Specify resolution: "720x1280 portrait" or "1280x720 landscape"
- Add "no text" if Flux text rendering is unreliable for the model

### Step 5: Display in Art Companion
Use the concept_comparison page template:
```python
from tools.artgen.pages.concept_comparison import render_concept_comparison

concepts = [
    {
        "id": "concept_a",
        "name": "Concept A: Dark Cathedral",
        "description": "Ornate fantasy with heavy stone borders and gold accents",
        "image_path": "/path/to/flux_mockup_a.jpg",  # or None
        "html_preview": html_a,  # the full HTML string
        "palette": ["#1a1a2e", "#16213e", "#e94560", "#ffd700", "#eaeaea"]
    },
    # ... more concepts
]

html = render_concept_comparison(screen_id, screen_name, concepts, data_dir)
companion.push_page(screen_dir, f"{screen_id}_concepts.html", html)
```

### Step 6: Wait for Director Selection
After pushing to the companion, tell the director:
"I've pushed {N} concepts for {screen_name} to the companion at {url}.
Please review and either:
- Click 'Select Direction' on your preferred concept
- Tell me what you'd like to combine (e.g., 'layout from A, colors from C')
- Give me feedback and I'll generate new options"

Then run `artgen sync` to read the director's selection from .events.

### Step 7: Generate ui-spec.json
From the approved concept direction, generate the per-screen ui-spec.json:

```json
{
  "screen": "{screen_id}",
  "source_screen_spec": "screens-spec.json#{screen_id}",
  "viewport": { "width": 720, "height": 1280 },
  "palette": {
    "primary": "#1a1a2e",
    "secondary": "#16213e",
    "accent": "#e94560",
    "text": "#eaeaea",
    "text_muted": "#8888aa"
  },
  "typography": {
    "title": { "font": "assets/fonts/title_font.ttf", "size": 48 },
    "button": { "font": "assets/fonts/ui_font.ttf", "size": 24 },
    "body": { "font": "assets/fonts/ui_font.ttf", "size": 18 }
  },
  "elements": [],
  "styles": {},
  "assets_needed": []
}
```

Rules for ui-spec.json (engine-neutral; the downstream engine renderer adapts):
- Every element from screens-spec.json must appear
- `node_type` is the abstract role: `panel`, `button`, `label`, `image`, `vbox`, `hbox`, `grid`, `stack`. The engine renderer maps this to its concrete component (three.js DOM/CSS, Godot Control, etc.)
- Colors must come from the palette (use palette key references where possible)
- Fonts reference relative paths from the project root
- `anchor_preset` values: `full_rect`, `center`, `top_center`, `bottom_center`, `top_left`, etc. — engine-neutral semantic anchors
- Buttons need `min_size` (typically [200-300, 48-64] for mobile)
- Container separation (vbox/hbox): 12-24px typical
- Panels and buttons default to a flat fill style (no image assets needed) unless the concept calls for it

### Step 8: Generate Assets
For items in `assets_needed`:
- **Backgrounds:** Generate via artgen at viewport resolution
- **Icons:** Write SVG inline, render to PNG via Playwright
- **Decorative elements:** Generate via artgen with transparency (future)

Save ui-spec.json to the game project: `{project}/.artgen/ui_specs/{screen_id}.json`

### Step 9: Write Taste Memory

After the Director picks a winner (or combines variants), write an `approved.json` record to close the taste-learning loop:

```json
{
  "ts": "2026-04-10T12:34:56Z",
  "screen_id": "main_menu",
  "chosen_concept": "concept_b",
  "variants_shown": ["concept_a", "concept_b", "concept_c"],
  "layout": "centered vertical",
  "color_treatment": "moody dark + gold accent",
  "density": "minimal",
  "palette": ["#1a1a2e", "#16213e", "#ffd700", "#eaeaea"],
  "director_feedback": "Loved the gold accent, wanted slightly more breathing room in the button stack. Asked to combine B's colors with A's spacing.",
  "tags": ["dark-fantasy", "mobile-portrait", "vertical-layout"]
}
```

Save to: `experiments/ui-concepts/<YYYY-MM-DD>_<screen_id>/approved.json`.

Also log a learning:
```bash
python tools/learnings_cli.py log \
  --skill ui-concept-generation \
  --type preference \
  --key ui-taste-<dominant-pattern> \
  --insight "<one sentence summarizing what the Director picked and why>" \
  --confidence 7 \
  --source user-supplied
```

This is how Jen gets smarter at reading the Director's taste over time. Skipping Step 9 means every new screen starts from zero — the whole point of taste memory is compound calibration.

## Multi-Screen Flow
When working on multiple screens:
1. First screen establishes the visual language (full 3-5 concept treatment)
2. Extract a `theme_base` from the approved first screen (palette, typography, button/panel styles)
3. Subsequent screens inherit theme_base — only generate 1-2 layout variations
4. Novel screens (HUD, inventory) may need full concept exploration
5. After all screens approved, do a consistency review pass

## Art Direction Principles (Jen's Rules)
Apply these when creating concepts:
1. **Palette discipline** — Max 5-6 colors. One dominant, one accent, rest supporting.
2. **Visual hierarchy** — Title > primary action > secondary actions > info. Size and contrast create hierarchy.
3. **Readability at scale** — Test at target resolution. Mobile buttons need min 48px height.
4. **Constraint creates identity** — Define visual rules per game and reject what breaks them.
5. **Authored feel** — Avoid generic AI smoothness. Add intentional asymmetry, hand-crafted touches.
6. **Cohesion over excellence** — Consistent average beats inconsistent peaks across all screens.
