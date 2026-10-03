import { test, expect, type Page } from "@playwright/test";

// The editor's View > Walls select: enabled in the 2.5D preview only, drives the drawn wall height (read from the
// DOM in real screen coordinates, CLAUDE.md findings 10 and 16), and survives a real reload.

const EDITOR = "floorplan-studio-editor";
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);
async function menu(page: Page, open: boolean) {
  const d = page.locator("details#mOpt");
  if ((await d.evaluate((el) => (el as HTMLDetailsElement).open)) !== open) await page.locator('details.menu > summary:text-is("View")').click();
}
async function pickView(page: Page, value: "2d" | "2.5d") {
  await menu(page, true);
  await page.locator("#view-mode").selectOption(value);
}
async function pickWalls(page: Page, value: string) {
  await menu(page, true);
  await page.locator("#walls").selectOption(value);
}
/** Screen heights of every wall side polygon, tallest first. */
const wallHeights = (page: Page) => page.evaluate((tag) =>
  [...document.querySelector(tag)!.shadowRoot!.querySelectorAll(".canvas > svg polygon.ws")].map((p) => p.getBoundingClientRect().height).sort((a, b) => b - a), EDITOR);
const frontWall = (page: Page) => page.evaluate((tag) => {
  const rects = [...document.querySelector(tag)!.shadowRoot!.querySelectorAll(".canvas > svg polygon.ws")].map((p) => p.getBoundingClientRect());
  return rects.filter((r) => r.width > r.height * 2).sort((a, b) => b.bottom - a.bottom)[0]!.height;
}, EDITOR);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("the Walls select lists the three modes, Cutaway chosen, and is enabled in 2.5D only", async ({ page }) => {
  await menu(page, true);
  const s = page.locator("#walls");
  expect(await s.locator("option").allTextContents()).toEqual(["Full height", "Cutaway", "Low"]);
  await expect(s).toHaveValue("cut");
  await expect(s).toBeDisabled();
  await pickView(page, "2.5d");
  await expect(s).toBeEnabled();
  await expect(page.locator("#tilt")).toBeVisible();
});

test("each mode draws a different front wall, and it is no edit", async ({ page }) => {
  await pickView(page, "2.5d");
  const before = await layoutJson(page);
  await pickWalls(page, "full");
  const full = await frontWall(page);
  await pickWalls(page, "cut");
  const cut = await frontWall(page);
  await pickWalls(page, "low");
  const low = await frontWall(page);
  expect(full).toBeGreaterThan(low + 1);
  expect(cut).toBeCloseTo(low, 0);
  expect((await wallHeights(page))[0]!).toBeGreaterThan(0);
  expect(await layoutJson(page)).toBe(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Full survives a real reload", async ({ page }) => {
  await pickView(page, "2.5d");
  await pickWalls(page, "low");
  const low = (await wallHeights(page))[0]!;
  await pickWalls(page, "full");
  const full = (await wallHeights(page))[0]!;
  expect(full).toBeGreaterThan(low + 1);
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon.ws`).first()).toBeVisible();
  await menu(page, true);
  await expect(page.locator("#walls")).toHaveValue("full");
  expect((await wallHeights(page))[0]!).toBeCloseTo(full, 1);
});

test("a hostile stored mode is Cutaway", async ({ page }) => {
  await pickView(page, "2.5d");
  await pickWalls(page, "full");
  // The editor writes its memory again as the page goes away, so the hostile value is planted as the next page starts.
  await page.addInitScript(() => {
    const k = "floorplan-studio:view";
    if (sessionStorage.getItem("planted")) return;
    sessionStorage.setItem("planted", "1");
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? "{}"), v: 1, mode: "2.5d", walls: "<img src=x>" }));
  });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon.ws`).first()).toBeVisible();
  await menu(page, true);
  await expect(page.locator("#walls")).toHaveValue("cut");
});
