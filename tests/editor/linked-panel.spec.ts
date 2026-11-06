import { test, expect, type Page } from "@playwright/test";
import { haData, type PickerHass } from "../../src/editor/hass-pickers";
import { validate, type Floor, type Layout } from "../../src/core/schema";

// B53.11: the Studio's panel for a linked appliance and plant, with real clicks. One undo step each, none for an unchanged value,
// `validate` after every step and after Undo and Redo. The panel reads Home Assistant through `haData` exactly as the
// card's host does; the registry rows below have the shape of `EntityReg` in `src/editor/hass-pickers.ts` (the sender).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const pieceOf = async (page: Page) => (await groundOf(page)).furniture[0] as unknown as Record<string, unknown>;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
const depthOf = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const redo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+Shift+z"); };
const valid = async (page: Page, what: string) => {
  const l = await layoutOf(page), r = validate(l);
  expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
};

/** Does `act`, then Undo and Redo: exactly one step each way, a valid layout throughout. */
async function oneStep(page: Page, what: string, act: () => Promise<void>) {
  const before = JSON.stringify(await layoutOf(page));
  await act();
  const after = JSON.stringify(await layoutOf(page));
  expect(after, `${what}: changed`).not.toBe(before);
  await valid(page, `${what} (done)`);
  await undo(page);
  expect(JSON.stringify(await layoutOf(page)), `${what}: one Undo takes it all back`).toBe(before);
  await redo(page);
  expect(JSON.stringify(await layoutOf(page)), `${what}: Redo`).toBe(after);
  await clickCm(page, 500, 450);
  await expect(page.locator("#fs")).toBeVisible();
}
const REG = [
  { entity_id: "sensor.fern_moisture", device_id: "dev-fern", original_name: "Fern moisture", original_device_class: "moisture" },
  { entity_id: "sensor.fern_battery", device_id: "dev-fern", original_name: "Fern battery", original_device_class: "battery" },
  { entity_id: "sensor.garage_temp", device_id: "dev-house", original_name: "Garage temperature" },
];
const STATES = Object.fromEntries(REG.map((r) => [r.entity_id, { state: "10", attributes: {} }]));
const FAKE_HASS: PickerHass = { states: STATES, callWS: async <T>({ type }: { type: string }) => (type === "config/entity_registry/list" ? REG : type === "config/device_registry/list" ? [{ id: "dev-fern", name: "Fern" }, { id: "dev-house", name: "House" }] : []) as T };
const floorOf = (extra: Partial<Floor>): Floor => ({ title: "Ground", outline: [[0, 0], [1200, 0], [1200, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra } as Floor);
const FERN = { id: "furniture-ground-1", symbol: "plant", x: 500, y: 450, rot: 0, w: 60, h: 60, name: "Fern", entity: "sensor.fern_moisture", attached: ["sensor.fern_battery"] };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg`).first()).toBeVisible();
  const ha = await haData(FAKE_HASS);
  await page.evaluate(([tag, f, h]) => {
    const el = document.querySelector(tag as string) as any;
    el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: f } };
    el.ha = h;
  }, [EDITOR, floorOf({ furniture: [FERN] as never }), ha] as const);
  await clickCm(page, 500, 450);
  await expect(page.locator("#fs")).toBeVisible();
});

test("a plant has the entity, the attach list and the threshold; a sofa has none of them", async ({ page }) => {
  await expect(page.locator("#fuent")).toBeVisible();
  await expect(page.locator("#fuattach")).toBeVisible();
  await expect(page.locator("#fumin")).toBeVisible();
  await page.locator("#fs").selectOption("sofa");
  await expect(page.locator("#fumin")).toHaveCount(0);
  await expect(page.locator("#fuattach")).toHaveCount(0);
  const p = await pieceOf(page);
  expect(p).not.toHaveProperty("attached");
  expect(p).not.toHaveProperty("minMoisture");
  await valid(page, "a sofa");
});

test("an appliance has the list but no threshold; the threshold and the attached ones stay as they should when the symbol changes", async ({ page }) => {
  await page.locator("#fumin").fill("35"); await page.locator("#fumin").press("Enter");
  expect((await pieceOf(page)).minMoisture).toBe(35);
  await page.locator("#fs").selectOption("washer");
  await expect(page.locator("#fuattach")).toBeVisible();
  await expect(page.locator("#fumin")).toHaveCount(0);
  const p = await pieceOf(page);
  expect(p).not.toHaveProperty("minMoisture");
  expect(p.attached).toEqual(["sensor.fern_battery"]);
  await valid(page, "a washer");
});

test("the threshold: one undo step, none when unchanged, a whole percent from 1 to 99, empty removes it", async ({ page }) => {
  await oneStep(page, "35", async () => { await page.locator("#fumin").fill("35"); await page.locator("#fumin").press("Enter"); });
  await page.locator("#fumin").fill("35"); await page.locator("#fumin").press("Enter");
  const before = JSON.stringify(await layoutOf(page)), depth = await depthOf(page);
  await page.locator("#fumin").fill("35"); await page.locator("#fumin").press("Enter");
  expect(JSON.stringify(await layoutOf(page)), "same value: no step").toBe(before);
  expect(await depthOf(page), "same value: the undo stack did not grow").toBe(depth);
  await page.locator("#fumin").fill("36"); await page.locator("#fumin").press("Enter");
  expect(await depthOf(page), "a new value is one step").toBe(depth + 1);
  await page.locator("#fumin").fill("35"); await page.locator("#fumin").press("Enter");
  await page.locator("#fumin").fill("150"); await page.locator("#fumin").press("Enter");
  expect((await pieceOf(page)).minMoisture).toBe(99);
  await page.locator("#fumin").fill("0"); await page.locator("#fumin").press("Enter");
  expect((await pieceOf(page)).minMoisture).toBe(1);
  await page.locator("#fumin").fill("33.6"); await page.locator("#fumin").press("Enter");
  expect((await pieceOf(page)).minMoisture).toBe(34);
  await page.locator("#fumin").fill("abc"); await page.locator("#fumin").press("Enter");
  expect((await pieceOf(page)).minMoisture, "junk refused").toBe(34);
  await page.locator("#fumin").fill(""); await page.locator("#fumin").press("Enter");
  expect(await pieceOf(page)).not.toHaveProperty("minMoisture");
  await valid(page, "cleared");
});
