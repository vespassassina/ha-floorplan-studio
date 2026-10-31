import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S42.5 (spec decision 15, criterion 8): the house range and a room's override in the Studio. The room is picked with a real
// click at real coordinates (CLAUDE.md finding 3). The layout is read back from the editor, so a typed °F is checked as °C.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const type = async (page: Page, sel: string, v: string) => { await page.locator(sel).fill(v); await page.locator(sel).press("Tab"); };
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("house range: min, max and hold are one undo step each, an unchanged value none", async ({ page }) => {
  await expect(page.locator("#hrmin")).toBeVisible();
  const d0 = await undoDepth(page);
  await type(page, "#hrmin", "17"); await type(page, "#hrmax", "26"); await type(page, "#hrhold", "7");
  expect((await layoutOf(page)).tempRange).toEqual({ min: 17, max: 26, hold: 7 });
  expect(await undoDepth(page)).toBe(d0 + 3);
  await type(page, "#hrmin", "17");
  expect(await undoDepth(page)).toBe(d0 + 3);
  await type(page, "#hrmin", ""); await type(page, "#hrmax", ""); await type(page, "#hrhold", "");
  expect((await layoutOf(page)).tempRange).toBeUndefined();
  await expect(page.locator("#hrhold")).toHaveAttribute("placeholder", "5");
});

test("house range refuses what validate refuses, says why, and keeps the old value", async ({ page }) => {
  await type(page, "#hrmin", "17"); await type(page, "#hrmax", "26");
  for (const [sel, bad] of [["#hrmin", "27"], ["#hrmax", "17.5"], ["#hrmax", "warm"], ["#hrhold", "2.5"], ["#hrhold", "500"], ["#hrmin", "-60"]] as const) {
    await type(page, sel, bad);
    expect((await layoutOf(page)).tempRange, `${sel}=${bad}`).toEqual({ min: 17, max: 26 });
    await expect(page.locator(`${EDITOR} #status`)).toContainText(/Kept|stays/);
  }
  await expect(page.locator("#hrmin")).toHaveValue("17");
});

test("fields take Fahrenheit and the layout holds Celsius to 0.1", async ({ page }) => {
  await page.evaluate((tag) => { (document.querySelector(tag) as any).tempUnit = "°F"; }, EDITOR);
  await expect(page.locator("label[for=hrmin]")).toContainText("°F");
  await type(page, "#hrmin", "64.4"); await type(page, "#hrmax", "78");
  expect((await layoutOf(page)).tempRange).toEqual({ min: 18, max: 25.6 });
  await expect(page.locator("#hrmin")).toHaveValue("64.4");
  await expect(page.locator("#hrmax")).toHaveValue("78.1"); // 25.6 °C is 78.08 °F: what is stored is what is shown back
});

test("a room: Use house range off writes {}, own min and max, back on removes it, one step each", async ({ page }) => {
  await clickCm(page, 150, 100);
  await expect(page.locator("#rtrUse")).toBeChecked();
  await expect(page.locator("#rtrmin")).toBeDisabled();
  const d0 = await undoDepth(page);
  await page.locator("#rtrUse").click();
  expect((await layoutOf(page)).floors.ground.rooms[0].tempRange).toEqual({});
  await expect(page.locator("#rtrmin")).toBeEnabled();
  await type(page, "#rtrmin", "18"); await type(page, "#rtrmax", "24");
  expect((await layoutOf(page)).floors.ground.rooms[0].tempRange).toEqual({ min: 18, max: 24 });
  await type(page, "#rtrmax", "18.5"); // gap under 1: refused
  expect((await layoutOf(page)).floors.ground.rooms[0].tempRange).toEqual({ min: 18, max: 24 });
  expect(await undoDepth(page)).toBe(d0 + 3);
  await page.locator("#rtrUse").click();
  expect("tempRange" in (await layoutOf(page)).floors.ground.rooms[0]).toBe(false);
  expect(await undoDepth(page)).toBe(d0 + 4);
});
