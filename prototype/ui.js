import { FACTION_COLORS, FACTION_COUNT } from "./faction.js";

// ===================== UI MANAGER =====================
// Manages HUD elements: timer, faction ranking, player stats, minimap,
// leaderboard overlay (Tab key), and end screen.

export class UIManager {
  /**
   * @param {object} factionManager
   * @param {object} matchManager
   * @param {object} scoreTracker
   * @param {Uint8Array} grid
   * @param {number} gridSize
   * @param {number} sentinel
   */
  constructor(factionManager, matchManager, scoreTracker, grid, gridSize, sentinel) {
    this.factionManager = factionManager;
    this.matchManager = matchManager;
    this.scoreTracker = scoreTracker;
    this.grid = grid;
    this.gridSize = gridSize;
    this.sentinel = sentinel;

    // DOM elements
    this.timerEl = document.getElementById("hud-tl");
    this.rankingEl = document.getElementById("hud-tr");
    this.statsEl = document.getElementById("hud-bottom");
    this.minimapCanvas = document.getElementById("minimap");
    this.minimapCtx = this.minimapCanvas
      ? this.minimapCanvas.getContext("2d")
      : null;
    this.leaderboardEl = document.getElementById("leaderboard-overlay");
    this.endScreenEl = document.getElementById("match-end-screen");

    // Minimap setup
    this.minimapSize = 180; // display CSS size
    this.minimapScale = Math.ceil(gridSize / 180); // sample every Nth cell
    this.minimapPixelSize = Math.ceil(gridSize / this.minimapScale); // canvas pixel dimensions
    if (this.minimapCanvas) {
      this.minimapCanvas.width = this.minimapPixelSize;
      this.minimapCanvas.height = this.minimapPixelSize;
    }
    this.minimapTimer = 0;
    this.minimapInterval = 0.5;

    // Pre-compute faction RGB arrays from FACTION_COLORS
    this.factionRGB = [null]; // index 0 unused
    for (let i = 0; i < FACTION_COUNT; i++) {
      const c = FACTION_COLORS[i];
      this.factionRGB.push([(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]);
    }

    // Tab leaderboard toggle
    this.showLeaderboard = false;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        this.showLeaderboard = true;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        this.showLeaderboard = false;
      }
    });

    // Player reference
    this.player = null;

    // End-screen shown-once guard
    this._endShown = false;
  }

  /** Store a reference to the player character. */
  setPlayer(player) {
    this.player = player;
  }

  /**
   * Call once per frame.
   * @param {number} dt - delta time in seconds
   */
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

  // ── Timer ────────────────────────────────────────────────────────────────

  _updateTimer() {
    if (!this.timerEl) return;

    const timeStr = this.matchManager.getTimeString();
    const flash =
      this.matchManager.timeRemaining <= 60 &&
      Math.sin(performance.now() * 0.006) > 0;

    this.timerEl.innerHTML =
      `<div style="font-size:28px;font-weight:bold;color:${flash ? "#e53935" : "#fff"};` +
      `text-shadow:0 2px 6px rgba(0,0,0,0.5);letter-spacing:2px;">${timeStr}</div>`;
  }

  // ── Faction ranking ───────────────────────────────────────────────────────

  _updateRanking() {
    if (!this.rankingEl) return;

    const factions = this.factionManager.getAllFactions()
      .slice()
      .sort((a, b) => b.territoryPct - a.territoryPct);

    let html = "<div style='font-weight:bold;font-size:13px;margin-bottom:6px;'>Factions</div>";
    for (const f of factions) {
      const hex = "#" + f.color.toString(16).padStart(6, "0");
      const isPlayer = this.player && this.player.factionId === f.id;
      const pct = f.territoryPct.toFixed(1);

      let tags = "";
      if (f.endangered && f.alive) {
        tags += `<span style="color:#FF9800;font-size:10px;font-weight:bold;margin-left:4px;">[ENDANGERED]</span>`;
      }
      if (!f.alive) {
        tags += `<span style="color:#9E9E9E;font-size:10px;margin-left:4px;">[ELIMINATED]</span>`;
      }

      const rowStyle = [
        "display:flex",
        "align-items:center",
        "gap:6px",
        "margin:3px 0",
        "font-size:13px",
        f.alive ? "" : "opacity:0.5;text-decoration:line-through;color:#9E9E9E",
        isPlayer ? "font-weight:bold;" : "",
      ].filter(Boolean).join(";");

      html +=
        `<div style="${rowStyle}">` +
        `<span style="display:inline-block;width:12px;height:12px;background:${hex};border-radius:2px;flex-shrink:0;"></span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>` +
        `<span>${pct}%</span>` +
        tags +
        `</div>`;
    }

    this.rankingEl.innerHTML = html;
  }

  // ── Player stats ──────────────────────────────────────────────────────────

  _updateStats() {
    if (!this.statsEl || !this.player) return;

    const { total, kills } = this.scoreTracker.getScore(this.player);
    const rank = this.scoreTracker.getPlayerRankInFaction(this.player);
    const faction = this.factionManager.getAllFactions().find(
      (f) => f.id === this.player.factionId
    );
    const factionName = faction ? faction.name : "Unknown";

    this.statsEl.innerHTML =
      `<span>Score: ${Math.floor(total)}</span>` +
      ` &nbsp;|&nbsp; ` +
      `<span>Kills: ${kills}</span>` +
      ` &nbsp;|&nbsp; ` +
      `<span>#${rank} in ${factionName}</span>`;
  }

  // ── Minimap ───────────────────────────────────────────────────────────────

  _updateMinimap() {
    if (!this.minimapCtx || !this.minimapCanvas) return;

    const pixelSize = this.minimapPixelSize;
    const scale = this.minimapScale;
    const imageData = this.minimapCtx.createImageData(pixelSize, pixelSize);
    const data = imageData.data;

    for (let py = 0; py < pixelSize; py++) {
      for (let px = 0; px < pixelSize; px++) {
        const gx = px * scale;
        const gy = py * scale;
        const idx = gy * this.gridSize + gx;
        const cell = this.grid[idx];

        const dataIdx = (py * pixelSize + px) * 4;

        if (cell === this.sentinel) {
          // Out-of-arena
          data[dataIdx] = 20;
          data[dataIdx + 1] = 20;
          data[dataIdx + 2] = 20;
          data[dataIdx + 3] = 255;
        } else if (cell === 0) {
          // Unclaimed arena cell
          data[dataIdx] = 60;
          data[dataIdx + 1] = 60;
          data[dataIdx + 2] = 60;
          data[dataIdx + 3] = 255;
        } else {
          // Faction-owned cell
          const rgb = this.factionRGB[cell];
          if (rgb) {
            data[dataIdx] = rgb[0];
            data[dataIdx + 1] = rgb[1];
            data[dataIdx + 2] = rgb[2];
            data[dataIdx + 3] = 255;
          } else {
            data[dataIdx] = 128;
            data[dataIdx + 1] = 128;
            data[dataIdx + 2] = 128;
            data[dataIdx + 3] = 255;
          }
        }
      }
    }

    this.minimapCtx.putImageData(imageData, 0, 0);

    // Draw player position as white dot
    if (this.player && this.player.alive) {
      const worldMin = -24.5;
      const worldSize = 49;

      const dotX =
        ((this.player.pos.x - worldMin) / worldSize) * pixelSize;
      const dotY =
        ((this.player.pos.z - worldMin) / worldSize) * pixelSize;

      this.minimapCtx.beginPath();
      this.minimapCtx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      this.minimapCtx.fillStyle = "#ffffff";
      this.minimapCtx.fill();
      this.minimapCtx.strokeStyle = "#000";
      this.minimapCtx.lineWidth = 1;
      this.minimapCtx.stroke();
    }
  }

  // ── Leaderboard overlay (Tab) ─────────────────────────────────────────────

  _updateLeaderboardOverlay() {
    if (!this.leaderboardEl) return;

    if (!this.showLeaderboard) {
      this.leaderboardEl.style.display = "none";
      return;
    }

    this.leaderboardEl.style.display = "flex";

    const entries = this.scoreTracker.getLeaderboard().slice(0, 10);
    let html = "<div style='font-weight:bold;font-size:15px;margin-bottom:10px;'>Top Players</div>";

    entries.forEach((entry, i) => {
      const { char, total } = entry;
      const faction = this.factionManager.getAllFactions().find(
        (f) => f.id === char.factionId
      );
      const hex = faction ? "#" + faction.color.toString(16).padStart(6, "0") : "#888";
      const isPlayer = char === this.player;

      html +=
        `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:14px;${isPlayer ? "font-weight:bold;" : ""}">` +
        `<span style="width:20px;text-align:right;color:#aaa;">${i + 1}.</span>` +
        `<span style="display:inline-block;width:12px;height:12px;background:${hex};border-radius:2px;flex-shrink:0;"></span>` +
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${char.name || "?"}</span>` +
        `<span style="color:#FFD700;font-weight:bold;">${Math.floor(total)}</span>` +
        `</div>`;
    });

    const lbContent = this.leaderboardEl.querySelector(".lb-content");
    if (lbContent) {
      lbContent.innerHTML = html;
    } else {
      this.leaderboardEl.innerHTML = html;
    }
  }

  // ── End screen ────────────────────────────────────────────────────────────

  _showEndScreen() {
    if (this._endShown || !this.endScreenEl) return;
    this._endShown = true;

    this.endScreenEl.style.display = "flex";

    const winner = this.matchManager.winner;
    const winnerHex = winner
      ? "#" + winner.color.toString(16).padStart(6, "0")
      : "#fff";
    const winnerName = winner ? winner.name : "No one";

    // Final standings by territory
    const factions = this.factionManager.getAllFactions()
      .slice()
      .sort((a, b) => b.territoryPct - a.territoryPct);

    let standingsHtml = "";
    factions.forEach((f, i) => {
      const hex = "#" + f.color.toString(16).padStart(6, "0");
      standingsHtml +=
        `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:14px;">` +
        `<span style="width:24px;color:#aaa;">${i + 1}.</span>` +
        `<span style="display:inline-block;width:12px;height:12px;background:${hex};border-radius:2px;flex-shrink:0;"></span>` +
        `<span style="flex:1;">${f.name}</span>` +
        `<span>${f.territoryPct.toFixed(1)}%</span>` +
        `</div>`;
    });

    // Player personal stats
    let playerHtml = "";
    if (this.player) {
      const { total, kills } = this.scoreTracker.getScore(this.player);
      const rank = this.scoreTracker.getPlayerRankInFaction(this.player);
      const faction = factions.find((f) => f.id === this.player.factionId);
      const factionName = faction ? faction.name : "Unknown";
      playerHtml =
        `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.2);font-size:14px;color:#eee;">` +
        `<div>Your Score: <strong>${Math.floor(total)}</strong></div>` +
        `<div>Kills: <strong>${kills}</strong></div>` +
        `<div>Rank in ${factionName}: <strong>#${rank}</strong></div>` +
        `</div>`;
    }

    const content =
      `<div style="font-size:36px;font-weight:bold;color:${winnerHex};margin-bottom:8px;">${winnerName} Wins!</div>` +
      `<div style="font-size:14px;color:#ccc;margin-bottom:16px;">Final Standings</div>` +
      standingsHtml +
      playerHtml;

    const endContent = this.endScreenEl.querySelector(".end-content");
    if (endContent) {
      endContent.innerHTML = content;
    } else {
      this.endScreenEl.innerHTML = content;
    }
  }
}
