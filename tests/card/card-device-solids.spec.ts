import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 2.5D device solids in the card: a radiator box, a speaker cabinet, a TV panel on the wall. The icon stays the tap
// target (a real mouse, finding 3); the solid takes no click. A small own layout, not the demo: no house data.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
const room = { id: "r", name: "Room", area: "", kind: "room", pts: [[0, 0], [600, 0], [600, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] };
const layout = {
  version: 2, unit: "cm", north: 0, rotate: 0,
  floors: { f: { title: "F", outline: room.pts, owk: ["wall", "wall", "wall", "wall"], rooms: [room], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [
      { id: "rad", type: "heater", entity: "climate.rad", a: [100, 8], b: [260, 8] },
      { id: "spk", type: "speaker", entity: "media_player.spk", x: 450, y: 300 },
      { id: "tv", type: "tv", entity: "switch.tv", x: 300, y: 70 },
    ] } },
};
async function open(page: Page, view: string, rotation = 0) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    (window as unknown as { __calls: unknown[] }).__calls = [];
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (...a: unknown[]) => (window as unknown as { __calls: unknown[] }).__calls.push(a) };
    return el.updateComplete;
  }, [{ layout, view, tilt: 0.5, rotation, active_list: false }, {
    "switch.tv": { state: "on", attributes: {}, last_changed: new Date().toISOString() },
    "climate.rad": { state: "heat", attributes: { hvac_action: "heating" }, last_changed: new Date().toISOString() },
  }] as const);
}

test.use({ viewport: { width: 800, height: 700 } });

test("2.5D draws the three solids; 2D draws none", async ({ page }) => {
  await open(page, "2d");
  await expect(card(page).locator("svg g.dsolid")).toHaveCount(0);
  await open(page, "2.5d");
  await expect(card(page).locator("svg g.dsolid.radiator.on")).toHaveCount(1);
  await expect(card(page).locator("svg g.dsolid.speaker")).toHaveCount(1);
  await expect(card(page).locator("svg g.dsolid.tv.on")).toHaveCount(1);
  await expect(card(page).locator("svg g.dsolid.speaker circle.drv")).toHaveCount(2);
});

for (const rotation of [0, 90]) test(`rotation ${rotation}: a real click on the TV icon opens its popup and its button makes the one call, a click on the panel does not reach it`, async ({ page }) => {
  await open(page, "2.5d", rotation);
  const centre = async (sel: string) => { const b = (await card(page).locator(sel).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const panel = await centre("svg g.dsolid.tv polygon.tv-screen, svg g.dsolid.tv polygon.bt"), icon = await centre('svg g[data-x="2"]');
  // The solid takes no pointer: what is under the mouse at the panel is not the panel and not a device.
  const hit = await page.evaluate(([x, y]) => (document.querySelector("floorplan-studio-card")!.shadowRoot!.elementFromPoint(x!, y!) as Element).closest("g.dsolid, g[data-x]") === null, [panel.x, panel.y]);
  expect(hit).toBe(true);
  await page.mouse.click(panel.x, panel.y);
  expect(await calls(page)).toEqual([]);
  await page.mouse.click(icon.x, icon.y);
  expect(await calls(page)).toEqual([]); // a tap opens the popup and operates nothing
  await card(page).locator("css=.fp-pop-do").click(); // the TV is on: its OFF asks first
  expect(await calls(page)).toEqual([]);
  await card(page).locator("css=.fp-pop-do").click();
  expect(await calls(page)).toEqual([["switch", "turn_off", { entity_id: "switch.tv" }]]);
});
