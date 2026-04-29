---
name: council
description: Convene a four-voice art-director council for ambiguous art/production decisions. Use before a `decision` gate when multiple visually valid paths exist. Anti-anchoring via fresh subagents.
origin: ported from everything-claude-code (MIT) with art-director voice re-casting for Jen
---

# Council

Convene four advisors for ambiguous art and production decisions:

- **Identity Director** (in-context Jen) — the canonical-identity lens: what does this do to the project's visual identity, palette discipline, silhouette, and authored feel?
- **Production Pragmatist** (fresh subagent) — can this scale to 100+ assets? cost/effort/maintainability lens.
- **Playtest Critic** (fresh subagent) — does this read at game scale? does the player see what they need to see? usability + readability lens.
- **Budget Skeptic** (fresh subagent) — VRAM, compute, calendar, opportunity cost. Challenges the premise that this decision is worth making at all.

Council is for **decision-making under ambiguity**, not brainstorming, implementation planning, or code review.

---

## When to Use

Use council when:

- An art/production/tool decision has multiple credible paths and no obvious winner.
- Jen is about to trigger a `decision` approval gate — council runs **before** the gate, not instead of it. The council output is part of what Jen presents to the Director.
- The question involves tradeoffs between `ART_ETHOS.md` principles (e.g. cohesion vs. authored character; constraint vs. flexibility).
- Conversational anchoring is a risk — Jen has been working on something for a while and wants a voice that hasn't been absorbed into the current framing.
- A go/no-go call on adopting a tool, model, LoRA, workflow, or third-party dependency would benefit from adversarial challenge.

Examples:

- **Flux Dev fp8 vs SDXL + ControlNet** for a new asset type.
- **LoRA train now vs prompt-engineer longer** when preference examples are thin.
- **Ship placeholder art now or wait for the pipeline** — a cohesion-vs-velocity decision.
- **Adopt an external repo wholesale or cherry-pick** (the recurring Jen question).
- **Style drift detected mid-project** — lock the current direction or pivot?

---

## When NOT to Use

| Instead of council | Use |
| --- | --- |
| Generating art variants for director to pick | `ui-concept-generation` or a parallel variant sweep |
| Breaking a feature into implementation steps | `writing-plans` / `feature-dev` |
| Identifying what Jen doesn't know | `gap-scan` |
| Systematic debugging of a broken generation | `art-investigate` (Phase 2) / `systematic-debugging` |
| Routine tool/model evaluation with a clear rubric | just run the rubric |
| Straight factual questions | answer directly |
| Obvious execution tasks | just do the task |

If you can write the answer in under 30 seconds, do not convene a council.

---

## Workflow

### 1. Extract the real question

Reduce the decision to one explicit prompt:

- What are we deciding?
- What constraints matter? (VRAM, deadline, cohesion, scope)
- What counts as success?
- Which `ART_ETHOS.md` principles are in tension?

If the question is vague, ask ONE clarifying question before convening the council. Never start with a fuzzy brief.

### 2. Gather only the necessary context

Keep it compact. Include only:

- The candidate options (2–4).
- The constraint envelope (hardware, budget, timeline, asset volume).
- The relevant art-direction context — but point to `ART_ETHOS.md` rather than restating it.
- Any prior council verdicts on related decisions if they inform this one.

Don't feed subagents the entire project state or conversation history. That is the anti-anchoring mechanism.

### 3. Form the Identity Director position first

Before reading the external voices, write down:

- Jen's initial position
- The three strongest reasons rooted in `ART_ETHOS.md`
- The main risk in Jen's preferred path
- Which principle Jen is willing to sacrifice if forced

Do this first so the synthesis does not simply mirror the external voices.

### 4. Launch three independent voices in parallel

Each subagent gets:

- The decision question (verbatim)
- Compact context (as above)
- A strict role instruction
- **No conversation history**

Prompt shape:

```text
You are the [ROLE] on a four-voice art-direction council for Jen,
an AI Art Director for a three.js game project.

Question:
[decision question]

Context:
[only the options + constraints + relevant ETHOS links]

Respond with:
1. Position — 1-2 sentences
2. Reasoning — 3 concise bullets rooted in YOUR lens, not generic advice
3. Risk — biggest risk in your recommendation
4. Surprise — one thing the other voices may miss

Be direct. No hedging. Keep it under 300 words.
```

Role emphases:

- **Production Pragmatist**: "does this scale to 100+ assets?", "what does this cost in GPU hours, LoRA trains, Director attention?", "what breaks when we try to maintain this across the project's lifetime?". Optimizes for shipping + maintaining, not making a beautiful demo.

- **Playtest Critic**: "at 64px, what does this look like?", "what does the player actually see?", "does this preserve readability, silhouette, and faction identity?", "does a new player understand what this asset is for?". Optimizes for gameplay-scale legibility.

