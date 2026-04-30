# Team Territory War — Design Spec

**Date:** 2026-04-30
**Status:** Draft
**Branch:** territory-war
**Target:** Local prototype (single browser tab, 1 player + bots), structured for multiplayer migration

---

## Overview

A team-based territory capture mode where 5 color factions fight over a fully divided map. Players use Paper.io-style loop capture to claim enemy territory for their faction. Factions can become endangered, collapse, and players get reassigned — but personal score persists across faction changes.

**Player fantasy:** "My team may collapse, but my run continues. I can still score, survive, get reassigned, and climb the leaderboard."

**Match arc:** Early game (border raids) → Mid game (faction wars, collapsing fronts) → Late game (last stands, reassignment, final territory race).

---

## Architecture

### Approach: Thin extraction + new modules

Keep existing working systems (grid, character, rendering) in `main.js`. Extract new team-mode systems into separate ES modules imported via the existing importmap.

### File structure

```
prototype/
├── index.html          # Modified: add new module imports, new HUD divs
├── main.js             # Modified: faction-based ownership, import new modules
├── faction.js           # New: FactionManager class
├── match.js             # New: MatchManager class (lifecycle, timer, end conditions)
├── scoring.js           # New: ScoreTracker class (personal scores, Last Stand)
└── ui.js                # New: HUD rendering (team ranking, timer, leaderboard, end screen)
```

Estimated scope: ~600-800 new lines across 4 files, ~200 lines of changes to `main.js`.

---

## Section 1: Grid & Faction Ownership Model

### Current → New

- **Current:** Grid stores per-character `ownerId` (1-254). Each player has unique territory.
- **New:** Grid stores **faction IDs** (1-6). All players on a faction share territory.

### Grid values

| Value | Meaning |
|-------|---------|
| 0 | Unclaimed |
| 1-6 | Faction ID |
| 255 | Out-of-bounds (outside arena circle) |

### Character changes

