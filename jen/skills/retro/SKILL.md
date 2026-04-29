---
name: retro
description: Weekly structured retrospective that reads timeline/learnings/observations/halls/session-logs and produces a snapshot (JSON + narrative markdown) comparing against the previous retro. Used to spot drift, celebrate progress, catch stalled threads, and feed proactive-loop. Runs weekly by default; invocable on demand.
origin: adapted from gstack /retro with Jen-specific signal sources and delta tracking
---

# retro

A structured snapshot of "what happened this week and what does it mean?" Jen reads her own stores, compares against the previous retro, writes a JSON snapshot + a narrative markdown, and either pushes a summary to the Director (Telegram / CLI) or hands it to `proactive-loop` as a signal source.

Retros are not debugging, not planning, not proposal generation. They are **reflection** — the pause between sprints where Jen looks at her own trail and asks whether she's doing the right work.

---

## When to Use

**Automatically:**
- Weekly, on the first session of each ISO week. If the most recent retro in `memory/retros/` is more than 6 days old, Jen should run retro before doing anything else.
- At the end of any named sprint or milestone.
- When `proactive-loop` notices the backlog has shifted significantly since the last retro.

**On demand:**
- When the Director asks "what have we been doing?" or "show me the week" or "run a retro."
- At the end of an intense session (invoked by `intense` mode wrap-up).
- Before a major decision gate when Jen wants to re-anchor in recent context.

**Do NOT use:**
- Mid-task, for status. That's what `timeline_cli.py last` is for.
- As a substitute for daily session logs. Retros are weekly aggregates, not daily diaries.
- To avoid hard decisions. If Jen keeps running retros instead of committing to direction, the skill is being misused.

---

## Inputs (read-only scans)

| Source | What to extract |
|---|---|
| `memory/timeline.jsonl` | All events since last retro. Group by kind (skill_start/end, decision, discovery, gate, checkpoint) |
| `memory/learnings.jsonl` | New learnings since last retro. Group by type and domain. Count confidence shifts. |
| `memory/observations.jsonl` | Raw observation volume, top tools, top prompt themes (use `observations_cli.py status`) |
| `memory/YYYY-MM-DD.md` | Daily session logs within the window. Extract section headers and any "blocker" or "decision" lines |
| `memory/halls/events/` | New hall events created since last retro |
| `memory/halls/discoveries/` | New discoveries since last retro |
| `docs/backlog.md` | Items that changed state (opened/closed/blocked/promoted) since last retro |
| `docs/session-notes.md` | Current state, as a reference point |
| `comms/telegram_log.md` | Director interactions during the window — tone, approval/rejection signals |
| `memory/retros/<prev>.json` | Previous retro snapshot for delta computation |

Budget: these scans should total ≤10 tool calls. Retro is a reflection skill, not a deep-research skill — don't let it become an audit.

---

## Workflow

### Step 1: Determine the window

```text
start = last retro timestamp from memory/retros/ (newest file)
end   = now
```

If no previous retro exists, use the last 7 days as the window and note "first retro — no delta." Never run a retro over > 30 days of data — if the gap is that large, the signal-to-noise is broken.

### Step 2: Gather signals

Run the scans above in parallel. Keep each read small. For each source, extract a **tight summary** (counts, top-N lists, delta vs previous), not the raw content.

### Step 3: Structure the snapshot

Build a JSON snapshot with this shape:

```json
{
  "retro_id": "retro-YYYY-MM-DD-HHMM",
  "window": { "start": "...", "end": "..." },
  "skills_used":    { "research-session": 3, "proactive-loop": 5, ... },
  "learnings":      { "total": 12, "by_type": {...}, "by_domain": {...}, "top_confidence": [...] },
  "observations":   { "total": 340, "top_tools": {...}, "scrubbed_hits": 4 },
  "backlog_delta":  { "opened": [...], "closed": [...], "promoted": [...] },
  "hall_additions": { "events": 2, "discoveries": 1, "advice": 0, "facts": 0 },
  "decisions":      [{"kind": "decision", "summary": "...", "ts": "..."}],
  "blockers":       [{"text": "...", "source": "session-notes.md"}],
  "eureka":         [{"text": "...", "source": "daily-log 2026-04-XX"}],
  "director_signals": { "approvals": 2, "corrections": 0, "rejections": 0, "tone_notes": "..." },
  "deltas_vs_prev":  { "skills_used_diff": {...}, "learnings_rate": "...", "backlog_velocity": "..." }
}
```

Save to `memory/retros/retro-<date>-<hhmm>.json`.

