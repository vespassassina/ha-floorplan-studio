// node scripts/theme-shots.mjs
//
// Renders one card screenshot per theme (docs/SPEC.md's THEMES list) for the README's theme gallery, into
// docs/img/themes/. Only demo/ is ever drawn, same rule as scripts/shots.mjs — no personal layout in a
// committed doc image. Run this again, and commit the result, whenever a theme is added, removed or
// re-palette'd.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync } from "node:fs";

const CARD = "dist/floorplan-studio-card.js";
if (!existsSync(CARD)) { console.error(`Missing ${CARD}. Run \`npm run build\` first.`); process.exit(1); }
const OUT = "docs/img/themes";
mkdirSync(OUT, { recursive: true });
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
  themes: { darkMode: false },
};

const THEMES = ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha", "coffee", "a-team", "space", "cyberpunk", "carpenter-brut", "beach-house"];
const errors = [];

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce" });
  for (const theme of THEMES) {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${theme}: ${e}`));
    // A neutral grey page background, not white: light/ha/slate's own light plan otherwise has no
    // visible edge against GitHub's white README background, and the gallery loses its card framing.
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#d8dade"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, h]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = h;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme }, hass]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`${theme}: the plan drew ${nodes} nodes`);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${theme}.png` });
    await page.close();
  }
  await ctx.close();
} finally {
  await browser.close();
}

if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
console.log(`wrote ${THEMES.length} screenshots to ${OUT}/`);
