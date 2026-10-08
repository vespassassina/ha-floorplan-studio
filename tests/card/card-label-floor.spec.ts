import { test, expect, type Page } from "@playwright/test";
import { demo, open, card } from "./helpers-3d";

// S23.2 (V1): on a phone the plan shrinks, but its names and its device discs do not shrink with it. A room name never
// renders under 11 CSS px and a device disc never under 28 CSS px. The review measured 5 px names on a 390 px card.
// Sizes are read off the page: the drawn font size times the element's own screen scale (getScreenCTM), and the
// measured box of each name as a cross-check.

const sizes = (page: Page) => card(page).locator("css=svg").first().evaluate((svg) => {
  const scaleOf = (el: SVGGraphicsElement) => { const m = el.getScreenCTM()!; return Math.hypot(m.a, m.b); };
  const names = [...svg.querySelectorAll<SVGTextElement>("text.lbl[data-rl]")].map((t) => ({
    name: t.textContent, px: Number(t.getAttribute("font-size")) * scaleOf(t), box: t.getBoundingClientRect().height,
  }));
  // A device's disc is 32 icon units across (r=16 in the 24-unit icon), drawn at the group's own scale.
  const discs = [...svg.querySelectorAll<SVGGElement>("g[data-x]")].map((g) => ({ i: g.getAttribute("data-x"), px: 32 * scaleOf(g) }));
  return { names, discs, width: svg.getBoundingClientRect().width };
});

for (const width of [390, 320]) {
  test(`a ${width} px card: every room name at least 11 CSS px, every device disc at least 28`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, { layout: structuredClone(demo), floor: "ground" });
    await page.evaluate((w) => { (document.getElementById("wrap") as HTMLElement).style.width = `${w}px`; }, width);
    // The card measures its plan after a resize; wait for the names to settle rather than for a fixed time.
    await expect.poll(async () => Math.min(...(await sizes(page)).names.map((n) => n.px)), { timeout: 5000 }).toBeGreaterThanOrEqual(11 - 0.01);
    const s = await sizes(page);
    expect(s.width).toBeLessThanOrEqual(width);
    expect(s.names.length).toBeGreaterThan(3);
    expect(s.discs.length).toBeGreaterThan(3);
    for (const n of s.names) {
      expect(n.px, `${n.name}`).toBeGreaterThanOrEqual(11 - 0.01);
      expect(n.box, `${n.name} box`).toBeGreaterThanOrEqual(11);
    }
    for (const d of s.discs) expect(d.px, `device ${d.i}`).toBeGreaterThanOrEqual(28 - 0.01);
  });
}

test("a wide card keeps the plan's own sizes: the floor lifts only what would fall under it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page, { layout: structuredClone(demo), floor: "ground" });
  const font = () => card(page).locator("css=svg text.lbl[data-rl]").first().getAttribute("font-size");
  const at = async (w: number) => {
    await page.evaluate((w) => { (document.getElementById("wrap") as HTMLElement).style.width = `${w}px`; }, w);
    await expect.poll(async () => Math.round((await sizes(page)).width)).toBe(w);
    // The card measures after the resize and re-renders when the floor changes the names' size; wait for that render.
    await expect.poll(async () => Math.min(...(await sizes(page)).names.map((n) => n.px)), { timeout: 5000 }).toBeGreaterThanOrEqual(11 - 0.01);
    return { font: await font(), min: Math.min(...(await sizes(page)).names.map((n) => n.px)) };
  };
  const a = await at(1300), b = await at(1000);
  expect(a.min).toBeGreaterThanOrEqual(11 - 0.01);
  expect(b.min).toBeGreaterThanOrEqual(11 - 0.01);
  expect(b.font).toBe(a.font); // both above the floor: the plan's own 12k, untouched
});
