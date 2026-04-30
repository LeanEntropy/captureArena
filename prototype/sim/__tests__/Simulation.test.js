import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../Simulation.js";
import { GRID_SIZE, GRID_SENTINEL } from "../constants.js";
import { FACTION_COUNT, CHARS_PER_FACTION } from "../faction.js";

describe("Simulation", () => {
  let sim;
  beforeEach(() => {
    sim = new Simulation({ seed: 1234 });
    sim.start();
  });

  it("creates a 1024x1024 grid initialized with sentinel outside arena", () => {
    expect(sim.grid).toBeInstanceOf(Uint8Array);
    expect(sim.grid.length).toBe(GRID_SIZE * GRID_SIZE);
    // top-left corner is outside the circular arena → sentinel
    expect(sim.grid[0]).toBe(GRID_SENTINEL);
    // center of arena is inside → not sentinel
    const ci = (GRID_SIZE / 2) * GRID_SIZE + (GRID_SIZE / 2);
    expect(sim.grid[ci]).not.toBe(GRID_SENTINEL);
  });

  it("creates 30 characters spread across 5 factions", () => {
    expect(sim.characters.length).toBe(FACTION_COUNT * CHARS_PER_FACTION);
    const byFaction = new Map();
    for (const c of sim.characters) {
      byFaction.set(c.factionId, (byFaction.get(c.factionId) ?? 0) + 1);
    }
    for (let f = 1; f <= FACTION_COUNT; f++) {
      expect(byFaction.get(f)).toBe(CHARS_PER_FACTION);
    }
  });

  it("all characters start with isHuman=false", () => {
    expect(sim.characters.every(c => c.isHuman === false)).toBe(true);
  });

  it("has a tick method that decrements match timeRemaining", () => {
    const before = sim.matchManager.timeRemaining;
    sim.tick(0.1);
    expect(sim.matchManager.timeRemaining).toBeCloseTo(before - 0.1, 5);
  });

  it("counts arena cells (totalArenaCells > 0 and < grid size)", () => {
    expect(sim.totalArenaCells).toBeGreaterThan(0);
    expect(sim.totalArenaCells).toBeLessThan(GRID_SIZE * GRID_SIZE);
  });

  it("tick advances a character along its dir vector", () => {
    const c = sim.characters[0];
    // Mark human so BotAI doesn't overwrite targetDir during tick.
    c.isHuman = true;
    c.setPos(0, 0);
    c.dir = { x: 1, z: 0 };
    c.targetDir = { x: 1, z: 0 };
    sim.tick(0.1);
    // After 0.1s at default bot speed (6), char should have moved approximately 0.6 along x
    expect(c.pos.x).toBeGreaterThan(0.3);
    expect(c.pos.x).toBeLessThan(0.9);
    expect(Math.abs(c.pos.z)).toBeLessThan(0.05);
  });

  it("invuln timer decreases over time", () => {
    const c = sim.characters[0];
    c.invulnTimer = 1.0;
    sim.tick(0.5);
    expect(c.invulnTimer).toBeCloseTo(0.5, 1);
  });

  it("character.wasOutside flips true when leaving own territory", () => {
    const c = sim.characters[0]; // faction 1, lives in faction 1's pie slice
    // Faction 1's pie slice is at angle 0-72°, so put char at 180° (opposite side)
    c.setPos(-15, 0);
    c.dir = { x: 0, z: 0 };
    c.targetDir = { x: 0, z: 0 };
    expect(c.wasOutside).toBe(false);
    sim.tick(0.05);
    // After ticking once at this position, the trail-step logic should detect outside
    expect(c.wasOutside).toBe(true);
  });

  it("claim with a zero-length trail (single repeated vertex) does not flip cells", () => {
    // A trail of identical points has zero enclosed area; the contour-arc
    // closure picks the same boundary index for both endpoints (si === ei)
    // and the resulting polygon has no extra interior. Faction 1's cell count
    // must not change meaningfully.
    const c = sim.characters[0];
    c.factionId = 1;
    // 5 identical points (zero-area trail) at a point safely inside faction 1.
    const p = { x: 30, z: 0 };
    c.trailVerts = [{ ...p }, { ...p }, { ...p }, { ...p }, { ...p }];
    const before = countCellsOwnedBy(sim.grid, 1);
    sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    // Trail must always be cleared.
    expect(c.trailVerts.length).toBe(0);
    // No-op zero-area trail must not produce a sliver. With identical points
    // the contour arc traverses the entire boundary forward and the result is
    // essentially the existing territory (modulo tiny rasterization rounding).
    expect(Math.abs(after - before)).toBeLessThan(20);
  });

  it("claim closes an out-and-back trail through the territory boundary", () => {
    // Regression test for the chevron/sliver artifact: a real-world claim trail
    // is roughly out-and-back (the character leaves territory, loops around,
    // returns near where it left). Stamping the raw trail as a polygon would
    // produce a thin sliver — instead the algorithm must close it through the
    // claimer's own territory contour.
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 cell on the boundary (i.e. one of its neighbors is
    // not faction-1). This is a place where a trail can plausibly start/end.
    let boundaryWX = 0, boundaryWZ = 0, found = false;
    for (let gy = 0; gy < GRID_SIZE && !found; gy++) {
      for (let gx = 0; gx < GRID_SIZE && !found; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        // Has a non-faction-1, non-sentinel neighbor?
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL)) {
          // Found a faction-1 boundary cell with a non-sentinel non-self
          // neighbor — convert to world coords.
          const cellSize = 133.78 / GRID_SIZE;
          boundaryWX = -66.89 + (gx + 0.5) * cellSize;
          boundaryWZ = -66.89 + (gy + 0.5) * cellSize;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    // Build an out-and-back trail starting at the boundary, looping into the
    // adjacent enemy/neutral cells, and returning near the start.
    // The trail end should be a couple of vertices apart from the start so the
    // arc-closure code picks a non-trivial arc through the claimer's contour.
    const trail = [];
    const lobeRadius = 4;
    const steps = 12;
    // Direction from origin outward through the boundary point — that's the
    // direction to push the lobe so it goes into enemy territory.
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    // Perpendicular direction (rotate 90°)
    const px = -uz, pz = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Half-circle lobe outward from the boundary
      const angle = Math.PI * t;
      const r = lobeRadius;
      const out = (1 - Math.cos(angle));   // 0 -> 2
      const side = Math.sin(angle);        // 0 -> 1 -> 0
      trail.push({
        x: boundaryWX + ux * r * out * 0.5 + px * r * side,
        z: boundaryWZ + uz * r * out * 0.5 + pz * r * side,
      });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);

    expect(ok).toBe(true);
    expect(c.trailVerts.length).toBe(0);
    // The claim must have meaningfully grown the territory (not produced a
    // sliver). At CELL_SIZE ≈ 0.13, a 4-unit lobe should sweep >>100 cells.
    expect(after - before).toBeGreaterThan(100);
  });

  it("claim with too-short trail returns false (no-op)", () => {
    const c = sim.characters[0];
    c.trailVerts = [{ x: 0, z: 0 }];
    const before = countCellsOwnedBy(sim.grid, c.factionId);
    const ok = sim.claim(c);
    expect(ok).toBe(false);
    expect(countCellsOwnedBy(sim.grid, c.factionId)).toBe(before);
  });

  it("setHumanControl flips isHuman on the indexed character", () => {
    const c = sim.characters[3];
    expect(c.isHuman).toBe(false);
    sim.setHumanControl(3, true);
    expect(c.isHuman).toBe(true);
    sim.setHumanControl(3, false);
    expect(c.isHuman).toBe(false);
  });

  it("setTargetDir normalizes the input", () => {
    const c = sim.characters[0];
    sim.setTargetDir(0, 3, 4); // length 5
    expect(c.targetDir.x).toBeCloseTo(0.6, 5);
    expect(c.targetDir.z).toBeCloseTo(0.8, 5);
  });

  it("setTargetDir ignores zero-length input", () => {
    const c = sim.characters[0];
    c.targetDir = { x: 1, z: 0 };
    sim.setTargetDir(0, 0, 0);
    expect(c.targetDir).toEqual({ x: 1, z: 0 }); // unchanged
  });

  it("onHeal hook fires with changed cells when heal pass mutates the grid", () => {
    // After start() the arena is fully claimed — no 0-cells remain.
    // Zero out an interior cell that has faction neighbors so the heal pass
    // will re-assign it. We call _healUnclaimedCells() directly rather than
    // routing through claim(), which could stamp over the cell before the heal.
    let healCalled = false;
    let healChanges = null;
    sim.onHeal = (changed) => { healCalled = true; healChanges = changed; };

    // Find an interior faction-1 cell (not on grid edge) with at least 2
    // faction-valued neighbors so the heal pass can re-assign it.
    let targetIdx = -1;
    for (let i = 0; i < sim.grid.length; i++) {
      if (sim.grid[i] !== 1) continue;
      const gx = i % GRID_SIZE;
      const gy = Math.floor(i / GRID_SIZE);
      if (gx <= 1 || gx >= GRID_SIZE - 2 || gy <= 1 || gy >= GRID_SIZE - 2) continue;
      const n = sim.grid[i - 1];
      const s = sim.grid[i + 1];
      const w = sim.grid[i - GRID_SIZE];
      const e = sim.grid[i + GRID_SIZE];
      const factionNeighbors = [n, s, w, e].filter(v => v > 0 && v !== GRID_SENTINEL);
      if (factionNeighbors.length >= 2) { targetIdx = i; break; }
    }
    expect(targetIdx).toBeGreaterThan(0); // sanity check

    sim.grid[targetIdx] = 0;

    // Directly invoke the heal pass — no claim needed
    sim._healUnclaimedCells();

    expect(healCalled).toBe(true);
    expect(healChanges.length).toBeGreaterThan(0);
    // The zeroed cell must have been re-assigned
    expect(sim.grid[targetIdx]).toBeGreaterThan(0);
    expect(sim.grid[targetIdx]).not.toBe(GRID_SENTINEL);
  });

  // ===== flood-fill claim algorithm tests =====

  it("Flood-fill claim: out-and-back trail captures the enclosed region only", () => {
    // Build a real out-and-back lobe trail starting at faction 1's territory
    // boundary, looping into adjacent enemy/neutral cells, and returning.
    // The new flood-fill-from-outside algorithm must enclose the lobe and
    // grow faction 1's territory without leaking into distant cells.
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 cell on the boundary.
    let boundaryWX = 0, boundaryWZ = 0, found = false;
    for (let gy = 0; gy < GRID_SIZE && !found; gy++) {
      for (let gx = 0; gx < GRID_SIZE && !found; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL)) {
          const cellSize = 133.78 / GRID_SIZE;
          boundaryWX = -66.89 + (gx + 0.5) * cellSize;
          boundaryWZ = -66.89 + (gy + 0.5) * cellSize;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    // Half-circle lobe outward from the boundary.
    const trail = [];
    const lobeRadius = 4;
    const steps = 12;
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    const px = -uz, pz = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = Math.PI * t;
      const r = lobeRadius;
      const out = (1 - Math.cos(angle));   // 0 -> 2
      const side = Math.sin(angle);        // 0 -> 1 -> 0
      trail.push({
        x: boundaryWX + ux * r * out * 0.5 + px * r * side,
        z: boundaryWZ + uz * r * out * 0.5 + pz * r * side,
      });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);

    expect(ok).toBe(true);
    expect(c.trailVerts.length).toBe(0);
    // The lobe is ~4-unit radius half-circle; at CELL_SIZE ≈ 0.13 it sweeps
    // far more than 100 cells.
    expect(after - before).toBeGreaterThan(100);
  });

  it("Flood-fill claim: does not capture distant disconnected enemy fragments", () => {
    // Place a tiny enemy island far from the claimer's trail. The old
    // algorithm's post-stamp _floodFillConnected would reassign distant
    // disconnected enemy fragments; the new flood-fill-from-outside
    // algorithm must NOT touch them.
    const c = sim.characters[0];
    c.factionId = 1;

    // Pick a far-from-faction-1 cell. Faction 1's pie slice is around angle 0;
    // the opposite side (negative-x direction) belongs to other factions.
    // Find a non-faction-1 non-sentinel cell roughly in the opposite direction
    // and stamp a small 3x3 island marked with a unique sentinel-like enemy id
    // (we'll use faction id 4 — simulation always has 5 factions).
    const enemyFaction = 4;
    // Find center cell roughly at world coord (-50, 0) — well away from
    // faction 1's slice and from the claimer's lobe.
    const cellSize = 133.78 / GRID_SIZE;
    const cx = Math.floor((-50 - (-66.89)) / cellSize);
    const cy = Math.floor((0 - (-66.89)) / cellSize);
    // Force a 5x5 island of faction `enemyFaction` (override whatever was
    // there). Skip sentinel cells.
    const islandIndices = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const idx = (cy + dy) * GRID_SIZE + (cx + dx);
        if (idx < 0 || idx >= sim.grid.length) continue;
        if (sim.grid[idx] === GRID_SENTINEL) continue;
        sim.grid[idx] = enemyFaction;
        islandIndices.push(idx);
      }
    }
    expect(islandIndices.length).toBeGreaterThan(10);

    // Now build a small lobe trail attached to faction 1 (same direction as
    // before, but small — does not touch the island).
    let boundaryWX = 0, boundaryWZ = 0, found = false;
    for (let gy = 0; gy < GRID_SIZE && !found; gy++) {
      for (let gx = 0; gx < GRID_SIZE && !found; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL)) {
          boundaryWX = -66.89 + (gx + 0.5) * cellSize;
          boundaryWZ = -66.89 + (gy + 0.5) * cellSize;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    const trail = [];
    const lobeRadius = 3;
    const steps = 10;
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    const px = -uz, pz = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = Math.PI * t;
      const r = lobeRadius;
      const out = (1 - Math.cos(angle));
      const side = Math.sin(angle);
      trail.push({
        x: boundaryWX + ux * r * out * 0.5 + px * r * side,
        z: boundaryWZ + uz * r * out * 0.5 + pz * r * side,
      });
    }
    c.trailVerts = trail;

    const ok = sim.claim(c);
    expect(ok).toBe(true);

    // The distant enemy island MUST still belong to enemyFaction. Count
    // surviving enemy cells in the original island indices.
    let survived = 0;
    for (const idx of islandIndices) {
      if (sim.grid[idx] === enemyFaction) survived++;
    }
    // All island cells must survive (island is far from the trail).
    expect(survived).toBe(islandIndices.length);
  });

  it("Flood-fill claim: degenerate trail captures nothing", () => {
    // A trail of length 5 entirely inside faction 1's own territory
    // (zero-area, attached to itself). The flood-fill must not flip any
    // cells. We allow either return value (true with 0 flips, or false) —
    // what matters is no cells change owner.
    const c = sim.characters[0];
    c.factionId = 1;
    const p = { x: 30, z: 0 };
    c.trailVerts = [{ ...p }, { ...p }, { ...p }, { ...p }, { ...p }];
    const before = countCellsOwnedBy(sim.grid, 1);
    sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(c.trailVerts.length).toBe(0);
    // No meaningful change.
    expect(Math.abs(after - before)).toBeLessThan(5);
  });

  it("Flood-fill claim: onClaimResult fires with cell-diff matching the cells flipped to factionId", () => {
    // The cell-diff hook must contain every cell that changed owner during
    // the claim, and ONLY those cells. Reconstructing the same grid by
    // applying the diff to a snapshot must yield the post-claim grid.
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 boundary cell.
    let boundaryWX = 0, boundaryWZ = 0, found = false;
    for (let gy = 0; gy < GRID_SIZE && !found; gy++) {
      for (let gx = 0; gx < GRID_SIZE && !found; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL)) {
          const cellSize = 133.78 / GRID_SIZE;
          boundaryWX = -66.89 + (gx + 0.5) * cellSize;
          boundaryWZ = -66.89 + (gy + 0.5) * cellSize;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    const trail = [];
    const lobeRadius = 4;
    const steps = 12;
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    const px = -uz, pz = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = Math.PI * t;
      const r = lobeRadius;
      const out = (1 - Math.cos(angle));
      const side = Math.sin(angle);
      trail.push({
        x: boundaryWX + ux * r * out * 0.5 + px * r * side,
        z: boundaryWZ + uz * r * out * 0.5 + pz * r * side,
      });
    }
    c.trailVerts = trail;

    // Capture the cell-diff via the new hook.
    let resultCharId = -1;
    let resultFactionId = -1;
    let resultCells = null;
    sim.onClaimResult = (cid, fid, cells) => {
      resultCharId = cid;
      resultFactionId = fid;
      resultCells = cells.slice();
    };

    // Snapshot the grid pre-claim.
    const preGrid = new Uint8Array(sim.grid);

    const ok = sim.claim(c);
    expect(ok).toBe(true);
    expect(resultCharId).toBe(c.id);
    expect(resultFactionId).toBe(1);
    expect(Array.isArray(resultCells)).toBe(true);
    expect(resultCells.length).toBeGreaterThan(0);

    // Apply the diff to the snapshot and verify it matches sim.grid.
    for (const idx of resultCells) {
      preGrid[idx] = 1;
    }
    let mismatches = 0;
    for (let i = 0; i < sim.grid.length; i++) {
      if (sim.grid[i] !== preGrid[i]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("Flood-fill claim: completes well under one server tick (50ms) for a typical lobe", () => {
    // Performance regression guard. With the bbox-bounded BFS, a typical
    // claim should be <10ms; a 50ms ceiling leaves ample slack for slow CI.
    const c = sim.characters[0];
    c.factionId = 1;

    let boundaryWX = 0, boundaryWZ = 0, found = false;
    for (let gy = 0; gy < GRID_SIZE && !found; gy++) {
      for (let gx = 0; gx < GRID_SIZE && !found; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL)) {
          const cellSize = 133.78 / GRID_SIZE;
          boundaryWX = -66.89 + (gx + 0.5) * cellSize;
          boundaryWZ = -66.89 + (gy + 0.5) * cellSize;
          found = true;
        }
      }
    }
    expect(found).toBe(true);

    const trail = [];
    const lobeRadius = 4;
    const steps = 12;
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    const px = -uz, pz = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = Math.PI * t;
      const r = lobeRadius;
      const out = (1 - Math.cos(angle));
      const side = Math.sin(angle);
      trail.push({
        x: boundaryWX + ux * r * out * 0.5 + px * r * side,
        z: boundaryWZ + uz * r * out * 0.5 + pz * r * side,
      });
    }
    c.trailVerts = trail;

    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const ok = sim.claim(c);
    const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    expect(ok).toBe(true);
    expect(t1 - t0).toBeLessThan(50);
  });

  it("restart resets characters and grid", () => {
    sim.characters[0].alive = false;
    sim.characters[0].killCount = 7;
    sim.characters[0].trailVerts = [{ x: 0, z: 0 }];
    sim.characters[0].wasOutside = true;
    sim.restart();
    expect(sim.characters[0].alive).toBe(true);
    expect(sim.characters[0].killCount).toBe(0);
    expect(sim.characters[0].trailVerts).toEqual([]);
    expect(sim.characters[0].wasOutside).toBe(false);
  });
});

function countCellsOwnedBy(grid, factionId) {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === factionId) n++;
  return n;
}
