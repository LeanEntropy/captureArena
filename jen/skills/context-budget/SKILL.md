---
name: context-budget
description: Periodic audit of Jen's context-window overhead. Flags bloated skill frontmatter, oversized skills, MCP over-subscription, and session-start bloat. Produces concrete trim recommendations. Run monthly or when sessions start feeling sluggish.
origin: adapted from ECC context-budget with Jen-specific audit targets
---

# context-budget

Every file loaded at SessionStart, every skill Jen reaches for, and every MCP server she subscribes to takes context window budget. As Jen accumulates skills and data stores, the session-start overhead grows silently. Without periodic auditing, Jen eventually wakes with half her context already spent on boot before the Director has said anything.

This skill produces a token-overhead audit with concrete trim recommendations.

---

## When to Use

**Automatically:**
- Monthly (first session of the month), if the last context-budget run was ≥28 days ago.
- When `skill-stocktake` reports ≥15 skills total.
- After any Phase rollout that adds new hooks, skills, or memory files.
- When session startup feels slow (subjective but valid signal).

**On demand:**
- When the Director says "context feels crowded" or "why does Jen load so much."
- Before adding a new skill or hook — check the budget before increasing it.

**Do NOT use:**
- After every skill creation (too noisy).
- To justify deleting skills that are actually in use (context-budget flags candidates; `skill-stocktake` makes the Keep/Retire call).

---

## What to Audit

### 1. SessionStart hook output

The biggest opportunity. SessionStart in `.claude/settings.json` dumps files into Jen's wake context. Audit each file:

| File | Purpose | Typical size |
|---|---|---|
| `memory/identity.md` | L0 identity | <50 lines |
| `memory/memory_protocol.md` | 5-step contract | <15 lines |
| `memory/welcome_back.md` | L1 recent state | <30 lines |
| `memory/essential.md` | L1 curated halls | ≤MAX_CHARS (3200 chars) |
| `MEMORY.md` | Permanent facts | <100 lines by contract |
| `docs/session-notes.md` | Current status | variable |
| `docs/director-profile.md` | Director preferences | variable |
| `memory/YYYY-MM-DD.md` | Today's session log | variable, can grow |
| `memory/YESTERDAY.md` | Yesterday's session log | variable, can grow |
| `comms/telegram_log.md` | Recent Telegram (last 80 lines) | ≤80 lines by hook |

**Red flags**:
- Any SessionStart file > 500 lines
- session-notes.md with stale content from >3 days ago
- Daily logs > 400 lines (PreCompact should have pruned earlier)
- Telegram log tail including old exchanges
- identity.md growing beyond its "tiny" contract

### 2. Skill frontmatter + body sizes

Every skill Jen invokes is loaded in full. Audit:

- Frontmatter size (`name:`, `description:` should be compact; multi-paragraph descriptions are a red flag)
- Body line count (≥500 lines is a red flag)
- Duplication across skills (same code examples repeated in 3 places)
- Stale version references (e.g., "Flux v1.0" when v2 has shipped)

### 3. MCP server subscriptions

Each MCP server in `.claude/settings.json` contributes tool schemas and prompts to the context. Audit:

- Which MCP servers are configured but unused in the last 30 days?
- Which have huge tool schemas Jen doesn't need?
- Which overlap (e.g., two MCPs that both do "read file")?

### 4. Hook output noise

Hooks that produce verbose stdout land in Jen's context too. Audit each hook for:

- Output that exceeds 20 lines
- Output that includes timestamps/paths repeated across lines
- Output that summarizes things Jen already has elsewhere (e.g., re-citing CLAUDE.md)

---

## Workflow

### Step 1: Measure

For each audit target, record a size:
- Skills: `wc -l .claude/skills/*/SKILL.md` → line count per skill
- SessionStart files: read each, count lines and chars
- Total SessionStart payload: sum all files that the bash hook cats

Write the numbers down. Specific numbers, not "it feels big."

### Step 2: Classify

Sort into three buckets:

- **Green** — within contract, no action
- **Yellow** — approaching limit or slightly over, watch
- **Red** — over limit, trim required

Use these contracts:
- SessionStart total: ≤4000 lines / ≤150KB
- Any single skill: ≤400 lines unless it's a reference skill (e.g., pattern catalogue)
- identity.md: ≤15 lines
- essential.md: ≤MAX_CHARS (3200) — enforced by generator, but verify
- MEMORY.md: ≤100 lines (user's contract in CLAUDE.md)

### Step 3: Propose trims

For every red item, propose a concrete trim:

- "Skill X is 680 lines. The first 200 lines are the how-to; the last 480 are a reference catalogue that could move to `references/catalogue.md` and be loaded on demand."
- "SessionStart includes yesterday's daily log (312 lines) but today's session has progressed past that context. Trim the yesterday block from SessionStart or move it to on-demand load."
- "MCP server X has 31 tools, but Jen only invokes 4. Consider disabling the unused tools or unsubscribing when not in use."

Each proposal is a **specific edit**, not a general complaint.

### Step 4: Report

Write to `memory/retros/context-budget-<date>.md`:

```markdown
# Context Budget Audit — <date>

## Totals
- SessionStart payload: N lines / N KB
- Skills inventory: N skills, M avg lines, top-5 by size: [...]
- MCP servers: N configured, N active in last 30d

## Red items (over contract)
| Target | Size | Contract | Trim proposal |
|---|---|---|---|
| ... | ... | ... | ... |

## Yellow items (approaching limit)
...

## Green (healthy)
- <summary bullets, not a full list>

## Recommendations
1. <specific edit>
2. <specific edit>
3. <specific edit>

## Director review required
- <anything that changes governance, retires a skill, or disables an MCP>
```

### Step 5: Execute low-risk trims

Jen can autonomously:
- Trim stale daily log blocks from SessionStart bash
- Move long reference content from a skill into a `references/` subfolder
- Remove comments from skill files (if any)
- Tighten frontmatter descriptions

Jen MUST ask the Director for:
- Disabling an MCP server
- Removing a file from SessionStart
- Retiring a skill (hand off to `skill-stocktake`)
- Changing hook output format

Log the actions in timeline: `python tools/timeline_cli.py append --kind custom --skill context-budget --summary "trimmed N items, saved ~N lines"`.

---

## Anti-Patterns

- **Running the audit and not trimming anything.** If every item is green, either the audit is shallow or Jen hasn't accumulated enough to audit. The whole point is the trims.
- **Trimming things Jen actually uses.** Don't trim a skill because it's long; trim because it's bloated *relative to its utility*. A 500-line skill that fires every session is healthy; a 200-line skill that fires once a quarter is bloated.
- **Surrogate metrics.** "Lines" is not the same as "useful context." A long skill with heavy code examples is cheaper to process than a short skill with dense prose. Use line count as a first pass; judge quality on the second pass.
- **Running context-budget every session.** Monthly is right. Weekly feels productive but isn't — skills don't change that fast.
- **Pretending the Director loves numbers.** Report in bullets, not tables-of-tables. Keep the "so what" paragraph short.

---

## Related Skills

- `skill-stocktake` — pairs with this. Stocktake asks "is this skill worth keeping?"; context-budget asks "is it paying rent?"
- `self-improvement` — consumes context-budget outputs when a trim is approved.
- `retro` — may trigger context-budget if skill surface keeps growing.

---

## Storage

- Reports: `memory/retros/context-budget-<date>.md`
- Do NOT autogenerate a new skill inventory file — `ls .claude/skills/` is the inventory.

---

*Adapted from ECC context-budget with Jen-specific audit targets (SessionStart hook output, halls, learnings/timeline data stores, MCP servers).*
