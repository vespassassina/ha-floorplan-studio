import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// B53.11: tap, hold and kiosk for a linked appliance and plant (spec 19d), as the car's (card-car.spec.ts). Every click is a real page.mouse event at a point checked to
// be the real top element (finding 3). The hold is a real mouse.down held past HOLD_MS. The 3D tap on a car is held by card-3d-car.spec.ts.
// The state values are copied from what the integrations send (finding 21): the tracker is home / not_home / a zone name, Tesla's
// charging sensor is an enum with "charging" and "stopped", the battery is a `sensor` with device_class battery and unit %.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-18T09:30:15Z" });
const STATES = (o: Record<string, unknown> = {}) => ({
  "light.demo_living": st("on"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "media_player.demo_tv": st("playing", { friendly_name: "Living TV" }),
  // Home Connect washer: the operation state is a `sensor` enum (run/ready), the door a `binary_sensor` with device_class door, the end time a timestamp.
  "sensor.washer_state": st("run", { friendly_name: "Washer state" }),
  "binary_sensor.washer_door": st("off", { friendly_name: "Washer door", device_class: "door" }),
  "sensor.washer_end": st(new Date(Date.now() + 41 * 60000 + 30000).toISOString(), { friendly_name: "Washer end", device_class: "timestamp" }),
  // Mi Flora style moisture sensor.
  "sensor.fern_moisture": st("14", { friendly_name: "Fern moisture", device_class: "moisture", unit_of_measurement: "%" }),
  ...o,
});


const washer = (extra: Record<string, unknown> = {}) => ({ id: "w-1", symbol: "washer", x: 120, y: 150, rot: 0, w: 60, h: 60, name: "Washer", entity: "sensor.washer_state", attached: ["binary_sensor.washer_door", "sensor.washer_end"], ...extra });
const fern = (extra: Record<string, unknown> = {}) => ({ id: "p-1", symbol: "plant", x: 330, y: 230, rot: 0, w: 50, h: 50, name: "Fern", entity: "sensor.fern_moisture", ...extra });
const layoutOf = (...pieces: Record<string, unknown>[]) => { const l = structuredClone(demo); l.floors.ground.furniture.push(...pieces); return l; };
const indexOf = (layout: { floors: { ground: { furniture: { id: string }[] } } }, id: string) => layout.floors.ground.furniture.findIndex((f) => f.id === id);
async function boot(page: Page, layout: unknown, config: Record<string, unknown> = {}, states: Record<string, unknown> = STATES()) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states]) => {
      const w = window as unknown as { __calls: string[]; __info: string[] };
      w.__calls = []; w.__info = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
      el.setConfig(config);
      el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
      return el.updateComplete;
    },
    [{ layout, floor: "ground", ...config }, states] as const,
  );
}
async function setStates(page: Page, states: Record<string, unknown>) {
  await page.evaluate((states) => {
    const el = document.getElementById("card") as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.hass = { ...el.hass, states };
    return el.updateComplete;
  }, states);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);

/** The centre of piece `i`, checked to be the real top element there (the piece's own group, not the room under it). */
async function piecePoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-f="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest(`g[data-f="${i}"]`) };
  }, i);
  expect(p.hit, `piece ${i} is the top element at its centre`).toBe(true);
  return p;
}
/** A real press. With `hold: "chooser"` the button stays down until the chooser shows (the hold timer is the clock, no sleep); with
 *  `hold: "quiet"` it stays down 600 ms, the one place a wait is the point: proving that nothing opens (kiosk). */
async function press(page: Page, p: { x: number; y: number }, hold?: "chooser" | "quiet") {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  if (hold === "chooser") await expect(chooser(page)).toBeVisible();
  if (hold === "quiet") await page.waitForTimeout(600);
  await page.mouse.up();
}
const chooser = (page: Page) => card(page).locator("css=.fp-chooser-dialog");
const rows = (page: Page) => card(page).locator("css=.fp-chooser-list button").evaluateAll((bs) => bs.map((b) => b.textContent!.replace(/\s+/g, " ").trim()));


