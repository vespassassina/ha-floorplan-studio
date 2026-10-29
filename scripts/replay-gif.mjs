// node scripts/replay-gif.mjs
//
// Records the replay on the demo home and converts it to README.md's replay GIF (docs/img/replay.gif): the live evening plan,
// ⋯ > Replay, the slider dragged back to the morning, a few seconds of Play, a drag on into the evening, then Live. Only demo/ is
// ever drawn (scripts/demo-home.mjs), same rule as demo-gif.mjs. Needs ffmpeg on PATH and dist-test/ (the card and its lazy
// chunks: FP_TEST_BUILD=1 node scripts/build.mjs).
//
// The history is made up here, one day of the demo home, and answered the way Home Assistant answers
// `history/history_during_period`: `{ [entity_id]: [{ s, a?, lu }] }`, `a` on the first row only, times in seconds since the
// epoch (the stub in tests/card/replay-bar.spec.ts says where that shape comes from).
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { home as layout, homeHass } from "./demo-home.mjs";

const CARD_DIR = "dist-test";
if (!existsSync(`${CARD_DIR}/floorplan-studio-card.js`)) { console.error("Missing dist-test/. Run `FP_TEST_BUILD=1 node scripts/build.mjs` first."); process.exit(1); }
try { execFileSync("ffmpeg", ["-version"]); } catch { console.error("ffmpeg not found on PATH."); process.exit(1); }

const OUT_DIR = "docs/img";
const VIDEO_DIR = "docs/img/.replay-gif-tmp";
mkdirSync(OUT_DIR, { recursive: true });
rmSync(VIDEO_DIR, { recursive: true, force: true });
mkdirSync(VIDEO_DIR, { recursive: true });

// The bar opens at 22:30; its slider runs from 22:30 the evening before.
const NOW = new Date(2026, 9, 28, 22, 30).getTime();
const at = (h, m = 0) => (NOW - (22.5 - h - m / 60) * 3600_000) / 1000; // today, h < 22.5
const live = homeHass(false, NOW).states;
live["sun.sun"] = { ...live["sun.sun"], state: "below_horizon" }; // the snapshot is a dusk; at 22:30 the sun is down

/** The night every entity starts from: lamps, relays, motion, windows and the TV off, the sun down. Everything else as it is live. */
const night = (id, s) => {
  if (/^(light|switch|binary_sensor)\./.test(id) && id !== "binary_sensor.demo_car_charging") return "off";
  if (id === "media_player.demo_living_tv") return "off";
  if (id === "sun.sun") return "below_horizon";
  return s.state;
};
/** The day: [entity, state, hour, minute]. The last change of each entity is its live state, so the end of the slider joins the live plan. */
const DAY = [
  ["sun.sun", "above_horizon", 7, 15], ["sun.sun", "below_horizon", 17, 0],
  ["binary_sensor.demo_hall_motion", "on", 6, 40], ["light.demo_hall", "on", 6, 40], ["binary_sensor.demo_hall_motion", "off", 6, 42],
  ["binary_sensor.demo_kitchen_motion", "on", 6, 45], ["light.demo_kitchen", "on", 6, 45], ["switch.demo_coffee", "on", 6, 47],
  ["switch.demo_coffee", "off", 6, 55], ["binary_sensor.demo_kitchen_motion", "off", 7, 20], ["light.demo_hall", "off", 7, 25],
  ["light.demo_kitchen", "off", 7, 30], ["binary_sensor.demo_front_door", "on", 7, 40], ["person.demo_alex", "not_home", 7, 41],
  ["binary_sensor.demo_front_door", "off", 7, 41],
  ["binary_sensor.demo_front_door", "on", 17, 50], ["person.demo_alex", "home", 17, 50], ["binary_sensor.demo_front_door", "off", 17, 51],
  ["binary_sensor.demo_hall_motion", "on", 17, 51], ["light.demo_hall", "on", 17, 51], ["binary_sensor.demo_hall_motion", "off", 17, 53],
  ["binary_sensor.demo_kitchen_motion", "on", 18, 20], ["light.demo_kitchen", "on", 18, 20], ["binary_sensor.demo_kitchen_motion", "off", 19, 5],
  ["switch.demo_living_relay", "on", 19, 30], ["light.demo_living", "on", 19, 30], ["switch.demo_tv", "on", 19, 35],
  ["media_player.demo_living_tv", "playing", 19, 35], ["light.demo_dining", "on", 19, 40], ["light.demo_terrace", "on", 19, 45],
  ["light.demo_kids", "on", 20, 0], ["binary_sensor.demo_dining_window", "on", 20, 15], ["switch.demo_washer", "on", 21, 0],
  ["binary_sensor.demo_washer_vibration", "on", 21, 2], ["binary_sensor.demo_kitchen_motion", "on", 22, 28],
];
const rows = {};
for (const [id, s] of Object.entries(live)) rows[id] = [{ s: night(id, s), a: s.attributes, lu: NOW / 1000 - 86400 - 600 }];
for (const [id, s, h, m] of DAY) rows[id].push({ s, lu: at(h, m) });
for (const [id, list] of Object.entries(rows)) {
  const last = list[list.length - 1].s;
  if (last !== live[id].state) { console.error(`${id}: the made-up day ends ${last}, live is ${live[id].state}.`); process.exit(1); }
}

