import { FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";

// Tuning constants (extracted from prototype/main.js for sharing with server-side simulation).

// Arena / movement
export const ARENA_RADIUS = 66.89;
export const MIN_POINT_DIST = 0.3;
export const PLAYER_SPEED = 9.8;
export const BOT_SPEED = 7.5;
export const TURN_SPEED = 5;

// Trail
export const TRAIL_KILL_DIST = 0.6;
export const SELF_TRAIL_SKIP = 5;
// Hard cap on trail vertex count. Long trails balloon the claim bbox (PAD
// scales with trailExtent); a trail spanning most of the arena makes
// _claimTrail iterate the full grid and stalls the server hundreds of ms —
// visible to clients as a freeze + jump in every character. Cap is generous
// (~60 world units = ~90% of arena diameter) but bounds worst-case cost.
export const MAX_TRAIL_LEN = 200;

// Players / respawn
export const BOT_COUNT = FACTION_COUNT * CHARS_PER_FACTION - 1;
export const RESPAWN_DELAY = 3;
export const INVULN_TIME = 5;

// Gameplay
export const CONTINUOUS_LAND = true; // When true, disconnected land fragments are freed after territory loss

export const BOT_NAMES = ["K-9","Lime","Toe","Leaf Assassin","Helmet Destroyer","Star Jammer","Sky Bully","Daisy Stick","Claw","Blitz","Nova","Shade","Rook","Pixel","Echo","Drift","Fang","Jinx","Bolt"];

// Territory grid
export const GRID_SIZE = 1024;
export const WORLD_MIN = -ARENA_RADIUS;  // -66.89
export const WORLD_SIZE = ARENA_RADIUS * 2;  // 133.78
export const CELL_SIZE = WORLD_SIZE / GRID_SIZE;  // ~0.1307
export const GRID_SENTINEL = 255;  // out-of-bounds marker
