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

// Opus review of Sprint 22: writers outside `edit` (paint, the floor writers, the plan rotation, add floor, add stairs)
// were refused without a word, so the colour input snapped back silently. Each must raise the same banner.
const banner = (page: Page) => page.locator(".banner #bannerUnfix");
const openEdit = (page: Page) => clickBox(page, "#mEdit > summary");

test("a colour swatch refused by Fix plan leaves the room as it was and offers to untick Fix plan", async ({ page }) => {
  const c = await screenOf(page, 60, 200); // inside Living
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rn")).toHaveValue("Living");
  const before = (await layoutOf(page)).floors.ground.rooms.find((r) => r.name === "Living")!;
  const sw = page.locator('#panel .swatches[aria-label="Colours"] button.sw').nth(2);
  await sw.scrollIntoViewIfNeeded(); // the room panel is long; the swatches may sit below the fold
  const b = (await sw.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(banner(page)).toBeVisible();
  const after = (await layoutOf(page)).floors.ground.rooms.find((r) => r.name === "Living")!;
  expect(after.color).toBe(before.color);
  expect(after.texture).toBe(before.texture);
});

test("a floor rename refused by Fix plan snaps back and offers to untick Fix plan", async ({ page }) => {
  await expect(page.locator("#ft")).toHaveValue("Ground");
  await clickBox(page, "#ft");
  await page.locator("#ft").press("ControlOrMeta+a");
  await page.keyboard.type("Loft");
  await page.keyboard.press("Enter");
  await expect(banner(page)).toBeVisible();
  await expect(page.locator("#ft")).toHaveValue("Ground");
  expect((await layoutOf(page)).floors.ground.title).toBe("Ground");
});

test("moving a floor refused by Fix plan keeps the order and offers to untick Fix plan", async ({ page }) => {
  await clickBox(page, "#fup");
  await expect(banner(page)).toBeVisible();
  expect(Object.keys((await layoutOf(page)).floors)).toEqual(["ground", "first", "test"]);
});

test("deleting a floor refused by Fix plan keeps it and offers to untick Fix plan", async ({ page }) => {
  await clickBox(page, "#fdel");
  await clickBox(page, "#fdelyes");
  await expect(banner(page)).toBeVisible();
  expect(Object.keys((await layoutOf(page)).floors)).toEqual(["ground", "first", "test"]);
});

test("rotating the plan refused by Fix plan keeps the angle and offers to untick Fix plan", async ({ page }) => {
  await openEdit(page);
  await clickBox(page, "#rotr");
  await expect(banner(page)).toBeVisible();
  expect((await layoutOf(page)).rotate ?? 0).toBe(0);
  await expect(page.locator("#rotv")).toContainText("0°");
});

test("adding a floor refused by Fix plan adds nothing and offers to untick Fix plan", async ({ page }) => {
  await openEdit(page);
  await clickBox(page, "#addFloor");
  await expect(page.locator("#newFloor")).toBeFocused();
  await page.keyboard.type("Loft");
  await page.keyboard.press("Enter");
  await expect(banner(page)).toBeVisible();
  expect(Object.keys((await layoutOf(page)).floors)).toEqual(["ground", "first", "test"]);
});

test("adding stairs refused by Fix plan adds none, says so and offers to untick Fix plan", async ({ page }) => {
  const n = (await layoutOf(page)).floors.ground.stairs.length;
  await clickBox(page, "#mAdd > summary");
  await clickBox(page, "#addAreas > summary");
  await clickBox(page, "#addStairs");
  await expect(banner(page)).toBeVisible();
  await expect(page.locator("#status")).not.toContainText("Added stairs");
  expect((await layoutOf(page)).floors.ground.stairs).toHaveLength(n);
});

test("turning furniture with its slider under Fix plan keeps it still and offers to untick Fix plan", async ({ page }) => {
  const c = await screenOf(page, 250, 320); // the sofa
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#frotsl")).toBeVisible();
  if (await banner(page).count()) await clickBox(page, ".banner #bannerClose"); // a press on furniture already warns that it will not move
  await expect(banner(page)).toHaveCount(0);
  await page.locator("#frotsl").scrollIntoViewIfNeeded();
  const b = (await page.locator("#frotsl").boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.75, b.y + b.height / 2); // a click on the track: one input, one change
  await expect(banner(page)).toBeVisible();
  expect((await layoutOf(page)).floors.ground.furniture[0].rot).toBe(0);
  await expect(page.locator("#frotval")).toHaveText("0°");
});
