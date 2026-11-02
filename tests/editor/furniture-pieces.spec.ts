import { test, expect } from "@playwright/test";

// B53.1: the four new pieces can be picked from Add > Furniture with a real click, and arrive at their default size.
const PIECES = [
  { symbol: "sofa-l", w: 280, h: 180 },
  { symbol: "coffee-table", w: 110, h: 60 },
  { symbol: "bookcase", w: 100, h: 35 },
  { symbol: "buffet", w: 180, h: 50 },
];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
});

for (const p of PIECES) {
  test(`Add > Furniture places a ${p.symbol} at ${p.w} x ${p.h} cm`, async ({ page }) => {
    await page.locator("#mAdd > summary").click();
    await page.locator("#addFurn > summary").click();
    const btn = page.locator(`#addFurn-${p.symbol}`);
    await btn.scrollIntoViewIfNeeded();
    const b = (await btn.boundingBox())!;
    expect(b.y + b.height, "inside the viewport").toBeLessThanOrEqual(768);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const placed = await page.evaluate((s) => {
      const lay = (document.querySelector("floorplan-studio-editor") as any).layout;
      return Object.values(lay.floors).flatMap((f: any) => f.furniture ?? []).filter((m: any) => m.symbol === s).map((m: any) => ({ w: m.w, h: m.h }));
    }, p.symbol);
    expect(placed).toEqual([{ w: p.w, h: p.h }]);
  });
}
