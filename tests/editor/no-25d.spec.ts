import { test, expect } from "@playwright/test";

// S12.1: the editor has no 2.5D. Real DOM, real Chromium: the View menu has no plan-view select, tilt or walls select,
// no preview note, and an old stored 2.5D view opens flat. The card keeps 2.5D (tests/card).

const EDITOR = "floorplan-studio-editor";
const KEY = "floorplan-studio:view";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("the View menu has no plan view, tilt or walls control, and no 2.5D text anywhere in the editor", async ({ page }) => {
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator('details.menu > summary:text-is("View")').click();
  await expect(page.locator("details#mOpt")).toHaveAttribute("open", "");
  for (const id of ["#view-mode", "#tilt", "#walls", "#previewNote"]) await expect(page.locator(id), id).toHaveCount(0);
  const text = await page.evaluate((tag) => document.querySelector(tag)!.shadowRoot!.textContent ?? "", EDITOR);
  expect(text).not.toMatch(/2\.5D/i);
  expect(text).not.toMatch(/Plan view/i);
});

test("a stored 2.5D view, tilt and wall mode open flat: no wall sides, no solids, no preview", async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k!, JSON.stringify({ v: 1, mode: "2.5d", tilt: 0.9, walls: "full", rotation: 45 })), [KEY]);
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await page.locator("svg .ws, svg g.dsolid, svg line.stem").count()).toBe(0);
  // Still editable: a click on the plan is not swallowed by a read-only preview, and the edit menus are not inert.
  expect(await page.locator("#mAdd").evaluate((el) => el.hasAttribute("inert"))).toBe(false);
  await expect(page.locator("#reset")).toBeEnabled();
  // The rest of the old entry still applies: the turn survived.
  expect(await page.evaluate((tag) => document.querySelector(tag)!.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform") ?? "", EDITOR)).toMatch(/^rotate\(45/);
  // The entry is rewritten without the 2.5D fields at the next view change (here a zoom), not before.
  await page.locator("#zin").click();
  await page.waitForTimeout(400);
  const stored = await page.evaluate((k) => localStorage.getItem(k) ?? "", KEY);
  expect(stored).not.toContain("2.5d");
  expect(stored).not.toContain("tilt");
});

test("junk in the stored mode and tilt does not stop the editor", async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k!, '{"mode":5,"tilt":"x","walls":["full"],"zooms":"no"}'), [KEY]);
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await page.locator("svg .ws").count()).toBe(0);
});
