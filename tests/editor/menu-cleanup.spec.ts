import { test, expect, type Page } from "@playwright/test";
import { FURNITURE_SYMBOLS } from "../../src/core";
import { pickUnlinked } from "./menu-helpers";

// S26.17 (Studio review U5, U7, U8): the menus. Real clicks at 1024x768, on the real elements (finding 3).

const MENUS = ["mAdd", "mFloors", "mOpt", "mEdit", "mFile"];
const FURN_LABELS: Record<string, string> = { "patio-wood": "Patio, wood", "patio-concrete": "Patio, concrete" };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
});

const inside = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  expect(b, sel).not.toBeNull();
  expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
  expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(page.viewportSize()!.height);
};

for (const id of MENUS) {
  test(`${id}: the box stays inside the viewport with each of its submenus open in turn`, async ({ page }) => {
    await page.locator(`#${id} > summary`).click();
    await inside(page, `#${id} > .box`);
    const subs = await page.locator(`#${id} > .box > details.sub > summary`).count();
    for (let k = 0; k < subs; k++) {
      await page.locator(`#${id} > .box > details.sub > summary`).nth(k).click();
      await inside(page, `#${id} > .box`);
    }
  });
}

test("a menu box is taller than the room below it only by scrolling: it never runs past the bottom edge", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 220 });
  await page.locator("#mOpt > summary").click();
  await page.locator("#mOpt > .box > details.sub > summary").first().click();
  await inside(page, "#mOpt > .box");
  const scrolls = await page.locator("#mOpt > .box").evaluate((b) => b.scrollHeight > b.clientHeight);
  expect(scrolls).toBe(true);
});

for (const id of ["mAdd", "mOpt"]) {
  test(`${id}: opening a submenu closes its siblings`, async ({ page }) => {
    await page.locator(`#${id} > summary`).click();
    const subs = page.locator(`#${id} > .box > details.sub`);
    const n = await subs.count();
    expect(n).toBeGreaterThan(1);
    for (let k = 0; k < n; k++) {
      await subs.nth(k).locator("> summary").click();
      await expect(page.locator(`#${id} > .box > details.sub[open]`)).toHaveCount(1);
      await expect(subs.nth(k)).toHaveJSProperty("open", true);
    }
  });
}

test("no menu holds a select", async ({ page }) => {
  for (const id of MENUS) {
    await page.locator(`#${id} > summary`).click();
    await expect(page.locator(`#${id} select`)).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("Add holds only buttons and submenus", async ({ page }) => {
  await page.locator("#mAdd > summary").click();
  const kinds = await page.locator("#mAdd > .box > *").evaluateAll((els) => els.map((e) => (e.tagName === "BUTTON" ? "button" : e.matches("details.sub") ? "sub" : e.tagName)));
  expect(kinds.length).toBeGreaterThan(4);
  expect(kinds.filter((k) => k !== "button" && k !== "sub")).toEqual([]);
  await expect(page.locator("#mAdd > .box > details.sub#addFurn")).toHaveCount(1);
  await expect(page.locator("#mAdd > .box > details.sub#addUnlDev")).toHaveCount(1);
});

test("Furniture lists every piece by a name with no hyphen, and a click places it", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  await page.locator("#mAdd > summary").click();
  await page.locator("#addFurn > summary").click();
  const labels = await page.locator("#addFurn > button").allTextContents();
  expect(labels).toHaveLength(FURNITURE_SYMBOLS.length);
  for (const l of labels) expect(l, l).not.toMatch(/-/);
  const patio = page.locator("#addFurn-patio-wood");
  await expect(patio).toHaveText(FURN_LABELS["patio-wood"]);
  await page.locator("#addFurn-bed").click();
  expect(await page.evaluate(() => JSON.stringify((document.querySelector("floorplan-studio-editor") as any).layout))).toContain('"symbol":"bed"');
});

test("Unlinked device is a submenu of buttons: a click places the chosen type", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  await page.locator("#mAdd > summary").click();
  await pickUnlinked(page, "heater");
  expect(await page.evaluate(() => JSON.stringify((document.querySelector("floorplan-studio-editor") as any).layout.floors))).toContain('"unlinked":[{');
});

test("the version is under Help, not in View", async ({ page }) => {
  await expect(page.locator("#mOpt #version")).toHaveCount(0);
  await expect(page.locator("#version")).toHaveCount(0);
  await page.locator("#help").click();
  await expect(page.locator("#version")).toContainText(/Floorplan Studio \d+\.\d+\.\d+/);
});

test("View has one Labels submenu holding Device names and Names and values", async ({ page }) => {
  await page.locator("#mOpt > summary").click();
  await expect(page.locator("#mOpt > .box > #names, #mOpt > .box > #labels")).toHaveCount(0);
  await page.locator("#labelsSub > summary").click();
  await expect(page.locator("#labelsSub > #names")).toHaveText("Device names");
  await expect(page.locator("#labelsSub > #labels")).toHaveText("Names and values");
});
