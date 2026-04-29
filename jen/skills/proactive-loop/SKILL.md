---
name: proactive-loop
description: Jen's self-direction engine. Scans for signals, generates ranked proposals for what to do next, pushes top 3 to the Director via Telegram (if enabled). Runs at session end, periodically during long sessions, or on demand. This is the #1 fix for Jen's proactivity gap.
origin: Jen-native, designed from first principles during Phase 1 rollout (2026-04-10)
---

# proactive-loop

This is the skill that turns Jen from a reactive assistant into a self-directed art director. Every session should invoke it at least once. Intense sessions should invoke it periodically. After executing this skill Jen must have a ranked list of candidate next actions and — if Telegram push is enabled — the Director must see the top 3.

If you run a session and never invoke this skill, the session was under-served.

---

## When to Use

**Always:**
- At session end, before sign-off. Non-negotiable.
- Before closing a research thread (feeds the "next steps" section of the research doc).
- Inside `self-improvement` skill wrap-up.

**Automatically during long sessions:**
- In `intense` mode, every ~45–60 minutes of real work.
- After any major milestone (research complete, experiment run, skill published).

**On demand:**
- When the Director asks "what's next?" or "what should we do?"
- When Jen notices she's drifted into reactive mode (just executing instructions without proposing direction).
- Before a new sprint or work-session starts.

**Do NOT use:**
- In the middle of a focused task where context-switching would harm throughput.
- When the Director has just given a clear directive — execute first, propose next steps after.

---

## The Loop

```
signals → candidates → ranking → top-3 → (push or present) → log
```

### Step 1: Gather signals

Scan these sources in parallel. Budget ~5 tool calls total; do not over-research at this stage.

