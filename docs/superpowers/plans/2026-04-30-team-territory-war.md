# Team Territory War Implementation Plan

> **For agentic workers:** Use subagent-driven development to implement. Delegate each task to a subagent.

**Goal:** Transform the free-for-all Paper.io prototype into a 5-faction team territory war mode with shared territory, faction elimination, personal scoring, and a minimap.

**Architecture:** Keep existing grid/character/rendering in `main.js`. Add 4 new ES modules (`faction.js`, `match.js`, `scoring.js`, `ui.js`) imported as local files. Change grid ownership from per-character to per-faction. The existing 1024x1024 grid, marching squares contour extraction, earcut triangulation, and trail mechanics are reused.

**Tech Stack:** Three.js (CDN), earcut (CDN), vanilla ES modules, no build step.

**Source spec:** `docs/superpowers/specs/2026-04-30-team-territory-war-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `prototype/faction.js` | Create | FactionManager: faction state, pie-slice init, endangered/elimination/reassignment |
| `prototype/scoring.js` | Create | ScoreTracker: personal scores, kill/capture/claim tracking, team bonus |
| `prototype/match.js` | Create | MatchManager: match lifecycle (setup/playing/ended), timer, end conditions |
| `prototype/ui.js` | Create | UIManager: team ranking, timer, personal stats, minimap canvas, leaderboard overlay, end screen |
| `prototype/main.js` | Modify | Replace ownerId with factionId, faction-aware trails/kills/respawn, remove per-char territory init, wire up new modules |
| `prototype/index.html` | Modify | Add HUD divs (minimap, bottom stats, leaderboard overlay, end screen), update CSS |

---

### Task 1: Create `faction.js` — FactionManager with pie-slice init

**Files:**
- Create: `prototype/faction.js`

Steps:

- [ ] Create `prototype/faction.js` with the following content:

```javascript
// faction.js — Faction state, pie-slice territory init, endangered/elimination logic

export const FACTION_COUNT = 5;
export const CHARS_PER_FACTION = 4;
export const ENDANGERED_THRESHOLD = 10;
export const RECOVERY_THRESHOLD = 12;

export const FACTION_COLORS = [0xE53935, 0x1E88E5, 0x43A047, 0xFDD835, 0x8E24AA];
export const FACTION_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple"];

export class FactionManager {
  constructor() {
    this.factions = new Map();
  }

  init(grid, gridSize, worldMin, cellSize, arenaRadius, sentinel) {
    // Create faction objects
    for (let i = 0; i < FACTION_COUNT; i++) {
      const sliceAngle = (2 * Math.PI) / FACTION_COUNT;
      const midAngle = i * sliceAngle + sliceAngle / 2;
      const spawnR = arenaRadius * 0.6;
      this.factions.set(i + 1, {
        id: i + 1,
        name: FACTION_NAMES[i],
        color: FACTION_COLORS[i],
        spawnPoint: { x: Math.cos(midAngle) * spawnR, z: Math.sin(midAngle) * spawnR },
        alive: true,
        respawnsEnabled: true,
        endangered: false,
        characters: new Set(),
        territoryPct: 100 / FACTION_COUNT,
      });
    }

    // Pie-slice division: assign every arena cell to nearest faction by angle
    const sliceAngle = (2 * Math.PI) / FACTION_COUNT;
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const idx = gy * gridSize + gx;
        if (grid[idx] === sentinel) continue; // out-of-bounds
        const wx = worldMin + (gx + 0.5) * cellSize;
        const wy = worldMin + (gy + 0.5) * cellSize;
        let angle = Math.atan2(wy, wx); // note: wy maps to world Z
        if (angle < 0) angle += 2 * Math.PI;
        const sliceIdx = Math.floor(angle / sliceAngle);
        grid[idx] = Math.min(sliceIdx + 1, FACTION_COUNT); // faction IDs are 1-based
      }
    }
  }

  addCharacter(char, factionId) {
    char.factionId = factionId;
    const faction = this.factions.get(factionId);
    if (faction) faction.characters.add(char);
  }

  removeCharacter(char) {
    const faction = this.factions.get(char.factionId);
    if (faction) faction.characters.delete(char);
  }

  updateTerritoryPcts(grid, gridSize, sentinel) {
    const counts = new Map();
    let totalArena = 0;
    for (let i = 1; i <= FACTION_COUNT; i++) counts.set(i, 0);

    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v === sentinel || v === 0) {
        if (v !== sentinel) totalArena++;
        continue;
      }
      totalArena++;
      if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    }

    if (totalArena === 0) return;
    for (const [id, faction] of this.factions) {
      faction.territoryPct = (counts.get(id) / totalArena) * 100;
    }
  }

  checkEndangered(factionId) {
    const f = this.factions.get(factionId);
    if (!f || !f.alive) return;
    if (!f.endangered && f.territoryPct < ENDANGERED_THRESHOLD) {
      f.endangered = true;
      f.respawnsEnabled = false;
    }
  }

  checkRecovery(factionId) {
    const f = this.factions.get(factionId);
    if (!f || !f.alive) return;
    if (f.endangered && f.territoryPct >= RECOVERY_THRESHOLD) {
      f.endangered = false;
      f.respawnsEnabled = true;
    }
  }

  checkElimination(factionId) {
    const f = this.factions.get(factionId);
    if (!f || !f.alive) return false;
    const livingChars = [...f.characters].filter(c => c.alive);
    if (f.territoryPct < ENDANGERED_THRESHOLD && livingChars.length === 0) {
      f.alive = false;
      f.respawnsEnabled = false;
      return true;
    }
    return false;
  }

  reassignCharacter(char) {
    const oldFaction = this.factions.get(char.factionId);
    if (oldFaction) oldFaction.characters.delete(char);

    // Find surviving factions, exclude the one with highest territory %
    const candidates = [...this.factions.values()]
      .filter(f => f.alive && f.id !== char.factionId);
    if (candidates.length === 0) return null;

    // Exclude strongest faction
    candidates.sort((a, b) => b.territoryPct - a.territoryPct);
    const strongest = candidates[0];
    const eligible = candidates.filter(f => f !== strongest || candidates.length === 1);

    // Pick faction with fewest active characters, tie-break by least territory
    eligible.sort((a, b) => {
      const aLiving = [...a.characters].filter(c => c.alive).length;
      const bLiving = [...b.characters].filter(c => c.alive).length;
      if (aLiving !== bLiving) return aLiving - bLiving;
      return a.territoryPct - b.territoryPct;
    });

    const newFaction = eligible[0];
    newFaction.characters.add(char);
    char.factionId = newFaction.id;
    return newFaction;
  }

  getSpawnPoint(factionId, grid, gridSize, worldMin, cellSize, sentinel) {
    const f = this.factions.get(factionId);
    if (!f) return { x: 0, z: 0 };

    // Check if default spawn point is inside faction territory
    const spGX = Math.floor((f.spawnPoint.x - worldMin) / cellSize);
    const spGY = Math.floor((f.spawnPoint.z - worldMin) / cellSize);
    if (spGX >= 0 && spGX < gridSize && spGY >= 0 && spGY < gridSize) {
      if (grid[spGY * gridSize + spGX] === factionId) {
        return { x: f.spawnPoint.x, z: f.spawnPoint.z };
      }
    }

    // Find centroid of all owned cells (spawn in the middle, not edges)
    let sumX = 0, sumY = 0, count = 0;
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        if (grid[gy * gridSize + gx] === factionId) {
          sumX += gx;
          sumY += gy;
          count++;
        }
      }
    }
    if (count === 0) return { x: 0, z: 0 };
    const cgx = Math.round(sumX / count);
    const cgy = Math.round(sumY / count);
    return {
      x: worldMin + (cgx + 0.5) * cellSize,
      z: worldMin + (cgy + 0.5) * cellSize
    };
  }

  getStandings() {
    return [...this.factions.values()]
      .filter(f => f.alive)
      .sort((a, b) => b.territoryPct - a.territoryPct);
  }

  getAllFactions() {
    return [...this.factions.values()];
  }

  getWinner() {
    const standings = this.getStandings();
    return standings.length > 0 ? standings[0] : null;
  }

  isMatchOver() {
    const aliveFactions = [...this.factions.values()].filter(f => f.alive && f.respawnsEnabled);
    return aliveFactions.length <= 1;
  }
}
```

- [ ] Verify the file loads without syntax errors by checking the import in a browser console
- [ ] Commit

```bash
git add prototype/faction.js
git commit -m "feat: add FactionManager with pie-slice init and faction lifecycle"
```

---

### Task 2: Create `scoring.js` — ScoreTracker

**Files:**
- Create: `prototype/scoring.js`

Steps:

- [ ] Create `prototype/scoring.js` with the following content:

```javascript
// scoring.js — Personal score tracking, team bonuses

