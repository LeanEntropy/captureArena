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

  it("Flood-fill claim: parallel-section trail at 4-cell spacing fills enclosed region", () => {
    // Regression: an out-and-back trail with parallel sections sitting
    // 4 cells apart (≈0.52 world units at CELL_SIZE 0.13) used to leave a
    // 1-cell gap in a 3-cell-wide wall stamp, letting the BFS leak through.
    // The visible result was a "trail-shaped strip with no fill" through
    // enemy territory.
    //
    // The fix retries the BFS with progressively thicker walls (radius 1, 3,
    // 5) so parallel sections at any reasonable spacing seal correctly. With
    // a 7-cell-wide wall (radius 3) walls overlap at 4-cell spacing,
    // sealing the loop and capturing the inner ribbon properly.
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 boundary cell adjacent to an enemy faction.
    let bx = 0, bz = 0, dirX = 0, dirZ = 0, found = false;
    outer:
    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const checks = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
        for (const ch of checks) {
          const nx = gx + ch.dx, ny = gy + ch.dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const nv = sim.grid[ny * GRID_SIZE + nx];
          if (nv > 0 && nv < 6 && nv !== 1) {
            const cellSize = 133.78 / GRID_SIZE;
            bx = -66.89 + (gx + 0.5) * cellSize;
            bz = -66.89 + (gy + 0.5) * cellSize;
            dirX = ch.dx; dirZ = ch.dy;
            found = true;
            break outer;
          }
        }
      }
    }
    expect(found).toBe(true);

    const cellSize = 133.78 / GRID_SIZE;
    const ux = dirX, uz = dirZ;
    const px = -uz, pz = ux;
    // Single out-and-back lobe with parallel sections 4 cells apart.
    const trail = [];
    const DEPTH = 8;
    const STEP_OUT = cellSize * 4;
    trail.push({ x: bx, z: bz });
    for (let s = 1; s <= 32; s++) {
      const r = (s / 32) * DEPTH;
      trail.push({ x: bx + ux * r, z: bz + uz * r });
    }
    trail.push({ x: bx + ux * DEPTH + px * STEP_OUT, z: bz + uz * DEPTH + pz * STEP_OUT });
    for (let s = 32; s >= 1; s--) {
      const r = (s / 32) * DEPTH;
      trail.push({ x: bx + ux * r + px * STEP_OUT, z: bz + uz * r + pz * STEP_OUT });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    const gain = after - before;

    // BlocklyIO sub-fill algorithm: with a 3-cell-wide wall stamp (radius=1)
    // and parallel legs at 4-cell spacing, the inter-leg channel (~1 cell wide)
    // fills + the wall ribbon itself flips. Pre-fix thin-line bug: only ~17
    // trail cells. Post-fix: ~400+ cells = real fill of the ribbon. Threshold
    // 300 cleanly separates "thin line bug" from "real fill".
    expect(gain).toBeGreaterThan(300);

    // Sample a point in the geometric center of the lobe — it should be
    // claimer-owned (filled, not "outside"). With the leak, this cell stays
    // enemy-owned because the BFS reaches it from the bbox perimeter.
    const midX = bx + ux * (DEPTH * 0.5) + px * (STEP_OUT * 0.5);
    const midZ = bz + uz * (DEPTH * 0.5) + pz * (STEP_OUT * 0.5);
    const midGX = Math.floor((midX - (-66.89)) / cellSize);
    const midGY = Math.floor((midZ - (-66.89)) / cellSize);
    expect(sim.grid[midGY * GRID_SIZE + midGX]).toBe(1);
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
    // No meaningful change. The wall stamp at WALL_RADIUS=2 produces a
    // 5×5 footprint at the trail point; a few of those cells may flip if the
    // trail point is right on the own-faction boundary, but it must remain
    // far below any flood-fill commit (which would be hundreds of cells).
    expect(Math.abs(after - before)).toBeLessThan(30);
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

  it("Flood-fill claim: thin out-and-back trail produces a real fill, not a thin line", () => {
    // Regression test for the "thin-line claim" bug. A trail whose two legs
    // run within ~3 cells of each other (an out-and-back with a small lateral
    // offset) defeated the 1-cell wall rasterizer: the BFS leaked through the
    // 1-2 cell gap between the two legs, the enclosed set ended up empty,
    // and only the trail walls themselves got flipped → user saw their trail
    // as a thin line of their color, no fill.
    //
    // Fix: 3×3 thick stamping makes the wall watertight, and a fallback path
    // polygon-stamps the trail when the BFS still leaks. Either way the claim
    // must produce a real fill (>> trail length).
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 cell on the boundary.
    let bGX = -1, bGY = -1;
    outer: for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL && v !== 0)) {
          bGX = gx; bGY = gy; break outer;
        }
      }
    }
    expect(bGX).toBeGreaterThanOrEqual(0);
    const cellSize = 133.78 / GRID_SIZE;
    const bx = -66.89 + (bGX + 0.5) * cellSize;
    const bz = -66.89 + (bGY + 0.5) * cellSize;
    const dirLen = Math.hypot(bx, bz);
    const ux = bx / dirLen, uz = bz / dirLen;
    const px = -uz, pz = ux;

    // Build the trail shape that triggered the bug: out-leg + return-leg
    // separated by 0.4 worldUnits (~3 cells at CELL_SIZE ≈ 0.13). With a
    // 1-cell wall this leaves a 1-2 cell gap the BFS leaked through.
    const trail = [];
    for (let i = 0; i < 8; i++) {
      trail.push({ x: bx + ux * (i*0.4) + px * 0.2, z: bz + uz * (i*0.4) + pz * 0.2 });
    }
    for (let i = 7; i >= 0; i--) {
      trail.push({ x: bx + ux * (i*0.4) - px * 0.2, z: bz + uz * (i*0.4) - pz * 0.2 });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    // Must produce a REAL fill — not just trail-cells. Pre-fix this was ≤ trail.length (~16).
    // Real fill is dozens to hundreds of cells. Allow margin for tighter fits.
    expect(after - before).toBeGreaterThan(trail.length + 5);
  });

  it("Flood-fill claim: pinched/self-touching trail still fills (no thin-line regression)", () => {
    // Another shape that triggered the thin-line bug: a self-touching pinch
    // where the trail crosses itself or comes within sub-3-cell distance.
    const c = sim.characters[0];
    c.factionId = 1;

    let bGX = -1, bGY = -1;
    outer: for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const nbrs = [
          gy > 0 ? sim.grid[(gy - 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gy < GRID_SIZE - 1 ? sim.grid[(gy + 1) * GRID_SIZE + gx] : GRID_SENTINEL,
          gx > 0 ? sim.grid[gy * GRID_SIZE + gx - 1] : GRID_SENTINEL,
          gx < GRID_SIZE - 1 ? sim.grid[gy * GRID_SIZE + gx + 1] : GRID_SENTINEL,
        ];
        if (nbrs.some(v => v !== 1 && v !== GRID_SENTINEL && v !== 0)) {
          bGX = gx; bGY = gy; break outer;
        }
      }
    }
    expect(bGX).toBeGreaterThanOrEqual(0);
    const cellSize = 133.78 / GRID_SIZE;
    const bx = -66.89 + (bGX + 0.5) * cellSize;
    const bz = -66.89 + (bGY + 0.5) * cellSize;
    const dirLen = Math.hypot(bx, bz);
    const ux = bx / dirLen, uz = bz / dirLen;
    const px = -uz, pz = ux;

    // Pinch shape (16 verts) — trail loops back near its start with a tight gap.
    const trail = [];
    for (let i=0;i<6;i++) trail.push({ x: bx + ux*(0.3 + i*0.3), z: bz + px*(0.05 + i*0.05) });
    for (let i=0;i<4;i++) trail.push({ x: bx + ux*1.5 + px*(0.5 + i*0.4), z: bz + 0.5 + uz*(i*0.2) });
    for (let i=5;i>=0;i--) trail.push({ x: bx + ux*(0.3 + i*0.3), z: bz - px*(0.05 + i*0.05) });
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    // Must produce a real fill (not just trail cells).
    expect(after - before).toBeGreaterThan(trail.length + 5);
  });

  it("BlocklyIO sub-fill: zigzag trail with parallel sections fills its enclosed pockets", () => {
    // Regression: a zigzag trail (S-shape) traces several near-parallel
    // sections separated by a few cells. The BlocklyIO sub-fill must enclose
    // any genuinely-closed pocket between segments — a leak through one
    // pocket must NOT cause the others to fail to fill (they're independent
    // sub-fills).
    const c = sim.characters[0];
    c.factionId = 1;

    // Find a faction-1 boundary cell adjacent to a different faction (not 0,
    // not sentinel). Capture the direction from the boundary cell into the
    // enemy cell — that's the direction the trail must travel to leave own
    // territory.
    let bGX = -1, bGY = -1, dirX = 0, dirZ = 0;
    outer: for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const checks = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
        for (const ch of checks) {
          const nx = gx + ch.dx, ny = gy + ch.dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const nv = sim.grid[ny * GRID_SIZE + nx];
          if (nv > 0 && nv < 6 && nv !== 1) {
            bGX = gx; bGY = gy;
            dirX = ch.dx; dirZ = ch.dy;
            break outer;
          }
        }
      }
    }
    expect(bGX).toBeGreaterThanOrEqual(0);
    const cellSize = 133.78 / GRID_SIZE;
    const bx = -66.89 + (bGX + 0.5) * cellSize;
    const bz = -66.89 + (bGY + 0.5) * cellSize;
    const ux = dirX, uz = dirZ;
    const px = -uz, pz = ux;

    // Zigzag with 4-cell parallel-section spacing. Multiple segments switching
    // direction.
    const trail = [];
    const SPACING = cellSize * 4;
    const DEPTH = 6;
    // Segment 1: out
    for (let s = 0; s <= 16; s++) {
      const r = (s / 16) * DEPTH;
      trail.push({ x: bx + ux * r, z: bz + uz * r });
    }
    // Segment 2: side-step + return
    for (let s = 16; s >= 0; s--) {
      const r = (s / 16) * DEPTH;
      trail.push({ x: bx + ux * r + px * SPACING, z: bz + uz * r + pz * SPACING });
    }
    // Segment 3: side-step + out again
    for (let s = 0; s <= 16; s++) {
      const r = (s / 16) * DEPTH;
      trail.push({ x: bx + ux * r + px * SPACING * 2, z: bz + uz * r + pz * SPACING * 2 });
    }
    // Segment 4: side-step + return
    for (let s = 16; s >= 0; s--) {
      const r = (s / 16) * DEPTH;
      trail.push({ x: bx + ux * r + px * SPACING * 3, z: bz + uz * r + pz * SPACING * 3 });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    // A real fill — at minimum the trail walls (~3-cell-wide × ~120 verts).
    // No "thin line" outcome (which would be ~17 cells).
    expect(after - before).toBeGreaterThan(200);
  });

  it("BlocklyIO sub-fill: balloon-on-string trail fills the balloon enclosure", () => {
    // Regression: the "balloon on a string" trail = a long thin out-leg
    // followed by a wide loop. The previous algorithm leaked through the
    // long string section. The sub-fill must capture only the balloon
    // interior (not the string), and the string itself becomes own territory
    // as a trail wall.
    const c = sim.characters[0];
    c.factionId = 1;

    let bGX = -1, bGY = -1, dirX = 0, dirZ = 0;
    outer: for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const idx = gy * GRID_SIZE + gx;
        if (sim.grid[idx] !== 1) continue;
        const checks = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
        for (const ch of checks) {
          const nx = gx + ch.dx, ny = gy + ch.dy;
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const nv = sim.grid[ny * GRID_SIZE + nx];
          if (nv > 0 && nv < 6 && nv !== 1) {
            bGX = gx; bGY = gy;
            dirX = ch.dx; dirZ = ch.dy;
            break outer;
          }
        }
      }
    }
    expect(bGX).toBeGreaterThanOrEqual(0);
    const cellSize = 133.78 / GRID_SIZE;
    const bx = -66.89 + (bGX + 0.5) * cellSize;
    const bz = -66.89 + (bGY + 0.5) * cellSize;
    const ux = dirX, uz = dirZ;
    const px = -uz, pz = ux;

    // String: long thin out-leg.
    const trail = [];
    const STRING_LEN = 4;
    const BALLOON_R = 2;
    for (let s = 0; s <= 12; s++) {
      const r = (s / 12) * STRING_LEN;
      trail.push({ x: bx + ux * r, z: bz + uz * r });
    }
    // Balloon: half-circle outward at the end of the string.
    for (let s = 0; s <= 16; s++) {
      const angle = Math.PI * (s / 16);
      const cx2 = bx + ux * (STRING_LEN + BALLOON_R) - ux * BALLOON_R * Math.cos(angle);
      const cz2 = bz + uz * (STRING_LEN + BALLOON_R) - uz * BALLOON_R * Math.cos(angle);
      const ox = px * BALLOON_R * Math.sin(angle);
      const oz = pz * BALLOON_R * Math.sin(angle);
      trail.push({ x: cx2 + ox, z: cz2 + oz });
    }
    // String: long thin return-leg (~2 cells offset from out-leg, makes it a
    // tight loop along the string).
    for (let s = 12; s >= 0; s--) {
      const r = (s / 12) * STRING_LEN;
      trail.push({ x: bx + ux * r + px * cellSize * 2, z: bz + uz * r + pz * cellSize * 2 });
    }
    c.trailVerts = trail;

    const before = countCellsOwnedBy(sim.grid, 1);
    const ok = sim.claim(c);
    const after = countCellsOwnedBy(sim.grid, 1);
    expect(ok).toBe(true);
    // Real fill — the balloon interior (~π×r² ≈ 50 cells at r=2 worldUnits)
    // plus the trail walls (~120+ cells from 43 verts × 3-cell-wide stamp,
    // with overlap on the parallel string sections). Total >> the thin-line
    // outcome (= trail.length ≈ 43).
    expect(after - before).toBeGreaterThan(100);
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

  it("cellCounts stays in sync with grid contents after start, claim, and restart", () => {
    // Right after start(), the incremental cellCounts must match a full
    // recount of the grid.
    expectCellCountsMatchGrid(sim);

    // Run a real claim that flips many cells.
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
    const trail = [];
    const dirLen = Math.hypot(boundaryWX, boundaryWZ);
    const ux = boundaryWX / dirLen, uz = boundaryWZ / dirLen;
    const px = -uz, pz = ux;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const angle = Math.PI * t;
      const out = (1 - Math.cos(angle));
      const side = Math.sin(angle);
      trail.push({
        x: boundaryWX + ux * 4 * out * 0.5 + px * 4 * side,
        z: boundaryWZ + uz * 4 * out * 0.5 + pz * 4 * side,
      });
    }
    c.trailVerts = trail;
    sim.claim(c);
    // After a claim that flips many cells, counts must still match the grid.
    expectCellCountsMatchGrid(sim);

    // After restart(), counts must be re-initialized correctly.
    sim.restart();
    expectCellCountsMatchGrid(sim);
  });

  it("updateTerritoryPctsFromCounts produces same results as the legacy grid scan", () => {
    // Run a claim to ensure cells have moved around.
    const c = sim.characters[0];
    c.factionId = 1;
    c.trailVerts = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
      { x: 3, z: 0 }, { x: 4, z: 0 }, { x: 5, z: 0 },
    ];
    sim.claim(c);

    const fm = sim.factionManager;

    // Compute via the new incremental path.
    fm.updateTerritoryPctsFromCounts(sim.cellCounts, sim.totalArenaCells);
    const incremental = new Map();
    for (const [id, f] of fm.factions) incremental.set(id, f.territoryPct);

    // Compute via the legacy slow path; results must match within float epsilon.
    fm.updateTerritoryPcts(sim.grid, GRID_SIZE, GRID_SENTINEL);
    for (const [id, f] of fm.factions) {
      expect(f.territoryPct).toBeCloseTo(incremental.get(id), 6);
    }
  });
});

function countCellsOwnedBy(grid, factionId) {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === factionId) n++;
  return n;
}

function expectCellCountsMatchGrid(sim) {
  // Recompute counts from the grid and compare against sim.cellCounts.
  const truth = new Uint32Array(sim.cellCounts.length);
  for (let i = 0; i < sim.grid.length; i++) {
    const v = sim.grid[i];
    if (v === GRID_SENTINEL) continue;
    truth[v]++;
  }
  for (let i = 0; i < truth.length; i++) {
    expect(sim.cellCounts[i]).toBe(truth[i]);
  }
}
