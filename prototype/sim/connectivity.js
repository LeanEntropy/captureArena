// After-claim connectivity enforcement.
//
// Rule: a connected region of faction X's territory survives iff at least one
// living, non-trail player of faction X stands on a cell in it. Otherwise the
// region is "empty" and converts to the claimer's faction. After conversion,
// any trail-running player whose faction now has zero cells dies.
//
// Public API:
//   enforceConnectivity({
//     grid, gridSize, numFactions,
//     affectedFactions: Set<number>,
//     characters: Array<Character>,
//     claimerFactionId: number,
//     cellCounts: Uint32Array,
//   }) → { capturedCells: number, killedCharacters: Array<Character> }
//
// Each character must expose: factionId, alive (bool), trailVerts (array),
// and cellIndex (precomputed grid index of body position) OR pos.{x,z} +
// a cellIndexOf(x,z) function. The Simulation integration computes cellIndex
// inline before calling, so the helper takes it directly.

const NEIGHBORS = [1, -1, 0, 0]; // x deltas paired with the y deltas below
const NEIGHBORS_Y = [0, 0, 1, -1];

// Reused across calls to avoid per-claim allocation.
let _visited = null;
let _label = null;
let _queue = null;

function _ensureBuffers(size) {
  if (_visited && _visited.length === size) return;
  _visited = new Uint8Array(size);
  _label = new Int32Array(size);
  _queue = new Int32Array(size);
}

export function enforceConnectivity({
  grid, gridSize, numFactions,
  affectedFactions, characters, claimerFactionId, cellCounts,
}) {
  const size = gridSize * gridSize;
  _ensureBuffers(size);
  const visited = _visited;
  const label = _label;
  const queue = _queue;
  visited.fill(0);
  label.fill(-1);

  let capturedCells = 0;

  for (const F of affectedFactions) {
    if (F === claimerFactionId) continue; // claimer's own components are safe by definition
    if (cellCounts[F] === 0) continue;

    // 1. Component labeling — BFS over cells where grid[i] === F.
    let nextLabel = 0;
    const componentSize = []; // componentId → cell count
    for (let start = 0; start < size; start++) {
      if (grid[start] !== F || visited[start]) continue;
      // BFS this component.
      const cid = nextLabel++;
      let qHead = 0, qTail = 0;
      queue[qTail++] = start;
      visited[start] = 1;
      label[start] = cid;
      let count = 0;
      while (qHead < qTail) {
        const idx = queue[qHead++];
        count++;
        const cx = idx % gridSize;
        const cy = (idx - cx) / gridSize;
        for (let n = 0; n < 4; n++) {
          const ax = cx + NEIGHBORS[n];
          const ay = cy + NEIGHBORS_Y[n];
          if (ax < 0 || ax >= gridSize || ay < 0 || ay >= gridSize) continue;
          const aIdx = ay * gridSize + ax;
          if (visited[aIdx]) continue;
          if (grid[aIdx] !== F) continue;
          visited[aIdx] = 1;
          label[aIdx] = cid;
          queue[qTail++] = aIdx;
        }
      }
      componentSize.push(count);
    }

    if (nextLabel === 0) continue; // no cells of F in arena (can happen if F was wiped)

    // 2. Residency check — single pass over characters.
    const occupied = new Uint8Array(nextLabel);
    for (const c of characters) {
      if (!c.alive) continue;
      if (c.factionId !== F) continue;
      if (c.trailVerts && c.trailVerts.length > 0) continue; // trail-running ≠ resident
      const ci = c.cellIndex;
      if (ci == null || ci < 0 || ci >= size) continue;
      const cid = label[ci];
      if (cid >= 0) occupied[cid] = 1;
    }

    // 3. Convert unoccupied components to claimer.
    if (occupied.every((v) => v === 1)) continue;
    for (let i = 0; i < size; i++) {
      const cid = label[i];
      if (cid < 0) continue;
      if (occupied[cid]) continue;
      if (grid[i] !== F) continue; // safety
      grid[i] = claimerFactionId;
      cellCounts[F]--;
      cellCounts[claimerFactionId]++;
      capturedCells++;
    }
  }

  // 4. Trail-runner kill pass.
  const killedCharacters = [];
  for (const c of characters) {
    if (!c.alive) continue;
    if (!c.trailVerts || c.trailVerts.length === 0) continue;
    if (cellCounts[c.factionId] === 0) {
      killedCharacters.push(c);
    }
  }

  return { capturedCells, killedCharacters };
}
