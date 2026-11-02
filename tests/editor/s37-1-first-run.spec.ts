import { test, expect, type Page } from "@playwright/test";
import { haData, type PickerHass } from "../../src/editor/hass-pickers";
import { validate, type Layout } from "../../src/core/schema";

// S37.1 and S37.2: the first-run choice in the Studio, driven with real mouse clicks at real coordinates (finding 3).
// The panel shows it when `floorplan_studio/load` replies { layout: null }; here the standalone page stands in for the panel:
// it is emptied with Reset (the real code path), then given `firstRun` and the HA data a panel would hand it.
// Registry rows have the shape Home Assistant's websocket API sends (see tests/editor/from-areas.test.ts); `haData` reads them.

const EDITOR = "floorplan-studio-editor";
const REG: Record<string, unknown> = {
  "config/area_registry/list": [
    { area_id: "kitchen", name: "Kitchen", floor_id: null, aliases: [], icon: null, picture: null, labels: [] },
    { area_id: "bedroom", name: "Bedroom", floor_id: null, aliases: [], icon: null, picture: null, labels: [] },
    { area_id: "attic", name: "Attic", floor_id: null, aliases: [], icon: null, picture: null, labels: [] },
  ],
  "config/entity_registry/list": [
    { entity_id: "light.kitchen_main", device_id: "d1", area_id: null, platform: "hue", disabled_by: null, entity_category: null, name: null, original_name: "Kitchen light", unique_id: "u1" },
    { entity_id: "sensor.kitchen_temp", device_id: null, area_id: "kitchen", platform: "zha", disabled_by: null, entity_category: null, name: null, original_name: "Kitchen temp", unique_id: "u2", original_device_class: "temperature" },
    { entity_id: "light.bed", device_id: null, area_id: "bedroom", platform: "hue", disabled_by: null, entity_category: null, name: null, original_name: "Bed lamp", unique_id: "u3" },
  ],
  "config/device_registry/list": [{ id: "d1", area_id: "kitchen", name: "Hue lamp", name_by_user: null }],
  "config/floor_registry/list": [],
};
const HASS: PickerHass = {
  states: { "light.kitchen_main": { state: "on", attributes: {} }, "sensor.kitchen_temp": { state: "21", attributes: { device_class: "temperature" } }, "light.bed": { state: "off", attributes: {} } },
  callWS: async <T,>({ type }: { type: string }) => REG[type] as T,
};

type D = { entity: string; type: string; x: number; y: number };
const devs = (f: { devices: unknown[] }) => f.devices as D[];
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const histLen = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const doors = (page: Page) => page.locator(`${EDITOR} .firstrun`);
/** A real click at the middle of the element, by coordinates. */
async function click(page: Page, sel: string) {
  const loc = page.locator(sel);
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };

/** A blank plan, as the panel hands it over when nothing is stored: Reset, then firstRun and the HA data. */
async function boot(page: Page, opts: { ha?: boolean } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  page.once("dialog", (d) => void d.accept());
  await page.evaluate((tag) => (document.querySelector(tag) as any).reset(), EDITOR);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
  const ha = opts.ha === false ? undefined : await haData(HASS);
  await page.evaluate(([tag, h]) => { const el = document.querySelector(tag as string) as any; el.ha = h; el.firstRun = true; }, [EDITOR, ha] as const);
}

test("the standalone page on a saved plan shows no first-run choice", async ({ page }) => {
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(doors(page)).toHaveCount(0);
});

test("a blank plan with firstRun shows three choices", async ({ page }) => {
  await boot(page);
  await expect(doors(page)).toBeVisible();
  await expect(page.locator(`${EDITOR} .firstrun button`)).toHaveText(["Load the demo", "Start from your Home Assistant areas", "Blank"]);
});

test("Blank closes the choice and leaves the empty plan, no undo step", async ({ page }) => {
  await boot(page);
  const before = await histLen(page);
  await click(page, `${EDITOR} .firstrun #frBlank`);
  await expect(doors(page)).toHaveCount(0);
  expect(await histLen(page)).toBe(before);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
});