- `Character.factionId` replaces `Character.ownerId` for all grid operations.
- `insideOwn(x, z)` → `getOwner(x, z) === this.factionId` (safe on any teammate's land).
- `stampPolygon()` stamps with `factionId`, overwriting other factions' cells.
- On death: territory stays (belongs to faction). Only the player respawns.
- On respawn: no `stampCircle` — faction territory already exists, player spawns inside it.

### Trail & kill rules

- Enemy touches your trail → you die.
- Teammate touches your trail → no effect (pass through).
- Self-trail collision → you die (unchanged).
- Enemy enters your faction territory → no effect (they must leave to claim).

---

## Section 2: Map Initialization — Pie Slice Division

At match start, the entire map is divided between 6 factions using equal angular slices from the center, like a pie chart. No unclaimed land at start.

### Algorithm

1. Divide the full circle (2π) into 6 equal sectors of 60° each.
2. For each grid cell inside the arena, compute `atan2(wy, wx)` to get the angle from center, map to a sector index (0-5), assign that faction ID.
3. Cells outside arena radius remain 255 (out-of-bounds).
4. Each faction gets exactly 1/6 of the arena (~16.67%).

### Performance

Single pass over 1024x1024 grid with one `atan2` per cell. Runs once at match start, well under 1 second.

### Spawn points

- Each faction's spawn point is placed at ~60% radius along the center of its pie slice (angle = slice midpoint).
- On respawn: spawn at faction spawn point if it's inside faction territory. Otherwise, pick a random cell inside faction territory and convert to world coords.

### Bot distribution

- Total characters: 20 (1 player + 19 bots). 4 per faction.
- Player joins a random faction.
- Bots are evenly distributed: 4 per faction (3 for the player's faction since the player takes one slot).

---

## Section 3: Faction System & Elimination

### FactionManager class (`faction.js`)

```
FactionManager {
  factions: Map<id, {
    id: number,           // 1-6
    name: string,         // "Red", "Blue", etc.
    color: number,        // hex color for rendering
    seedPoint: {x, z},
    alive: boolean,
    respawnsEnabled: boolean,
    players: Set<Character>,
    territoryPct: number  // 0-100
  }>

  init(grid, arenaRadius)         — pie slice division, populate factions map
  updateTerritoryPcts(grid)       — count cells per faction, compute %
  checkEndangered(factionId)      — below 10% → disable respawns, set lastStand
  checkRecovery(factionId)        — above 12% → re-enable respawns, clear lastStand
  checkElimination(factionId)     — <10% AND no living characters (players + bots) → mark eliminated
  reassignPlayer(char)            — move to faction with fewest active characters
  getStandings()                  — sorted list of factions by territory %
  getWinner()                     — faction with most territory
  isMatchOver()                   — only 1 faction can respawn
}
```

### Endangered threshold (hysteresis)

```
Below 10% territory → respawns disabled (endangered)
Above 12% territory → respawns re-enabled (recovered)
```

### Death flow

1. Player dies (trail touched by enemy, or self-collision. Boundry does NOT kill).
2. Territory stays on grid (faction-owned).
3. Check player's faction:
   - Respawns enabled → respawn at faction spawn point (in the middle of the territory, never at the edges) after 3s delay.
   - Respawns disabled (endangered) → `reassignPlayer()`: assign to surviving faction with fewest active characters (players + bots). Tie-break: least territory %. Exclude the faction with the highest territory % from candidates. Player gets new faction color, spawns in new faction's territory.
4. After reassignment, check if old faction has any living characters (players + bots). If none, and territory < 10%, mark faction as eliminated.

### Elimination

- A faction is eliminated when: territory < 10% AND zero living characters (players + bots).
- Eliminated faction's grid cells remain on the map — other factions must conquer them. They don't vanish.
- An eliminated faction cannot recover.

---

## Section 4: Match Lifecycle

### MatchManager class (`match.js`)

```
MatchManager {
  phase: "setup" | "playing" | "ended"
  timeRemaining: number       // seconds, starts at 900 (15 min)
  factionManager: FactionManager
  scoreTracker: ScoreTracker

  init(grid, characters)      — pie slice division, distribute players, start timer
  update(dt)                  — tick timer, check end conditions, update factions
  endMatch()                  — compute final scores, determine winner
  getResults()                — final standings and personal scores
}
```

### Match phases

1. **Setup:** Pie slice division, assign players to factions, spawn characters.
2. **Playing:** 15-minute countdown. Every second: update territory percentages, check endangered/recovery/elimination, check if only 1 faction remains.
3. **Ended:** Freeze gameplay, compute team bonuses, display results screen.

### End conditions

The match ends when either:
1. Only one faction remains eligible to respawn (all others eliminated).
2. 15-minute timer expires.

Winner: faction with highest territory percentage at match end.

---

## Section 5: Personal Scoring

### ScoreTracker class (`scoring.js`)

```
ScoreTracker {
  scores: Map<Character, {
    total: number,
    captures: number,      // cells flipped
    kills: number,
    claims: number,        // successful loop closures
    factionHistory: number[] // faction IDs played for
  }>

  onCapture(char, cellsFlipped)    — +1 per cell (×1.25 if Last Stand)
  onKill(char)                     — +500 (×1.25 if Last Stand)
  onClaim(char)                    — +50 per successful claim
  applyTeamBonus(standings)        — 1st: +20%, 2nd: +10%, 3rd: +5%
  getLeaderboard()                 — sorted by total score
  getPlayerRankInFaction(char)     — rank among current faction members
}
```

### Score sources

| Action | Points | Notes |
|--------|--------|-------|
| Capture enemy cell | 1 per cell | Main score source |
| Kill enemy player | 500 | Trail touch kill |
| Complete a claim | 50 | Successfully close a loop |
| Last Stand multiplier | ×1.25 | Applied to all above while faction < 10% |

### Team result bonus (applied at match end)

| Place | Bonus |
|-------|-------|
| 1st | +20% of personal score |
| 2nd | +10% |
| 3rd | +5% |
| 4th-6th | +0% |

Score is per-character, persists across faction reassignment.

### Scoring balance

~80-90% of final score comes from personal actions. 10-20% from team result bonus. This ensures personal skill matters more than team luck.

---

## Section 6: UI / HUD

### UI module (`ui.js`)

Manages all HUD elements. Updates from `MatchManager` state each frame.

### HUD layout

```
┌─────────────────────────────────────────────┐
│ [12:34]                    [Team Rankings]  │
│  Timer                     Red     24%      │
│                            Blue    21%      │
│                            Green   18%      │
│                            Yellow  16%      │
│                            Purple  13% ⚠    │
│                            Orange   8% ⚠    │
│                                             │
│                                             │
│                                             │
│ ┌────────┐                                  │
│ │Minimap │     [Your Score: 4,250]          │
│ │ (map)  │     [#2 in Blue | 3 kills]       │
│ └────────┘                                  │
└─────────────────────────────────────────────┘
```

### Elements

1. **Top-left: Match timer** — `MM:SS` countdown. Flashes red in final 60 seconds.
2. **Top-right: Team Territory Ranking** — 6 rows: color swatch, faction name, territory %. "ENDANGERED" warning icon when < 10%. Eliminated factions greyed out and crossed through.
3. **Bottom-left: Minimap** — shows the entire map at a glance, drawn on a `<canvas>` element.
4. **Bottom-center: Personal stats** — Current score, kill count, faction contribution rank. Small and unobtrusive.
5. **Tab key: Full leaderboard overlay** — Top 10 personal scores with player names and current faction color. Semi-transparent overlay.
6. **Match end screen** — Full-screen overlay: winning faction banner, final territory standings, personal score, personal rank, "Play Again" button.

### Minimap

A `<canvas>` element in the bottom-left corner, approximately 180x180 pixels, showing a downscaled view of the territory grid.

**Rendering:**
- Sample the 1024x1024 grid at a lower resolution (e.g., every 4th or 8th cell → 128x128 or 256x256 pixel map).
- Each pixel is colored by the faction that owns that cell: faction color for owned cells, dark grey for unclaimed, transparent/black for out-of-bounds.
- The shapes and positions are exact — this is a direct pixel readout of the grid, not an approximation.
- Draw a small white dot for the player's current position.
- Optionally draw small dots for teammates (same faction color, smaller).

**Update frequency:** Redraw every 500ms (territory doesn't change faster than claims happen). Not every frame — that would be wasteful for a 1024x1024 scan.

**Implementation:** Part of `ui.js`. Reads `territoryGrid.grid` directly, maps faction IDs to colors, writes to canvas via `ImageData`.

### HTML changes to `index.html`

- Repurpose `#hud-tl` for match timer.
- Repurpose `#hud-tr` for team ranking.
- Add `#minimap-container` with `<canvas id="minimap">` in bottom-left.
- Add `#hud-bottom` for personal stats.
- Add `#leaderboard-overlay` (hidden, toggled by Tab).
- Add `#match-end-screen` (hidden, shown at match end).
- Modify `#name-entry` to show faction assignment after name entry.

---

## Section 7: Bot AI Modifications

### Team awareness

- Bots only attack enemy faction territory (not teammates).
- `_planBotLoop()` modified: when choosing aggro target, only consider characters from other factions.
- Trail avoidance: bots avoid enemy trails (existing behavior), ignore teammate trails.

### Territory targeting

- Bots prefer to claim territory at faction borders (where their faction's territory meets enemy territory) rather than wandering deep into enemy land.
- Simple heuristic: exit toward the nearest enemy-faction border, loop outward 3-5 units, return.

### No coordination

Bots operate independently — no squad tactics or coordinated assaults. They each pick a direction and loop. This is sufficient for MVP.

---

## Section 8: Changes to `main.js`

### Removed

- `Character.ownerId` — replaced by `Character.factionId`.
- Individual territory init (`stampCircle` on spawn) — pie slice division handles initial territory.
- `_subtractFromOthers()` — grid overwrite already handles this.
- Per-character leaderboard in HUD — replaced by `ui.js` team/personal leaderboards.

### Modified

- `Character.insideOwn()` — checks `factionId` instead of `ownerId`.
- `Character._claim()` — stamps with `factionId`, reports cells flipped to `ScoreTracker`.
- `Character.die()` — does NOT call `clearOwner()`. Territory stays.
- `Character.respawn()` — no `_initTerritory()`. Spawns inside faction territory.
- Trail collision checks — skip teammates (same `factionId`).
- `Game` constructor — creates `MatchManager`, `FactionManager`, `ScoreTracker`, `UIManager`.
- `Game.tick()` — calls `matchManager.update(dt)`, `uiManager.update()`.
- `Game._checkTrailKills()` — only kill if attacker's `factionId !== victim.factionId`.
- `CONTINUOUS_LAND` flood fill — operates per-faction (keep largest connected component of the faction, not per-character).
- Colors array — 6 faction colors instead of 8 individual colors.
- `BOT_COUNT` — increased to 17 (for 18 total characters, 3 per faction).

### Rendering

- `_rebuildAreaMesh()` — called per-faction (not per-character). One mesh per faction covering all that faction's territory.
- Territory mesh color = faction color, shared by all faction members.
- Character body/head color = faction color (all teammates look alike, differentiated by name label).

---

## Section 9: Constants

```javascript
// Factions
const FACTION_COUNT = 6;
const CHARS_PER_FACTION = 3;
const BOT_COUNT = FACTION_COUNT * CHARS_PER_FACTION - 1;  // 17 (1 player takes a slot)
const RESPAWN_DELAY = 3;          // seconds

// Match
const MATCH_DURATION = 900;       // 15 minutes in seconds
const ENDANGERED_THRESHOLD = 10;  // % territory to disable respawns
const RECOVERY_THRESHOLD = 12;    // % territory to re-enable respawns

// Scoring
const SCORE_PER_CELL = 1;
const SCORE_PER_KILL = 500;
const SCORE_PER_CLAIM = 50;
const LAST_STAND_MULTIPLIER = 1.25;
const TEAM_BONUS = [0.20, 0.10, 0.05, 0, 0, 0]; // 1st through 6th

// Faction colors
const FACTION_COLORS = [0xE53935, 0x1E88E5, 0x43A047, 0xFDD835, 0x8E24AA, 0xF4511E];
const FACTION_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange"];
```

---

## MVP Scope

### Included in MVP

1. 5-faction pie slice map division
2. Faction-based grid ownership (shared territory)
3. 1 player + 19 bots (4 per faction)
4. Paper.io loop capture for faction
5. Trail kill (enemies only, teammates pass through)
6. Death → respawn in faction territory (territory persists)
7. Territory % tracking per faction
8. Endangered threshold at 10%, recovery at 12%
9. Player reassignment on death while endangered
10. Faction elimination (<10% + no living players)
11. 15-minute match timer
12. Team territory ranking HUD
13. Personal score (cells + kills + claims)
14. Personal leaderboard (Tab key)
15. Match end screen with winner
16. Minimap (bottom-left, canvas-based grid readout)

### Deferred post-MVP

- Team contribution ranking display
- Anti-snowball bonuses for weak factions
- Neutral corridors or contested zones
- Better bot AI (border targeting, coordination)
- Play Again flow (match restart)
- Sound effects / visual polish
