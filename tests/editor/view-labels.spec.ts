import { test, expect, type Page } from "@playwright/test";

// The editor's View > Show names and text toggle. Every pointer action goes through
// page.mouse at real screen coordinates (CLAUDE.md finding 3): a test that dispatched events on the inner element
// would pass while the real click did something else.

const EDITOR = "floorplan-studio-editor";
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("View > Show names and text: off removes every <text> from the plan, icons and clicks stay, it is no undo step", async ({ page }) => {
  const before = await layoutJson(page);
  await page.locator('details.menu > summary:text-is("View")').click();
  const t = page.locator("#labels");
  await expect(t).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("svg text.lbl:not(.mg-n)").count()).toBeGreaterThan(0);
  await t.click();
  await expect(t).toHaveAttribute("aria-pressed", "false");
  expect(await page.locator("svg text.lbl:not(.mg-n), svg text.val").count()).toBe(0);
  const icons = await page.locator("svg g[data-x]").count();
  expect(icons).toBeGreaterThan(0);
  await page.locator('details.menu > summary:text-is("View")').click();
  await dragOn(page, "svg g[data-x]", 60, 40); // a real drag on the icon still moves it
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  expect(await layoutJson(page)).toBe(before);
  expect(await page.locator("svg text.lbl:not(.mg-n), svg text.val").count()).toBe(0); // and undo did not bring the text back
  await page.locator('details.menu > summary:text-is("View")').click();
  await t.click();
  expect(await page.locator("svg text.lbl:not(.mg-n)").count()).toBeGreaterThan(0);
});
