const MATCH_DURATION = 900; // 15 minutes in seconds

export class MatchManager {
  constructor(factionManager, scoreTracker) {
    this.factionManager = factionManager;
    this.scoreTracker = scoreTracker;
    this.phase = "setup";
    this.timeRemaining = MATCH_DURATION;
    this.factionCheckTimer = 0;
    this.winner = null;
  }

  startMatch() {
    this.phase = "playing";
    this.timeRemaining = MATCH_DURATION;
  }

  update(dt, grid, gridSize, sentinel, cellCounts, totalArenaCells) {
    if (this.phase !== "playing") return;

    this.timeRemaining -= dt;

    this.factionCheckTimer += dt;
    if (this.factionCheckTimer >= 1.0) {
      this.factionCheckTimer -= 1.0;

      // Prefer O(FACTION_COUNT) incremental counts when the caller maintains
      // them; fall back to the legacy O(N²) grid scan otherwise.
      if (cellCounts && typeof totalArenaCells === "number") {
        this.factionManager.updateTerritoryPctsFromCounts(cellCounts, totalArenaCells);
      } else {
        this.factionManager.updateTerritoryPcts(grid, gridSize, sentinel);
      }

      for (const [id] of this.factionManager.factions) {
        this.factionManager.checkEndangered(id);
        this.factionManager.checkRecovery(id);
        this.factionManager.checkElimination(id);
      }
    }

    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endMatch();
      return;
    }

    if (this.factionManager.isMatchOver()) {
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
    const total = Math.max(0, Math.ceil(this.timeRemaining));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }
}
