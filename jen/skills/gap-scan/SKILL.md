---
name: gap-scan
description: Identify what Jen does not know — uncertainty zones across tools, art stack coverage, memory staleness, and Director preferences. Produces a report that feeds proactive-loop. Can also run standalone when the Director asks "what don't you know?"
origin: Jen-native, designed from first principles during Phase 1 rollout (2026-04-10)
---

# gap-scan

A short diagnostic skill that asks: **what should Jen know, but doesn't?** It produces an uncertainty-zone report that `proactive-loop` uses as one of its signal sources. It is also directly invocable when the Director wants an honest self-assessment.

This skill is not about debugging a specific failure. It is about mapping the blank spots on Jen's map.

---

## When to Use

**Automatically:**
- Called as a signal source by `proactive-loop` before it generates proposals.
- Called by `research-session` at Step 1 (Load Context) to prime the session with honest uncertainty awareness.

**On demand:**
- When the Director asks "what don't you know?" or "where are you weak?" or "what are we missing?"
- Before Jen commits to a `decision` or `plan` gate — know the gaps before presenting confidence.
- After a major milestone (phase complete, research thread closed) — check whether the milestone revealed new gaps.
- When Jen has been running hot on one topic and wants a sanity check that she isn't drifting into a single-topic trap.

**Do NOT use:**
- As a brainstorm input (`brainstorming` skill does that differently).
- To evaluate a specific tool (`research-session` with a targeted brief does that).
- To generate task proposals (`proactive-loop` does that; gap-scan only surfaces the *uncertainty*).

---

## The Scan

Run these four scans in parallel. Each is short — budget 1–2 tool calls per scan. The goal is map, not deep dive.

### Scan A — Art stack coverage

Compare current skills + memory + backlog against Jen's target art stack:

| Area | Covered if Jen has... |
|---|---|
| **2D textures / tileable backgrounds** | working skill + proven workflow in `comfyui-art-generation` |
| **2D sprites / characters** | workflow + LoRA discipline + silhouette-at-64px test |
| **Sprite animation / frame sequences** | workflow OR an open backlog item with an owner |
| **3D models** | skill OR a deliberate "cloud-only, deferred" decision logged |
| **Rigging / skeletal animation** | ditto |
| **VFX / particles / shaders** | three.js integration pattern + ComfyUI-to-three.js pipeline |
| **Transitions / screen effects** | documented approach or a flagged gap |
| **UI / HUD** | `ui-concept-generation` + three.js scene rendering pipeline working |
| **Metagame screens** | workflow covering menus, shops, inventories, progression |
| **Icons / portraits** | workflow + consistency discipline |
| **Art direction / style guides** | `ART_ETHOS.md` + per-project style guide pattern |

For each row, output: `covered | partial | gap | deferred-by-decision`.

### Scan B — Tool/model coverage

What tools are mentioned in learnings, research docs, or the backlog but Jen has not actually evaluated?

- Grep `research/*.md` and `memory/learnings.jsonl` for tool names.
- Cross-reference against tools Jen has actually run (from `timeline_cli.py last --limit 100 --kind skill_end`).
- Output: a list of "mentioned but untried" tools ranked by how often they're mentioned.

### Scan C — Memory staleness

- List memories in `memory/` with `last_verified` older than 21 days.
- List learnings with effective confidence ≤2 (decayed near zero).
- List backlog items with `Status: pending` and no updates in the last 14 days.
- Output: the stalest 5 items per category.

### Scan D — Director-preference coverage

- Read all `feedback_*.md` memories.
- For each, ask: "has Jen applied this in the current sprint?" — scan recent work for evidence.
- Output: feedback memories that may have drifted out of active practice.

---

## Report Shape

```markdown
## Gap Scan — <YYYY-MM-DD HH:MM>

### Art Stack Coverage
| Area | Status | Note |
|---|---|---|
| 2D textures | covered | Flux Dev fp8 + tileable ext |
| Sprite animation | gap | no skill, no open backlog item |
| 3D models | deferred | cloud-only per 2026-04-10 decision |
| Metagame screens | partial | `ui-concept-generation` exists, no metagame-specific patterns |
| ...

### Untried Tools
- [tool-name] — mentioned Nx across research/backlog, not yet evaluated — lead: <link>
- ...

### Stale Memories
- [name] — last_verified 42d ago — likely stale, worth reviewing
- ...

### Stale Learnings
- [key] — effective confidence 1/10, last seen 60d ago — consider prune
- ...

### Director Preferences Possibly Drifting
- [feedback_name] — no evidence in last 5 sessions — worth re-checking
- ...

### Honest Summary
<2-4 sentences: what is Jen's biggest blind spot right now, based on the scan? Write this paragraph like an honest self-report, not a status page.>
```

---

## Handoff to proactive-loop

When gap-scan is invoked by `proactive-loop`, return only the structured data (no narrative). The report shape above is for human consumption; proactive-loop consumes the tabular signals directly.

When invoked by `research-session`, write the report to `docs/session-notes.md` under a `## Gap scan (session start)` section so it frames the session.

When invoked on demand by the Director, present the report inline in the CLI and offer follow-up actions.

---

## Anti-Patterns

- **Running gap-scan instead of just doing the work.** If Jen knows what to do, do it. Gap-scan is for when the map has blank spots, not for avoiding action.
- **Treating every stale memory as a problem.** Some memories should decay. The scan surfaces candidates; Jen's judgment decides which matter.
- **Using gap-scan as procrastination.** If gap-scan output is used to avoid shipping, the skill is being misused. The point is to *know* the gaps, not to close all of them before moving.
- **Producing a gap-scan report and not handing it to proactive-loop.** The value of gap-scan is compounded when it becomes input to the proactive engine.
- **Being falsely modest.** "Everything is a gap" is useless. "This specific thing is a gap for this specific reason" is valuable.
- **Being falsely confident.** If Jen's scan comes back "no gaps," either the scan is shallow or Jen is not being honest with herself. Run it again with a wider net.

---

## Related Skills

- `proactive-loop` — primary consumer of gap-scan output.
- `research-session` — uses gap-scan at Step 1 to prime session awareness.
- `self-improvement` — uses gap-scan at session wrap to decide whether new skills should be created.
- `council` — if gap-scan surfaces a blind spot that affects a pending decision, the council should hear about it before the decision gate.

---

*Jen-native skill. Designed from first principles on 2026-04-10 to give Jen a vocabulary for honest self-assessment, because the 5-repo evaluation found that every repo assumed agents knew their own weaknesses — none provided a mechanism for discovering them.*
