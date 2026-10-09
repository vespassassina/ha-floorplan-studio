import { test, expect, type Page } from "@playwright/test";
import { GUIDE_STEPS, guideControls } from "../../src/editor/guide";

// S26.19 (Studio review U2): "Fix plan" was a red pill with an emoji lock, loud for a state that is the normal one. Now a
// neutral toggle with a drawn lock; the warning colour shows only when the pointer is on it.

const EDITOR = "floorplan-studio-editor";
const LABEL = `${EDITOR} label.lockplan`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

/** The colour a custom property resolves to, as the browser writes it for a background (so it compares with computed styles). */
const resolved = (page: Page, v: string) => page.locator(LABEL).evaluate((el, name) => {
  const probe = document.createElement("span"); probe.style.background = `var(${name})`; el.append(probe);
  const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
}, v);
const bg = (page: Page) => page.locator(LABEL).evaluate((el) => getComputedStyle(el).backgroundColor);

test("locked: the toggle reads Plan locked, draws a lock, and is neither the danger colour nor the old red", async ({ page }) => {
  const label = page.locator(LABEL);
  await expect(label).toHaveClass(/\bon\b/);
  await expect(label).toContainText("Plan locked");
  expect(await label.textContent()).not.toMatch(/\p{Extended_Pictographic}/u);
  await expect(label.locator("svg")).toHaveCount(1);
  await page.mouse.move(5, 5);
  const on = await bg(page);
  expect(on).not.toBe(await resolved(page, "--fp-danger"));
  expect(on).not.toBe("rgb(192, 57, 43)");
  expect(on).not.toBe("rgba(0, 0, 0, 0)"); // locked is visibly a set state
});

test("editable: the toggle reads Plan editable on a clear background, with the open lock", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  const label = page.locator(LABEL);
  await expect(label).toContainText("Plan editable");
  await expect(label).not.toHaveClass(/\bon\b/);
  await page.mouse.move(5, 5);
  expect(await bg(page)).toBe("rgba(0, 0, 0, 0)");
  await expect(label.locator("svg")).toHaveCount(1);
});

test("the two states draw two different locks", async ({ page }) => {
  const d = () => page.locator(`${LABEL} svg path`).getAttribute("d");
  const locked = await d();
  await page.locator("#fixPlan").uncheck();
  expect(await d()).not.toBe(locked);
});

test("the warning colour shows on hover and only then", async ({ page }) => {
  const warn = await resolved(page, "--fp-warn");
  await page.mouse.move(5, 5);
  expect(await bg(page)).not.toBe(warn);
  const b = (await page.locator(LABEL).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => bg(page)).toBe(warn);
  await page.mouse.move(5, 5);
  await expect.poll(() => bg(page)).not.toBe(warn);
});

test("the checkbox keeps one name, Lock plan, and its state; a real click on the pill unlocks and locks", async ({ page }) => {
  const box = page.getByRole("checkbox", { name: "Lock plan" });
  await expect(box).toBeChecked();
  const b = (await page.locator(LABEL).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(box).not.toBeChecked();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(box).toBeChecked();
});

test("no label says Fix on the toggle, and the guide step names the toggle by the words on it", async ({ page }) => {
  expect(await page.locator(LABEL).textContent()).not.toMatch(/\bfix/i);
  expect(await page.locator(LABEL).getAttribute("title")).not.toMatch(/\bfix/i);
  expect(guideControls(GUIDE_STEPS.slice(0, 1))).toEqual(["Plan locked"]);
  expect(GUIDE_STEPS[0].body).not.toMatch(/\bfix/i);
});
