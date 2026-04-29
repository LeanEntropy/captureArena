---
name: skill-stocktake
description: Periodic audit of Jen's skill inventory. Produces Keep/Improve/Update/Retire/Merge verdicts per skill, grounded in usage data from the timeline. Feeds self-improvement and skill-creator. Run weekly or on demand when skill surface feels bloated.
origin: adapted from ECC skill-stocktake with Jen-specific signal sources
---

# skill-stocktake

Every skill in `.claude/skills/` is a maintenance liability. A skill that nobody invokes, duplicates another skill, or no longer matches the workflow it was written for is a tax on every future session's context window and on Jen's own mental model of what tools she has.

This skill runs a periodic audit and produces explicit verdicts. It does not autonomously delete or rewrite skills — it produces decisions for the Director or for `skill-creator` to execute.

---

## When to Use

**Automatically:**
- At the end of every `retro` skill run, if ≥4 weeks have passed since the last stocktake.
- When `retro` reports that 3+ skills haven't been invoked in the window.
- When `context-budget` skill flags skill surface bloat.

**On demand:**
- When Jen notices she's been reaching for the same 3 skills and ignoring the others.
- When the Director says "what skills do you have?" and Jen realizes she's not sure.
- Before creating a new skill (to check if one already exists that could be updated instead).

**Do NOT use:**
- Right after creating a new skill (the signal is too thin).
- As a substitute for `skill-creator` — stocktake decides what to change, skill-creator executes.
- During active work (stocktake is reflection, not execution).

---

## Inputs

| Source | What to extract |
|---|---|
| `.claude/skills/*/SKILL.md` | Full skill inventory with frontmatter + line counts |
| `memory/timeline.jsonl` | Skill invocation counts from `kind: skill_start`/`skill_end` events |
| `memory/learnings.jsonl` | Learnings tagged to each skill (indicates active use + refinement) |
| Recent research docs in `research/` | Which skills the docs mention, as a secondary usage signal |
| `docs/session-notes.md` | Any skill the Director has flagged as painful or missing |

Budget: ≤6 tool calls total. Stocktake is a reflection skill, not a deep audit.

---

## The Five Verdicts

For each skill, assign one verdict with a one-sentence reason:

| Verdict | Definition | Action |
|---|---|---|
| **Keep** | Used regularly, fits its purpose, no changes needed | No action |
| **Improve** | Used regularly but feels thin or missing something | Invoke `skill-creator` with improvement scope |
| **Update** | Used but contains stale facts, deprecated tools, or wrong model versions | Targeted edit to refresh outdated sections |
| **Retire** | Unused for ≥2 stocktake cycles (≥8 weeks), no clear revival signal | Move to `.claude/skills/archive/` with a reason header |
| **Merge** | Overlaps substantially with another skill; the split is artificial | Propose a merged skill to `skill-creator`, keep one, archive the other |

**Decision-enabling reason required.** A verdict without a reason that would let someone else understand the call is an incomplete stocktake. Don't write "Keep — looks fine"; write "Keep — invoked 4x this window, Director explicitly referenced its output during concept review, zero pending updates in learnings."

---

## Workflow

### Step 1: Inventory

List every file matching `.claude/skills/*/SKILL.md`. For each, record:
- Skill name (from frontmatter)
- Line count
- Last modified date (from git log, if available)
- Whether it has a structured frontmatter contract

### Step 2: Signal gathering

For each skill, count:
- **Invocations this window** (from timeline.jsonl `kind:skill_start` where `skill:<name>`)
- **Learnings this window** (from learnings.jsonl where `skill:<name>`)
- **Research mentions** (grep `research/*.md` for the skill name)
- **Director mentions** (grep `comms/telegram_log.md` and `docs/session-notes.md`)

Build a per-skill signal row.

### Step 3: Verdict assignment

For each skill, apply the decision tree:

```
1. Invocations == 0 AND no learnings AND no mentions → RETIRE candidate
2. Invocations > 0 AND learnings exist AND no stale facts → KEEP
3. Invocations > 0 AND learnings flag gaps / frustration → IMPROVE
4. Invocations > 0 AND file references dead tools / old versions → UPDATE
5. Skill's signal rows look nearly identical to another skill's → MERGE candidate
```

When two verdicts could apply, prefer the less destructive (Keep > Update > Improve > Merge > Retire).

### Step 4: Conflict-check verdicts

Before finalizing, sanity-check:

- **Retire candidates**: look for any research doc mentioning the skill in the last 4 weeks. If found, downgrade Retire → Keep (low signal ≠ no signal).
- **Merge candidates**: spot-check that the two skills actually do overlap in practice, not just in description.
- **Update candidates**: make sure the "stale fact" is real, not just old wording.

### Step 5: Produce the report

Write to `memory/retros/stocktake-<date>.md`:

```markdown
# Skill Stocktake — <date>
*Window: <start> → <end>*

## Inventory
N skills total, M lines avg.

## Verdicts
| Skill | Invocations | Learnings | Verdict | Reason |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Retire candidates
- [skill] — <reason> — last used: <date>

## Improve candidates
- [skill] — <reason> — suggested improvement: <what>

## Update candidates
- [skill] — <reason> — what's stale: <what>

## Merge candidates
- [skill_a] + [skill_b] — <overlap rationale> — suggested merged name: <what>

## Overall health
<2-3 sentences: is the skill surface healthy, bloated, or anemic?>

## Actions for skill-creator
1. ...
2. ...
```

### Step 6: Hand off

- Merge/Retire candidates → present to Director for approval before execution.
- Update candidates → Jen can execute autonomously (targeted edits to stale sections).
- Improve candidates → invoke `skill-creator` with the specific improvement scope.
- Keep verdicts → no action.

Log the stocktake in timeline: `python tools/timeline_cli.py append --kind custom --skill skill-stocktake --summary "stocktake <date>: N keep, N improve, N update, N retire candidate, N merge candidate"`.

---

## Anti-Patterns

- **Retiring a skill on one window of silence.** Some skills only fire once per month (e.g., retro itself). Use the ≥2 cycles rule and actively search for non-timeline signals before retiring anything.
- **Merging just because descriptions overlap.** Descriptions lie. Check actual invocation patterns — if the two skills are invoked at different phases of work, they're not the same skill even if they sound similar.
- **"Keep" as a default.** If the Keep count is high and Retire/Update counts are both zero, the stocktake is lazy. Skill surface is rarely perfect.
- **Running stocktake and not executing the verdicts.** A report that sits in memory/retros/ and doesn't trigger changes is a ritual, not a skill.
- **Retiring skills the Director uses.** Always grep Director-surface files (telegram log, session-notes) before retiring. The timeline might not catch Director-initiated invocations.
- **Treating line count as a quality signal.** Short ≠ bad, long ≠ thorough. Judge by whether the skill has been successfully applied, not by size.

---

## Related Skills

- `retro` — invokes stocktake if enough time has passed.
- `self-improvement` — a lighter-weight per-session version; stocktake is the weekly/monthly aggregate.
- `skill-creator` — the execution arm for Improve / Update / Merge verdicts.
- `context-budget` — companion skill for auditing not just skill presence but skill-wall size.

---

## Storage

- Report: `memory/retros/stocktake-<date>.md` (alongside retro snapshots)
- Archived skills: `.claude/skills/archive/<skill-name>/` with an `ARCHIVED.md` header explaining the retire reason and the last invocation date.

---

*Adapted from ECC skill-stocktake with Jen's timeline + learnings as the primary signal sources instead of ECC's usage counters.*