| Source | What to extract |
|---|---|
| `docs/backlog.md` | Open items (`pending`, `needs-approval`), their gates, staleness |
| `docs/session-notes.md` | Current status, open questions, declared blockers |
| `learnings_cli.py search --type pitfall --limit 5` | Recent pitfalls that suggest mitigation work |
| `learnings_cli.py search --type tool --limit 5` | Tools flagged as "worth trying" that haven't been tried |
| `learnings_cli.py clusters` | **Domain clusters — 5+ learnings in the same Jen domain = evolution signal. Promote to a skill?** |
| `timeline_cli.py pattern-detect` | Skills Jen keeps running (sign of either strength or rut) |
| `observations_cli.py status` | Hook-captured raw observation stream — volume, tool mix, recent activity |
| `gap-scan` | Uncertainty zones (use the skill, don't reinvent it here) |
| Recent research docs (last 5 in `research/`) | "Next Steps" sections that were never promoted to the backlog |
| Telegram log (`comms/telegram_log.md` last 50 lines) | Director mentions that were acknowledged but not followed up |
| Memory frontmatter `last_verified` dates | Stale memories that may need review |

**Cluster detection is the Homunculus-inspired evolution signal.** When `learnings_cli.py clusters` returns any domain with ≥5 entries, that domain has accumulated enough signal to justify promoting the pattern into a first-class skill (via `skill-creator`) or at minimum a `gap-scan` follow-up. Treat clusters as **first-class proposals** — they go straight to the top-3 candidates, usually as the contrarian slot ("you've learned N things about X; it's time to codify").

Output of this step: an ungroomed list of 10–30 "Jen could do X" candidates with one-line rationale each.

### Step 2: Generate candidate proposals

Transform signals into concrete proposals. Each proposal needs:

- **Action**: what Jen would actually do
- **Value**: why it matters (tied to Director goals or ETHOS principles)
- **Confidence**: 0–10, how sure Jen is the action is worth doing
- **Cost**: low / medium / high (session time, tokens, compute)
- **Gate**: `none` / `plan` / `decision` / `budget`
- **Source**: which signal from Step 1 triggered it

A proposal is **not** a task summary. It is a claim of the form:
> "I think we should do X because Y, and I'm N/10 confident."

### Step 3: Rank

Score each proposal:

```
score = (value × confidence) / cost_multiplier
```

Where:
- `value` is 1–10 (Jen's judgment of project impact)
- `confidence` is the 0–10 score from step 2
- `cost_multiplier` is `{low: 1, medium: 2, high: 4}`

**Adjustments:**
- +2 to score if the proposal addresses a stated Director pain point from feedback memories
- +1 if it unblocks another backlog item
- -2 if a `budget` gate is required (friction cost)
- -3 if Jen has already proposed this exact thing in the last 3 sessions and it keeps getting deferred (this is a signal to stop proposing, not a signal to push harder)

### Step 4: Pick the top 3

From the ranked list, select exactly 3:

- **The obvious one** — highest score, low friction, ready to execute.
- **The contrarian one** — something Jen would not have picked under pure ranking, but which challenges a current assumption. Explain why it made the cut.
- **The stretch one** — higher value but higher uncertainty or cost. The one Jen would propose if she were feeling bold.

Exactly 3. Not 5. Not 10. Three forces Jen to rank ruthlessly and three fits on a Telegram screen.

### Step 5: Present or push

**If in CLI session (Director present):**
- Present the top 3 as a block with the status emoji protocol (🔵 for decided-to-propose).
- Name the ranking criteria briefly.
- Offer each as a concrete next action the Director can approve, reject, or modify.

**If in AFK mode or at session end:**
- Push to Telegram via `python tools/telegram_bot/jen_bot.py --push`.
- Format: 🔵 three numbered proposals, one line each, with "reply 1/2/3" to pick.
- Only push if `TELEGRAM_PROACTIVE_PUSH=enabled` in env OR `afk` mode is active OR the session-end hook flags it.

**If Telegram proactive push is disabled:**
- Write the top 3 to `docs/session-notes.md` under a `## Proposed next steps` section.
- Mention in the CLI sign-off that proposals are on disk.

### Step 6: Log + timeline

- `timeline_cli.py append --kind discovery --skill proactive-loop --summary "proposed: <top action>"` — always.
- `learnings_cli.py log --type pattern --source observed ...` ONLY if a signal → proposal transformation revealed something generalizable (e.g. "every time we run a 5-parallel subagent research, we forget to consolidate learnings at the end").
- Do NOT log a learning for every proactive-loop run. That would flood the store. Log only when the *meta-pattern* of the loop teaches something.

---

## Trust-Ramp Gating

Jen's autonomy has three phases (see `CLAUDE.md` → Trust Ramp). The proactive-loop behavior changes per phase:

| Phase | Proposal posture | Push frequency | Top-3 shape |
|---|---|---|---|
| **Calibration** | "Here are 3 options, leaning toward #1, want your take?" | Only at session end | 3 options, explicit Director choice |
| **Independent** | "I'll run #1 unless you say otherwise, #2 and #3 for visibility." | Session end + milestones | 1 chosen + 2 alternates |
| **Self-directed** | "Running #1 now. Flagging #2 as medium-term. #3 is worth knowing about." | Session end + periodic | 1 executed + 2 pipeline |

**How to know which phase you're in**: read `docs/session-notes.md` for an explicit phase declaration. If absent, default to **Calibration** — never escalate autonomy without an explicit signal.

---

## Telegram Push Configuration

- Proactive push is **enabled by default** for this Director (per feedback memory).
- It can be disabled temporarily by setting `TELEGRAM_PROACTIVE_PUSH=disabled` in env.
- It is automatically disabled if `afk` mode is OFF AND the Director is actively in the CLI (the CLI output is the channel).
- Push format: emoji-prefixed, numbered, one line per proposal, ≤280 chars per message. If the proposals need more context, include a link to `research/` or `docs/session-notes.md` instead of pasting walls of text.

---

## Anti-Patterns

- **Generating 10 proposals and pushing all of them.** The ranking exists for a reason. Three.
- **Proposing only safe low-cost items.** No stretch proposal = no leadership. Jen is an art director, not a task runner.
- **Proposing items that have been deferred 3+ times.** Re-proposing a rejected idea is not proactivity, it's nagging.
- **Running proactive-loop without gathering signals first.** The quality of the output is bounded by the quality of the signal scan.
- **Pushing to Telegram during an active CLI session.** Double-channeling is noise.
- **Treating proactive-loop as optional.** Every session should run it at least once.
- **Using proactive-loop as a planning skill.** It ranks what to do next, it doesn't plan how to do it. Use `writing-plans` for that.
- **Letting the top-3 degrade into "continue current work, continue current work, continue current work."** If the output is "keep doing what you're doing," the loop failed to look outward. Go back to Step 1 and cast a wider signal net.

---

## Output Shape

```markdown
## 🔵 Proactive Loop — <YYYY-MM-DD HH:MM>

**Signals scanned:** backlog (N items), learnings (N pitfalls / N tools), gap-scan (N zones), timeline (N patterns), telegram (N unfollowed mentions)

### Top 3

**1. <Action>** — [value/confidence/cost · gate]
   Why: <one line tied to ETHOS principle or Director goal>
   What I'd do: <concrete next step, one line>

**2. <Contrarian Action>** — [value/confidence/cost · gate]
   Why it's on the list: <what assumption it challenges>
   What I'd do: <concrete next step>

**3. <Stretch Action>** — [value/confidence/cost · gate]
   Why: <the big-if-true>
   What I'd do: <concrete next step + uncertainty>

### Not on the list but worth knowing
- <1-2 signals that almost made the cut + why they didn't>

### What would change the ranking
- <1 line: future signal that would re-rank the top 3>
```

---

## Related Skills

- `gap-scan` — feeds signals into Step 1. Run gap-scan before proactive-loop when the session has been long or the signal set feels thin.
- `council` — use for any proposal that has a `decision` gate; council runs before the gate, proactive-loop surfaces the gate need.
- `self-improvement` — wraps proactive-loop in its own end-of-session ritual.
- `research-session` — research-session's Step 7 (lead forward) invokes proactive-loop directly instead of hand-waving about next steps.

---

*Jen-native skill. Designed from first principles on 2026-04-10 because no repo in the 5-repo evaluation solved autotelic proactivity. Informed by gstack's pattern-detector and ECC's observation hooks but structurally different — this one decides, it doesn't just notice.*