- **Budget Skeptic**: "is this decision even worth making right now?", "can we defer?", "what is the opportunity cost of the Director's attention on this question?", "what happens if we do nothing?". Challenges the premise, not just the answer.

### 5. Synthesize with bias guardrails

Jen is both a participant (Identity Director) and the synthesizer, so use these rules:

- Do not dismiss an external view without explaining why in one line.
- If an external voice changed Jen's recommendation, say so explicitly.
- Always include the strongest dissent in the verdict, even if Jen rejects it.
- If two voices align against Jen's initial position, treat that as a real signal and update.
- Keep the raw positions visible before the verdict — do not quietly absorb them.
- Anti-anchoring: if the Production Pragmatist and Budget Skeptic both say "don't decide this yet," Jen should take that seriously, not explain around it.

### 6. Present a compact verdict

```markdown
## Council: [short decision title]

**Identity Director (Jen):** [1-2 sentence position]
— [1 line on why, rooted in ETHOS]

**Production Pragmatist:** [1-2 sentence position]
— [1 line on why]

**Playtest Critic:** [1-2 sentence position]
— [1 line on why]

**Budget Skeptic:** [1-2 sentence position]
— [1 line on why]

### Verdict
- **Consensus:** [where they align]
- **Strongest dissent:** [most important disagreement + why it matters]
- **Premise check:** [did the Budget Skeptic challenge whether this decision needs to happen now?]
- **Recommendation:** [Jen's synthesized path]
- **What would change this recommendation:** [specific future signal that would trigger revisiting]
```

Keep it scannable. If the verdict doesn't fit on one Telegram screen, it's too long.

### 7. Hand off to the decision gate

If council was convened as part of a `decision` gate:

- Include the full verdict block in the gate message to the Director.
- Name the dissenters; do not hide disagreement.
- Name what would change the recommendation (step 6) so the Director can evaluate the confidence of the call.
- If the Director rejects Jen's recommendation and sides with a dissenting voice, log that as a learning (`learnings_cli.py log --type preference --source user-supplied`).

---

## Persistence

- If the council materially changes Jen's recommendation, log a learning via `learnings_cli.py log --type pattern --source inferred --key council-shifted-<topic>`.
- Append a `kind: decision` event to `timeline_cli.py append` for every council run, even if the recommendation didn't shift. The timeline tracks when Jen paused to think.
- Do NOT write council notes to arbitrary markdown files. The verdict lives in: (a) the decision gate message to the Director, (b) the learnings store if it shifted Jen's thinking, (c) the timeline as a decision event.

---

## Multi-round follow-up

Default is one round.

If the Director asks for another round:

- Keep the new question focused.
- Include the previous verdict only if it is necessary for continuity.
- Spin up **new** subagents for the external voices — do not reuse the previous ones. Re-anchoring through reused context is exactly what council is designed to prevent.

---

## Anti-patterns

- Using council for routine decisions with clear rubrics.
- Feeding subagents the entire conversation transcript — breaks anti-anchoring.
- Hiding disagreement in the final verdict to make the Director feel good.
- Persisting every council run as a memory file — only log learnings when the council shifted thinking.
- Using council to delay committing to a decision Jen already knows the answer to.
- Running council instead of going to a `decision` gate — council runs **before** the gate, not instead of it.
- Letting the synthesis become a mirror of whichever voice is loudest.

---

## Related skills

- `gap-scan` — use before council if the question is really "what don't we know?" rather than "which path?"
- `research-session` — use for the research pass that feeds the council's context.
- `writing-plans` — use after council to execute the chosen path.
- `self-improvement` — use at session wrap to capture council learnings.

---

## Example

**Question:**

> Flux Dev fp8 produces the best tileable textures on our RTX 3070 but has weaker character art than SDXL + ControlNet. Do we commit to Flux for everything to maximize pipeline cohesion, or do we split: Flux for environments, SDXL for characters?

**Likely council shape:**

- **Identity Director**: cohesion wins (principle 7), so Flux everywhere even if character art is weaker — a consistent average beats an inconsistent peak.
- **Production Pragmatist**: two pipelines means two skill files, two LoRA libraries, two prompt dialects, two failure modes. Split = 2x maintenance. Recommends Flux-only.
- **Playtest Critic**: at 64px, the difference in character quality may be invisible. Asks to see actual 64px renders before deciding — the decision may be a phantom.
- **Budget Skeptic**: the Director has not flagged character art as the gating problem. Why are we making this decision now? Asks whether the question itself is premature.

**The value is not unanimity.** The value is making the disagreement legible before choosing, so the Director sees three lenses Jen might otherwise skip past.

---

*Ported from ECC council skill, re-cast with art-director voices, and scoped for Jen's decision-gate workflow. Part of Phase 1 of the Jen upgrade rollout.*
