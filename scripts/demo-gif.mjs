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

// Scene 1: the card at fit with a floor switcher, a quiet house by day.
await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:16px;background:#fff"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
await page.addScriptTag({ content: cardJs, type: "module" });
await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
const quiet = structuredClone(hass);
for (const e of ["light.demo_kitchen", "light.demo_living", "switch.demo_hall", "binary_sensor.demo_hall_motion"]) quiet.states[e] = st("off");
quiet.states["sun.sun"] = st("above_horizon");
const setHass = (h) => page.evaluate((h) => { const el = document.getElementById("c"); el.hass = h; return el.updateComplete; }, h);
await page.evaluate(([config, h]) => {
  const el = document.getElementById("c");
  el.setConfig(config); el.hass = h;
  return el.updateComplete;
}, [{ layout, floor: "all", theme: "blueprint" }, quiet]);
await page.waitForTimeout(1500);

// Scene 2: the house wakes up — two lights on, the hall motion sensor, the front door opens.
const awake = structuredClone(hass);
awake.states["sun.sun"] = st("above_horizon");
awake.states["binary_sensor.demo_front_door"] = st("on");
await setHass(awake);
await page.waitForTimeout(1800);

// Scene 3: Ctrl+wheel zooms in about the living room, then the fit button brings the whole floor back.
const svg = await page.locator("floorplan-studio-card svg").first().boundingBox();
await page.mouse.move(svg.x + svg.width * 0.3, svg.y + svg.height * 0.35);
await page.keyboard.down("Control");
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120); }
await page.keyboard.up("Control");
await page.waitForTimeout(1200);
await page.locator('floorplan-studio-card .fp-zoom button[aria-label="Fit"]').click();
await page.waitForTimeout(900);

// Scene 4: the floor chip switches to the first floor.
await page.locator("floorplan-studio-card .fp-floors button", { hasText: "First" }).click();
await page.waitForTimeout(1600);
await page.locator("floorplan-studio-card .fp-floors button", { hasText: "Ground" }).click();
await page.waitForTimeout(600);

// Scene 5: the sun sets — night darkens the rooms; the lit rooms stay clear.
const dusk = structuredClone(awake);
dusk.states["sun.sun"] = st("below_horizon");
await setHass(dusk);
await page.waitForTimeout(2000);

// Scene 6: the editor — open the demo house, open Add, select a device and drag it across the room.
await page.goto(pathToFileURL(resolve(EDITOR)).href);
await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
await page.waitForTimeout(700);
await page.locator('details.menu > summary:text-is("Add")').click();
await page.waitForTimeout(1200);
await page.mouse.click(500, 700); // close the menu, same as a user clicking away
await page.waitForTimeout(300);
const box = await page.locator('g[data-x="0"]').first().boundingBox();
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.locator("#panel").waitFor();
  await page.waitForTimeout(900);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx - i * 8, cy + i * 6); await page.waitForTimeout(60); }
  await page.mouse.up();
}
await page.waitForTimeout(1600);

await ctx.close();
await browser.close();

if (errors.length) { console.error("Page errors during recording:\n" + errors.join("\n")); process.exit(1); }

const videoFile = (await import("node:fs")).readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
if (!videoFile) { console.error("No video was recorded."); process.exit(1); }
const webm = resolve(VIDEO_DIR, videoFile);
const gif = resolve(OUT_DIR, "demo.gif");
const palette = resolve(VIDEO_DIR, "palette.png");

const FPS = 8, WIDTH = 640, SKIP = "0.6"; // the first frames are the blank page before the card has drawn
execFileSync("ffmpeg", ["-y", "-ss", SKIP, "-i", webm, "-vf", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`, "-update", "1", palette]);
execFileSync("ffmpeg", ["-y", "-ss", SKIP, "-i", webm, "-i", palette, "-lavfi", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`, gif]);

rmSync(VIDEO_DIR, { recursive: true, force: true });

const bytes = (await import("node:fs")).statSync(gif).size;
console.log(`${gif}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 3 * 1024 * 1024) { console.error("Over the 3 MB budget (S5.4 done-when). Lower FPS, width, or duration."); process.exit(1); }
