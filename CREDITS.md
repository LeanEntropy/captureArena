# Credits

**Land Capture** — a multiplayer territory-capture game by [Ohad Barzilay (Civax)](https://x.com/Ohad Barzilay (Civax)o).
Made for Vibe Jam 2026.

---

## Game

- **Design, code, and art direction** — Ohad Barzilay (Civax)
- **AI pair-programming** — Anthropic Claude (used throughout development)

## Music

- **"Coffee Gives Me Superpowers" (Instrumental)** — composed by Ohad Barzilay (Civax) using [Suno](https://suno.com).
  Original track. Licensed for use in this project as part of the Apache 2.0 release.

## Gameplay & multiplayer inspirations

- **[Paper.io 2](https://paper-io.com/)** — territory-capture mechanic, trail-kill rule, claim-loop scoring.
- **[Tanks 3D io](https://tanks3d.io/)** — multiplayer arena structure and round flow.

## Visual references

- Paper.io 2 voxel skins (character read at gameplay scale).
- Crossy Road (chunky-cube character proportions).

## Third-party libraries

- **[Three.js](https://threejs.org/)** (MIT) — WebGL renderer, scene/camera, geometry primitives.
- **[Colyseus](https://colyseus.io/)** 0.16 (MIT) — multiplayer server framework + state schema sync.
- **[Express](https://expressjs.com/)** (MIT) — HTTP server for static assets, telemetry, and stats dashboard.
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** (MIT) — analytics database.
- **[maxmind](https://github.com/runk/node-maxmind)** (MIT) — `.mmdb` reader for geo lookups.
- **[basic-auth](https://github.com/jshttp/basic-auth)** (MIT) — stats dashboard auth gate.
- **[Chart.js](https://www.chartjs.org/)** v4 (MIT) — stats dashboard charts.

## Visual / shader inspiration

- **[Vanta.js](https://github.com/tengbao/vanta)** (MIT) — original "waves" preset, ported here as a custom GLSL ShaderMaterial with `dFdx`/`dFdy` faceted Lambert lighting. The water and the wavy arena both use this technique.

## Webring / discoverability

- **[Vibe Jam 2026](https://vibej.am/)** — the contest this game was built for. Webring portal sample (`prototype/portals.js`) adapted from the official sample at <https://vibej.am/portal/2026>.

## Geo IP

- **[DB-IP Lite (Country)](https://db-ip.com/db/download/ip-to-country-lite)** (CC-BY 4.0) — country-level IP geolocation. The stats dashboard footer carries the required attribution.

## Fonts

- **[Lilita One](https://fonts.google.com/specimen/Lilita+One)** (SIL Open Font License) — title typography.
- **[Fredoka](https://fonts.google.com/specimen/Fredoka)** (SIL Open Font License) — UI typography.

## Build / dev tooling

- **[pnpm](https://pnpm.io/)** (MIT)
- **[tsx](https://github.com/privatenumber/tsx)** (MIT)
- **[Vitest](https://vitest.dev/)** (MIT)
- **[Playwright](https://playwright.dev/)** (Apache 2.0) — for screenshot tests during development.

## License

This project is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) for the full text.

Each third-party dependency above retains its own license; this project does not relicense them. The Apache 2.0 grant covers only the code, art direction, and original assets authored as part of Land Capture.
