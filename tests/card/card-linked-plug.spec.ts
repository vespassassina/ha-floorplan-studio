import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// B53.13: an electric piece powered through a smart plug. Only the plug's switch is in the layout; its power and energy sensors are found
// on the same HA device through `hass.entities`. Shapes (finding 21): `hass.entities` is a map entity_id -> { device_id, entity_category, ... }
// as the frontend's entity registry display list sends it; a Zigbee plug has `switch.x`, `sensor.x_power` (device_class power, W) and
// `sensor.x_energy` (device_class energy, kWh, total_increasing); a utility_meter `sensor.x_daily` has meter_period "daily". The vacuum is
// `vacuum.robo` with state cleaning / docked and attribute battery_level.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource();
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-11-06T09:30:15Z" });
const REG = {
  "switch.fridge_plug": { device_id: "dev1" }, "sensor.fridge_plug_power": { device_id: "dev1" }, "sensor.fridge_plug_energy": { device_id: "dev1" }, "sensor.fridge_plug_linkquality": { device_id: "dev1", entity_category: "diagnostic" },
  "switch.tv_plug": { device_id: "dev2" }, "sensor.tv_plug_power": { device_id: "dev2" },
  "vacuum.robo": { device_id: "dev3" },
};
const STATES = (o: Record<string, unknown> = {}) => ({
  "light.demo_living": st("on"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"), "media_player.demo_tv": st("playing"),
  "switch.fridge_plug": st("on", { friendly_name: "Fridge plug" }),
  "sensor.fridge_plug_power": st("312", { friendly_name: "Fridge plug power", device_class: "power", unit_of_measurement: "W", state_class: "measurement" }),
  "sensor.fridge_plug_energy": st("48.26", { friendly_name: "Fridge plug energy", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }),
  "sensor.fridge_plug_linkquality": st("90", { device_class: "power", unit_of_measurement: "lqi" }),
  "switch.tv_plug": st("on", { friendly_name: "TV plug" }), "sensor.tv_plug_power": st("96", { friendly_name: "TV plug power", device_class: "power", unit_of_measurement: "W" }),
  "vacuum.robo": st("cleaning", { friendly_name: "Robo", battery_level: 63 }),
  ...o,
});
const piece = (symbol: string, extra: Record<string, unknown>) => ({ id: `${symbol}-1`, symbol, x: 120, y: 150, rot: 0, w: 60, h: 60, name: symbol, ...extra });
const layoutOf = (...pieces: Record<string, unknown>[]) => { const l = structuredClone(demo); l.floors.ground.furniture.push(...pieces); return l; };
const indexOf = (layout: { floors: { ground: { furniture: { id: string }[] } } }, id: string) => layout.floors.ground.furniture.findIndex((f) => f.id === id);
async function boot(page: Page, layout: unknown, states: Record<string, unknown> = STATES(), config: Record<string, unknown> = {}, entities: unknown = REG) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states, entities]) => {
    const w = window as unknown as { __info: string[] };
    w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(config);
    el.hass = { states, entities, callService: () => {} };
    return el.updateComplete;
  }, [{ layout, floor: "ground", ...config }, states, entities] as const);
}
async function setStates(page: Page, states: Record<string, unknown>) {
  await page.evaluate((states) => {
    const el = document.getElementById("card") as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.hass = { ...el.hass, states };
    return el.updateComplete;
  }, states);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
async function tap(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-f="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = el.shadowRoot!.elementFromPoint(x, y);
    return { x, y, hit: !!top?.closest(`g[data-f="${i}"]`), top: top ? `${top.tagName}.${top.getAttribute("class")} in ${top.closest("g[data-f]")?.getAttribute("data-f")}` : "none" };
  }, i);
  expect(p.hit, `piece ${i} is the top element at its centre (got ${p.top})`).toBe(true);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}
const state = (page: Page) => card(page).locator("css=.fp-pop-state");
const lines = async (page: Page) => (await state(page).innerText()).split("\n");
const classes = (page: Page, i: number) => card(page).locator(`css=svg g[data-f="${i}"]`).getAttribute("class");

