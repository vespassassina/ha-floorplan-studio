import { test, expect, type Page } from "@playwright/test";
import { validate, type Floor, type Layout } from "../../src/core/schema";

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const dev0 = async (page: Page) => (await layoutOf(page)).floors.ground.devices[0] as any;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
const valid = async (page: Page, what: string) => {
  const r = validate(await layoutOf(page));
  expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true);
};

const floorOf = (extra: Partial<Floor>): Floor => ({ title: "Ground", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...extra } as Floor);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg`).first()).toBeVisible();
  await page.evaluate(([tag, f]) => {
    const el = document.querySelector(tag as string) as any;
    el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: f } };
    return el.updateComplete;
  }, [EDITOR, floorOf({
    devices: [
      { id: "dev-light", name: "Lamp", type: "light", entity: "light.lamp", x: 500, y: 400, rot: 0 },
      { id: "dev-switch", name: "Switch", type: "switch", entity: "switch.s", x: 200, y: 200 },
    ] as never,
  })] as const);
  await expect(page.locator(`${EDITOR} g[data-x="0"]`)).toBeVisible();
});

test("Lamp kind selector appears only on lights and exposes kind-specific fields", async ({ page }) => {
  await clickCm(page, 200, 200);
  await expect(page.locator("#vlamp")).toHaveCount(0);

  await clickCm(page, 500, 400);
  await expect(page.locator("#vlamp")).toHaveValue("");

  await page.locator("#vlamp").selectOption("floor");
  await expect(page.locator("#vlampH")).toBeVisible();
  expect((await dev0(page)).lamp).toEqual({ kind: "floor" });
  await valid(page, "floor lamp");

  await page.locator("#vlamp").selectOption("strip");
  await expect(page.locator("#vlampLen")).toBeVisible();
  await expect(page.locator(`${EDITOR} [data-lh="0:strip"]`)).toBeVisible();
  await valid(page, "strip lamp");

  await page.locator("#vlamp").selectOption("ceiling");
  await expect(page.locator("#vlampDia")).toBeVisible();
  await expect(page.locator(`${EDITOR} [data-lh="0:ceiling"]`)).toBeVisible();
  await valid(page, "ceiling lamp");

  await page.locator("#vlamp").selectOption("flood");
  await expect(page.locator("#vlampAng")).toBeVisible();
  await expect(page.locator("#vlampReach")).toBeVisible();
  await expect(page.locator(`${EDITOR} [data-lh="0:flood"]`)).toBeVisible();
  await valid(page, "flood lamp");

  await page.locator("#vtype").selectOption("switch");
  await expect(page.locator("#vlamp")).toHaveCount(0);
  expect((await dev0(page)).lamp).toBeUndefined();
  await valid(page, "retyped to switch");
});

test("Dragging strip and flood handles updates geometry in one undo step", async ({ page }) => {
  await clickCm(page, 500, 400);
  await page.locator("#vlamp").selectOption("flood");
  const handle = page.locator(`${EDITOR} [data-lh="0:flood"]`);
  await expect(handle).toBeVisible();
  const before = JSON.stringify(await layoutOf(page));
  const hb = (await handle.boundingBox())!;
  const top = await page.evaluate(([tag, x, y]) => {
    const e = (document.querySelector(tag as string) as any).shadowRoot.elementFromPoint(x, y);
    return e ? `${e.tagName}:${e.getAttribute("data-lh")}:${e.getAttribute("class")}` : null;
  }, [EDITOR, hb.x + hb.width / 2, hb.y + hb.height / 2] as const);
  expect(top).toBe("circle:0:flood:h");
  const to = await screenOf(page, 700, 400);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();

  const d = await dev0(page);
  expect(d.lamp.reach).toBe(200);
  expect(d.rot).toBe(90);
  await valid(page, "after flood drag");

  await undo(page);
  expect(JSON.stringify(await layoutOf(page))).toBe(before);
});
