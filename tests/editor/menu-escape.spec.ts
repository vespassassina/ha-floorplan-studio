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

const clickBox = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// Opus review of S22.5: the selection alone could not tell, since no later Escape handler clears a selection. The
// Device colours window is closed by the next Escape handler, so it proves the menu's Escape stops there.
test("Escape on an open menu does only that: a selection and an open Device colours window survive it", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  const dev = (await page.locator(`${EDITOR} svg g[data-x]`).first().boundingBox())!;
  await page.mouse.click(dev.x + dev.width / 2, dev.y + dev.height / 2);
  const panelBefore = await page.locator(`${EDITOR} aside`).innerText();
  await clickBox(page, "#mEdit > summary");
  await clickBox(page, "#devcols");
  await expect(page.locator("#devcolsClose")).toBeVisible();
  await clickBox(page, "#mOpt > summary");
  await expect(page.locator("#mOpt")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mOpt")).not.toHaveAttribute("open", "");
  await expect(page.locator("#devcolsClose")).toBeVisible();
  expect(await page.locator(`${EDITOR} aside`).innerText()).toBe(panelBefore);
  await page.keyboard.press("Escape"); // and the next Escape reaches the window
  await expect(page.locator("#devcolsClose")).toHaveCount(0);
});

test("Escape on a menu opened mid-drawing closes the menu and keeps the drawing; the next Escape cancels it", async ({ page }) => {
  await page.locator("#fixPlan").uncheck();
  await clickBox(page, "#mDraw > summary");
  await clickBox(page, "#mDraw details.sub:has(#drawOutline) > summary");
  await clickBox(page, "#drawOutline");
  await expect(page.locator(`${EDITOR} svg.drawing`)).toHaveCount(1);
  const svg = (await page.locator(`${EDITOR} svg.drawing`).boundingBox())!;
  await page.mouse.click(svg.x + svg.width * 0.3, svg.y + svg.height * 0.4); // one corner
  await expect(page.locator(`${EDITOR} svg circle.dp`)).toHaveCount(1);
  await clickBox(page, "#mOpt > summary");
  await expect(page.locator("#mOpt")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mOpt")).not.toHaveAttribute("open", "");
  await expect(page.locator(`${EDITOR} svg.drawing`)).toHaveCount(1);
  await expect(page.locator(`${EDITOR} svg circle.dp`)).toHaveCount(1); // the corner is still there
  await page.keyboard.press("Escape");
  await expect(page.locator(`${EDITOR} svg.drawing`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} svg circle.dp`)).toHaveCount(0);
});
