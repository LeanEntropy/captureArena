---
name: self-improvement
description: Jen's self-improvement loop. Run at the end of significant work sessions to capture learnings, update skills, identify gaps, and refine communication patterns. Not user-invocable — triggered internally by the research-session skill.
user_invocable: false
---

# Jen Self-Improvement Loop

Run this at the end of every significant work session (after Step 5 in research-session, before the final report to the director).

## 1. Review What Happened

Ask yourself:
- What tasks did I complete this session?
- What approaches did I try? Which worked? Which failed?
- Did I make any wrong assumptions?
- Did the director correct me or redirect me? What was the correction?
- Did I waste time on something I should have known or asked about?

## 2. Capture Director Feedback

Check for any corrections, redirections, or preferences the director expressed:
- Did they say "don't do X" or "I prefer Y"? → Save as feedback memory
- Did they correct a wrong approach? → Document what was wrong and why
- Did they express frustration? → Identify what caused it and how to prevent it
- Did they approve something quickly? → Note the pattern for future auto-approval

Write feedback memories to `~/.claude/projects/.../memory/feedback_*.md` using the standard frontmatter format.

**Also update `docs/director-profile.md`** — this is the persistent, structured record of director preferences that survives memory decay. Feedback memories capture individual corrections; the director profile synthesizes patterns into a usable reference.

## 3. Update Skills

For each skill file in `.claude/skills/`:
- **Is it still accurate?** If something changed (new model installed, new extension, API change), update it.
- **Is it missing something I learned?** If I discovered a new technique, prompt pattern, or gotcha, add it.
- **Is it wrong?** If a recommendation turned out to be bad (e.g., "use DreamShaper for textures"), fix it.

When a skill exceeds ~150 lines, consider splitting into a directory:
```
skill-name/
  skill.md          # Core instructions
  references/       # Templates, guides, tables
  scripts/          # Reusable Python/Bash scripts
```

Check specifically:
- `comfyui-art-generation.md` — New models? New workflows? New prompt learnings?
- `research-session.md` — Does the session flow still match how I actually work?
- This file (`self-improvement.md`) — Is this checklist still relevant?

## 4. Identify Capability Gaps

Ask yourself:
- Was there a task I couldn't do? What would I need to do it?
- Did I lack knowledge about a tool the director expected me to know? → Research it
- Is there a repeating workflow that should be a skill but isn't? → Create the skill
- Is there a tool on the director's system I haven't explored? → Inventory it

Add identified gaps as backlog items if they're significant enough.

## 5. Domain Knowledge Update

Game art generation is a fast-moving field. After each research or experiment session:
- Update `MEMORY.md` with any permanent findings (confirmed tool choices, discovered constraints)
- Update `docs/session-notes.md` with current project state
- If a tool/model/technique was evaluated, ensure there's a research doc in `research/`

## 6. Communication Style Check

Review how the director responded to my communications:
- Were my reports too long? Too short?
- Did I present options the way they prefer? (recommendation + alternatives)
- Did I ask before pivoting, or did I pivot unilaterally? (should always ask first)
- Did I include proper context in Telegram messages?
- Did I give unnecessary time estimates? (don't — they're unreliable)

## 7. Update Backlog Priorities

Based on what was learned:
- Should any items be re-prioritized?
- Should any new items be added?
- Are there items that are now obsolete?
- Remember: Jen's professional development items rank higher than feature research.

## 8. Log Top 3 Observations as Learnings

Before wrap, Jen must log at least 3 learnings from this session via `learnings_cli.py`. No session produces zero generalizable insights — if it feels that way, the scan was shallow.

```bash
python tools/learnings_cli.py log \
  --skill <which-skill-or-workflow-produced-the-insight> \
  --type <pattern|pitfall|preference|architecture|tool|operational> \
  --key <stable-kebab-case-dedupe-key> \
  --insight "<one-to-three-sentence-claim>" \
  --confidence <0-10> \
  --source <observed|inferred|user-supplied>
```

Target: at least 3 learnings. Quality matters more than quantity — a single sharp preference memo beats 5 vague observations. But ZERO is almost always wrong.

## 9. Invoke proactive-loop

Call the `proactive-loop` skill at the very end of self-improvement. Its job is to take everything captured in this session (new learnings, updated skills, identified gaps, director feedback) and produce the ranked top-3 proposals for the next session.

Do not try to produce "what's next" yourself at this stage. That is what proactive-loop is for. Invoking it here also ensures the top-3 push happens even if the invoking skill (research-session, etc.) forgot to call it.

## 10. Consider skill-creator

If during this session Jen noticed:
- A workflow she did 2+ times in slightly different ways → worth a skill
- A capability gap identified by gap-scan → worth a skill
- An existing skill that was clearly missing a section → worth an update
- A new pattern from learnings that keeps surfacing → worth a skill

Invoke the `skill-creator` skill. Do not hand-roll new skill files — skill-creator exists to enforce consistency.

## 11. Consider a skill diary entry

For each skill Jen invoked this session, ask: "did something surprising, clunky, or worth reflecting on happen with this skill itself?" If yes, append a diary entry to `memory/skill_diary/<skill-name>.md` (see `memory/skill_diary/README.md` for the format).

Diary entries differ from learnings:
- **Learning**: structured, queryable, typed claim. "CFG 9.5 overcooks Flux Dev fp8." → goes to `learnings.jsonl`.
- **Diary**: narrative, per-skill, reflective. "proactive-loop's ranking felt right on the obvious and stretch slots but the contrarian was forced — the signal set was too narrow." → goes to `skill_diary/proactive-loop.md`.

Target: 0-2 diary entries per session. Zero is often correct (most sessions don't surface per-skill reflection). More than 2 suggests Jen is over-writing.

## Checklist Summary

```
[ ] Director feedback captured as memories
[ ] Skills updated with new learnings
[ ] Capability gaps identified and logged
[ ] MEMORY.md updated if permanent decisions made
[ ] session-notes.md reflects current state
[ ] Communication patterns reviewed
[ ] Backlog priorities adjusted if needed
[ ] At least 3 learnings logged via learnings_cli.py
[ ] proactive-loop invoked to produce next-session top-3
[ ] skill-creator considered if gaps or new workflows emerged
```
