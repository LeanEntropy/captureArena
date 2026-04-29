---
name: art-investigate
description: Systematic debugging of art generation failures. 3-strike rule, pattern catalogue (seed collapse, CFG overcook, LoRA conflict, prompt bleed, style drift, palette hijack), forces hypothesis before retry, escalates after 3 failures with an evidence brief. Use whenever a ComfyUI run produces output that fails ART_ETHOS principles.
origin: adapted from gstack /investigate + ECC agent-introspection-debugging, with an art-specific pattern catalogue
---

# art-investigate

When a generation produces output that **fails** (unreadable at 64px, wrong palette, style drift, broken tiling, bad anatomy, generic AI slop), **stop**. Do not retry blindly. Run this skill.

The rule: **three informed attempts, then escalate with evidence**. No blind retries. No "one more seed and it'll work." Each attempt must be grounded in a hypothesis about why the previous attempt failed.

This skill is adapted from gstack `/investigate` and ECC `agent-introspection-debugging`, with an art-specific pattern catalogue and the `ART_ETHOS.md` principles as the definition of "failure."

---

## When to Use

**Always, when:**
- A ComfyUI / generation run produces output that fails any `ART_ETHOS.md` principle.
- The Director looks at output and says "no" without detailed feedback.
- Jen herself looks at output and thinks "that's not right" — trust the gut; the gut is the instinctive application of ART_ETHOS.
- A previously working workflow suddenly degrades.
- Output that passed yesterday is failing today.

**On demand:**
- Director asks "what went wrong with that batch?"
- Jen is about to queue a large batch and wants to de-risk first.

**Do NOT use:**
- For subjective "I'd like it better this way" feedback — that's iteration, not failure.
- For decisions about which tool to use — that's `council` or `research-session`.
- For tool evaluation — that's `research-session`.
- When the failure is obviously external (ComfyUI crashed, VRAM OOM, file missing). Fix the obvious thing first; only invoke art-investigate when the failure is *in the output*.

---

## The 3-strike rule

```
attempt 1 → failed → hypothesis → attempt 2 → failed → new hypothesis → attempt 3 → failed → ESCALATE
```

Between attempts, Jen MUST:
1. Name what failed, in ART_ETHOS terms.
2. Propose a hypothesis from the pattern catalogue (below).
3. Make **one** change grounded in the hypothesis — not five.
4. Log the hypothesis + the change in `learnings_cli.py` as `type=pitfall, domain=debugging`.

After three failed attempts, Jen **stops retrying** and writes an evidence brief (format below). The brief goes to the Director or into `docs/backlog.md` as a new research item, whichever fits.

No blind 4th attempt. No "just one more." The 3-strike rule exists because art generation has a depressing long-tail of "kinda works" where Jen can burn hours chasing a solution that never converges.

---

## Pattern Catalogue (hypotheses to start from)

When a generation fails, pattern-match against these first. These are the failure modes Jen has seen or will see. Expand the catalogue as new patterns emerge (via `learnings_cli.py log --type pitfall --domain debugging`).

### Seed collapse
**Symptoms**: Multiple outputs look nearly identical despite different seeds. Composition is trapped in one attractor.
**Likely cause**: CFG too high, prompt too prescriptive, or LoRA too strong. The model is stuck.
**Fix candidates**: Lower CFG (1-2 points), weaken the most dominant LoRA, remove the most specific keyword in the prompt.

### CFG overcook
**Symptoms**: Overcooked contrast, over-saturated colors, artifacts at high-contrast edges, generic "hyperreal" look.
**Likely cause**: CFG > 8 (for Flux) or > 10 (for SDXL).
**Fix candidates**: Drop CFG to 3.5-5 for Flux, 6-7 for SDXL. Re-run same seed.

### LoRA conflict
**Symptoms**: Style is muddy or inconsistent across batch. Sometimes it reads style A, sometimes style B.
**Likely cause**: Two LoRAs fighting for style dominance, or a LoRA trained on a different base model.
**Fix candidates**: Disable LoRAs one at a time to find the conflict. Check base model compatibility. Reduce weights to 0.5-0.7 range.

