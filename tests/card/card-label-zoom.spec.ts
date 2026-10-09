import { test, expect, type Page } from "@playwright/test";
import { demo, open, card } from "./helpers-3d";

// S25.4: a label keeps its on-screen size at any zoom. The card re-renders on each zoom with the view's zoom over fit,
// so renderFloor sizes a label in the view's px. Driven by the real wheel on the plan, measured with getBoundingClientRect.

const heights = (page: Page, sel: string) => card(page).locator("css=svg").first().evaluate((svg, sel) =>
  Object.fromEntries([...svg.querySelectorAll<SVGTextElement>(sel)].map((t) => [t.getAttribute("data-rl") ?? t.textContent, t.getBoundingClientRect().height])), sel);
const zoomNow = (page: Page) => card(page).locator("css=svg").first().evaluate((svg) => {
  const vb = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
  return { w: vb[2], px: svg.getBoundingClientRect().width / vb[2] };
});

for (const names of [false, true]) {
  test(`room ${names ? "and device " : ""}labels are the same height at zoom 1 and zoom 6, within 0.5 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page, { layout: structuredClone(demo), floor: "ground", zoom: "wheel", names });
    const sel = "text.lbl";
    await expect.poll(async () => Object.keys(await heights(page, sel)).length).toBeGreaterThan(3);
    const fit = await zoomNow(page), before = await heights(page, sel);
    const b = (await card(page).locator("css=svg").first().boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.37, b.y + b.height * 0.41); // off-centre, asymmetric
    for (let i = 0; i < 40 && (await zoomNow(page)).px / fit.px < 6; i++) await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await zoomNow(page)).px / fit.px).toBeGreaterThanOrEqual(5.9);
    const z = (await zoomNow(page)).px / fit.px;
    expect(z).toBeLessThan(8.01);
    const after = await heights(page, sel);
    // A name the zoom moved out of the view or into another place is not compared; the ones in both are.
    const both = Object.keys(before).filter((k) => k in after);
    expect(both.length).toBeGreaterThan(2);
    for (const k of both) expect(Math.abs(after[k] - before[k]), `${k} at zoom ${z.toFixed(2)}`).toBeLessThanOrEqual(0.5);
  });
}

test("a shrunk room name is the same size on screen when zoomed, and no name falls under 11 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page, { layout: structuredClone(demo), floor: "ground", zoom: "wheel" });
  await page.evaluate(() => { (document.getElementById("wrap") as HTMLElement).style.width = "320px"; });
  await expect.poll(async () => Math.min(...Object.values(await heights(page, "text.lbl[data-rl]")))).toBeGreaterThanOrEqual(11);
  const fit = await zoomNow(page), before = await heights(page, "text.lbl[data-rl]");
  const b = (await card(page).locator("css=svg").first().boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.7);
  for (let i = 0; i < 40 && (await zoomNow(page)).px / fit.px < 6; i++) await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await zoomNow(page)).px / fit.px).toBeGreaterThanOrEqual(5.9);
  const after = await heights(page, "text.lbl[data-rl]");
  expect(Object.keys(before).filter((k) => k in after).length).toBeGreaterThan(2);
  for (const h of Object.values(after)) expect(h).toBeGreaterThanOrEqual(11 - 0.01);
  for (const k of Object.keys(before).filter((k) => k in after)) expect(Math.abs(after[k] - before[k]), k).toBeLessThanOrEqual(0.5);
});