const SIZE = { width: 960, height: 680 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: SIZE, colorScheme: "light", recordVideo: { dir: VIDEO_DIR, size: SIZE } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.clock.setFixedTime(NOW);
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== "http://fp.test") return route.abort();
  if (url.pathname === "/harness.html") return route.fulfill({ body: readFileSync("tests/card/harness-static.html"), contentType: "text/html" });
  const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname), file = m && resolve(CARD_DIR, m[1]);
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
  return route.fulfill({ body: readFileSync(file), contentType: "text/javascript" });
});

const card = (sel) => page.locator(`floorplan-studio-card ${sel}`);
await page.goto("http://fp.test/harness.html");
await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
await page.evaluate(([config, states, rows]) => {
  const w = document.getElementById("wrap"); w.style.width = "960px"; w.style.height = "680px"; document.body.style.margin = "0";
  const el = document.getElementById("card");
  el.setConfig(config);
  el.hass = {
    states, themes: { darkMode: false }, config: { latitude: 52.52, longitude: 13.4 }, locale: { language: "en", time_format: "24" },
    callService: () => Promise.resolve(),
    connection: {
      sendMessagePromise: (m) => {
        if (m.type !== "history/history_during_period") return Promise.resolve({});
        const out = {};
        for (const id of m.entity_ids ?? []) if (rows[id]) out[id] = rows[id];
        return Promise.resolve(out);
      },
    },
  };
  return el.updateComplete;
}, [{ layout, theme: "blueprint", active_list: false, floors: ["ground", "first", "basement"], view: "2d" }, live, rows]);
await card("svg polygon[data-r]").first().waitFor();
await page.waitForTimeout(1500);

// ⋯ > Replay: the bar opens at the end of the slider, which is the live plan.
await card("button[aria-label='View options']").click();
await page.waitForTimeout(700);
await card("[role=menu] [data-value='replay']").click();
const range = card("input.fp-rp-range");
await page.waitForFunction(() => {
  const r = document.getElementById("card").shadowRoot.querySelector("input.fp-rp-range");
  return r && !r.disabled;
});
await page.waitForTimeout(1200);

// A drag on the slider, from the thumb at the end back to 06:30, then forward. x for a minute of the day, thumb half-width inset.
const b = await range.boundingBox();
const xOf = (min) => b.x + 8 + (b.width - 16) * (min / 1440);
const y = b.y + b.height / 2;
const minuteOf = (h, m = 0) => (h + 24 - 22.5) % 24 * 60 + m;
async function drag(from, to, ms) {
  const n = Math.round(ms / 40);
  await page.mouse.move(xOf(from), y);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) { await page.mouse.move(xOf(from + ((to - from) * i) / n), y); await page.waitForTimeout(40); }
  await page.mouse.up();
}
await drag(1440, minuteOf(6, 30), 3000);
await page.waitForTimeout(800);

// Play: a day in a minute, so six seconds is the morning, kitchen lamp, coffee and the front door.
await card("button.fp-rp-play").click();
await page.waitForTimeout(6500);
await card("button.fp-rp-play").click();
await page.waitForTimeout(600);

// On into the evening: Alex home, the lamps and the TV, the window, the washer.
await drag(minuteOf(8, 20), minuteOf(22, 20), 4000);
await page.waitForTimeout(1500);

await card("button.fp-rp-live").click();
await page.waitForTimeout(1500);

const left = await page.evaluate(() => !!document.getElementById("card")._replay);
if (left) errors.push("Live did not close the replay.");
await ctx.close();
await browser.close();

if (errors.length) { console.error("Problems during recording:\n" + errors.join("\n")); process.exit(1); }

const videoFile = readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
if (!videoFile) { console.error("No video was recorded."); process.exit(1); }
const webm = resolve(VIDEO_DIR, videoFile);
const gif = resolve(OUT_DIR, "replay.gif");
const palette = resolve(VIDEO_DIR, "palette.png");

// The same conversion as demo-gif.mjs: 6 fps, 560 px, 128 colours, the first blank frames skipped.
const FPS = Number(process.env.GIF_FPS ?? 6), WIDTH = Number(process.env.GIF_WIDTH ?? 560), COLORS = Number(process.env.GIF_COLORS ?? 128), SKIP = "0.6";
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", SKIP, "-i", webm, "-vf", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=full:max_colors=${COLORS}`, "-update", "1", palette]);
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", SKIP, "-i", webm, "-i", palette, "-lavfi", `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, gif]);

if (!process.env.KEEP_VIDEO) rmSync(VIDEO_DIR, { recursive: true, force: true });

const bytes = statSync(gif).size;
console.log(`${gif}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 3 * 1024 * 1024) { console.error("Over the 3 MB budget. Lower GIF_FPS, GIF_WIDTH, or shorten a scene."); process.exit(1); }
