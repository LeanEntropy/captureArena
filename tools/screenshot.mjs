#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const URL = process.argv[2] || "http://localhost:3000";
const NAME = process.argv[3] || "test";
const COUNT = parseInt(process.argv[4] || "5", 10);
const INTERVAL = parseInt(process.argv[5] || "3000", 10);
const OUT_DIR = join(process.cwd(), "screenshots");

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto(URL);
console.log(`Navigated to ${URL}`);

await page.fill('input[placeholder="Enter your name"]', NAME);
await page.click("button:has-text('Play')");
console.log(`Playing as "${NAME}"`);

// Wait for game to initialize
await page.waitForTimeout(2000);

for (let i = 1; i <= COUNT; i++) {
  const filename = join(OUT_DIR, `capture-${i}.png`);
  await page.screenshot({ path: filename });
  console.log(`[${i}/${COUNT}] ${filename}`);
  if (i < COUNT) await page.waitForTimeout(INTERVAL);
}

await browser.close();
console.log(`Done — ${COUNT} screenshots in ${OUT_DIR}`);
