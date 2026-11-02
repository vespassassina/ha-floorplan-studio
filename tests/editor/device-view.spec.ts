import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S40.3 (spec C12, criterion 11): the device panel's "Dashboard view" field. Real keyboard input into the real
// field; the stored layout and the undo depth are read back from the editor.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const dev0 = async (page: Page) => (await layoutOf(page)).floors.ground.devices[0] as { view?: string };
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const select = (page: Page, i: number) => page.evaluate(([tag, n]) => { const el = document.querySelector(tag as string) as any; el.st.sel = { t: "dev", i: n }; el.requestUpdate(); }, [EDITOR, i] as const);

async function type(page: Page, v: string) {
  const box = page.locator("#vview");
  await box.click();
  await box.press("ControlOrMeta+a");
  if (v) await page.keyboard.type(v); else await page.keyboard.press("Delete");
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await select(page, 0);
});

test("the field sits under the entity with its label, placeholder and tooltip", async ({ page }) => {
  const box = page.locator("#vview");
  await expect(box).toBeVisible();
  await expect(page.locator('label[for="vview"]')).toHaveText("Dashboard view");
  await expect(box).toHaveAttribute("placeholder", "/lovelace/…");
  await expect(box).toHaveAttribute("title", /instead of the popup/);
  const ve = await page.locator("#ve").boundingBox(), vv = await box.boundingBox();
  expect(vv!.y).toBeGreaterThan(ve!.y);
});

test("a valid path is written trimmed, one undo step; undo restores the old value and the field shows it", async ({ page }) => {
  const d0 = await undoDepth(page);
  await type(page, "  /lovelace/terrace ");
  expect((await dev0(page)).view).toBe("/lovelace/terrace");
  expect(await undoDepth(page)).toBe(d0 + 1);
  await expect(page.locator("#vview")).toHaveValue("/lovelace/terrace");
  await type(page, "/lovelace/garden");
  expect((await dev0(page)).view).toBe("/lovelace/garden");
  expect(await undoDepth(page)).toBe(d0 + 2);
  await page.locator("#undo").click();
  expect((await dev0(page)).view).toBe("/lovelace/terrace");
  await select(page, 0); // Undo clears the selection, as for every field
  await expect(page.locator("#vview")).toHaveValue("/lovelace/terrace");
});

test("an unchanged value adds no undo step", async ({ page }) => {
  await type(page, "/lovelace/terrace");
  const d = await undoDepth(page);
  await type(page, "/lovelace/terrace");
  await type(page, " /lovelace/terrace  ");
  expect(await undoDepth(page)).toBe(d);
});

for (const bad of ["//x", "javascript:x", "a b", "/" + "a".repeat(200)]) {
  test(`${bad.length > 20 ? "a 201 character path" : bad} is refused: nothing written, the validator's message shows until the next valid edit`, async ({ page }) => {
    await type(page, "/lovelace/ok");
    const d = await undoDepth(page);
    await type(page, bad);
    expect((await dev0(page)).view).toBe("/lovelace/ok");
    expect(await undoDepth(page)).toBe(d);
    const err = page.locator("#vview-err");
    await expect(err).toContainText("view must be a path inside Home Assistant that starts with one /");
    await expect(page.locator("#vview")).toHaveAttribute("aria-invalid", "true");
    await type(page, "/lovelace/two");
    await expect(err).toHaveCount(0);
    expect((await dev0(page)).view).toBe("/lovelace/two");
  });
}

test("an empty field removes the key, one undo step", async ({ page }) => {
  await type(page, "/lovelace/terrace");
  const d = await undoDepth(page);
  await type(page, "");
  expect("view" in (await dev0(page))).toBe(false);
  expect(await undoDepth(page)).toBe(d + 1);
  await type(page, ""); // already empty: nothing
  expect(await undoDepth(page)).toBe(d + 1);
});

test("the message goes when another device is selected", async ({ page }) => {
  await type(page, "//x");
  await expect(page.locator("#vview-err")).toBeVisible();
  await select(page, 1);
  await expect(page.locator("#vview-err")).toHaveCount(0);
  await expect(page.locator("#vview")).toHaveValue("");
});
