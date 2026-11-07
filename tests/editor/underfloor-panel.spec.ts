import { test, expect, type Page } from "@playwright/test";
import { DEVICE_TYPES, validate, type Floor, type Layout } from "../../src/core/schema";

// B54.4: the Underfloor box of the Studio's device panel, with a real click. Shown for a climate and a heater only; one undo step for a tick,
// one for an untick, none for an unchanged state; leaving climate and heater takes `underfloor` along; the layout validates throughout.
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const deviceOf = async (page: Page) => (await layoutOf(page)).floors.ground.devices[0] as unknown as Record<string, unknown>;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const click = async (page: Page, sel: string) => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = (await page.locator(sel).boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
const valid = async (page: Page, what: string) => { const r = validate(await layoutOf(page)); expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true); };
const floorOf = (devices: unknown[]): Floor => ({ title: "Ground", outline: [[0, 0], [1200, 0], [1200, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices, furniture: [], unlinked: [] } as unknown as Floor);
const DEVICE = { id: "device-ground-1", type: "climate", entity: "climate.floor", x: 500, y: 400, name: "Floor loop" };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg`).first()).toBeVisible();
  await page.evaluate(([tag, f]) => {
    const el = document.querySelector(tag as string) as any;
    el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: f } };
  }, [EDITOR, floorOf([DEVICE])] as const);
  await clickCm(page, 500, 400);
  await expect(page.locator("#vtype")).toBeVisible();
});

test("Underfloor shows for a climate and a heater and for no other type", async ({ page }) => {
  for (const t of DEVICE_TYPES) {
    await page.locator("#vtype").selectOption(t);
    await expect(page.locator("#vunderfloor"), t).toHaveCount(t === "climate" || t === "heater" ? 1 : 0);
  }
});

test("a tick is one undo step, an untick removes the key, and the layout validates", async ({ page }) => {
  expect(await deviceOf(page)).not.toHaveProperty("underfloor");
  await click(page, "#vunderfloor");
  expect((await deviceOf(page)).underfloor).toBe(true);
  await valid(page, "ticked");
  await undo(page);
  expect(await deviceOf(page)).not.toHaveProperty("underfloor"); // one Undo, all the way back
  await clickCm(page, 500, 400);
  await click(page, "#vunderfloor");
  await click(page, "#vunderfloor");
  expect(await deviceOf(page)).not.toHaveProperty("underfloor");
  await valid(page, "unticked");
  await undo(page);
  expect((await deviceOf(page)).underfloor).toBe(true); // the untick was one step of its own
});

test("an unchanged state is no step: the same value fired again changes nothing", async ({ page }) => {
  const before = JSON.stringify(await layoutOf(page));
  await page.locator("#vunderfloor").evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true }))); // still unticked
  expect(JSON.stringify(await layoutOf(page))).toBe(before);
  await undo(page);
  expect(JSON.stringify(await layoutOf(page))).toBe(before);
});

test("leaving climate and heater takes underfloor along; between the two it stays", async ({ page }) => {
  await click(page, "#vunderfloor");
  await page.locator("#vtype").selectOption("heater");
  expect((await deviceOf(page)).underfloor).toBe(true);
  await valid(page, "a heater");
  await page.locator("#vtype").selectOption("light");
  expect(await deviceOf(page)).not.toHaveProperty("underfloor");
  await valid(page, "a light");
});