### Prompt bleed
**Symptoms**: Unintended elements appear (wrong faction color, extra limbs, text artifacts, wrong outfit).
**Likely cause**: A keyword in the positive prompt has unintended semantic pull — often an artist name or style tag dragging in associated imagery.
**Fix candidates**: Strip artist name references. Replace abstract style words with concrete visual descriptors. Move the bleed term to negative prompt.

### Style drift
**Symptoms**: Output is technically fine but doesn't match the project's established style. Subtle — reads as "not ours."
**Likely cause**: Drift from the original sampler/scheduler/seed set, or a silent base-model swap.
**Fix candidates**: Pin sampler, scheduler, and steps to the known-good values. Diff the current workflow JSON against the last known-good one. Check for silent model path changes.

### Palette hijack
**Symptoms**: Colors drift toward a prompt-implied palette even though art-direction.json specifies different colors.
**Likely cause**: Words in the prompt pulling color associations ("dark", "glowing", "fantasy") override explicit palette constraints. Flux/SDXL cannot directly constrain palette.
**Fix candidates**: Use img2img from a palette-correct reference image. Post-process with palette-matching script. Strip color-implying words from the positive prompt.

### 64px failure
**Symptoms**: Output looks fine at full resolution but unreadable at 64px (game scale).
**Likely cause**: Silhouette is too busy, value contrast is too flat, details dominate instead of shape.
**Fix candidates**: Stronger silhouette cue in prompt ("bold silhouette", "strong outline"). Simpler color regions. Post-process downscale test before accepting output.

### Generic AI slop
**Symptoms**: Technically sharp but feels "generated" not "authored." No artistic character. Would fit any game.
**Likely cause**: Prompt reached for "8K masterpiece, ultra-detailed, ray-traced" type tropes that produce averaged style.
**Fix candidates**: Strip all generic quality words. Describe the *style* concretely ("flat vector shapes with hand-drawn outlines"). Reference classical art movements, not contemporary styles. See `ART_ETHOS.md` anti-patterns.