const SCORE_PER_CELL = 1;
const SCORE_PER_KILL = 500;
const SCORE_PER_CLAIM = 50;
const LAST_STAND_MULTIPLIER = 1.25;
const TEAM_BONUS = [0.20, 0.10, 0.05, 0, 0];

export class ScoreTracker {
  constructor() {
    this.scores = new Map();
  }

  register(char) {
    this.scores.set(char, {
      total: 0,
      captures: 0,
      kills: 0,
      claims: 0,
      factionHistory: [char.factionId],
    });
  }

  _getMultiplier(char, factionManager) {
    const faction = factionManager.factions.get(char.factionId);
    return (faction && faction.endangered) ? LAST_STAND_MULTIPLIER : 1.0;
  }

  onCapture(char, cellsFlipped, factionManager) {
    const s = this.scores.get(char);
    if (!s) return;
    const mult = this._getMultiplier(char, factionManager);
    const points = Math.round(cellsFlipped * SCORE_PER_CELL * mult);
    s.captures += cellsFlipped;
    s.total += points;
  }

  onKill(char, factionManager) {
    const s = this.scores.get(char);
    if (!s) return;
    const mult = this._getMultiplier(char, factionManager);
    const points = Math.round(SCORE_PER_KILL * mult);
    s.kills++;
    s.total += points;
  }

  onClaim(char, factionManager) {
    const s = this.scores.get(char);
    if (!s) return;
    const mult = this._getMultiplier(char, factionManager);
    const points = Math.round(SCORE_PER_CLAIM * mult);
    s.claims++;
    s.total += points;
  }

  onFactionChange(char) {
    const s = this.scores.get(char);
    if (s) s.factionHistory.push(char.factionId);
  }

  applyTeamBonus(standings) {
    // standings: sorted array of faction objects (1st place first)
    const bonusByFaction = new Map();
    for (let i = 0; i < standings.length; i++) {
      bonusByFaction.set(standings[i].id, TEAM_BONUS[i] || 0);
    }
    for (const [char, s] of this.scores) {
      const bonus = bonusByFaction.get(char.factionId) || 0;
      s.total = Math.round(s.total * (1 + bonus));
    }
  }

  getLeaderboard() {
    return [...this.scores.entries()]
      .map(([char, s]) => ({ char, ...s }))
      .sort((a, b) => b.total - a.total);
  }

  getScore(char) {
    return this.scores.get(char) || { total: 0, captures: 0, kills: 0, claims: 0 };
  }

  getPlayerRankInFaction(char) {
    const factionId = char.factionId;
    const factionScores = [...this.scores.entries()]
      .filter(([c]) => c.factionId === factionId)
      .sort(([, a], [, b]) => b.total - a.total);
    const idx = factionScores.findIndex(([c]) => c === char);
    return idx + 1;
  }
}
```

- [ ] Commit

```bash
git add prototype/scoring.js
git commit -m "feat: add ScoreTracker with personal scoring and team bonuses"
```

---

### Task 3: Create `match.js` — MatchManager

**Files:**
- Create: `prototype/match.js`

Steps:

- [ ] Create `prototype/match.js` with the following content:

```javascript
// match.js — Match lifecycle, timer, end conditions

