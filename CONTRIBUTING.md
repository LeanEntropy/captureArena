# Contributing to Land Capture

Thanks for your interest. This is a small, deliberately bundler-free codebase — contributions of any size are welcome.

## Quick start

```bash
pnpm install
pnpm dev:server   # http://localhost:2567
```

Requires **Node 20** and **pnpm 10**.

Solo mode runs entirely in the browser; Online mode connects to your local Colyseus server on the same port.

## Project layout

See [README.md → How the code fits together](README.md#how-the-code-fits-together). In short:

- `prototype/` — static client (Three.js via CDN importmap, no bundler)
- `prototype/sim/` — pure-JS simulation, shared between solo (browser) and online (server)
- `server/` — Colyseus + Express; imports `server/src/sim/` which is auto-copied from `prototype/sim/` by `server/scripts/copy-sim.mjs`

**Edit simulation logic in `prototype/sim/`, never in `server/src/sim/`** — the latter is regenerated on every `dev`, `build`, and `typecheck`.

## Tests + typecheck

```bash
pnpm test                                  # vitest (sim + server)
pnpm --filter template-server typecheck    # server TypeScript
```

Both run in CI on every push and pull request. Please make sure they pass locally before opening a PR.

## Code style

- The codebase favors small, single-purpose files. The current target is **~300 lines per file** — refactor when a file outgrows that.
- No comments that just restate what the code does. Comments are for *why* something non-obvious is true (a constraint, a subtle invariant, a workaround).
- Tuning constants live in `prototype/sim/constants.js`. Prefer adding a named constant over a magic number.
- The simulation is **server-authoritative** in online mode. The client renders state and predicts the local player; it never decides game outcomes.

## Pull requests

- Open against `main`.
- Keep PRs focused — one concern per PR makes review faster.
- Describe the change and how you tested it.
- For gameplay/balance changes, mention what you tuned and why.

## Reporting bugs

File an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce (solo vs. online, browser, any console errors)

A short screen recording helps a lot for visual or timing bugs.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
