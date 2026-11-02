import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// S37.7: small layout defects from the S36.6 walk (2026-10-24). Each test measures real geometry with getBoundingClientRect
// or getComputedStyle in the real standalone page, at the viewport the defect was seen at (finding 3: real clicks, real
// coordinates). The card's own defect (zoom buttons over the ghost) is in tests/card/card-ghost-stack.spec.ts.

const EDITOR = "floorplan-studio-editor";
const ALIGN_HOUSE = JSON.parse(readFileSync("tests/fixtures/align-house.json", "utf8"));

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}
/** Rects of shadow-DOM elements, by selector, as the editor's own shadow root lays them out. */
const rects = (page: Page, sel: string) => page.evaluate(([tag, s]) => {
  const root = (document.querySelector(tag as string) as HTMLElement).shadowRoot!;
  return [...root.querySelectorAll(s as string)].map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent?.trim().slice(0, 20) || e.tagName, x: r.x, y: r.y, right: r.right, bottom: r.bottom }; });
}, [EDITOR, sel] as const);
for (const [w, h] of [[1280, 800], [1024, 800]] as const) {
  test(`6: the Align panel's angle-step row is inside the aside at ${w} x ${h}`, async ({ page }) => {
    await boot(page, w, h);
    await page.locator("#fixPlan").uncheck();
    await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, ALIGN_HOUSE] as const);
    await page.locator('.chip[data-f="first"]').click();
    await page.locator("#mFloors > summary").click();
    await page.locator("#alignFloor").click();
    await expect(page.locator("#alignPanel")).toBeVisible();
    const [aside] = await rects(page, "aside");
    const steps = await rects(page, "#alignPanel [data-angle]");
    expect(steps.length).toBe(4);
    for (const s of steps) expect(s.bottom, `angle step ${s.id} bottom vs aside bottom ${aside.bottom}`).toBeLessThanOrEqual(aside.bottom);
    expect(Math.min(...steps.map((s) => s.y))).toBeGreaterThanOrEqual(aside.y);
  });
}
