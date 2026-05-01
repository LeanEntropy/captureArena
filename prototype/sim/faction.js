// ===================== FACTION MANAGER =====================
// Manages 5 factions in a Paper.io 2 team-mode clone.
// Grid: Uint8Array of size gridSize*gridSize, values 0=unclaimed, 1-5=faction, 255=sentinel.
// World coords: wx = worldMin + (gx + 0.5) * cellSize

export const FACTION_COUNT = 5;
export const CHARS_PER_FACTION = 6;
export const ENDANGERED_THRESHOLD = 10;   // territory % below which endangered triggers
export const RECOVERY_THRESHOLD = 12;     // territory % at or above which recovery triggers

// Direction E (Castaway Atoll) palette — desaturated cooler Blue (locked
// per Director 2026-04-30) keeps the faction distinct from the deep-teal sea;
// boosted Yellow reads against teal water reflections at distance.
// Round 3 retune: see docs/visual-direction-plan.md §16 + §18.
export const FACTION_COLORS = [0xE74A3F, 0x3D6CD0, 0x52B856, 0xFFCF2A, 0xA94BBE];
export const FACTION_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple"];

export class FactionManager {
  constructor() {
    /** @type {Map<number, object>} factionId (1-based) -> faction object */
    this._factions = new Map();
  }

  get factions() { return this._factions; }

