// Vitest global setup — runs before any server test module is imported.
// Sets STATS_DB_PATH to a writable tmp directory so db.ts doesn't try to
// open /app/data/stats.db (which doesn't exist in the test environment).
import os from "os";
import path from "path";
import fs from "fs";

const dir = path.join(os.tmpdir(), "captureArena-test");
fs.mkdirSync(dir, { recursive: true });
process.env.STATS_DB_PATH = process.env.STATS_DB_PATH || path.join(dir, "stats.db");
