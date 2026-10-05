import { test, expect, type Page } from "@playwright/test";
import type { Floor, Layout } from "../../src/core/schema";

// Room panel, Sensors section: the add menu is grouped "<floor> · <room>" with the edited room first, and Remove is a
// round red X button. Every pointer action is a real page.mouse action at real coordinates (CLAUDE.md finding 3).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const center = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  // Asymmetric catalog: the edited room (Living, ground) is the LAST temperature entry, on the FIRST of three floors;
  // the first catalog entries belong to the last floor.
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const add = (id: string, floor: string, room: string) => l.catalog.unshift({ id, floor, room, type: "temp", name: id, entity: `sensor.${id}` });
    add("t_test", "test", "Test room"); add("t_first_bath", "first", "Bathroom"); add("t_kitchen", "ground", "Kitchen"); add("t_nowhere", "ground", "");
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 150, 100); // Living room floor, clear of icons and furniture
  await expect(page.locator("#rtemp")).toBeVisible();
});

test("the add menu is grouped by floor and room, the edited room first", async ({ page }) => {
  await page.locator("#rtemp input").click();
  const heads = await page.locator("#rtemp li.grouphead").allTextContents();
  expect(heads).toEqual(["Ground · Living", "Ground · Kitchen", "Ground · No room", "First · Bedroom", "First · Bathroom", "Test · Test room"]);
  // each option sits under its own heading: the option right after the first heading is Living's sensor
  expect(await page.locator("#rtemp li[role='option'][data-value^='sensor.']").first().getAttribute("data-value")).toBe("sensor.demo_living_temperature");
  await page.keyboard.press("Escape");
  // typing a floor and room still filters by heading
  await page.locator("#rtemp input").fill("first bath");
  expect(await page.locator("#rtemp li[role='option']").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")))).toEqual(["sensor.t_first_bath"]);
  await page.keyboard.press("Escape");
});

test("pick from a lower group, then the red X detaches it in one undo step", async ({ page }) => {
  await page.locator("#rtemp input").click();
  await page.locator("#rtemp li[role='option'][data-value='sensor.t_kitchen']").click();
  expect((await groundOf(page)).rooms[0].temps).toEqual(["sensor.t_kitchen"]);
  const rm = page.locator("#rtemp-rm0");
  await expect(rm).toBeVisible();
  await expect(rm).toHaveAttribute("aria-label", "Remove Kitchen - t_kitchen");
  await expect(rm).toHaveAttribute("title", /Remove/);
  expect((await rm.innerText()).trim()).toBe(""); // an icon, no text
  const c = await center(page, "#rtemp-rm0");
  await page.mouse.click(c.x, c.y);
  expect((await groundOf(page)).rooms[0].temps).toBeUndefined();
  // one undo brings it back: the Remove was a single step
  await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].temps).toEqual(["sensor.t_kitchen"]);
});

test("Opus-style CSS pair: the Remove button is round, red and square, in every editor theme", async ({ page }) => {
  await page.locator("#rtemp input").click();
  await page.locator("#rtemp li[role='option'][data-value='sensor.t_kitchen']").click();
  const read = () => page.locator("#rtemp-rm0").evaluate((el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect(), svg = el.querySelector("svg")?.getBoundingClientRect();
    const [R, G, B] = (s.backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    return { radius: s.borderTopLeftRadius, w: Math.round(r.width), h: Math.round(r.height), R, G, B, color: s.color, icon: svg ? Math.round(svg.width) : 0 };
  });
  const a = await read();
  expect(a.w).toBe(a.h);
  expect(a.w).toBeGreaterThanOrEqual(22);
  expect(a.icon).toBeGreaterThan(8);
  expect(["50%", `${a.w / 2}px`, "9999px"].includes(a.radius) || parseFloat(a.radius) >= a.w / 2).toBe(true);
  expect(a.R).toBeGreaterThan(a.G * 2); expect(a.R).toBeGreaterThan(a.B * 2); // red
  // switch to a dark editor theme and read again
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.st.setTheme("midnight"); el.requestUpdate(); }, EDITOR);
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "midnight");
  const b = await read();
  expect(b.R).toBeGreaterThan(b.G * 2); expect(b.R).toBeGreaterThan(b.B * 2);
  expect(b.w).toBe(b.h);
});
