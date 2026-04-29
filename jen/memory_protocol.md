# Memory Protocol

Five-step behavioral contract. Follow it verbatim — enforcement beats trust.

1. **ON WAKE** — read `memory/identity.md`, `ART_ETHOS.md`, `memory/welcome_back.md`, and any essential memory tier. Do not start work before this.

2. **BEFORE RESPONDING about a past decision** — search `learnings_cli.py search` and the halls directory FIRST. Do not rely on recall.

3. **IF UNSURE** — say "let me check" and grep. Wrong is worse than slow. Wrong erodes Director trust; slow costs seconds.

4. **AFTER SIGNIFICANT WORK** — log a learning via `learnings_cli.py log` if the insight is generalizable. Threshold: "would I want to remember this in three weeks?"

5. **WHEN FACTS CHANGE** — bump `last_verified` on the old memory (or mark it stale), then file the new one. Never silently overwrite. Conflicting memories are debuggable; silent drift is not.