for (const view of ["2d", "2.5d"] as const) {
  test.describe(`a linked appliance and plant in ${view}`, () => {
    test("a real tap on a running washer opens the popup: name, status with minutes left, no service, no more-info", async ({ page }) => {
      const layout = layoutOf(washer());
      await boot(page, layout, { view });
      await press(page, await piecePoint(page, indexOf(layout, "w-1")));
      const pop = card(page).locator("css=.fp-pop");
      await expect(pop).toBeVisible();
      await expect(pop.locator("css=.fp-pop-name")).toHaveText("Washer");
      await expect(pop.locator("css=.fp-pop-state")).toHaveText("Running · 42 min left");
      expect(await calls(page)).toEqual([]);
      expect(await infos(page)).toEqual([]);
    });
    test("the status follows the states: idle, a washer door left ajar is still idle, a fridge door open is an alert", async ({ page }) => {
      const layout = layoutOf(washer());
      await boot(page, layout, { view }, STATES({ "sensor.washer_state": st("ready"), "sensor.washer_end": st("unknown") }));
      await press(page, await piecePoint(page, indexOf(layout, "w-1")));
      await expect(card(page).locator("css=.fp-pop-state")).toHaveText("Idle");
      const ajar = STATES({ "sensor.washer_state": st("ready"), "binary_sensor.washer_door": st("on", { device_class: "door" }) });
      await boot(page, layout, { view }, ajar);
      await press(page, await piecePoint(page, indexOf(layout, "w-1")));
      await expect(card(page).locator("css=.fp-pop-state")).toHaveText("Idle");
      const fridge = layoutOf(washer({ id: "f-1", symbol: "fridge", name: "Fridge" }));
      await boot(page, fridge, { view }, ajar);
      await press(page, await piecePoint(page, indexOf(fridge, "f-1")));
      await expect(card(page).locator("css=.fp-pop-state")).toHaveText("Door open");
    });
    test("the popup's More info lists the entities, main first; one entity opens its more-info", async ({ page }) => {
      const layout = layoutOf(washer());
      await boot(page, layout, { view });
      await press(page, await piecePoint(page, indexOf(layout, "w-1")));
      await card(page).locator("css=.fp-pop-more").click();
      await expect(chooser(page)).toBeVisible();
      const names = ["Washer state", "Washer door", "Washer end"];
      expect((await rows(page)).map((r, k) => r.startsWith(names[k]))).toEqual([true, true, true]);
      expect(await rows(page)).toHaveLength(3);
      const solo = layoutOf(washer({ attached: undefined }));
      await boot(page, solo, { view });
      await press(page, await piecePoint(page, indexOf(solo, "w-1")));
      await card(page).locator("css=.fp-pop-more").click();
      expect(await infos(page)).toEqual(["sensor.washer_state"]);
    });
    test("kiosk: a linked piece does nothing", async ({ page }) => {
      const layout = layoutOf(washer());
      await boot(page, layout, { view, kiosk: true });
      await press(page, await piecePoint(page, indexOf(layout, "w-1")));
      await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    });
    test("a thirsty plant says so; one with enough water says its moisture; the glow is on the plan only while thirsty", async ({ page }) => {
      const layout = layoutOf(fern({ minMoisture: 30 }));
      await boot(page, layout, { view });
      await expect(card(page).locator("css=svg .plant-glow")).toHaveCount(1);
      await press(page, await piecePoint(page, indexOf(layout, "p-1")));
      await expect(card(page).locator("css=.fp-pop-state")).toHaveText("Needs water · 14 %");
      await setStates(page, STATES({ "sensor.fern_moisture": st("55", { device_class: "moisture", unit_of_measurement: "%" }) }));
      await expect(card(page).locator("css=svg .plant-glow")).toHaveCount(0);
      await expect(card(page).locator("css=.fp-pop-state")).toHaveText("Moisture 55 %");
    });
    test("a plant with the default threshold (20) at 25 % is fine", async ({ page }) => {
      const layout = layoutOf(fern());
      await boot(page, layout, { view }, STATES({ "sensor.fern_moisture": st("25", { device_class: "moisture", unit_of_measurement: "%" }) }));
      await expect(card(page).locator("css=svg .plant-glow")).toHaveCount(0);
    });
  });
}
