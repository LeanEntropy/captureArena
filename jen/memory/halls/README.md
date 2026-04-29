# Halls — Project-Scoped Long-Lived Knowledge

Halls are Jen's **project-scoped** categorized knowledge store. Each hall is a directory of markdown files with required frontmatter. Halls ship as part of the CLI template (the directory structure) and fill with instance-specific content over the life of the project.

## The five halls

| Hall | What belongs here | Examples |
|---|---|---|
| **`facts/`** | Structural truths about the project, tools, environment, or constraints | "Jen deploys as a CLI template instance per game," "RTX 3070 fits Flux Dev fp8 but not TRELLIS 2" |
| **`events/`** | Dated things that happened — milestones, decisions, incidents, significant sessions | "Phase 1 rollout completed 2026-04-10," "AnimateDiff abandoned in favor of Wan2.2 on 2026-XX-XX" |
| **`discoveries/`** | "What I learned" — first-class home for non-obvious insights from research or experiments | "Flux Dev fp8 beats SDXL for tileable textures at 8GB VRAM," "Director prefers moody palettes at 0.7 saturation" |
| **`preferences/`** | Project-specific taste and convention preferences (NOT user-scoped director feedback — that lives in user auto-memory) | "This project uses snake_case for JSON keys," "Strategy game color-as-faction rule is locked" |
| **`advice/`** | Durable how-to patterns worth remembering across sessions, often attributed | "Subprocess-through-conda pattern for PyTorch version conflicts" |

## Frontmatter contract

Every hall file MUST have this frontmatter:

```yaml
---
hall: facts|events|discoveries|preferences|advice
key: stable-kebab-case-identifier
created: YYYY-MM-DD
last_verified: YYYY-MM-DD
confidence: 0-10     # 10 = bedrock, 5 = well-supported, 3 = provisional
source: observed|inferred|user-supplied
---
```

Optional fields:
- `attribution:` — who/what originated the knowledge (useful for advice)
- `applies_to:` — scope tag if the item only applies to a subset of work
- `supersedes:` — key of an older hall entry this replaces
- `related:` — list of related hall keys

## Relationship to other memory tiers

- **User-scoped auto-memory** (`~/.claude/projects/.../memory/`) — Director feedback memories (`feedback_*.md`). Auto-loaded by Claude Code at session start. **Stays there** — halls do not replace it.
- **`memory/learnings.jsonl`** — rapid-fire observations with confidence decay. Halls are the promoted form: when a learning matures into durable project knowledge, it becomes a hall entry.
- **`memory/timeline.jsonl`** — append-only event stream. Halls `events/` are the curated, narrative form of significant timeline entries.
- **`memory/YYYY-MM-DD.md`** — daily session logs, ephemeral, decay in ~7 days.

## Promotion rules

- A learning (from `learnings.jsonl`) becomes a hall entry when Jen decides it's project-durable, not session-durable.
- A daily log entry becomes a hall `events/` entry when it's a milestone worth remembering beyond the decay window.
- A research doc finding becomes a hall `discoveries/` entry when a single-sentence claim is worth extracting so it can surface in welcome-back briefings and proactive-loop scans.

## Deployment model reminder

Halls ship with the template (the directory structure is universal) but their **contents are per-game-instance**. When a new Jen spawns via the PlayDreams CLI template, her halls are empty except for any template-level advice files that are universal across all games. See `memory/halls/facts/jen_deployment_model.md` for the full deployment model rationale.
