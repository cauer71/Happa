// Rendert die App-Symbole aus public/icons/icon.svg mit Chromium (Playwright).
//   npm i -g playwright   (oder vorhandene Installation)
//   node scripts/build-icons.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(execSync("npm root -g").toString().trim() + "/playwright");
}

const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const out = (name) => new URL("../public/icons/" + name, import.meta.url).pathname;

// iOS rundet die Ecken selbst ab → apple-touch-icon randlos und ohne Transparenz.
// "maskable" (Android) braucht ~10 % Sicherheitsrand, den das Motiv bereits hat.
const targets = [
  { name: "apple-touch-icon.png", size: 180, radius: 0 },
  { name: "icon-192.png", size: 192, radius: 0.225 },
  { name: "icon-512.png", size: 512, radius: 0.225 },
  { name: "icon-maskable-512.png", size: 512, radius: 0 },
  { name: "favicon-32.png", size: 32, radius: 0.225 },
];

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}
    div{width:${t.size}px;height:${t.size}px;overflow:hidden;border-radius:${t.radius * t.size}px}
    svg{width:100%;height:100%;display:block}</style><div>${svg}</div>`);
  await page.screenshot({ path: out(t.name), omitBackground: true });
  console.log("✓", t.name);
}
await browser.close();
