import { test, expect, type Page } from "@playwright/test";

// S25.7: the Studio's View menu offers the detail mode. Real page.mouse on the real elements (finding 3); the level is
// read off the live plan root. The mode is a viewer preference: kept in the browser, never an undo step.

const EDITOR = "floorplan-studio-editor";

const level = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).shadowRoot.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null, EDITOR);
async function click(page: Page, sel: string) {
  const b = (await page.locator(`${EDITOR} ${sel}`).boundingBox())!;
  expect(b, `${sel} has a box`).not.toBeNull();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}
async function pick(page: Page, mode: "auto" | "full" | "minimal") {
  const isOpen = (sel: string) => page.evaluate(([tag, sel]) => (document.querySelector(tag) as any).shadowRoot.querySelector(sel).open, [EDITOR, sel]);
  if (!(await isOpen("#mOpt"))) await click(page, "#mOpt > summary");
  if (!(await isOpen("#detailSub"))) await click(page, "#detailSub > summary");
  await click(page, `#detailSub button[data-detail="${mode}"]`);
}

test("View menu: a Detail group with Auto, Full and Minimal; Full is on at start", async ({ page }) => {
  await open(page);
  await click(page, "#mOpt > summary");
  await click(page, "#detailSub > summary");
  const chips = page.locator(`${EDITOR} #detailSub button[data-detail]`);
  expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute("data-detail")))).toEqual(["auto", "full", "minimal"]);
  await expect(page.locator(`${EDITOR} #detailSub button[data-detail="full"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${EDITOR} #detailSub button[data-detail="auto"]`)).toHaveAttribute("aria-pressed", "false");
  expect(await level(page), "placing devices must not hide them: full while editing").toBe("near");
});

test("each choice moves data-detail at fit and after zooming in; the toolbar names a mode that is not the default", async ({ page }) => {
  await open(page);
  await expect(page.locator(`${EDITOR} #detailMode`), "default: nothing in the toolbar").toHaveCount(0);
  await pick(page, "auto");
  expect(await level(page)).toBe("far");
  await expect(page.locator(`${EDITOR} #detailMode`)).toHaveText(/Detail: Auto/);
  for (let i = 0; i < 12; i++) await click(page, "#zin");
  expect(await level(page), "auto follows zoom").toBe("near");
  await pick(page, "minimal");
  expect(await level(page), "minimal stays far when zoomed in").toBe("far");
  await expect(page.locator(`${EDITOR} #detailMode`)).toHaveText(/Detail: Minimal/);
  await expect(page.locator(`${EDITOR} #detailSub button[data-detail="minimal"]`)).toHaveAttribute("aria-pressed", "true");
  for (let i = 0; i < 12; i++) await click(page, "#zout");
  await pick(page, "full");
  expect(await level(page), "full is near at fit").toBe("near");
  await expect(page.locator(`${EDITOR} #detailMode`)).toHaveCount(0);
});

test("the choice survives a reload and is not an undo step", async ({ page }) => {
  await open(page);
  const undoBefore = await page.locator(`${EDITOR} #undo`).isDisabled();
  await pick(page, "minimal");
  expect(await page.locator(`${EDITOR} #undo`).isDisabled(), "undo stack untouched").toBe(undoBefore);
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await level(page)).toBe("far");
  await expect(page.locator(`${EDITOR} #detailMode`)).toHaveText(/Detail: Minimal/);
});

test("blocked storage or junk in storage: the Studio still renders, in full", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("floorplan-studio:detail", "<b>sideways</b>"); } catch { /* none */ } });
  await open(page);
  expect(await level(page)).toBe("near");
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await level(page)).toBe("near");
  await pick(page, "minimal"); // storing fails; the choice still holds for the session
  expect(await level(page)).toBe("far");
});
