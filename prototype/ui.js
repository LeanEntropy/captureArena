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
    this.leaderboardEl = document.getElementById("player-leaderboard");
    this.endScreenEl = document.getElementById("match-end-screen");

    // Minimap setup
    this.minimapSize = 180;
    this.minimapScale = Math.ceil(gridSize / 180);
    this.minimapPixelSize = Math.ceil(gridSize / this.minimapScale);
    if (this.minimapCanvas) {
      this.minimapCanvas.width = this.minimapPixelSize;
      this.minimapCanvas.height = this.minimapPixelSize;
    }
    this.minimapTimer = 0;
    this.minimapInterval = 0.5;

    this.factionRGB = [null];
    for (let i = 0; i < FACTION_COUNT; i++) {
      const c = FACTION_COLORS[i];
      this.factionRGB.push([(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]);
    }

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
          data[dataIdx] = 0;
          data[dataIdx + 1] = 0;
          data[dataIdx + 2] = 0;
          data[dataIdx + 3] = 0;
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

    const allEntries = this.scoreTracker.getLeaderboard();

    let playerRank = -1;
    for (let i = 0; i < allEntries.length; i++) {
      if (allEntries[i].char === this.player) {
        playerRank = i;
        break;
      }
    }

    // Position below faction rankings
    if (this.rankingEl) {
      const rect = this.rankingEl.getBoundingClientRect();
      this.leaderboardEl.style.top = (rect.bottom + 8) + "px";
    }

    // Build scrollable list of ALL players
    let listHtml = "";
    allEntries.forEach((entry, i) => {
      listHtml += this._renderLeaderboardRow(entry, i, entry.char === this.player);
    });

    // Build pinned player footer
    let pinnedHtml = "";
    if (playerRank >= 0) {
      const playerEntry = allEntries[playerRank];
      pinnedHtml = this._renderLeaderboardRow(playerEntry, playerRank, true, true);
    }

    this.leaderboardEl.innerHTML =
      `<div class="lb-title">Leaderboard</div>` +
      `<div class="lb-list">${listHtml}</div>` +
      `<div class="lb-pinned" id="lb-pinned-player">${pinnedHtml}</div>`;

    // Check visibility: hide pinned row if player is in top 10 or visible in scroll
    this._updatePinnedVisibility(playerRank);
  }

  _updatePinnedVisibility(playerRank) {
    const pinnedEl = document.getElementById("lb-pinned-player");
    if (!pinnedEl) return;

    // Always hide if player is in top 10
    if (playerRank >= 0 && playerRank < 10) {
      pinnedEl.style.display = "none";
      return;
    }

    // Check if the player's row is visible in the scroll container
    const listEl = this.leaderboardEl.querySelector(".lb-list");
    if (!listEl) return;

    const playerRowEl = listEl.querySelector("[data-player-row]");
    if (!playerRowEl) {
      pinnedEl.style.display = playerRank >= 0 ? "" : "none";
      return;
    }

    const listRect = listEl.getBoundingClientRect();
    const rowRect = playerRowEl.getBoundingClientRect();
    const isVisible = rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;

    pinnedEl.style.display = isVisible ? "none" : "";
  }

  _renderLeaderboardRow(entry, rank, isPlayer, pinned) {
    const { char, total } = entry;
    const faction = this.factionManager.getAllFactions().find(
      (f) => f.id === char.factionId
    );
    const hex = faction ? "#" + faction.color.toString(16).padStart(6, "0") : "#888";

    const attrs = isPlayer && !pinned ? ' data-player-row="1"' : "";
    const style = [
      "display:flex", "align-items:center", "gap:6px",
      "margin:2px 0", "padding:2px 4px", "border-radius:4px", "font-size:12px",
      isPlayer ? "font-weight:bold;background:rgba(0,0,0,0.08);" : "",
      pinned ? "border:2px solid #333;padding:3px 4px;" : ""
    ].filter(Boolean).join(";");

    return (
      `<div style="${style}"${attrs}>` +
      `<span style="width:18px;text-align:right;color:#999;flex-shrink:0;">${rank + 1}.</span>` +
      `<span style="display:inline-block;width:10px;height:10px;background:${hex};border-radius:2px;flex-shrink:0;"></span>` +
      `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${char.name || "?"}</span>` +
      `<span style="color:#555;font-weight:bold;flex-shrink:0;">${Math.floor(total)}</span>` +
      `</div>`
    );
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