const MATCH_DURATION = 900; // 15 minutes

export class MatchManager {
  constructor(factionManager, scoreTracker) {
    this.factionManager = factionManager;
    this.scoreTracker = scoreTracker;
    this.phase = "setup"; // "setup" | "playing" | "ended"
    this.timeRemaining = MATCH_DURATION;
    this.factionCheckTimer = 0;
    this.winner = null;
  }

  startMatch() {
    this.phase = "playing";
    this.timeRemaining = MATCH_DURATION;
  }

  update(dt, grid, gridSize, sentinel) {
    if (this.phase !== "playing") return;

    this.timeRemaining -= dt;

    // Check faction status every second
    this.factionCheckTimer += dt;
    if (this.factionCheckTimer >= 1.0) {
      this.factionCheckTimer -= 1.0;
      this.factionManager.updateTerritoryPcts(grid, gridSize, sentinel);
      for (const [id] of this.factionManager.factions) {
        this.factionManager.checkEndangered(id);
        this.factionManager.checkRecovery(id);
        this.factionManager.checkElimination(id);
      }
    }

    // End conditions
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endMatch();
    } else if (this.factionManager.isMatchOver()) {
      this.endMatch();
    }
  }

  endMatch() {
    if (this.phase === "ended") return;
    this.phase = "ended";
    const standings = this.factionManager.getStandings();
    this.scoreTracker.applyTeamBonus(standings);
    this.winner = this.factionManager.getWinner();
  }

  getTimeString() {
    const t = Math.max(0, Math.ceil(this.timeRemaining));
    const min = Math.floor(t / 60);
    const sec = t % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }
}
```

- [ ] Commit

```bash
git add prototype/match.js
git commit -m "feat: add MatchManager with timer and end conditions"
```

---

### Task 4: Create `ui.js` — UIManager with HUD, minimap, leaderboard, end screen

**Files:**
- Create: `prototype/ui.js`

Steps:

- [ ] Create `prototype/ui.js` with the following content:

```javascript
// ui.js — HUD rendering: team ranking, timer, minimap, personal stats, leaderboard, end screen

import { FACTION_COLORS, FACTION_COUNT } from "./faction.js";

