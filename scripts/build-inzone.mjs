import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "prototype");
const distRoot = path.join(root, "dist");
const output = path.join(distRoot, "capture-arena");
const archive = path.join(distRoot, "capture-arena.zip");

const runtimeFiles = [
  "index.html",
  "main.js",
  "ui.js",
  "portals.js",
  "music/bgm.mp3",
  "vendor/three.module.js",
  "vendor/three.core.js",
  "sim/BotAI.js",
  "sim/Character.js",
  "sim/Simulation.js",
  "sim/connectivity.js",
  "sim/constants.js",
  "sim/faction.js",
  "sim/grid_geom.js",
  "sim/match.js",
  "sim/scoring.js",
];

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function copyRuntime() {
  await fs.rm(output, { recursive: true, force: true });
  await fs.rm(archive, { force: true });
  await fs.mkdir(output, { recursive: true });

  for (const relative of runtimeFiles) {
    const from = path.join(source, relative);
    if (!(await exists(from))) {
      throw new Error(`Required Solo runtime file is missing: prototype/${relative}`);
    }
    const to = path.join(output, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }

  // The standalone package has no online runtime. Remove the three lazy
  // multiplayer imports from the generated copy, while leaving source intact.
  const mainPath = path.join(output, "main.js");
  let main = await fs.readFile(mainPath, "utf8");
  const lazyImport = 'const { MultiplayerClient } = await import("./multiplayer.js");';
  const occurrences = main.split(lazyImport).length - 1;
  if (occurrences !== 3) {
    throw new Error(`Expected 3 lazy multiplayer imports, found ${occurrences}; review Solo packaging rules.`);
  }
  main = main.replaceAll(lazyImport, 'throw new Error("Online play is not included in this Solo build.");');
  await fs.writeFile(mainPath, main);

  // Remote fonts are cosmetic and the stylesheet already has system fallbacks.
  // Strip the link from the generated build so distribution has no CDN request.
  const indexPath = path.join(output, "index.html");
  let html = await fs.readFile(indexPath, "utf8");
  html = html.replace(/^\s*<link[^>]+fonts\.googleapis\.com[^>]*>\s*$/m, "");
  await fs.writeFile(indexPath, html);
}

function localSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

async function validateBuild() {
  const required = ["index.html", "vendor/three.module.js"];
  for (const relative of required) {
    if (!(await exists(path.join(output, relative)))) throw new Error(`Validation failed: ${relative} is absent.`);
  }
  if (await exists(path.join(output, "telemetry.js"))) throw new Error("Validation failed: telemetry.js was packaged.");
  if (await exists(path.join(output, "multiplayer.js"))) throw new Error("Validation failed: multiplayer.js was packaged.");

  const files = await walk(output);
  if (files.some((file) => file.endsWith(".map") || file.includes("/__tests__/"))) {
    throw new Error("Validation failed: tests or source maps were packaged.");
  }

  const html = await fs.readFile(path.join(output, "index.html"), "utf8");
  if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(html)) {
    throw new Error("Validation failed: external script URL found in index.html.");
  }
  if (/(?:cdn\.jsdelivr\.net|esm\.sh|unpkg\.com|fonts\.googleapis\.com)/i.test(html)) {
    throw new Error("Validation failed: CDN reference found in index.html.");
  }

  const queue = ["main.js"];
  const seen = new Set();
  while (queue.length) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.join(output, relative);
    if (!(await exists(absolute))) throw new Error(`Validation failed: unresolved module ${relative}.`);
    const code = await fs.readFile(absolute, "utf8");
    if (/\b(?:from\s*|import\s*\()["'](?:colyseus\.js|\.\/multiplayer\.js)["']/.test(code)) {
      throw new Error(`Validation failed: multiplayer import reachable from ${relative}.`);
    }
    const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\()["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of imports) {
      if (!localSpecifier(specifier)) throw new Error(`Validation failed: bare import "${specifier}" in ${relative}.`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      if (!(await exists(path.join(output, resolved)))) {
        throw new Error(`Validation failed: ${relative} imports missing ${resolved}.`);
      }
      if (resolved.endsWith(".js")) queue.push(resolved);
    }
  }
  return files;
}

async function walk(directory, base = directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute, base));
    else result.push(path.relative(base, absolute).split(path.sep).join("/"));
  }
  return result.sort();
}

async function createAndValidateZip(expectedFiles) {
  await execFileAsync("zip", ["-X", "-q", "-r", archive, "."], { cwd: output });
  const { stdout } = await execFileAsync("unzip", ["-Z1", archive]);
  const zipFiles = stdout.split(/\r?\n/).filter((name) => name && !name.endsWith("/")).sort();
  if (JSON.stringify(zipFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("ZIP validation failed: archive contents differ from build directory.");
  }
}

try {
  await copyRuntime();
  const files = await validateBuild();
  await createAndValidateZip(files);
  const size = (await fs.stat(archive)).size;
  console.log(`Built ${files.length} files in ${path.relative(root, output)}/`);
  console.log(`Created ${path.relative(root, archive)} (${size} bytes)`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
