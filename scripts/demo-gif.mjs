// node scripts/demo-gif.mjs
//
// Records a short screencast of the demo house — card, then editor — and converts it to
// README.md's demo GIF (docs/img/demo.gif). Only demo/layout.json is ever drawn, same rule as
// scripts/shots.mjs and scripts/doc-shots.mjs — no personal layout in a committed image.
// Needs ffmpeg on PATH. Run again, and commit the result, whenever the card or editor's look
// changes enough that the GIF would mislead.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CARD = "dist/floorplan-studio-card.js";
const EDITOR = "dist/editor.html";
for (const f of [CARD, EDITOR]) {
  if (!existsSync(f)) { console.error(`Missing ${f}. Run \`npm run build\` first.`); process.exit(1); }
}
try { execFileSync("ffmpeg", ["-version"]); } catch { console.error("ffmpeg not found on PATH."); process.exit(1); }

const OUT_DIR = "docs/img";
const VIDEO_DIR = "docs/img/.demo-gif-tmp";
mkdirSync(OUT_DIR, { recursive: true });
rmSync(VIDEO_DIR, { recursive: true, force: true });
mkdirSync(VIDEO_DIR, { recursive: true });

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const cardJs = readFileSync(CARD, "utf8");
const now = () => new Date().toISOString();
const st = (state, attributes = {}) => ({ state, attributes, last_changed: now() });
const hass = {
  states: {
    "light.demo_kitchen": st("on", { rgb_color: [255, 170, 60] }), "light.demo_living": st("on"), "light.demo_bedroom": st("off"),
    "switch.demo_hall": st("on"), "switch.demo_tv_plug": st("off"), "binary_sensor.demo_hall_motion": st("on"), "climate.demo_living": st("heat"),
    "media_player.demo_office": st("playing"), "camera.demo_hall": st("streaming"), "sensor.demo_living_temperature": st("23.5"),
    "sensor.demo_bedroom_temperature": st("19"), "sensor.demo_bathroom_humidity": st("54"),
  },
  themes: { darkMode: false }, // no callService: a function cannot cross into the page, and nothing here clicks
};

const SIZE = { width: 960, height: 640 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: SIZE, colorScheme: "light", reducedMotion: "reduce", recordVideo: { dir: VIDEO_DIR, size: SIZE } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Scene 1: the card, live — a light on, motion active, a camera streaming.
await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;background:#fff"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
await page.addScriptTag({ content: cardJs, type: "module" });
await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
await page.evaluate(([config, h]) => {
  const el = document.getElementById("c");
  el.setConfig(config); el.hass = h;
  return el.updateComplete;
}, [{ layout, floor: "ground", theme: "blueprint" }, hass]);
await page.waitForTimeout(2200);

// Scene 2: the editor — open the demo house, open Add, then select a device to show its panel.
await page.goto(pathToFileURL(resolve(EDITOR)).href);
await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
await page.waitForTimeout(700);
await page.locator('details.menu > summary:text-is("Add")').click();
await page.waitForTimeout(1400);
await page.mouse.click(500, 700); // close the menu, same as a user clicking away
await page.waitForTimeout(300);
const box = await page.locator('g[data-x="0"]').first().boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator("#panel").waitFor();
}
await page.waitForTimeout(2000);

await ctx.close();
await browser.close();

if (errors.length) { console.error("Page errors during recording:\n" + errors.join("\n")); process.exit(1); }

const videoFile = (await import("node:fs")).readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
if (!videoFile) { console.error("No video was recorded."); process.exit(1); }
const webm = resolve(VIDEO_DIR, videoFile);
const gif = resolve(OUT_DIR, "demo.gif");
const palette = resolve(VIDEO_DIR, "palette.png");

const FPS = 8, WIDTH = 640;
execFileSync("ffmpeg", ["-y", "-i", webm, "-vf", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`, "-update", "1", palette]);
execFileSync("ffmpeg", ["-y", "-i", webm, "-i", palette, "-lavfi", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`, gif]);

rmSync(VIDEO_DIR, { recursive: true, force: true });

const bytes = (await import("node:fs")).statSync(gif).size;
console.log(`${gif}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 3 * 1024 * 1024) { console.error("Over the 3 MB budget (S5.4 done-when). Lower FPS, width, or duration."); process.exit(1); }
