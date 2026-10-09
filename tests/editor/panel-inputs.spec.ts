import { test, expect, type Page } from "@playwright/test";
import { pickFurniture } from "./menu-helpers";

// Diego, 2026-10-07: the Appearance boxes of a furniture piece threw away what he typed, and the height box had no
// up/down buttons. The editor re-renders on a 1 s timer while a motion sensor fades and on every Home Assistant
// update; a re-render must never overwrite a box that has focus.

const EDITOR = "floorplan-studio-editor";
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);
const rerender = (page: Page) => page.evaluate(async (tag) => { const e = document.querySelector(tag) as any; e.requestUpdate(); await e.updateComplete; }, EDITOR);

async function addBed(page: Page) {
  await page.locator(`details.menu > summary:text-is("Add")`).click();
  await pickFurniture(page, "bed");
  await expect(page.locator("#fw")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("a re-render does not overwrite what is being typed in the width box", async ({ page }) => {
  await addBed(page);
  const box = page.locator("#fw");
  await box.click();
  await box.fill("123");
  await rerender(page);
  await rerender(page);
  await expect(box).toHaveValue("123");
  await box.press("Enter");
  await expect(box).toHaveValue("123");
  expect(JSON.parse(await layoutJson(page)).floors.ground.furniture.at(-1).w).toBe(123);
});

test("an unfocused width box shows the layout value again after the field is committed and undone", async ({ page }) => {
  await addBed(page);
  const w0 = await page.locator("#fw").inputValue();
  await page.locator("#fw").fill("222");
  await page.locator("#fw").press("Enter");
  await page.locator("#fh").click(); // focus leaves the width box
  await expect(page.locator("#fw")).toHaveValue("222"); // an unfocused box still renders the stored value
  await page.locator(`details.menu > summary:text-is("File")`).click();
  await page.locator("#undo").click();
  expect(JSON.parse(await layoutJson(page)).floors.ground.furniture.at(-1).w).toBe(Number(w0));
});

test("the height box has up and down buttons and the arrow keys; each press is one step of 10 cm from the shown value", async ({ page }) => {
  await addBed(page);
  const box = page.locator("#fuht");
  await expect(box).toHaveAttribute("placeholder", "55");
  await page.locator("#fuht-up").click();
  await expect(box).toHaveValue("65"); // from the default 55
  await page.locator("#fuht-up").click();
  await expect(box).toHaveValue("75");
  await page.locator("#fuht-down").click();
  await expect(box).toHaveValue("65");
  await box.focus();
  await box.press("ArrowUp");
  await expect(box).toHaveValue("75");
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await expect(box).toHaveValue("55");
  expect(JSON.parse(await layoutJson(page)).floors.ground.furniture.at(-1).height).toBe(55);
});

test("the height buttons stop at 0 and at the maximum", async ({ page }) => {
  await addBed(page);
  const box = page.locator("#fuht");
  await box.fill("4");
  await box.press("Enter");
  await page.locator("#fuht-down").click();
  await expect(box).toHaveValue("0");
  await page.locator("#fuht-down").click();
  await expect(box).toHaveValue("0");
  await box.fill("995");
  await box.press("Enter");
  await page.locator("#fuht-up").click();
  await expect(box).toHaveValue("1000");
});

test("a furniture TV hangs at 100 cm by default; bottom is editable; H x W x L is shown; the speaker is a piece too", async ({ page }) => {
  await page.locator(`details.menu > summary:text-is("Add")`).click();
  await pickFurniture(page, "tv");
  const z = page.locator("#fuz");
  await expect(z).toHaveAttribute("placeholder", "100");
  await expect(page.locator("#fusize")).toHaveText("H 60 × W 120 × L 10 cm");
  await page.locator("#fuz-up").click();
  await expect(z).toHaveValue("110");
  expect(JSON.parse(await layoutJson(page)).floors.ground.furniture.at(-1).z).toBe(110);
  await z.fill("0"); await z.press("Enter");
  expect(JSON.parse(await layoutJson(page)).floors.ground.furniture.at(-1).z).toBe(0); // on the floor, by choice
  await page.locator("#fuht").fill("70"); await page.locator("#fuht").press("Enter");
  await expect(page.locator("#fusize")).toHaveText("H 70 × W 120 × L 10 cm");
  await page.locator("#fs").selectOption("speaker");
  await expect(page.locator("#fusize")).toContainText("H 70");
});
