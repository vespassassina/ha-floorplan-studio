import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S22.4 (review U1): with the plan fixed, a refused edit must offer the way out in the banner. S26.3 (U3): the lock holds
// geometry only, so these tests use a door drag as the refused edit, on purpose; a rename used to be one and now goes through.
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

const doorCentre = async (page: Page) => { const b = (await page.locator(`${EDITOR} svg line.door[data-d="0"]`).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const dragDoor = async (page: Page) => {
  const d = await doorCentre(page);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 40, d.y + 30, { steps: 6 });
  await page.mouse.up();
};

test("a door drag refused by Fix plan leaves the door, the banner offers to untick it, and then the same drag goes through", async ({ page }) => {
  await expect(page.locator("#fixPlan")).toBeChecked(); // the plan opens fixed
  const door = async () => (await layoutOf(page)).floors.ground.doors[0];
  const before = await door();
  await dragDoor(page);
  await expect(page.locator("#status")).toContainText("plan is locked");
  expect(await door()).toEqual(before);

  await expect(page.locator(".banner #bannerUnfix")).toHaveText("Unlock");
  await clickBox(page, ".banner #bannerUnfix");
  await expect(page.locator("#fixPlan")).not.toBeChecked();

  await dragDoor(page);
  expect(await door()).not.toEqual(before);
});

test("under Fix plan a room rename goes through: the field keeps the new name, no banner, one undo step", async ({ page }) => {
  await expect(page.locator("#fixPlan")).toBeChecked();
  const c = await screenOf(page, 60, 200); // inside Living
  await page.mouse.click(c.x, c.y);
  const field = page.locator("#rn");
  await expect(field).toHaveValue("Living");
  await field.click();
  await field.press("ControlOrMeta+a");
  await page.keyboard.type("Lounge");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("Lounge");
  expect(await roomNames(page)).toContain("Lounge");
  expect(await roomNames(page)).not.toContain("Living");
  await expect(page.locator(".banner #bannerUnfix")).toHaveCount(0);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await roomNames(page)).toContain("Living");
});

test("a room kind refused by Fix plan snaps back in its select", async ({ page }) => {
  const c = await screenOf(page, 60, 200);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  await page.locator("#rk").selectOption("garden");
  await expect(page.locator("#status")).toContainText("plan is locked");
  await expect(page.locator("#rk")).toHaveValue("room");
});

// Opus review of Sprint 22: writers outside `edit` (paint, the floor writers, the plan rotation, add floor, add stairs)
// were refused without a word, so the colour input snapped back silently. Each must raise the same banner.
const banner = (page: Page) => page.locator(".banner #bannerUnfix");
const openEdit = (page: Page) => clickBox(page, "#mEdit > summary");

test("under Fix plan a colour swatch paints the room, and no banner appears", async ({ page }) => {
  const c = await screenOf(page, 60, 200); // inside Living
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rn")).toHaveValue("Living");
  const before = (await layoutOf(page)).floors.ground.rooms.find((r) => r.name === "Living")!;
  const sw = page.locator('#panel .swatches[aria-label="Colours"] button.sw').nth(2);
  await sw.scrollIntoViewIfNeeded(); // the room panel is long; the swatches may sit below the fold
  const b = (await sw.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const after = (await layoutOf(page)).floors.ground.rooms.find((r) => r.name === "Living")!;
  expect(after.color).toBeTruthy();
  expect(after.color).not.toBe(before.color);
  await expect(banner(page)).toHaveCount(0);
});

test("under Fix plan a floor rename goes through and no banner appears", async ({ page }) => {
  await expect(page.locator("#ft")).toHaveValue("Ground");
  await clickBox(page, "#ft");
  await page.locator("#ft").press("ControlOrMeta+a");
  await page.keyboard.type("Loft");
  await page.keyboard.press("Enter");
  await expect(page.locator("#ft")).toHaveValue("Loft");
  expect((await layoutOf(page)).floors.ground.title).toBe("Loft");
  await expect(banner(page)).toHaveCount(0);
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
  await clickBox(page, "#mFloors > summary");
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

// Opus re-check: `planBlocked` went stale. After a lock refusal and Untick Fix plan, an empty floor title was refused for
// its own reason, and the banner still said the plan was fixed while the box was unticked. The refusal is a floor move now.
test("after Untick Fix plan, an empty or unchanged floor title is not blamed on the lock", async ({ page }) => {
  const ft = page.locator("#ft");
  const enter = async (text: string) => {
    await clickBox(page, "#ft");
    await ft.press("ControlOrMeta+a");
    if (text) await page.keyboard.type(text); else await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
  };
  await clickBox(page, "#fup");
  await expect(banner(page)).toBeVisible();
  await clickBox(page, ".banner #bannerUnfix");
  await expect(page.locator("#fixPlan")).not.toBeChecked();
  await enter("");
  await expect(ft).toHaveValue("Ground");
  await enter("  Ground  ");
  await expect(ft).toHaveValue("Ground");
  await expect(page.locator(".banner #bannerUnfix")).toHaveCount(0);
  await expect(page.getByText("plan is locked")).toHaveCount(0);
});

// Opus re-check nit: a refused slider warned on every input tick of a drag. One drag, one warning.
test("dragging the furniture slider under Fix plan warns once, not on every tick", async ({ page }) => {
  const c = await screenOf(page, 250, 320); // the sofa
  await page.mouse.click(c.x, c.y);
  if (await banner(page).count()) await clickBox(page, ".banner #bannerClose");
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, orig = el.planFixed.bind(el);
    el.__warned = 0;
    el.planFixed = () => { el.__warned++; return orig(); };
  }, EDITOR);
  const sl = page.locator("#frotsl");
  await sl.scrollIntoViewIfNeeded();
  const b = (await sl.boundingBox())!, y = b.y + b.height / 2;
  await page.mouse.move(b.x + 4, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(b.x + 4 + (b.width - 8) * k / 8, y);
  await page.mouse.up();
  await expect(banner(page)).toBeVisible();
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).__warned, EDITOR)).toBe(1);
  expect((await layoutOf(page)).floors.ground.furniture[0].rot).toBe(0);
});