test("Load the demo does what File, Load demo does, in one undo step, and Undo brings the blank plan back", async ({ page }) => {
  await boot(page);
  const before = await histLen(page);
  await click(page, `${EDITOR} .firstrun #frDemo`);
  await expect(doors(page)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await histLen(page)).toBe(before + 1);
  const l = await layoutOf(page);
  expect(validate(l).ok).toBe(true);
  expect(Object.keys(l.floors).length).toBeGreaterThan(1); // demo/home.json: a basement and two floors
  await undo(page);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
});

test("Start from your Home Assistant areas draws a room per area that has a drawable entity, one undo step, valid", async ({ page }) => {
  await boot(page);
  const before = await histLen(page);
  await click(page, `${EDITOR} .firstrun #frAreas`);
  await expect(doors(page)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(2); // Attic has nothing: skipped
  expect(await histLen(page)).toBe(before + 1);
  const l = await layoutOf(page);
  expect(validate(l).ok).toBe(true);
  const f = l.floors.ground;
  expect(f.rooms.map((r) => r.area)).toEqual(["bedroom", "kitchen"]);
  const kitchen = f.rooms.find((r) => r.area === "kitchen")!;
  // the lamp sits in the kitchen through its device, the sensor through its own area
  expect(devs(f).filter((d) => d.x >= kitchen.pts[0][0] && d.x <= kitchen.pts[2][0] && d.y >= kitchen.pts[0][1] && d.y <= kitchen.pts[2][1]).map((d) => d.entity).sort()).toEqual(["light.kitchen_main", "sensor.kitchen_temp"]);
  expect(l.catalog.map((c) => c.room).sort()).toEqual(["Bedroom", "Kitchen", "Kitchen"]);
  // the user can drag a corner afterwards: the plan is not locked
  expect(await page.locator("#fixPlan").isChecked()).toBe(false);
  await undo(page);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
  expect(devs((await layoutOf(page)).floors.ground)).toHaveLength(0);
});

test("without Home Assistant the areas choice is disabled, with a tooltip, and does nothing", async ({ page }) => {
  await boot(page, { ha: false });
  const b = page.locator(`${EDITOR} .firstrun #frAreas`);
  await expect(b).toBeDisabled();
  expect(await b.getAttribute("title")).toBeTruthy();
  const before = await histLen(page);
  const box = (await b.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(doors(page)).toBeVisible();
  expect(await histLen(page)).toBe(before);
});

test("areas with nothing the plan can draw change nothing and say so", async ({ page }) => {
  await boot(page);
  await page.evaluate((tag) => { (document.querySelector(tag) as any).ha = { floors: [], areas: [{ id: "a", name: "A" }], entities: [] }; }, EDITOR);
  const before = await histLen(page);
  await click(page, `${EDITOR} .firstrun #frAreas`);
  await expect(page.locator(`${EDITOR} #status`)).toContainText("anything the plan can draw");
  expect(await histLen(page)).toBe(before);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
});

test("drawing something by hand closes the choice", async ({ page }) => {
  await boot(page);
  await expect(doors(page)).toBeVisible();
  // The Draw room tool, then real clicks on the canvas: three corners and Enter (a gesture a person makes), not st.edit.
  await page.evaluate((tag) => (document.querySelector(tag) as any).startDraw("wall"), EDITOR);
  const c = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
  const x = c.x + c.width / 2 - 200, y = c.y + c.height / 2 - 100;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 300, y);
  await page.mouse.click(x + 300, y + 200);
  await page.keyboard.press("Enter");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.f.walls.length as number, EDITOR)).toBeGreaterThan(0);
  await expect(doors(page)).toHaveCount(0);
});

test("the disabled areas button says why: no Home Assistant, or Home Assistant with no areas", async ({ page }) => {
  await boot(page, { ha: false });
  const b = page.locator(`${EDITOR} .firstrun #frAreas`);
  const noHa = await b.getAttribute("title");
  expect(noHa).toContain("Needs Home Assistant");
  const empty = await haData({ states: {}, callWS: async <T,>() => [] as T });
  await page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, empty] as const);
  await expect(b).toBeDisabled();
  const noAreas = await b.getAttribute("title");
  expect(noAreas).not.toContain("Needs Home Assistant");
  expect(noAreas).toContain("no areas");
  expect(noAreas).not.toBe(noHa);
});
