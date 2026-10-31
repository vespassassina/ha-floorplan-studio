import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S42.4 (docs/specs/temp-range.md, decision 8): a real built card, fed the way Home Assistant feeds it, tints a hot room and lists
// it in Attention, and clears both when the reading comes back inside the band. The states have the shape HA's frontend gives
// `hass.states` (state text, attributes, last_changed), as in card-temp-attention.spec.ts. Hold 0 makes the warning immediate; the
// hold itself is pinned with a faked clock in card-temp-watch.test.ts.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const layout = structuredClone(demo);
layout.tempRange = { min: 17, max: 26, hold: 0 };
Object.assign(layout.floors.ground.rooms[1], { temps: ["sensor.demo_kitchen_temperature"] }); // Kitchen, room-ground-2
const st = (state: string) => ({ state, attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-31T09:30:15Z" });
const card = (page: Page) => page.locator("floorplan-studio-card");
const feed = (page: Page, v: string) =>
  card(page).evaluate((el, s) => { (el as unknown as { hass: unknown }).hass = { states: { "sensor.demo_kitchen_temperature": s }, callService: () => {} }; return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; }, st(v));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    try { localStorage.clear(); } catch { /* file: origin without storage */ }
    (document.getElementById("card") as unknown as { setConfig(c: unknown): void }).setConfig(config);
  }, { layout, floor: "ground" });
});

test("a hot room gets the wash and an Attention row, and loses both when the reading is back inside the band", async ({ page }) => {
  await feed(page, "27.4");
  await expect(card(page).locator("css=svg polygon.temp-wash.temp-wash-hot[data-tw='1']")).toHaveCount(1);
  await expect(card(page).locator("css=.fp-ov-attn .fp-active-row")).toContainText("27.4 °C, above 26");
  await feed(page, "25.8"); // inside the 0.5 band below max (25.5): the room stays out
  await expect(card(page).locator("css=svg polygon.temp-wash-hot")).toHaveCount(1);
  await feed(page, "25.4");
  await expect(card(page).locator("css=svg polygon.temp-wash-hot")).toHaveCount(0);
  await expect(card(page).locator("css=.fp-ov-attn .fp-active-row")).toHaveCount(0);
});
