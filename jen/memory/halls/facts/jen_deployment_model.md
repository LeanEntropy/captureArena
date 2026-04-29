---
hall: facts
key: jen-deployment-model
created: 2026-04-10
last_verified: 2026-04-10
confidence: 10
source: user-supplied
attribution: Director, 2026-04-10 clarification
---

# Jen's Deployment Model

Jen exists in two contexts. Design decisions must account for both.

## Production (real Jen)

- Jen is distributed as part of the **PlayDreams CLI template**.
- Every game project spawned by PlayDreams gets its **own Jen instance**.
- That instance lives inside the game project repo and works on **exactly one game**, for the life of that game.
- There is no shared-across-projects Jen. There is no cross-project memory migration. There is no "Jen fleet."
- State (learnings, timeline, memory, halls, skills) is scoped to the single game project by default — it travels with the game repo.

**Why:** PlayDreams is commercial, multi-tenant, one-agent-per-game. Every game's Jen has its own taste calibration, its own `ART_ETHOS` for that game's visual identity, its own project memory.

## Research project (`games_gen_ai_research`)

- This repo is where Jen is **built, evolved, and stress-tested**.
- Here Jen can legitimately span multiple game concepts — she's being sent to evaluate different experiments, run comparative research, do deep dives across dev stages.
- Cross-project behavior in this repo is **research scaffolding**, not production behavior.
- Patterns that look production-shaped here must still be compatible with "deploy as a single-project instance."

## Template vs instance split

| Layer | What lives here | Ships with every Jen? |
|---|---|---|
| **Template-level** | skills, `ART_ETHOS.md` base, `memory_protocol.md`, hooks, tools, governance (`CLAUDE.md`), halls directory structure (empty or seeded with universal advice) | Yes |
| **Instance-level** | `learnings.jsonl`, `timeline.jsonl`, observation stream, hall contents (facts/events/discoveries/preferences), `director-profile.md`, `approved.json` taste history, daily session logs, welcome-back state | No — created empty per game, fills over that game's lifetime |

## Implications for Phase 2+ architecture

- **No multi-project scoping.** ECC's project-hash scoping, daemon PID/flock infrastructure, and cross-project learnings promotion are all solving problems that don't exist in Jen's production model. This confirms the 2026-04-10 Homunculus verdict.
- **State migration is a non-goal.** Jen doesn't carry state between game projects because she is never deployed across game projects. When a new game starts, a new Jen is born with empty learnings + timeline + halls (content), inheriting only the templated skills + `ART_ETHOS` base + universal advice.
- **Taste calibration is per-game.** `approved.json` in `ui-concept-generation` calibrates to the Director of *that game*, not globally.
- **Research project is the exception, not the norm.** In this codebase Jen spans experiments, but that's development scaffolding. Production = single game.

## How to apply this

- When designing any feature, ask: "does this assume multi-project state?" If yes, it's probably wrong for production Jen.
- When this research project spans multiple game experiments (normal), use subdirectories or branches — do not build cross-project plumbing into Jen herself.
- When documenting Phase 2+ implementation, distinguish "template-level" (ships with every Jen) from "instance-level" (created per game).
- Flag any upstream repo pattern that assumes multi-project state as a **bad fit** regardless of its technical elegance.