  /**
   * Initialize factions and perform pie-slice territory division.
   * @param {Uint8Array} grid
   * @param {number} gridSize
   * @param {number} worldMin  e.g. -24.5
   * @param {number} cellSize  e.g. 49/1024
   * @param {number} arenaRadius
   * @param {number} sentinel  e.g. 255
   */
  init(grid, gridSize, worldMin, cellSize, arenaRadius, sentinel) {
    this._factions.clear();

    const sliceAngle = (2 * Math.PI) / FACTION_COUNT;
    const spawnRadius = arenaRadius * 0.6;

    // Build faction objects with spawn points at 60% radius along each slice midpoint
    for (let i = 0; i < FACTION_COUNT; i++) {
      const id = i + 1; // 1-based
      const midAngle = i * sliceAngle + sliceAngle / 2 - Math.PI; // center of slice, offset so slice 0 starts at -π
      // atan2 returns values in [-π, π]; we normalize to [0, 2π] when mapping
      // Spawn point uses world X/Z (Three.js: Y is up, XZ is ground plane)
      const spawnX = Math.cos(midAngle) * spawnRadius;
      const spawnZ = Math.sin(midAngle) * spawnRadius;

      this._factions.set(id, {
        id,
        name: FACTION_NAMES[i],
        color: FACTION_COLORS[i],
        spawnPoint: { x: spawnX, z: spawnZ },
        alive: true,
        respawnsEnabled: true,
        endangered: false,
        characters: new Set(),
        territoryPct: 0,
      });
    }

    // Pie-slice grid assignment
    // Divide the angle space [0, 2π) into FACTION_COUNT equal sectors.
    // atan2(wy, wx) gives [-π, π]; normalize to [0, 2π).
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const idx = gy * gridSize + gx;
        if (grid[idx] === sentinel) continue;

        const wx = worldMin + (gx + 0.5) * cellSize;
        const wy = worldMin + (gy + 0.5) * cellSize;

        let angle = Math.atan2(wy, wx); // [-π, π]
        if (angle < 0) angle += 2 * Math.PI; // normalize to [0, 2π)

        const sectorIndex = Math.floor(angle / sliceAngle); // 0-based
        const factionId = (sectorIndex % FACTION_COUNT) + 1; // 1-based
        grid[idx] = factionId;
      }
    }
  }

  /**
   * Register a character with a faction.
   * @param {object} char  must have .factionId property
   * @param {number} factionId
   */
  addCharacter(char, factionId) {
    char.factionId = factionId;
    const faction = this._factions.get(factionId);
    if (faction) {
      faction.characters.add(char);
    }
  }

  /**
   * Remove a character from its faction's active set.
   * @param {object} char
   */
  removeCharacter(char) {
    const faction = this._factions.get(char.factionId);
    if (faction) {
      faction.characters.delete(char);
    }
  }

  /**
   * Recount cells per faction and update territoryPct for all factions.
   * Legacy O(N²) full-grid scan. Kept as a fallback for callers that don't
   * maintain incremental cell counts; production paths should use
   * updateTerritoryPctsFromCounts() instead. Calling this at 1Hz on a
   * 1024×1024 grid blew the 50ms tick budget.
   * @param {Uint8Array} grid
   * @param {number} gridSize
   * @param {number} sentinel
   */
  updateTerritoryPcts(grid, gridSize, sentinel) {
    const counts = new Map();
    for (const id of this._factions.keys()) counts.set(id, 0);

    let totalArenaCells = 0;
    for (let i = 0, len = gridSize * gridSize; i < len; i++) {
      const v = grid[i];
      if (v === sentinel || v === 0) {
        if (v === 0) totalArenaCells++;
        continue;
      }
      totalArenaCells++;
      if (counts.has(v)) {
        counts.set(v, counts.get(v) + 1);
      }
    }

    if (totalArenaCells === 0) return;

    for (const [id, faction] of this._factions) {
      faction.territoryPct = (counts.get(id) / totalArenaCells) * 100;
    }
  }

  /**
   * Update territoryPct from a precomputed Uint32Array of cell counts.
   * cellCounts[factionId] = number of grid cells owned by that faction.
   * Index 0 is unclaimed (counted toward totalArenaCells but not toward any
   * faction's percentage). totalArenaCells must be the count of in-arena
   * (non-sentinel) cells, used as the denominator. O(FACTION_COUNT).
   * @param {Uint32Array} cellCounts
   * @param {number} totalArenaCells
   */
  updateTerritoryPctsFromCounts(cellCounts, totalArenaCells) {
    if (totalArenaCells === 0) return;
    for (const [id, faction] of this._factions) {
      const count = cellCounts[id] ?? 0;
      faction.territoryPct = (count / totalArenaCells) * 100;
    }
  }

  /**
   * Check if a faction has fallen below the endangered threshold.
   * Sets endangered=true and disables respawns if newly endangered.
   * @param {number} factionId
   */
  checkEndangered(factionId) {
    const faction = this._factions.get(factionId);
    if (!faction || faction.endangered) return;
    if (faction.territoryPct < ENDANGERED_THRESHOLD) {
      faction.endangered = true;
      faction.respawnsEnabled = false;
    }
  }

  /**
   * Check if an endangered faction has recovered above the recovery threshold.
   * Re-enables respawns if recovered.
   * @param {number} factionId
   */
  checkRecovery(factionId) {
    const faction = this._factions.get(factionId);
    if (!faction || !faction.endangered) return;
    if (faction.territoryPct >= RECOVERY_THRESHOLD) {
      faction.endangered = false;
      faction.respawnsEnabled = true;
    }
  }

  /**
   * Check if a faction is eliminated (< 10% territory AND zero living characters).
   * @param {number} factionId
   * @returns {boolean} true if the faction was just eliminated (or was already dead)
   */
  checkElimination(factionId) {
    const faction = this._factions.get(factionId);
    if (!faction) return false;
    if (!faction.alive) return true;

    const livingChars = [...faction.characters].filter(c => c.alive);
    if (faction.territoryPct < ENDANGERED_THRESHOLD && livingChars.length === 0) {
      faction.alive = false;
      return true;
    }
    return false;
  }

  /**
   * Reassign a character to a surviving faction.
   * Excludes the strongest faction by territory %. Among remaining, picks
   * the one with fewest active characters, tie-breaking by least territory %.
   * @param {object} char
   * @returns {object} the new faction object
   */
  reassignCharacter(char) {
    // Remove from old faction
    this.removeCharacter(char);

    // Collect surviving (alive + respawnsEnabled) factions
    const surviving = [...this._factions.values()].filter(
      f => f.alive && f.respawnsEnabled
    );

    if (surviving.length === 0) return null;

    // Exclude strongest faction (highest territory %)
    const strongest = surviving.reduce((a, b) =>
      b.territoryPct > a.territoryPct ? b : a
    );
    const candidates = surviving.filter(f => f !== strongest);

    // If excluding strongest leaves nothing, just use surviving
    const pool = candidates.length > 0 ? candidates : surviving;

    // Pick faction with fewest active characters; tie-break by least territory %
    const target = pool.reduce((best, f) => {
      const bCount = [...best.characters].filter(c => c.alive).length;
      const fCount = [...f.characters].filter(c => c.alive).length;
      if (fCount < bCount) return f;
      if (fCount === bCount && f.territoryPct < best.territoryPct) return f;
      return best;
    });

    this.addCharacter(char, target.id);
    return target;
  }

  /**
   * Return a spawn position for a faction.
   * Prefers the default spawn point if it belongs to the faction.
   * Falls back to the centroid of all owned cells.
   * @param {number} factionId
   * @param {Uint8Array} grid
   * @param {number} gridSize
   * @param {number} worldMin
   * @param {number} cellSize
   * @param {number} sentinel
   * @returns {{x: number, z: number}}
   */
  getSpawnPoint(factionId, grid, gridSize, worldMin, cellSize, sentinel) {
    const faction = this._factions.get(factionId);
    if (!faction) return { x: 0, z: 0 };

    const { x: spawnX, z: spawnZ } = faction.spawnPoint;

    // Check if the default spawn point cell belongs to this faction
    const gx = Math.floor((spawnX - worldMin) / cellSize);
    const gz = Math.floor((spawnZ - worldMin) / cellSize);
    if (gx >= 0 && gx < gridSize && gz >= 0 && gz < gridSize) {
      const idx = gz * gridSize + gx;
      if (grid[idx] === factionId) {
        return { x: spawnX, z: spawnZ };
      }
    }

    // Compute centroid of all owned cells
    let sumX = 0, sumZ = 0, count = 0;
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx2 = 0; gx2 < gridSize; gx2++) {
        const idx = gy * gridSize + gx2;
        if (grid[idx] === factionId) {
          sumX += worldMin + (gx2 + 0.5) * cellSize;
          sumZ += worldMin + (gy + 0.5) * cellSize;
          count++;
        }
      }
    }

    if (count === 0) return { x: spawnX, z: spawnZ }; // no cells owned, fallback to default

    return { x: sumX / count, z: sumZ / count };
  }

  /**
   * Return alive factions sorted by territory % descending.
   * @returns {object[]}
   */
  getStandings() {
    return [...this._factions.values()]
      .filter(f => f.alive)
      .sort((a, b) => b.territoryPct - a.territoryPct);
  }

  /**
   * Return all factions as an array.
   * @returns {object[]}
   */
  getAllFactions() {
    return [...this._factions.values()];
  }

  /**
   * Return the faction with the most territory.
   * @returns {object|null}
   */
  getWinner() {
    let winner = null;
    for (const faction of this._factions.values()) {
      if (!winner || faction.territoryPct > winner.territoryPct) {
        winner = faction;
      }
    }
    return winner;
  }

  /**
   * Match is over when <= 1 faction is both alive and has respawns enabled.
   * @returns {boolean}
   */
  isMatchOver() {
    const active = [...this._factions.values()].filter(
      f => f.alive && f.respawnsEnabled
    );
    return active.length <= 1;
  }
}