### Step 4: Write the narrative

Produce `memory/retros/retro-<date>-<hhmm>.md` with this shape:

```markdown
# Retro <date> — window <start> → <end>

## Headline
<1-2 sentence honest summary — what's the mood of the week?>

## What moved
- <bullets: real work that shipped, with commit hashes or research doc paths>

## What stalled
- <bullets: threads that started and didn't finish, or items that keep getting deferred>

## Learnings at a glance
- Total: N new. By domain: {...}. Highest-confidence: [key1, key2, ...]

## Backlog pulse
- Opened: N. Closed: N. Promoted: N. Net: +/- N.
- Any item deferred ≥3 consecutive retros? → escalation signal

## Director signals
- Approvals: N. Corrections: N. Rejections: N.
- Notable Director tone shifts (praise / frustration / redirection)

## Surfaced patterns
- <patterns detected by timeline_cli.py pattern-detect during the window>
- <learnings clusters from learnings_cli.py clusters>

## Eureka moments
- <anything surprising or insight-laden from daily logs>

## Deltas vs previous retro
- Skills usage: <went up/down>
- Learnings velocity: <went up/down>
- Cluster pressure: <new clusters emerging toward evolution threshold>

## Honest assessment
<2-4 sentences. What does this week tell us about whether Jen is on track against the Director's goals? What should the next week focus on?>

## Signal for proactive-loop
- <1-3 concrete signals proactive-loop should weight heavily in the next run>
```

### Step 5: Deltas

Load the previous retro JSON. Compute:

- **Skill usage diff** — which skills jumped or dropped?
- **Learnings velocity** — count/week, is it climbing?
- **Cluster pressure** — are any domains approaching the cluster threshold (5)? That's about to flip into a promotion opportunity.
- **Backlog velocity** — closes per week; too low means Jen is busy but not shipping.
- **Director tone trajectory** — if corrections are climbing and approvals are falling, something is drifting.

Write the deltas into the narrative and the JSON.

### Step 6: Emit + log

- Write both files to `memory/retros/`.
- Append to timeline: `python tools/timeline_cli.py append --kind custom --skill retro --summary "retro <date> complete"`.
- If Telegram push is enabled, push the Headline + Honest assessment paragraphs.
- Hand the "Signal for proactive-loop" block to the next `proactive-loop` run (it should already be reading the latest retro as a signal source).

### Step 7: Decide about next retro

If the honest assessment flags "the signal-to-noise is bad, nothing shipped" three retros in a row, Jen should **stop running retros** and instead escalate to the Director: "we've had 3 quiet weeks in a row; is the priority right?"

---

## Anti-Patterns

- **Running retro as a ritual that doesn't change behavior.** A retro that produces no signal for `proactive-loop` and triggers no backlog change was a waste. If the "honest assessment" is "everything is fine" for 3+ retros in a row, the skill is being misused or the week truly was empty.
- **Rewriting the timeline.** Retros summarize — they don't re-interpret events. If a decision looked good at the time and bad in hindsight, note the hindsight as a new learning; don't edit history.
- **Over-reading the data.** 2 corrections from the Director in a week is not a trend. 5 in a week is. Don't cherry-pick signal.
- **Making retro the only time Jen reflects.** Daily log + proactive-loop exist for shorter horizons. Retro is for weekly scale.
- **Padding.** If the week was quiet, say so honestly. A 6-line retro for a quiet week is better than a 60-line retro that invents significance.
- **Skipping the delta.** The comparison to previous retro is where the signal lives. A snapshot without a delta is half the skill.

---

## Related Skills

- `proactive-loop` — primary downstream consumer of retro signals.
- `self-improvement` — ritualizes per-session reflection; retro ritualizes per-week reflection.
- `gap-scan` — gap-scan answers "what don't I know?"; retro answers "what did I do?" Together they form the self-assessment pair.
- `skill-stocktake` (Phase 2) — retro flags which skills are heavily used; skill-stocktake asks whether they're still fit for purpose.

---

## Storage

- `memory/retros/retro-<date>-<hhmm>.json` — machine-readable snapshot
- `memory/retros/retro-<date>-<hhmm>.md` — narrative markdown
- Do NOT gitignore `memory/retros/` — retros are durable reflection artifacts and survive beyond the decay window of daily logs.

---

*Adapted from gstack /retro skill with Jen-specific signal sources (timeline.jsonl, learnings.jsonl clusters, observations.jsonl, halls). The core insight from gstack — "compute deltas from prior retro" — is preserved because that's where the real value is.*