### Anatomy collapse
**Symptoms**: Hands, faces, perspective, or pose broken in a way that doesn't fix with retries.
**Likely cause**: Model weakness at the specific anatomical challenge, not a prompt issue.
**Fix candidates**: ControlNet pose/depth to constrain. Inpaint the broken region. Switch approach (e.g., don't generate hands at all, keep them off-screen in composition).

### Tiling seam
**Symptoms**: Tileable texture has visible seam.
**Likely cause**: Seamless tiling extension not enabled, or the seed is bad for tiling.
**Fix candidates**: Verify tiling extension is active. Try 3-5 different seeds specifically; tiling is seed-sensitive. Post-process with frequency-domain seam hiding.

### Unknown
If the failure doesn't match any pattern above, **say so explicitly** and log a new pattern via `learnings_cli.py log --type pitfall --domain debugging --key <new-pattern-name>`. Growing the catalogue is part of the skill.

---

## Workflow

### Step 1: Name the failure in ART_ETHOS terms

Before any hypothesis, Jen writes one line identifying which principle the failure violates:

> "Principle 10 (simplicity over detail) — at 64px this sprite is just noise, the silhouette is unreadable."

If Jen cannot name the violated principle, the issue is probably **taste disagreement**, not **failure**. Stop and ask the Director for specific feedback instead of running art-investigate.

### Step 2: Match against the pattern catalogue

Pick the closest pattern. If two patterns both fit, pick the one with the cheaper fix and try that first.

### Step 3: Form the hypothesis

Write the hypothesis in full sentences before changing anything:

> "Hypothesis: CFG overcook. CFG is at 9.5 which is too high for Flux Dev fp8. Expect softer colors and reduced artifact edges at CFG 4.5."

### Step 4: Make exactly ONE change

The temptation is to change CFG + prompt + LoRA + seed simultaneously. Don't. Then you won't know what fixed it. One change per attempt.

### Step 5: Log the attempt

```bash
python tools/learnings_cli.py log \
  --skill art-investigate \
  --type pitfall \
  --domain debugging \
  --key <pattern-name>-<short-context> \
  --insight "CFG 9.5 caused overcooked contrast in terrain_grass_v3 batch. Dropped to 4.5, soft shadows returned." \
  --confidence 6 \
  --source observed
```

### Step 6: Re-run and evaluate

If fixed: log a pattern learning with `--type pattern --confidence 8`, update the workflow comment with the known-good value, done.

If still failing: return to Step 2 with a new hypothesis. Do NOT re-use the same pattern without new information.

### Step 7: Third failure → escalate with an evidence brief

After three failed attempts, stop. Write an evidence brief:

```markdown
# Art Investigation Brief — <asset name>

## What failed
- <ART_ETHOS principle violated>
- <specific observable symptom>

## What was tried
| Attempt | Hypothesis | Change | Outcome |
|---|---|---|---|
| 1 | [pattern] | [one change] | [observed result] |
| 2 | [pattern] | [one change] | [observed result] |
| 3 | [pattern] | [one change] | [observed result] |

## What I know for sure
- <facts verified across the three attempts>

## What I don't know
- <honest list of uncertainties>

## Proposed next moves
1. Consult Director on taste question (if the failure is subjective)
2. Switch tools / models (if Flux is not the right model for this)
3. Open a research backlog item (if this is a systemic gap)
4. Abandon the asset (if no path forward)

## Recommendation
<one line: which of the 4 moves Jen recommends and why>
```

Save to `experiments/art_investigations/<date>_<asset>.md` and present to the Director (or push to Telegram if AFK).

---

## Anti-Patterns

- **Blind retry.** Running the same workflow with a new seed and hoping. If Jen catches herself doing this, stop and form a hypothesis.
- **Change five things at once.** Changes the pattern catalogue wants you to isolate. Cost: you won't know what fixed it.
- **"Just one more attempt."** The 3-strike rule exists to prevent exactly this. Three attempts then escalate. Every time.
- **Treating taste disagreement as failure.** If Jen can't name a violated ART_ETHOS principle, it's not a failure — it's a preference call. Ask the Director, don't invoke art-investigate.
- **Skipping the logging.** Every attempt gets a learning logged. The pattern catalogue grows from those logs. Skipping the logging means the next failure restarts from zero.
- **Running art-investigate for 4-batch rejections.** Run it once per distinct failure mode per batch. If 10 batches all fail the same way, that's ONE investigation, not ten.
- **Burning the Director's attention on unfinished investigations.** The escalation happens after investigation, not during. Don't push "I'm trying things" — push "here's the brief."

---

## Related Skills

- `council` — use when the investigation concludes that the failure is ambiguous and needs multiple lenses (e.g., "is this an ART_ETHOS violation or a taste drift?").
- `comfyui-art-generation` — the execution skill for the retries.
- `learnings_cli` — the logging target for every attempt.
- `proactive-loop` — consumes the accumulated pitfall learnings as a signal source; if a pattern repeats across investigations, proactive-loop will surface it as a promotion candidate (evolution signal).
- `skill-stocktake` (Phase 2) — if an investigation produces a stable workflow improvement, stocktake may flag it as a skill update opportunity.

---

## Storage

- Failed attempt logs → `memory/learnings.jsonl` (via learnings_cli) with `type=pitfall, domain=debugging`
- Successful fixes → same file, `type=pattern`, higher confidence
- Escalation briefs → `experiments/art_investigations/<date>_<asset>.md` (tracked, durable)
- New patterns discovered → added to this skill's catalogue (via skill update) when the same pattern appears 3+ times across investigations

---

*Adapted from gstack /investigate (general-purpose root-cause debugging) and ECC agent-introspection-debugging (4-phase capture/diagnose/recover/report), with a Jen-specific pattern catalogue keyed to ART_ETHOS principles as the definition of failure.*
