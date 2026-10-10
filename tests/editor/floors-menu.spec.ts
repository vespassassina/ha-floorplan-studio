import { test, expect, type Page } from "@playwright/test";

// S27.9: the Floors menu, and Draw folded into Add. Real clicks at 1024x768, on the real elements (finding 3).

const EDITOR = "floorplan-studio-editor";
const DRAW: [string, string[]][] = [
  ["drawOpening", ["addOpenings"]],
  ...["wall", "boundary", "external", "fence", "edge", "parapet"].map((k): [string, string[]] => [`drawWall-${k}`, ["addWallSub", "drawWallSub"]]),
  ...["drawRoom", "drawZone", "drawWater", "drawOutline", "drawExtra"].map((i): [string, string[]] => [i, ["addAreas"]]),
];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

const isOpen = (page: Page, sel: string) => page.locator(sel).evaluate((e) => (e as HTMLDetailsElement).open);
async function openMenu(page: Page, id: string, subs: string[] = []) {
  if (!(await isOpen(page, `#${id}`))) await page.locator(`#${id} > summary`).click();
  for (const s of subs) if (!(await isOpen(page, `#${s}`))) await page.locator(`#${s} > summary`).click();
}

test("the toolbar reads Add, Floors, View, Edit, File: there is no Draw menu", async ({ page }) => {
  await expect(page.locator("details.menu > summary")).toHaveText(["Add", "Floors", "View", "Edit", "File"]);
  await expect(page.locator("#mDraw")).toHaveCount(0);
  await expect(page.locator("#mEdit #addFloor")).toHaveCount(0);
});

test("the Floors menu holds Add floor, Align to floor below, Move up, Move down, Delete floor, in that order, inside the window", async ({ page }) => {
  await openMenu(page, "mFloors");
  const items = await page.locator("#mFloors > .box > button").evaluateAll((b) => b.map((x) => [x.id, (x.textContent ?? "").trim()]));
  expect(items).toEqual([["addFloor", "Add floor"], ["alignFloor", "Align to floor below…"], ["mFloorUp", "Move up"], ["mFloorDown", "Move down"], ["mFloorDel", "Delete floor…"]]);
  const b = (await page.locator("#mFloors > .box").boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(1024);
  expect(b.y + b.height).toBeLessThanOrEqual(768);
});

test("Align is disabled on the lowest floor and says why; on a higher floor it is enabled", async ({ page }) => {
  await openMenu(page, "mFloors");
  await expect(page.locator("#alignFloor")).toBeDisabled();
  await expect(page.locator("#alignFloor")).toHaveAttribute("title", /lowest floor/i);
  await page.locator("#mFloors > summary").click();
  await page.locator('.chip[data-f="first"]').click();
  await openMenu(page, "mFloors");
  await expect(page.locator("#alignFloor")).toBeEnabled();
  await expect(page.locator("#alignFloor")).not.toHaveAttribute("title", /lowest floor/i);
});

test("Move up, Move down and Delete floor act on the current floor with real clicks", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  const keys = () => page.locator(".bar .chip[data-f]").evaluateAll((c) => c.map((x) => (x as HTMLElement).dataset.f));
  expect(await keys()).toEqual(["ground", "first", "test"]);
  await page.locator('.chip[data-f="first"]').click();
  await openMenu(page, "mFloors");
  await page.locator("#mFloorUp").click();
  expect(await keys()).toEqual(["ground", "test", "first"]);
  await expect(page.locator("#mFloors")).toHaveJSProperty("open", false);
  await openMenu(page, "mFloors");
  await expect(page.locator("#mFloorUp")).toBeDisabled(); // first is now the top floor
  await page.locator("#mFloorDown").click();
  expect(await keys()).toEqual(["ground", "first", "test"]);
  await openMenu(page, "mFloors");
  await page.locator("#mFloorDel").click();
  await expect(page.locator("#fconfirm")).toBeVisible(); // the panel asks; nothing is deleted yet
  expect(await keys()).toEqual(["ground", "first", "test"]);
  await page.locator("#fdelyes").click();
  expect(await keys()).toEqual(["ground", "test"]);
});

test("Add floor from the Floors menu opens the title input", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  await openMenu(page, "mFloors");
  await page.locator("#addFloor").click();
  await expect(page.locator("#newFloor")).toBeFocused();
});

for (const [id, subs] of DRAW) {
  test(`${id} opens from Add and starts drawing`, async ({ page }) => {
    await page.locator("#fixPlan").uncheck();
    await openMenu(page, "mAdd", subs);
    await page.locator(`#${id}`).click();
    await expect(page.locator(`${EDITOR} svg.drawing`)).toHaveCount(1);
    await expect(page.locator("#mAdd")).toHaveJSProperty("open", false);
  });
}

test("Add holds every former Draw button, and Draw nothing else", async ({ page }) => {
  const ids = await page.locator("#mAdd button").evaluateAll((b) => b.map((x) => x.id).filter((i) => i.startsWith("draw")));
  expect(new Set(ids)).toEqual(new Set(DRAW.map(([i]) => i)));
  expect(ids.length).toBe(DRAW.length);
});