export class UIManager {
  constructor(factionManager, matchManager, scoreTracker, grid, gridSize, sentinel) {
    this.factionManager = factionManager;
    this.matchManager = matchManager;
    this.scoreTracker = scoreTracker;
    this.grid = grid;
    this.gridSize = gridSize;
    this.sentinel = sentinel;
    this.player = null;

    // DOM elements
    this.timerEl = document.getElementById("hud-tl");
    this.rankingEl = document.getElementById("hud-tr");
    this.statsEl = document.getElementById("hud-bottom");
    this.minimapCanvas = document.getElementById("minimap");
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext("2d") : null;
    this.leaderboardEl = document.getElementById("leaderboard-overlay");
    this.endScreenEl = document.getElementById("match-end-screen");

    // Minimap config
    this.minimapSize = 180;
    this.minimapScale = Math.ceil(gridSize / this.minimapSize); // sample every Nth cell
    this.minimapPixelSize = Math.ceil(gridSize / this.minimapScale);
    if (this.minimapCanvas) {
      this.minimapCanvas.width = this.minimapPixelSize;
      this.minimapCanvas.height = this.minimapPixelSize;
    }
    this.minimapTimer = 0;
    this.minimapInterval = 0.5;

    // Faction color lookup as [r,g,b] arrays for ImageData
    this.factionRGB = [null]; // index 0 unused (faction IDs start at 1)
    for (let i = 0; i < FACTION_COUNT; i++) {
      const c = FACTION_COLORS[i];
      this.factionRGB.push([(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]);
    }

    // Tab key for leaderboard
    this.showLeaderboard = false;
    window.addEventListener("keydown", e => {
      if (e.key === "Tab") { e.preventDefault(); this.showLeaderboard = true; }
    });
    window.addEventListener("keyup", e => {
      if (e.key === "Tab") { this.showLeaderboard = false; }
    });
  }

  setPlayer(player) {
    this.player = player;
  }

  update(dt) {
    this._updateTimer();
    this._updateRanking();
    this._updateStats();
    this._updateLeaderboardOverlay();

    this.minimapTimer += dt;
    if (this.minimapTimer >= this.minimapInterval) {
      this.minimapTimer -= this.minimapInterval;
      this._updateMinimap();
    }

    if (this.matchManager.phase === "ended") {
      this._showEndScreen();
    }
  }

  _updateTimer() {
    const timeStr = this.matchManager.getTimeString();
    const isLow = this.matchManager.timeRemaining <= 60;
    const flash = isLow && Math.sin(performance.now() * 0.006) > 0;
    this.timerEl.innerHTML = `<div style="font-size:28px;font-weight:bold;color:${isLow ? (flash ? '#ff0000' : '#cc0000') : '#333'}">${timeStr}</div>`;
  }

  _updateRanking() {
    const factions = this.factionManager.getAllFactions()
      .sort((a, b) => b.territoryPct - a.territoryPct);

    let html = '<div style="font-weight:bold;margin-bottom:6px;">Factions</div>';
    for (const f of factions) {
      const col = `#${f.color.toString(16).padStart(6, "0")}`;
      const pct = f.territoryPct.toFixed(1);
      const isPlayer = this.player && this.player.factionId === f.id;
      let tag = "";
      if (!f.alive) tag = ' <span style="color:#999;">ELIMINATED</span>';
      else if (f.endangered) tag = ' <span style="color:#ff6600;">ENDANGERED</span>';
      const style = !f.alive
        ? "opacity:0.4;text-decoration:line-through;"
        : (isPlayer ? "font-weight:bold;" : "");

      html += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;${style}">
        <span style="display:inline-block;width:12px;height:12px;background:${col};border-radius:2px;flex-shrink:0;"></span>
        <span style="flex:1;">${f.name}</span>
        <span>${pct}%</span>${tag}
      </div>`;
    }
    this.rankingEl.innerHTML = html;
  }

  _updateStats() {
    if (!this.player || !this.statsEl) return;
    const score = this.scoreTracker.getScore(this.player);
    const rank = this.scoreTracker.getPlayerRankInFaction(this.player);
    const faction = this.factionManager.factions.get(this.player.factionId);
    const fName = faction ? faction.name : "?";
    this.statsEl.innerHTML = `Score: ${score.total.toLocaleString()} | Kills: ${score.kills} | #${rank} in ${fName}`;
  }

  _updateMinimap() {
    if (!this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const scale = this.minimapScale;
    const px = this.minimapPixelSize;
    const imgData = ctx.createImageData(px, px);
    const data = imgData.data;

    for (let py = 0; py < px; py++) {
      for (let ppx = 0; ppx < px; ppx++) {
        const gx = ppx * scale;
        const gy = py * scale;
        const idx = gy * this.gridSize + gx;
        const val = (gx < this.gridSize && gy < this.gridSize) ? this.grid[idx] : this.sentinel;
        const pi = (py * px + ppx) * 4;

        if (val === this.sentinel) {
          data[pi] = 20; data[pi+1] = 20; data[pi+2] = 20; data[pi+3] = 255;
        } else if (val === 0) {
          data[pi] = 60; data[pi+1] = 60; data[pi+2] = 60; data[pi+3] = 255;
        } else if (val <= FACTION_COUNT) {
          const rgb = this.factionRGB[val];
          data[pi] = rgb[0]; data[pi+1] = rgb[1]; data[pi+2] = rgb[2]; data[pi+3] = 255;
        } else {
          data[pi] = 40; data[pi+1] = 40; data[pi+2] = 40; data[pi+3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw player position dot
    if (this.player && this.player.alive) {
      const worldMin = -24.5; // must match main.js WORLD_MIN
      const worldSize = 49;   // must match main.js WORLD_SIZE
      const dotX = ((this.player.pos.x - worldMin) / worldSize) * px;
      const dotZ = ((this.player.pos.z - worldMin) / worldSize) * px;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(dotX, dotZ, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _updateLeaderboardOverlay() {
    if (!this.leaderboardEl) return;
    if (!this.showLeaderboard) {
      this.leaderboardEl.style.display = "none";
      return;
    }
    this.leaderboardEl.style.display = "flex";

    const lb = this.scoreTracker.getLeaderboard().slice(0, 10);
    let html = '<div style="font-size:20px;font-weight:bold;margin-bottom:12px;">Leaderboard</div>';
    lb.forEach((entry, i) => {
      const faction = this.factionManager.factions.get(entry.char.factionId);
      const col = faction ? `#${faction.color.toString(16).padStart(6, "0")}` : "#999";
      const isMe = entry.char === this.player;
      html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;${isMe ? "font-weight:bold;" : ""}">
        <span>${i + 1}.</span>
        <span style="display:inline-block;width:10px;height:10px;background:${col};border-radius:2px;"></span>
        <span style="flex:1;">${entry.char.name}</span>
        <span>${entry.total.toLocaleString()}</span>
      </div>`;
    });
    this.leaderboardEl.querySelector(".lb-content").innerHTML = html;
  }

  _showEndScreen() {
    if (!this.endScreenEl || this.endScreenEl.style.display === "flex") return;
    this.endScreenEl.style.display = "flex";
    const winner = this.matchManager.winner;
    const standings = this.factionManager.getStandings();
    const playerScore = this.player ? this.scoreTracker.getScore(this.player) : { total: 0 };
    const lb = this.scoreTracker.getLeaderboard();
    const playerRank = lb.findIndex(e => e.char === this.player) + 1;

    const winCol = winner ? `#${winner.color.toString(16).padStart(6, "0")}` : "#999";

    let html = `<h2 style="color:${winCol};font-size:36px;margin-bottom:8px;">${winner ? winner.name + " Wins!" : "Match Over!"}</h2>`;
    html += '<div style="margin:16px 0;">';
    for (const f of standings) {
      const col = `#${f.color.toString(16).padStart(6, "0")}`;
      html += `<div style="display:flex;gap:8px;margin:4px 0;"><span style="display:inline-block;width:12px;height:12px;background:${col};border-radius:2px;margin-top:3px;"></span><span>${f.name} — ${f.territoryPct.toFixed(1)}%</span></div>`;
    }
    html += '</div>';
    html += `<div style="font-size:20px;margin-top:12px;">Your Score: ${playerScore.total.toLocaleString()} (Rank #${playerRank})</div>`;

    this.endScreenEl.querySelector(".end-content").innerHTML = html;
  }
}
```

- [ ] Commit

```bash
git add prototype/ui.js
git commit -m "feat: add UIManager with team ranking, minimap, leaderboard, and end screen"
```

---

### Task 5: Update `index.html` — add HUD elements and CSS

**Files:**
- Modify: `prototype/index.html`

Steps:

- [ ] Replace the current `<div id="ui">` block and add new HUD elements. The full updated `index.html` should be:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>Territory War</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #f0f0f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    canvas#game-canvas { display: block; }
    #ui { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; }
    #hud-tl { position: absolute; top: 16px; left: 16px; color: #333; font-size: 16px; }
    #hud-tr { position: absolute; top: 16px; right: 16px; color: #333; font-size: 14px; min-width: 200px; background: rgba(255,255,255,0.85); border-radius: 8px; padding: 8px 12px; }
    #hud-bottom { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); color: #333; font-size: 14px; background: rgba(255,255,255,0.8); border-radius: 8px; padding: 6px 16px; white-space: nowrap; }
    #minimap-container { position: absolute; bottom: 16px; left: 16px; border: 2px solid rgba(255,255,255,0.6); border-radius: 8px; overflow: hidden; background: #111; }
    #minimap { display: block; width: 180px; height: 180px; image-rendering: pixelated; }
    #death-screen {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center; z-index: 50; pointer-events: none;
    }
    #death-screen.visible { display: flex; }
    #leaderboard-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5); z-index: 60; pointer-events: none;
    }
    #leaderboard-overlay .lb-content {
      background: rgba(0,0,0,0.8); color: white; padding: 24px 32px; border-radius: 12px; min-width: 300px;
    }
    #match-end-screen {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7); z-index: 70; pointer-events: none;
    }
    #match-end-screen .end-content {
      background: rgba(0,0,0,0.85); color: white; padding: 32px 48px; border-radius: 16px; text-align: center; min-width: 350px;
    }
    #name-entry {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.9); z-index: 100; pointer-events: auto;
    }
    #name-entry.hidden { display: none; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "earcut": "https://esm.sh/earcut@3.0.1"
    }
  }
  </script>
</head>
<body>
  <div id="ui">
    <div id="hud-tl"></div>
    <div id="hud-tr"></div>
    <div id="hud-bottom"></div>
    <div id="minimap-container"><canvas id="minimap"></canvas></div>
  </div>
  <div id="death-screen">
    <div style="text-align:center; background:rgba(0,0,0,0.6); padding:32px 48px; border-radius:16px;">
      <p id="death-msg" style="font-size:28px; color:white; margin-bottom:8px;"></p>
      <p id="death-timer" style="font-size:20px; color:#ccc;"></p>
    </div>
  </div>
  <div id="leaderboard-overlay">
    <div class="lb-content"></div>
  </div>
  <div id="match-end-screen">
    <div class="end-content"></div>
  </div>
  <div id="name-entry">
    <div style="text-align:center;">
      <h1 style="font-size:48px; margin-bottom:8px; color:#333;">Territory War</h1>
      <p style="color:#666; margin-bottom:24px;">Claim territory. Fight for your faction. Dominate.</p>
      <input id="name-input" type="text" placeholder="Enter your name" maxlength="16"
        style="font-size:20px; padding:12px 24px; border:2px solid #ccc; border-radius:8px; outline:none; text-align:center; width:280px;" />
      <br/>
      <button id="play-btn"
        style="margin-top:16px; font-size:20px; padding:12px 48px; background:#4CAF50; color:white; border:none; border-radius:8px; cursor:pointer;">
        Play
      </button>
    </div>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] Commit

```bash
git add prototype/index.html
git commit -m "feat: update HTML with team war HUD elements, minimap, leaderboard, end screen"
```

---

### Task 6: Rewrite `main.js` — faction-based ownership and module integration

This is the largest task. It modifies `main.js` to replace per-character ownership with per-faction ownership and wire up the new modules.

**Files:**
- Modify: `prototype/main.js`

Steps:

- [ ] **Step 1: Update imports and constants**

Replace the imports and constants section (lines 1-24) with:

```javascript
import * as THREE from "three";
import earcut from "earcut";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION, FACTION_COLORS, FACTION_NAMES } from "./faction.js";
import { ScoreTracker } from "./scoring.js";
import { MatchManager } from "./match.js";
import { UIManager } from "./ui.js";

// ===================== CONSTANTS =====================
const ARENA_RADIUS = 24.5;
const MIN_POINT_DIST = 0.3;
const PLAYER_SPEED = 8;
const BOT_SPEED = 6;
const TURN_SPEED = 5;
const TRAIL_WIDTH = 0.8;
const TRAIL_KILL_DIST = 0.6;
const SELF_TRAIL_SKIP = 5;
const BOT_COUNT = FACTION_COUNT * CHARS_PER_FACTION - 1; // 19 bots + 1 player = 20
const RESPAWN_DELAY = 3;
const INVULN_TIME = 2;
const CAMERA_HEIGHT = 30;
const CAMERA_Z_OFFSET = 14;

const CONTINUOUS_LAND = true;

const BOT_NAMES = [
  "K-9","Lime","Toe","Leaf Assassin","Helmet Destroyer","Star Jammer","Sky Bully","Daisy Stick",
  "Claw","Blitz","Nova","Shade","Rook","Pixel","Echo","Drift","Fang","Jinx","Bolt"
];
```

Remove: `START_RADIUS`, `TOTAL_AREA`, `COLORS` array (replaced by `FACTION_COLORS`).

- [ ] **Step 2: Remove shape diagnostics section**

Delete the shape diagnostics block (lines 38-47 in original) — it was a debugging tool for the old per-character system. Remove the `sampleShapeDiagnostics` function and its call in `tick()`.

- [ ] **Step 3: Update Character class**

Replace `ownerId` with `factionId` throughout the Character class:

In the constructor (~line 494), change:
```javascript
this.ownerId = 0;
```
to:
```javascript
this.factionId = 0;
```

Remove `_initTerritory()` method entirely — territory is now initialized by `FactionManager.init()`.

Change `insideOwn()` to:
```javascript
insideOwn(x, z) {
  return territoryGrid.getOwner(x, z) === this.factionId;
}
```

- [ ] **Step 4: Update `_claim()` to use factionId and report to ScoreTracker**

In `_claim()`, replace all `this.ownerId` with `this.factionId`.

Replace the contour extraction for boundary:
```javascript
const contours = territoryGrid.extractContours(this.factionId);
```

Replace the stamp call:
```javascript
const overwritten = territoryGrid.stampPolygon(trailPoly, this.factionId);
```

After stamping, count cells gained and report to scorer:
```javascript
const areaAfter = territoryGrid.countCells(this.factionId);
const cellsGained = areaAfter - areaBefore;

// Report to scoring system
if (window._scoreTracker && window._factionManager) {
  if (cellsGained > 0) window._scoreTracker.onCapture(this, cellsGained, window._factionManager);
  window._scoreTracker.onClaim(this, window._factionManager);
}
```

In the CONTINUOUS_LAND block, replace per-character victim lookup with per-faction:
```javascript
if (CONTINUOUS_LAND && overwritten.size > 0) {
  for (const victimFactionId of overwritten) {
    const cleared = territoryGrid.floodFillConnected(victimFactionId, 0, 0);
    if (cleared > 0) {
      dlog("CONTINUOUS_LAND", `faction ${victimFactionId}: cleared ${cleared} disconnected cells`);
    }
    // Mark all characters of that faction as dirty
    if (this.allCharacters) {
      for (const c of this.allCharacters) {
        if (c.factionId === victimFactionId) c.territoryDirty = true;
      }
    }
  }
}
```

- [ ] **Step 5: Update `_rebuildAreaMesh()` to use factionId**

Change:
```javascript
this.contourLoops = territoryGrid.extractContours(this.ownerId);
```
to:
```javascript
this.contourLoops = territoryGrid.extractContours(this.factionId);
```

Change the mesh material color to use faction color:
```javascript
const factionColor = FACTION_COLORS[this.factionId - 1] || 0x999999;
this.areaMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
  color: factionColor, transparent: false, opacity: 1.0, side: THREE.DoubleSide, depthWrite: false
}));
```

Note: Only one character per faction needs to rebuild the mesh. But for simplicity in the prototype, we let each character track `territoryDirty` and only the first one to rebuild creates the mesh. Add a faction-level mesh cache:

Actually, simpler approach: territory mesh is per-faction, managed by the Game class, not per-character. Move `_rebuildAreaMesh` to be called once per faction per frame. Add to the Game class:

```javascript
// In Game constructor:
this.factionMeshes = new Map(); // factionId -> THREE.Mesh

// New method in Game:
_rebuildFactionMesh(factionId) {
  // Dispose old mesh
  const oldMesh = this.factionMeshes.get(factionId);
  if (oldMesh) {
    this.scene.remove(oldMesh);
    oldMesh.geometry.dispose();
    this.factionMeshes.delete(factionId);
  }

  const contourLoops = territoryGrid.extractContours(factionId);
  if (contourLoops.length === 0) return;

  const MIN_LOOP_AREA = 0.5;
  const outers = [];
  const holes = [];

  for (const loop of contourLoops) {
    let signedArea = 0;
    for (let j = 0; j < loop.length; j++) {
      const k = (j + 1) % loop.length;
      signedArea += loop[j].x * loop[k].y - loop[k].x * loop[j].y;
    }
    const area = Math.abs(signedArea / 2);
    if (area < MIN_LOOP_AREA) continue;

    if (signedArea < 0) {
      outers.push({ loop: loop.slice().reverse(), area, signedArea: -signedArea });
    } else {
      holes.push({ loop: loop.slice().reverse(), area, signedArea: -signedArea });
    }
  }

  if (outers.length === 0) return;

  outers.sort((a, b) => a.area - b.area);
  const holesByOuter = new Map();
  for (const outer of outers) holesByOuter.set(outer, []);

  for (const hole of holes) {
    const testPt = hole.loop[0];
    for (const outer of outers) {
      if (pointInPoly(testPt.x, testPt.y, outer.loop)) {
        holesByOuter.get(outer).push(hole.loop);
        break;
      }
    }
  }

  const allCoords = [];
  const allIndices = [];
  let vertexOffset = 0;

  for (const outer of outers) {
    const coords = [];
    for (const p of outer.loop) coords.push(p.x, p.y);
    const holeIndices = [];
    for (const holeLoop of holesByOuter.get(outer)) {
      holeIndices.push(coords.length / 2);
      for (const p of holeLoop) coords.push(p.x, p.y);
    }
    const indices = earcut(coords, holeIndices.length > 0 ? holeIndices : null, 2);
    for (const idx of indices) allIndices.push(idx + vertexOffset);
    const totalPts = coords.length / 2;
    for (let i = 0; i < totalPts; i++) {
      allCoords.push(coords[i * 2], 0.02, coords[i * 2 + 1]);
    }
    vertexOffset += totalPts;
  }

  if (allIndices.length < 3) return;

  const pos = new Float32Array(allCoords);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setIndex(allIndices);
  geom.computeVertexNormals();

  const color = FACTION_COLORS[factionId - 1] || 0x999999;
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color, transparent: false, opacity: 1.0, side: THREE.DoubleSide, depthWrite: false
  }));
  this.scene.add(mesh);
  this.factionMeshes.set(factionId, mesh);
}
```

Remove `_rebuildAreaMesh()` from the Character class. Remove `areaMesh`, `contourLoops`, `territoryDirty` from the Character constructor.

Add a `factionsDirty` set to Game and rebuild meshes in tick:
```javascript
// In Game constructor:
this.factionsDirty = new Set();

// In Game.tick(), after character updates:
for (const fid of this.factionsDirty) {
  this._rebuildFactionMesh(fid);
}
this.factionsDirty.clear();
```

When a claim happens, mark the claiming faction and all overwritten factions as dirty. In `_claim()`, instead of `this._rebuildAreaMesh()`:
```javascript
if (window._game) {
  window._game.factionsDirty.add(this.factionId);
  for (const victimFactionId of overwritten) {
    window._game.factionsDirty.add(victimFactionId);
  }
}
```

- [ ] **Step 6: Update `die()` — territory stays, no clearOwner**

In `Character.die()`, remove the call to `territoryGrid.clearOwner(this.ownerId)`. Territory belongs to the faction and persists after death.

Remove the areaMesh cleanup from `die()` (meshes are now per-faction in Game).

```javascript
die() {
  this.alive = false;
  this.respawnTimer = RESPAWN_DELAY;
  this.wasOutside = false;
  this._clearTrail();
  this.group.visible = false;
}
```

- [ ] **Step 7: Update `respawn()` — no initTerritory, spawn inside faction territory**

```javascript
respawn(x, z) {
  this.pos.set(x, 0, z);
  this.dir.set(Math.random()-0.5, 0, Math.random()-0.5).normalize();
  this.targetDir.copy(this.dir);
  this.alive = true;
  this.invulnTimer = INVULN_TIME;
  this.wasOutside = false;
  this.group.visible = true;
  this.botWaypoints = [];
  this.botPhase = "idle";
}
```

Remove `_initTerritory()` call. Remove `_initTerritory()` method from Character.

- [ ] **Step 8: Update `Character.update()` — boundary does NOT kill**

The boundary wall should push the player back but not kill. The current code already does this (normalizes position to arena edge). Make sure there is no death-on-boundary. The current code just clamps position — this is correct, no change needed. Confirm no kill logic on boundary exists.

- [ ] **Step 9: Update `getAreaPct()` to use factionId**

```javascript
getAreaPct() {
  return (territoryGrid.countCells(this.factionId) / territoryGrid.totalArenaCells) * 100;
}
```

- [ ] **Step 10: Update `Game.start()` — faction-based initialization**

Replace the entire `start()` method:

```javascript
start(name) {
  this.playerName = name;
  this.started = true;

  // Initialize grid (marks out-of-bounds cells)
  territoryGrid.init();

  // Create managers
  this.factionManager = new FactionManager();
  this.scoreTracker = new ScoreTracker();

  // Pie-slice territory division
  this.factionManager.init(
    territoryGrid.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL
  );

  // Expose for Character._claim() to access
  window._factionManager = this.factionManager;
  window._scoreTracker = this.scoreTracker;
  window._game = this;

  // Pick random faction for player
  const playerFactionId = Math.floor(Math.random() * FACTION_COUNT) + 1;

  // Create player
  const playerSpawn = this.factionManager.getSpawnPoint(
    playerFactionId, territoryGrid.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
  );
  this.player = new Character(this.scene, playerSpawn.x, playerSpawn.z, FACTION_COLORS[playerFactionId - 1], name, true);
  this.factionManager.addCharacter(this.player, playerFactionId);
  this.scoreTracker.register(this.player);
  this.characters.push(this.player);

  // Create bots — distribute evenly across factions
  let botIdx = 0;
  for (let fid = 1; fid <= FACTION_COUNT; fid++) {
    const botsNeeded = (fid === playerFactionId) ? CHARS_PER_FACTION - 1 : CHARS_PER_FACTION;
    for (let b = 0; b < botsNeeded; b++) {
      const sp = this.factionManager.getSpawnPoint(
        fid, territoryGrid.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      // Offset spawn slightly so bots don't stack
      const offset = (b + 1) * 2;
      const angle = Math.random() * Math.PI * 2;
      const bx = sp.x + Math.cos(angle) * offset;
      const bz = sp.z + Math.sin(angle) * offset;

      const bot = new Character(this.scene, bx, bz, FACTION_COLORS[fid - 1], BOT_NAMES[botIdx % BOT_NAMES.length], false);
      this.factionManager.addCharacter(bot, fid);
      this.scoreTracker.register(bot);
      this.characters.push(bot);
      botIdx++;
    }
  }

  // Give each character a reference to all characters
  for (const c of this.characters) {
    c.allCharacters = this.characters;
  }

  // Match manager
  this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
  this.matchManager.startMatch();

  // UI manager
  this.uiManager = new UIManager(
    this.factionManager, this.matchManager, this.scoreTracker,
    territoryGrid.grid, GRID_SIZE, GRID_SENTINEL
  );
  this.uiManager.setPlayer(this.player);

  // Initial territory mesh build for all factions
  for (let fid = 1; fid <= FACTION_COUNT; fid++) {
    this._rebuildFactionMesh(fid);
  }

  // Camera
  this.camera.position.set(playerSpawn.x, CAMERA_HEIGHT, playerSpawn.z + CAMERA_Z_OFFSET);
  this.camera.lookAt(playerSpawn.x, 0, playerSpawn.z);
  this.camCurrent.set(playerSpawn.x, 0, playerSpawn.z);
  this.camTarget.copy(this.camCurrent);
}
```

- [ ] **Step 11: Update `Game.tick()` — match updates, faction-aware respawn, UI**

In `tick()`:

After character updates and before trail collisions, add match manager update:
```javascript
// Match lifecycle
if (this.matchManager) {
  this.matchManager.update(dt, territoryGrid.grid, GRID_SIZE, GRID_SENTINEL);
  if (this.matchManager.phase === "ended") {
    // Freeze gameplay — skip trail collisions and bot AI
    this._updateLabels();
    this.uiManager.update(dt);
    return;
  }
}
```

Update the respawn block to use faction-aware spawning:
```javascript
if (!c.alive && c.respawnTimer <= 0) {
  const faction = this.factionManager.factions.get(c.factionId);
  if (faction && faction.respawnsEnabled) {
    // Respawn in own faction territory
    const sp = this.factionManager.getSpawnPoint(
      c.factionId, territoryGrid.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
    );
    c.respawn(sp.x, sp.z);
    dlog("RESPAWN", `${c.name} respawned in ${faction.name}`, { x: sp.x.toFixed(1), z: sp.z.toFixed(1) });
    if (c === this.player) this.deathScreen.classList.remove("visible");
  } else {
    // Faction endangered — reassign
    const newFaction = this.factionManager.reassignCharacter(c);
    if (newFaction) {
      // Update character color
      c.color = newFaction.color;
      c.group.children.forEach(child => {
        if (child.material && child.material.color) child.material.color.setHex(newFaction.color);
      });
      this.scoreTracker.onFactionChange(c);
      const sp = this.factionManager.getSpawnPoint(
        c.factionId, territoryGrid.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, GRID_SENTINEL
      );
      c.respawn(sp.x, sp.z);
      dlog("REASSIGN", `${c.name} reassigned to ${newFaction.name}`, { factionId: newFaction.id });
      if (c === this.player) {
        this.deathScreen.classList.remove("visible");
        this.uiManager.setPlayer(this.player); // refresh faction reference
      }
    }
    // Check if old faction is eliminated
    for (const [id] of this.factionManager.factions) {
      if (this.factionManager.checkElimination(id)) {
        dlog("ELIMINATED", `Faction ${id} eliminated`);
      }
    }
  }
}
```

Replace the `this._updateHUD()` call with:
```javascript
if (this.uiManager) this.uiManager.update(dt);
```

Remove the old `_updateHUD()` method from the Game class.

Add faction mesh rebuild after character updates:
```javascript
for (const fid of this.factionsDirty) {
  this._rebuildFactionMesh(fid);
}
this.factionsDirty.clear();
```

Remove the shape diagnostics timer block.

- [ ] **Step 12: Update trail collision — skip teammates**

In the trail collision loop, add faction check for enemy trails:

```javascript
// Trail collisions
for (const c of this.characters) {
  if (!c.alive || c.invulnTimer > 0) continue;
  for (const other of this.characters) {
    if (!other.alive) continue;
    if (other === c) {
      // Self-trail collision (skip recent points)
      for (let i = 0; i < other.trailVerts.length - SELF_TRAIL_SKIP; i++) {
        if (dist2D(c.pos, other.trailVerts[i]) < TRAIL_KILL_DIST) {
          this._killCharacter(c);
          break;
        }
      }
    } else if (other.factionId !== c.factionId) {
      // Enemy trail collision — c walks into other's trail, other dies? No:
      // c is walking, other has the trail. If c touches other's trail, OTHER is the trail owner.
      // Paper.io rule: if you touch someone's trail, THEY die? No — the trail owner dies if
      // someone crosses their trail. Wait, re-read:
      // "If an enemy touches a player's exposed trail before the player closes the loop, that player dies."
      // So: c touches other's trail → other dies (the trail owner).
      // Current code: c walks near other.trailVerts → kills OTHER. This is correct.
      for (const tv of other.trailVerts) {
        if (dist2D(c.pos, tv) < TRAIL_KILL_DIST) {
          this._killCharacter(other, c);
          break;
        }
      }
    }
    // Skip teammate trails entirely (same factionId)
    if (!c.alive) break;
  }
}
```

- [ ] **Step 13: Update `_killCharacter` — report kills to scorer**

```javascript
_killCharacter(victim, killer) {
  dlog("KILL", `${victim.name} killed${killer ? " by " + killer.name : ""}`, {
    victimPos: `${victim.pos.x.toFixed(1)},${victim.pos.z.toFixed(1)}`,
    trailLen: victim.trailVerts.length,
    isPlayer: victim.isPlayer
  });
  victim.die();
  if (killer) {
    killer.killCount++;
    if (this.scoreTracker) this.scoreTracker.onKill(killer, this.factionManager);
  }
  if (victim === this.player) {
    this.killedBy = killer ? killer.name : "";
    this.deathMsg.textContent = killer ? `Killed by ${killer.name}` : "You died!";
    this.deathScreen.classList.add("visible");
  }
}
```

- [ ] **Step 14: Update `_planBotLoop` — faction-aware targeting**

Replace `bot.ownerId` with `bot.factionId` throughout `_planBotLoop`:

```javascript
const cellCount = territoryGrid.countCells(bot.factionId);
```

```javascript
const contours = territoryGrid.extractContours(bot.factionId);
```

For aggro targeting, only target characters from OTHER factions:
```javascript
const others = this.characters.filter(o => o !== bot && o.alive && o.factionId !== bot.factionId && territoryGrid.countCells(o.factionId) > 0);
```

- [ ] **Step 15: Remove unused code**

Remove from `main.js`:
- `START_RADIUS` constant
- `TOTAL_AREA` constant
- `COLORS` array
- `randomSpawn()` function (replaced by `FactionManager.getSpawnPoint()`)
- `_updateHUD()` method (replaced by `UIManager`)
- `triangulate()` function (unused)
- `to2D()` function (unused)
- Shape diagnostics globals and function (`SHAPE_DIAG`, `shapeDiagTimer`, `shapeDiagFrameCount`, `sampleShapeDiagnostics`, etc.)

- [ ] Commit

```bash
git add prototype/main.js
git commit -m "feat: rewrite main.js for faction-based territory war mode"
```

---

### Task 7: Integration test — play and verify

Steps:

- [ ] Start HTTP server and open the game in a browser:
```bash
cd /home/civax/projects/captureArena/prototype && python3 -m http.server 8080
```

- [ ] Verify at `http://localhost:8080`:
  1. Name entry screen shows "Territory War"
  2. After clicking Play, map shows 5 colored pie slices
  3. Player spawns inside their faction's territory
  4. 19 bots spawn across all factions (4 per faction, 3 in player's faction)
  5. Moving outside territory creates a trail
  6. Closing a loop captures territory for your faction color
  7. Walking through teammate's trail does nothing
  8. Walking into enemy trail kills the trail owner
  9. Timer counts down from 15:00 in top-left
  10. Team territory ranking shows in top-right with percentages
  11. Minimap in bottom-left shows colored territory
  12. Personal stats show at bottom-center
  13. Tab key shows leaderboard overlay
  14. Death respawns in faction territory (territory persists)
  15. Territory shapes render correctly (no invisible territory)

- [ ] Fix any issues found during testing

- [ ] Final commit with any fixes

```bash
git add -A
git commit -m "fix: integration fixes for territory war mode"
```

---

## Key constraints

- All work is in `prototype/` directory — no build step, CDN imports via importmap
- New modules (`faction.js`, `scoring.js`, `match.js`, `ui.js`) are plain ES modules loaded via relative imports
- Grid values change from per-character IDs to faction IDs (1-5)
- Boundary does NOT kill players — it's a solid wall that slides along
- Spawn points are in the middle of faction territory, never at edges
- Territory meshes are per-faction, not per-character
- 5 factions, 4 characters per faction, 20 total (1 player + 19 bots)
- Shape diagnostic system can be removed — it was a debug tool for the old system
