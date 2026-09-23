// node scripts/doc-shots.mjs
//
// Renders a handful of demo screenshots for docs/editor.md and docs/card.md into docs/img/. Only demo/ is
// ever drawn, same rule as scripts/shots.mjs — no personal layout in a committed doc image. Run this again,
// and commit the result, whenever the editor toolbar, a menu shown in the doc, or the card's on-state look
// changes enough that the screenshot would mislead.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CARD = "dist/floorplan-studio-card.js";
const EDITOR = "dist/editor.html";
for (const f of [CARD, EDITOR]) {
  if (!existsSync(f)) { console.error(`Missing ${f}. Run \`npm run build\` first.`); process.exit(1); }
}
const OUT = "docs/img";
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
  themes: { darkMode: false }, // no callService: a function cannot cross into the page, and nothing here clicks
};
const errors = [];

const browser = await chromium.launch();
try {
  // card-overview.png: the demo ground floor, blueprint theme, a light and the motion sensor on.
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`card-overview: ${e}`));
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, h]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = h;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme: "blueprint" }, hass]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`card-overview: the plan drew ${nodes} nodes`);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/card-overview.png` });
    await ctx.close();
  }

  // editor-overview.png: the full editor, blueprint theme, demo loaded, nothing selected.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`editor: ${e}`));
  await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), "blueprint");
  await page.goto(pathToFileURL(resolve(EDITOR)).href);
  await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
  await page.screenshot({ path: `${OUT}/editor-overview.png` });

  // editor-add-menu.png: the Add menu open, showing the furniture/device/area submenus.
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.screenshot({ path: `${OUT}/editor-add-menu.png` });
  await page.mouse.click(500, 700); // empty canvas: closes the open menu, same as a user clicking away

  // editor-device-panel.png: a device selected, its panel open on the right.
  const box = await page.locator('g[data-x="0"]').first().boundingBox();
  if (!box) errors.push("editor-device-panel: no box for g[data-x=\"0\"]");
  else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator("#panel").waitFor();
    await page.screenshot({ path: `${OUT}/editor-device-panel.png` });
  }
  await ctx.close();
} finally {
  await browser.close();
}

if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
console.log(`wrote ${OUT}/card-overview.png, editor-overview.png, editor-add-menu.png, editor-device-panel.png`);
