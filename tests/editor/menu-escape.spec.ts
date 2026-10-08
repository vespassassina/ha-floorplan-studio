import { test, expect, type Page } from "@playwright/test";

// S22.5 (review U4): Help promises "Escape: close a menu". Every toolbar menu, opened with a real click, closes on
// Escape and hands focus back to its own button. The key is handled on the editor host (finding 6).

const EDITOR = "floorplan-studio-editor";
const MENUS = ["filter", "mAdd", "mDraw", "mOpt", "mEdit", "mFile"];
const focusedId = (page: Page) => page.evaluate((tag) => {
  const a = (document.querySelector(tag) as any).shadowRoot.activeElement as HTMLElement | null;
  return a?.tagName === "SUMMARY" ? (a.parentElement as HTMLElement).id : a?.id ?? a?.tagName ?? null;
}, EDITOR);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("the toolbar has exactly the menus this test walks", async ({ page }) => {
  const ids = await page.locator(`${EDITOR} details.menu`).evaluateAll((els) => els.map((e) => e.id));
  expect(ids.sort()).toEqual([...MENUS].sort());
});

for (const id of MENUS) {
  test(`Escape closes the ${id} menu and puts focus on its button`, async ({ page }) => {
    const b = (await page.locator(`#${id} > summary`).boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator(`#${id}`)).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(page.locator(`#${id}`)).not.toHaveAttribute("open", "");
    expect(await focusedId(page)).toBe(id);
  });
}

test("Escape with a submenu open closes the whole Add menu, submenu included", async ({ page }) => {
  const b = (await page.locator("#mAdd > summary").boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const sub = page.locator("#mAdd details.sub > summary").first();
  const s = (await sub.boundingBox())!;
  await page.mouse.click(s.x + s.width / 2, s.y + s.height / 2);
  await expect(page.locator("#mAdd details.sub[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mAdd")).not.toHaveAttribute("open", "");
  await expect(page.locator("#mAdd details.sub[open]")).toHaveCount(0);
  expect(await focusedId(page)).toBe("mAdd");
});

test("Escape on an open menu does only that: a selection survives it", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  const dev = (await page.locator(`${EDITOR} svg g[data-x]`).first().boundingBox())!;
  await page.mouse.click(dev.x + dev.width / 2, dev.y + dev.height / 2);
  const panelBefore = await page.locator(`${EDITOR} aside`).innerText();
  const b = (await page.locator("#mOpt > summary").boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mOpt")).not.toHaveAttribute("open", "");
  expect(await page.locator(`${EDITOR} aside`).innerText()).toBe(panelBefore);
});
