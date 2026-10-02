import { test, expect, type Page } from "@playwright/test";

// The editor's View > "Plan view" dropdown. 2.5D there is a read-only preview. Every pointer action goes through
// page.mouse at real screen coordinates (CLAUDE.md finding 3): a test that dispatched events on the inner element
// would pass while the real click did something else.

const EDITOR = "floorplan-studio-editor";
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);
const viewBox = (page: Page) => page.locator(`${EDITOR} svg`).first().getAttribute("viewBox");

async function pickView(page: Page, value: "2d" | "2.5d") {
  await page.locator('details.menu > summary:text-is("View")').click();
  await page.locator("#view-mode").selectOption(value);
  await page.locator('details.menu > summary:text-is("View")').click(); // close the menu again, so it covers nothing
}
async function centreOf(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function dragOn(page: Page, selector: string, dx: number, dy: number) {
  const c = await centreOf(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 4 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
/** A point well inside room `i`, away from its icons and its walls. */
async function insideRoom(page: Page, i: number) {
  const b = (await page.locator(`svg polygon[data-r="${i}"]`).boundingBox())!;
  return { x: b.x + b.width * 0.3, y: b.y + b.height * 0.3 };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("View has a Plan view select: 2D by default, 2D and 2.5D", async ({ page }) => {
  await page.locator('details.menu > summary:text-is("View")').click();
  const sel = page.locator("#view-mode");
  await expect(sel).toHaveValue("2d");
  expect(await sel.locator("option").evaluateAll((os) => os.map((o) => [o.getAttribute("value"), o.textContent!.trim()]))).toEqual([["2d", "2D"], ["2.5d", "2.5D"]]);
});

test("2.5D draws the walls up, shows the preview note, shows no handles or selection, and switches back", async ({ page }) => {
  expect(await page.locator("svg .ws").count()).toBe(0);
  await pickView(page, "2.5d");
  expect(await page.locator("svg .ws").count()).toBeGreaterThan(0);
  await expect(page.locator("#panel")).toContainText("2.5D is a preview. Switch to 2D to edit.");
  expect(await page.locator("svg circle.h").count()).toBe(0);
  await pickView(page, "2d");
  expect(await page.locator("svg .ws").count()).toBe(0);
  await expect(page.locator("#panel")).not.toContainText("2.5D is a preview");
});

test("in 2.5D a drag on a device and a click on a room change nothing and add no undo step; the same drag works in 2D", async ({ page }) => {
  const before = await layoutJson(page);
  await expect(page.locator("#undo")).toBeDisabled();

  await pickView(page, "2.5d");
  await dragOn(page, "svg g[data-x]", 60, 40);
  expect(await layoutJson(page)).toBe(before);
  const r = await insideRoom(page, 0);
  await page.mouse.click(r.x, r.y);
  expect(await layoutJson(page)).toBe(before);
  expect(await page.locator("svg .hl").count()).toBe(0); // nothing got selected
  await expect(page.locator("#panel")).toContainText("2.5D is a preview");
  await expect(page.locator("#undo")).toBeDisabled();

  await pickView(page, "2d");
  expect(await layoutJson(page)).toBe(before);
  await dragOn(page, "svg g[data-x]", 60, 40);
  expect(await layoutJson(page)).not.toBe(before); // the same drag, in 2D, moves the device
  await expect(page.locator("#undo")).toBeEnabled();
});

test("in 2.5D Delete, Backspace and Ctrl+Z edit nothing, with a deletable device selected and an undo step waiting", async ({ page }) => {
  // A device dragged in 2D: it is selected (Delete would remove it) and there is a step to undo (Ctrl+Z would revert it).
  await dragOn(page, "svg g[data-x]", 60, 40);
  await expect(page.locator("svg g[data-x].sel")).toHaveCount(1);
  await expect(page.locator("#undo")).toBeEnabled();
  const before = await layoutJson(page);

  await pickView(page, "2.5d");
  await page.locator(EDITOR).focus();
  for (const key of ["Delete", "Backspace", "Control+z", "Meta+z"]) await page.keyboard.press(key);
  expect(await layoutJson(page)).toBe(before);

  await pickView(page, "2d");
  expect(await layoutJson(page)).toBe(before);
  await expect(page.locator("svg g[data-x].sel")).toHaveCount(1); // the selection waited
  await page.keyboard.press("Delete"); // and in 2D the same key does remove it, so the test above could fail
  expect(await layoutJson(page)).not.toBe(before);
});

test("switching to 2.5D and back keeps the selection and the zoom, writes no undo step and adds no view to the layout", async ({ page }) => {
  await page.locator("#zin").click();
  await page.locator("#zin").click();
  const r = await insideRoom(page, 0);
  await page.mouse.click(r.x, r.y);
  await expect(page.locator("svg .hl").first()).toBeVisible();
  const box = await viewBox(page);
  const before = await layoutJson(page);
  const hl = await page.locator("svg .hl").first().getAttribute("points");

  await pickView(page, "2.5d");
  expect(await viewBox(page)).toBe(box);
  await pickView(page, "2d");
  expect(await viewBox(page)).toBe(box);
  expect(await page.locator("svg .hl").first().getAttribute("points")).toBe(hl);
  expect(await layoutJson(page)).toBe(before);
  expect(before).not.toContain("2.5d");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("in 2.5D the Add, Draw and Edit menus and Reset do nothing: they cannot be opened", async ({ page }) => {
  await pickView(page, "2.5d");
  for (const id of ["mAdd", "mDraw", "mEdit"]) {
    expect(await page.locator(`#${id}`).evaluate((el) => el.hasAttribute("inert")), id).toBe(true);
  }
  await expect(page.locator("#reset")).toBeDisabled();
  await pickView(page, "2d");
  for (const id of ["mAdd", "mDraw", "mEdit"]) {
    expect(await page.locator(`#${id}`).evaluate((el) => el.hasAttribute("inert")), id).toBe(false);
  }
});

test("a drawing in progress is dropped when 2.5D is picked, and the plan can still be panned there", async ({ page }) => {
  await page.locator('details.menu > summary:text-is("Draw")').click();
  await page.locator("#drawAreas > summary").click();
  await page.locator("#drawZone").click();
  await expect(page.locator("svg.drawing")).toHaveCount(1);
  const before = await layoutJson(page);
  await pickView(page, "2.5d");
  await expect(page.locator("svg.drawing")).toHaveCount(0);

  await page.locator("#zin").click();
  const box = await viewBox(page);
  const b = (await page.locator("svg").first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await viewBox(page)).not.toBe(box); // panning still works in a preview
  expect(await layoutJson(page)).toBe(before);
});
