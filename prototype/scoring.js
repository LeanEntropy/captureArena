// ===================== SCORE TRACKER =====================
// Tracks personal scores for each character in a Paper.io 2 team territory war.
// Characters have .factionId. FactionManager.factions is a Map where each
// faction has an .endangered boolean.

const SCORE_PER_CELL = 1;
const SCORE_PER_KILL = 500;
const SCORE_PER_CLAIM = 50;
const LAST_STAND_MULTIPLIER = 1.25;
const TEAM_BONUS = [0.20, 0.10, 0.05, 0, 0];

export class ScoreTracker {
  constructor() {
    /** @type {Map<object, {total: number, captures: number, kills: number, claims: number, factionHistory: number[]}>} */
    this.scores = new Map();
  }

  /**
   * Initialize a score entry for a character.
   * @param {object} char - Character with .factionId
   */
  register(char) {
    this.scores.set(char, {
      total: 0,
      captures: 0,
      kills: 0,
      claims: 0,
      factionHistory: [char.factionId],
    });
  }

  /**
   * Returns 1.25 if char's faction is endangered, else 1.0.
   * @param {object} char
   * @param {object} factionManager - Has .factions Map<factionId, {endangered: boolean}>
   * @returns {number}
   */
  _getMultiplier(char, factionManager) {
    const faction = factionManager.factions.get(char.factionId);
    return faction && faction.endangered ? LAST_STAND_MULTIPLIER : 1.0;
  }

  /**
   * Award points for a territory capture.
   * @param {object} char
   * @param {number} cellsFlipped - Number of cells flipped to char's faction
   * @param {object} factionManager
   */
  onCapture(char, cellsFlipped, factionManager) {
    const entry = this.scores.get(char);
    if (!entry) return;
    const multiplier = this._getMultiplier(char, factionManager);
    entry.total += cellsFlipped * SCORE_PER_CELL * multiplier;
    entry.captures += 1;
  }

  /**
   * Award points for killing an enemy character.
   * @param {object} char - The killer
   * @param {object} factionManager
   */
  onKill(char, factionManager) {
    const entry = this.scores.get(char);
    if (!entry) return;
    const multiplier = this._getMultiplier(char, factionManager);
    entry.total += SCORE_PER_KILL * multiplier;
    entry.kills += 1;
  }

  /**
   * Award points for claiming a cell.
   * @param {object} char
   * @param {object} factionManager
   */
  onClaim(char, factionManager) {
    const entry = this.scores.get(char);
    if (!entry) return;
    const multiplier = this._getMultiplier(char, factionManager);
    entry.total += SCORE_PER_CLAIM * multiplier;
    entry.claims += 1;
  }

  /**
   * Record a faction change in the character's history.
   * @param {object} char - Character after faction has been updated
   */
  onFactionChange(char) {
    const entry = this.scores.get(char);
    if (!entry) return;
    entry.factionHistory.push(char.factionId);
  }

  /**
   * Apply end-of-game team placement bonuses.
   * @param {number[]} standings - Faction IDs sorted by placement (1st place first)
   */
  applyTeamBonus(standings) {
    for (const [char, entry] of this.scores) {
      const factionPlacement = standings.indexOf(char.factionId);
      if (factionPlacement === -1) continue;
      const bonus = TEAM_BONUS[factionPlacement] ?? 0;
      entry.total *= 1 + bonus;
    }
  }

  /**
   * Return leaderboard sorted by total score descending.
   * @returns {{char: object, total: number, captures: number, kills: number, claims: number}[]}
   */
  getLeaderboard() {
    return Array.from(this.scores.entries())
      .map(([char, entry]) => ({
        char,
        total: entry.total,
        captures: entry.captures,
        kills: entry.kills,
        claims: entry.claims,
      }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * Return the score entry for a character, or zeroed defaults if not registered.
   * @param {object} char
   * @returns {{total: number, captures: number, kills: number, claims: number}}
   */
  getScore(char) {
    const entry = this.scores.get(char);
    if (!entry) return { total: 0, captures: 0, kills: 0, claims: 0 };
    return entry;
  }

  /**
   * Return the 1-based rank of a character among all members of their faction.
   * @param {object} char
   * @returns {number}
   */
  getPlayerRankInFaction(char) {
    const factionScores = Array.from(this.scores.entries())
      .filter(([c]) => c.factionId === char.factionId)
      .map(([c, entry]) => ({ char: c, total: entry.total }))
      .sort((a, b) => b.total - a.total);

    const index = factionScores.findIndex((s) => s.char === char);
    return index === -1 ? -1 : index + 1;
  }
}
