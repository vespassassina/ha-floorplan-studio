import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S37.6 (docs/DECISIONS.md 2026-10-25): in `auto`, the card draws device icons at fit on a plan 400 px wide or more, and dots
// under it. The width is the plan's own rendered width (the svg), not the window: the card sits in a box of its own here, so the
// window stays 1280 wide while the box is 360. Real Chromium, the real built card (finding 3), the real default (no harness
// pin: `__realDetailDefault`). Icon = a device's glyph path is painted; dot = the disc alone.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const st = (state: string) => ({ state, attributes: {}, last_changed: new Date().toISOString() });
/** Every linked device on the ground floor is on: at far an idle device is not drawn at all, an on device is a dot. */
const STATES = Object.fromEntries(demo.floors.ground.devices.filter((d: { entity?: string }) => d.entity).map((d: { entity: string }) => [d.entity, st("on")]));

async function open(page: Page, config: Record<string, unknown> = {}, box = 1280, states: Record<string, unknown> = STATES) {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.addInitScript(() => { (window as any).__realDetailDefault = true; });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, box);
  await page.evaluate(async ({ cfg, states }) => {
    const el = document.getElementById("card") as any;
    el.setConfig(cfg);
    el.hass = { states, callService: () => {} };
    await el.updateComplete;
  }, { cfg: { layout: demo, floor: "ground", theme: "light", ...config }, states });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const level = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null);
const width = (page: Page, w: number) => page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, w);
/** The plan's rendered width, as the card measures it: the floor at fit. The svg is as wide as the box and keeps its aspect. */
const planWidth = (page: Page) => card(page).evaluate((el) => {
  const svg = el.shadowRoot!.querySelector<SVGSVGElement>("svg.fp-zoomable")!, r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  return Math.min(r.width, r.height * (vb.width / vb.height));
});
/** Devices drawn (display not none) split into those with a painted glyph and those that are the disc alone. */
const drawn = (page: Page) => card(page).evaluate((el) => {
  let icons = 0, dots = 0;
  for (const g of el.shadowRoot!.querySelectorAll<SVGGElement>("svg g[data-x]")) {
    if (getComputedStyle(g).display === "none") continue;
    const glyph = [...g.querySelectorAll("path:not(.cone)")].some((p) => getComputedStyle(p).display !== "none");
    if (glyph) icons++; else dots++;
  }
  return { icons, dots };
});
const settle = (page: Page, want: string) => expect.poll(() => level(page)).toBe(want);

test("1280 wide: the default draws icons, idle devices included, and no device is a bare dot", async ({ page }) => {
  await open(page, {}, 1280, Object.fromEntries(Object.keys(STATES).map((e) => [e, st("off")])));
  expect(await planWidth(page)).toBeGreaterThan(400);
  await settle(page, "mid");
  const d = await drawn(page);
  expect(d.icons, "the demo's ground floor has a dozen devices").toBeGreaterThanOrEqual(10);
  expect(d.dots).toBe(0);
});

test("360 wide: the default draws dots only; the devices that are on stay, as discs without glyphs", async ({ page }) => {
  await open(page, {}, 360);
  expect(await planWidth(page)).toBeLessThan(400);
  await settle(page, "far");
  const d = await drawn(page);
  expect(d.icons).toBe(0);
  expect(d.dots, "the devices that are on").toBeGreaterThanOrEqual(5);
});

test("the bound is the plan's own width: sweeping 380 up to 420 px of box stays dots until the plan is 420 wide (S38.7)", async ({ page }) => {
  await open(page, {}, 380);
  await settle(page, "far");
  const seen: { box: number; w: number; l: string | null }[] = [];
  for (let box = 380; box <= 420; box++) {
    await width(page, box);
    const w = await planWidth(page);
    await settle(page, w >= 420 ? "mid" : "far");
    seen.push({ box, w, l: await level(page) });
  }
  expect(seen.some((s) => s.w < 420 && s.w > 415), "the sweep has a plan just under the bound").toBe(true);
  expect(seen.some((s) => s.w >= 420), "and one at it").toBe(true);
  for (const s of seen) expect(s.l, JSON.stringify(s)).toBe(s.w >= 420 ? "mid" : "far");
});

test("an explicit detail wins over the width: minimal at 1280 is dots, full at 360 is everything", async ({ page }) => {
  await open(page, { detail: "minimal" }, 1280);
  expect(await level(page)).toBe("far");
  expect((await drawn(page)).icons).toBe(0);
  await page.reload();
  await open(page, { detail: "full" }, 360);
  expect(await level(page)).toBe("near");
  expect((await drawn(page)).icons).toBeGreaterThanOrEqual(10);
});

test("resizing across the bound settles: one switch per crossing, no flicker, no oscillation at rest", async ({ page }) => {
  await open(page, {}, 600);
  await settle(page, "mid");
  await page.evaluate(() => {
    const w = window as any, el = document.getElementById("card") as any;
    w.__levels = [];
    const tick = () => { w.__levels.push(el.shadowRoot.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null); w.__raf = requestAnimationFrame(tick); };
    tick();
  });
  // Straddle the bound by a few px each way: 420 / 380 / 420 ... (6 crossings).
  const sizes = [380, 420, 380, 420, 380, 420];
  for (const s of sizes) { await width(page, s); await settle(page, s < 420 ? "far" : "mid"); await page.waitForTimeout(150); }
  // Rest: 30 frames with no change at all.
  const before = await page.evaluate(() => (window as any).__levels.length);
  await page.waitForTimeout(600);
  const levels: (string | null)[] = await page.evaluate(() => { cancelAnimationFrame((window as any).__raf); return (window as any).__levels; });
  const collapsed = levels.filter((l, i) => i === 0 || l !== levels[i - 1]);
  expect(collapsed, "mid, then far/mid once per resize").toEqual(["mid", "far", "mid", "far", "mid", "far", "mid"]);
  expect(levels.length - before, "frames at rest").toBeGreaterThan(10);
  expect(new Set(levels.slice(before)).size, "no change at rest").toBe(1);
});

// S38.7: hysteresis. Icons from a plan 420 px wide, dots under 380, the last level in between. At 400 px nothing switches,
// whichever side the card came from. Asymmetric on purpose (finding 4): the two directions must read different levels.
test("a plan 400 px wide keeps its last level: coming from icons stays icons, coming from dots stays dots", async ({ page }) => {
  await open(page, {}, 600);
  await settle(page, "mid");
  await width(page, 400);
  const inBand = await planWidth(page);
  expect(inBand, "the plan is inside the band").toBeGreaterThan(385);
  expect(inBand).toBeLessThan(415);
  await page.waitForTimeout(300);
  expect(await level(page), "from icons").toBe("mid");
  expect((await drawn(page)).icons).toBeGreaterThanOrEqual(10);
  await width(page, 360);
  await settle(page, "far");
  await width(page, 400);
  await page.waitForTimeout(300);
  expect(await level(page), "from dots").toBe("far");
  expect((await drawn(page)).icons).toBe(0);
  await width(page, 420);
  await settle(page, "mid");
});
