import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S22.4 (review U1): with the plan fixed, a rename is refused. The field must show the old name again (it kept the typed
// one, and retyping it after unfixing fired no change), and the refusal must offer the way out in the banner.
// Real typing and real page.mouse clicks (finding 3).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const roomNames = async (page: Page) => (await layoutOf(page)).floors.ground.rooms.map((r) => r.name);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickBox = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("a rename refused by Fix plan snaps back, the banner offers to untick it, and then the same name goes through", async ({ page }) => {
  await expect(page.locator("#fixPlan")).toBeChecked(); // the plan opens fixed
  const c = await screenOf(page, 60, 200); // inside Living
  await page.mouse.click(c.x, c.y);
  const field = page.locator("#rn");
  await expect(field).toHaveValue("Living");

  await field.click();
  await field.press("ControlOrMeta+a");
  await page.keyboard.type("Lounge");
  await page.keyboard.press("Enter");

  await expect(page.locator("#status")).toContainText("plan is fixed");
  await expect(field).toHaveValue("Living"); // the field agrees with the layout
  expect(await roomNames(page)).toContain("Living");
  expect(await roomNames(page)).not.toContain("Lounge");

  const unfix = page.locator(".banner #bannerUnfix");
  await expect(unfix).toHaveText("Untick Fix plan");
  await clickBox(page, ".banner #bannerUnfix");
  await expect(page.locator("#fixPlan")).not.toBeChecked();

  await field.click();
  await field.press("ControlOrMeta+a");
  await page.keyboard.type("Lounge");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("Lounge");
  expect(await roomNames(page)).toContain("Lounge");
  expect(await roomNames(page)).not.toContain("Living");
});

test("a room kind refused by Fix plan snaps back in its select", async ({ page }) => {
  const c = await screenOf(page, 60, 200);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  await page.locator("#rk").selectOption("garden");
  await expect(page.locator("#status")).toContainText("plan is fixed");
  await expect(page.locator("#rk")).toHaveValue("room");
});