for (const view of ["2d", "2.5d"] as const) {
  test.describe(`a plug behind an electric piece in ${view}`, () => {
    test("a fridge with only its plug attached: working, 312 W and the total kWh; the plan group is on", async ({ page }) => {
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
      const i = indexOf(layout, "fridge-1");
      await boot(page, layout, STATES(), { view });
      expect(await classes(page, i)).toMatch(/ on\b/);
      await tap(page, i);
      await expect(card(page).locator("css=.fp-pop-name")).toHaveText("fridge");
      expect(await lines(page)).toEqual(["Running", "312 W", "48.26 kWh"]);
    });
    test("a daily meter wins over the total: 'today'", async ({ page }) => {
      const reg = { ...REG, "sensor.fridge_daily": { device_id: "dev1" } };
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
      await boot(page, layout, STATES({ "sensor.fridge_daily": st("1.4", { device_class: "energy", unit_of_measurement: "kWh", meter_period: "daily" }) }), { view }, reg);
      await tap(page, indexOf(layout, "fridge-1"));
      expect(await lines(page)).toEqual(["Running", "312 W", "1.4 kWh today"]);
    });
    test("plug off says 'Off at the plug', the group is not on; idle at 3 W; both follow the states", async ({ page }) => {
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
      const i = indexOf(layout, "fridge-1");
      await boot(page, layout, STATES({ "switch.fridge_plug": st("off"), "sensor.fridge_plug_power": st("0", { device_class: "power", unit_of_measurement: "W" }) }), { view });
      expect(await classes(page, i)).not.toMatch(/ on\b/);
      await tap(page, i);
      expect((await lines(page))[0]).toBe("Off at the plug");
      await setStates(page, STATES({ "sensor.fridge_plug_power": st("3", { device_class: "power", unit_of_measurement: "W" }) }));
      expect((await lines(page))[0]).toBe("Idle");
      await setStates(page, STATES());
      expect((await lines(page))[0]).toBe("Running");
      expect(await classes(page, i)).toMatch(/ on\b/);
    });
    test("More info lists the plug and its sensors, not the diagnostic one", async ({ page }) => {
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
      await boot(page, layout, STATES(), { view });
      await tap(page, indexOf(layout, "fridge-1"));
      await card(page).locator("css=.fp-pop-more").click();
      const rows = await card(page).locator("css=.fp-chooser-list button").evaluateAll((bs) => bs.map((b) => b.textContent!.replace(/\s+/g, " ").trim()));
      expect(rows).toEqual(["Fridge plugon", "Fridge plug power312 W", "Fridge plug energy48.26 kWh"]);
      expect(rows.some((r) => r.includes("linkquality"))).toBe(false);
    });
    test("a tv on a plug: the popup, with its watts, instead of straight to more-info; a tv with no extras still goes to more-info", async ({ page }) => {
      const layout = layoutOf(piece("tv", { entity: "switch.tv_plug", w: 120, h: 12 }));
      await boot(page, layout, STATES(), { view });
      await tap(page, indexOf(layout, "tv-1"));
      expect(await lines(page)).toContain("96 W");
      const plain = layoutOf(piece("tv", { entity: "media_player.demo_tv", w: 120, h: 12 }));
      await boot(page, plain, STATES(), { view });
      await tap(page, indexOf(plain, "tv-1"));
      await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __info: string[] }).__info)).toEqual(["media_player.demo_tv"]);
    });
    test("an attached sensor of the user's wins: no second power line, no sensor of another device", async ({ page }) => {
      const states = STATES({ "sensor.my_power": st("77", { device_class: "power", unit_of_measurement: "W" }) });
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug", attached: ["sensor.my_power"] }));
      await boot(page, layout, states, { view });
      await tap(page, indexOf(layout, "fridge-1"));
      expect(await lines(page)).toEqual(["Running", "77 W", "48.26 kWh"]);
    });
    test("with no registry the piece still works from what is attached", async ({ page }) => {
      const layout = layoutOf(piece("fridge", { entity: "switch.fridge_plug" }));
      await boot(page, layout, STATES(), { view }, null);
      await tap(page, indexOf(layout, "fridge-1"));
      expect(await lines(page)).toEqual(["Idle"]);
    });
    test("a robot out cleaning: 'Cleaning · 63 %', faded and on; docked it is neither; the dock says the same", async ({ page }) => {
      const layout = layoutOf(piece("robot-vacuum", { entity: "vacuum.robo", w: 35, h: 35, x: 480, y: 150 }), piece("robot-dock", { entity: "vacuum.robo", w: 35, h: 15, x: 560, y: 150 }));
      const r = indexOf(layout, "robot-vacuum-1"), d = indexOf(layout, "robot-dock-1");
      await boot(page, layout, STATES(), { view });
      expect(await classes(page, r)).toMatch(/ on\b.* away|away.* on\b/);
      expect(await classes(page, d)).not.toMatch(/ away/);
      expect(await card(page).locator(`css=svg g[data-f="${r}"]`).evaluate((g) => getComputedStyle(g).opacity)).toBe("0.35");
      await tap(page, r);
      expect(await lines(page)).toEqual(["Cleaning · 63 %"]);
      await setStates(page, STATES({ "vacuum.robo": st("docked", { battery_level: 100 }) }));
      expect(await lines(page)).toEqual(["Docked · 100 %"]);
      expect(await classes(page, r)).not.toMatch(/ on\b| away/);
      expect(await card(page).locator(`css=svg g[data-f="${r}"]`).evaluate((g) => getComputedStyle(g).opacity)).toBe("1");
    });
  });
}
