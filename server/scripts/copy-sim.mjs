import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../prototype/sim");
const dst = path.resolve(here, "../src/sim");

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });
await cp(src, dst, {
  recursive: true,
  filter: p => !p.includes("__tests__"),
});
console.log(`Copied ${src} → ${dst}`);
