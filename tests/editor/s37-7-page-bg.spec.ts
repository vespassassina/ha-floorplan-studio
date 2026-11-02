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
test("4: the page behind the Studio takes the Studio's theme, for every theme", async ({ page }) => {
  await boot(page, 1280, 800);
  const themes = await page.locator("#thSub [data-th]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.th!));
  expect(themes.length).toBeGreaterThan(5);
  const seen = new Set<string>();
  for (const t of themes) {
    if (!(await page.locator("#mOpt").evaluate((e) => (e as HTMLDetailsElement).open))) await page.locator("#mOpt > summary").click();
    if (!(await page.locator("#thSub").evaluate((e) => (e as HTMLDetailsElement).open))) await page.locator("#thSub > summary").click();
    await page.locator(`#thSub [data-th="${t}"]`).click();
    const c = await page.evaluate((tag) => {
      const canvas = (document.querySelector(tag) as HTMLElement).shadowRoot!.querySelector(".canvas")!;
      return { canvas: getComputedStyle(canvas).backgroundColor, body: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor };
    }, EDITOR);
    expect(c, t).toEqual({ canvas: c.canvas, body: c.canvas, html: c.canvas });
    seen.add(c.body);
  }
  expect(seen.size, "the themes do not all share one colour").toBeGreaterThan(3);
});

