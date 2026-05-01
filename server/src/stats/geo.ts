// IP -> ISO-2 country lookup using the db-ip free country-lite database.
//
// The .mmdb file is expected at /app/server/dist/dbip-country-lite.mmdb in
// production (Dockerfile downloads it during build). For local dev, we fall
// back to a sibling path next to this source file so the server still boots
// when the file is missing — lookupCountry then just returns null.

import maxmind, { type CountryResponse, type Reader } from "maxmind";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Production: built bundle lives at /app/server/dist; the .mmdb is copied
// there alongside the JS. In dev (tsx watch from src/), we look two levels up.
const candidates = [
  path.resolve(__dirname, "dbip-country-lite.mmdb"),
  path.resolve(__dirname, "../dist/dbip-country-lite.mmdb"),
  "/app/server/dist/dbip-country-lite.mmdb",
];

let reader: Reader<CountryResponse> | null = null;

async function loadReader(): Promise<void> {
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        reader = await maxmind.open<CountryResponse>(p);
        console.log(`[stats] geo db loaded from ${p}`);
        return;
      } catch (err) {
        console.warn(`[stats] failed to open geo db at ${p}:`, err);
      }
    }
  }
  console.warn(
    "[stats] no dbip-country-lite.mmdb found — country lookups will return null"
  );
}

// Fire and forget at module load. lookupCountry returns null until ready.
void loadReader();

export function lookupCountry(ip: string | undefined): string | null {
  if (!reader || !ip) return null;
  // Strip IPv6-mapped IPv4 prefix and zone id.
  const cleaned = ip.replace(/^::ffff:/, "").split("%")[0];
  try {
    const result = reader.get(cleaned);
    return result?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}
