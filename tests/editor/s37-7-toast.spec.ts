import { test, expect, type Page } from "@playwright/test";

// S37.7: small layout defects from the S36.6 walk (2026-10-24). Each test measures real geometry with getBoundingClientRect
// or getComputedStyle in the real standalone page, at the viewport the defect was seen at (finding 3: real clicks, real
// coordinates). The card's own defect (zoom buttons over the ghost) is in tests/card/card-ghost-stack.spec.ts.

const EDITOR = "floorplan-studio-editor";

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}
type Box = { x: number; y: number; right: number; bottom: number };
/** Rects of shadow-DOM elements, by selector, as the editor's own shadow root lays them out. */
const rects = (page: Page, sel: string) => page.evaluate(([tag, s]) => {
  const root = (document.querySelector(tag as string) as HTMLElement).shadowRoot!;
  return [...root.querySelectorAll(s as string)].filter((e) => e.checkVisibility()).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent?.trim().slice(0, 20) || e.tagName, x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
}, [EDITOR, sel] as const);
const overlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5;

/** Unticks Lock plan, which posts the "Plan unlocked" toast. */
async function unlock(page: Page) {
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(".banner")).toContainText("Plan unlocked");
}

for (const [w, h] of [[1280, 800], [1024, 800]] as const) {
  test(`1 and 3: the Plan unlocked toast covers no toolbar control, no open Floors menu and not the status bar at ${w} x ${h}`, async ({ page }) => {
    await boot(page, w, h);
    await unlock(page);
    await page.locator("#mFloors > summary").click();
    await expect(page.locator("#addFloor")).toBeVisible();
    const [toast] = await rects(page, ".banner");
    expect(toast, "the toast is showing").toBeTruthy();
    const covered = [
      ...(await rects(page, ".bar button, .bar summary, .bar label, .bar fp-search, .bar input")),
      ...(await rects(page, "#mFloors .box button")),
      ...(await rects(page, ".statusbar")),
    ].filter((r) => r.right > r.x && r.bottom > r.y);
    expect(covered.map((r) => r.id)).toEqual(expect.arrayContaining(["addFloor", "search"]));
    expect(covered.filter((r) => overlap(toast, r)).map((r) => r.id), "toast covers").toEqual([]);
    expect(toast.x).toBeGreaterThanOrEqual(0);
    expect(toast.right).toBeLessThanOrEqual(w);
  });
}

