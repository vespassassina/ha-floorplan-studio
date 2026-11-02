import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardHeight, frameMode, HEADER_H, sideOpenByDefault, sideWidth } from "../../src/card/frame";
import { cardSource } from "../../scripts/card-source.mjs";

// S31.7 (docs/specs/card-layout-touch.md, criterion 4, the "fit to height" assumption): a card in an auto-height parent is never
// taller than the screen. Real Chromium, the built card, the harness's auto-height wrapper (a masonry column). The expected height is
// not copied from the card: `cardHeight` from frame.ts is the rule, the test feeds it what the page measures.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const GUTTER = 16;

async function boot(page: Page, layout: unknown, size: { width: number; height: number }, config: Record<string, unknown> = {}) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    try { localStorage.clear(); } catch { /* no storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout, floor: "ground", theme: "light", ...config });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}

/** What the page says about the card: its box, the plan's box and the floor's outline corners on screen. */
const measure = (page: Page) => page.evaluate(() => {
  const el = document.getElementById("card")!;
  const svg = el.shadowRoot!.querySelector("svg.fp-zoomable") as SVGSVGElement;
  const r = el.getBoundingClientRect(), s = svg.getBoundingClientRect(), m = svg.getScreenCTM()!;
  const corners = [...svg.querySelectorAll("polygon[data-r]")].flatMap((p) => [...(p as SVGPolygonElement).points].map((q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f })));
  return { top: r.top, bottom: r.bottom, width: r.width, height: r.height, plan: { l: s.left, t: s.top, r: s.right, b: s.bottom }, corners, vh: innerHeight };
});

/** Two animation frames, one ResizeObserver tick, one more frame: whatever the card was going to do about a resize it has done. No fixed sleep. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => {
  const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  void (async () => {
    await raf(); await raf();
    await new Promise<void>((r) => { const ro = new ResizeObserver(() => { ro.disconnect(); r(); }); ro.observe(document.getElementById("card")!); });
    await raf();
    done();
  })();
}));

const SIZES = [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];
const HOUSES = { demo, stress } as const;

for (const [name, layout] of Object.entries(HOUSES)) {
  for (const size of SIZES) {
    test(`${name} at ${size.width} x ${size.height}: the card ends 16 px above the bottom and the whole floor is in the plan's box`, async ({ page }) => {
      await boot(page, layout, size);
      const m = await measure(page);
      expect(m.bottom).toBeLessThanOrEqual(size.height - GUTTER);
      for (const c of m.corners) {
        expect(c.x).toBeGreaterThanOrEqual(m.plan.l - 0.5); expect(c.x).toBeLessThanOrEqual(m.plan.r + 0.5);
        expect(c.y).toBeGreaterThanOrEqual(m.plan.t - 0.5); expect(c.y).toBeLessThanOrEqual(m.plan.b + 0.5);
      }
      // The height is the rule's answer, to the pixel: with the plan's aspect, the stage's width, the header, the frame's mode.
      const aspect = await page.locator("floorplan-studio-card").evaluate((el) => { const f = (el as unknown as { _fit: { w: number; h: number } })._fit; return f.w / f.h; });
      const mode = frameMode(m.width);
      // side: the sheet's RESTING width, open from 900 px and the 52 px rail below it, whatever a pick does to it
      const stage = m.width - (mode === "side" ? (sideOpenByDefault(m.width) ? sideWidth(m.width) : HEADER_H) : await sheetPx(page));
      const want = cardHeight({ planAspect: aspect, width: stage, viewportH: size.height, haHeader: 56, chrome: HEADER_H, mode });
      expect(Math.abs(m.height - want)).toBeLessThan(1.5);
    });
  }
}

const sheetPx = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--fp-sheet-w")) || 0);

test("a screen shorter than the plan: the card is cut to the screen, the plan letterboxes, nothing is cropped", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 500 });
  const m = await measure(page);
  expect(m.bottom).toBeLessThanOrEqual(500 - GUTTER);
  expect(m.height).toBeGreaterThan(200); // not collapsed: the cap is a bound, not a squeeze
  for (const c of m.corners) { expect(c.y).toBeGreaterThanOrEqual(m.plan.t - 0.5); expect(c.y).toBeLessThanOrEqual(m.plan.b + 0.5); }
});

test("a phone whose plan is short: the card is at least min(screen less header, 640) tall (D2), not the plan's 330 px", async ({ page }) => {
  await boot(page, stress, { width: 390, height: 844 });
  const m = await measure(page);
  expect(m.height).toBeGreaterThanOrEqual(640 - 1);
  expect(m.bottom).toBeLessThanOrEqual(844 - GUTTER);
});

test("a resize recomputes: a window made shorter shortens the card, made taller lets it grow back", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 700 });
  const tall = await measure(page);
  await page.setViewportSize({ width: 1024, height: 420 });
  await expect.poll(async () => (await measure(page)).bottom).toBeLessThanOrEqual(420 - GUTTER);
  const short = await measure(page);
  expect(short.height).toBeLessThan(tall.height);
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect.poll(async () => Math.round((await measure(page)).height)).toBe(Math.round(tall.height));
});

test("HA's --header-height is taken off the screen", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 500 });
  const a = await measure(page);
  await page.evaluate(() => document.documentElement.style.setProperty("--header-height", "120px"));
  await page.setViewportSize({ width: 1024, height: 501 }); // the resize is what makes the card look again
  await expect.poll(async () => (await measure(page)).height).toBeLessThan(a.height - 40);
  const b = await measure(page);
  expect(b.height).toBeCloseTo(501 - 120 - GUTTER, 0);
});

test("a sections-like parent with a fixed height gives the 0.28.1 box: the card fills it, the screen does not cut it", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 500 });
  await page.evaluate(() => { document.getElementById("wrap")!.style.height = "480px"; });
  await expect.poll(async () => Math.round((await measure(page)).height)).toBe(480);
  await page.setViewportSize({ width: 1024, height: 400 }); // a resize must not start fitting it
  await settle(page);
  expect(Math.round((await measure(page)).height)).toBe(480);
});

test("a panel-view host keeps its own bound: the screen below HA's header", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 700 });
  await page.evaluate(() => { (document.getElementById("card") as unknown as { layout: string }).layout = "panel"; });
  await expect.poll(async () => Math.round((await measure(page)).height)).toBe(700 - 56);
});

test("a height set on the host by hand is the user's: a resize leaves it", async ({ page }) => {
  await boot(page, stress, { width: 1024, height: 700 });
  await page.locator("floorplan-studio-card").evaluate((el) => { el.style.height = "300px"; });
  await page.setViewportSize({ width: 1024, height: 500 });
  await settle(page);
  expect(Math.round((await measure(page)).height)).toBe(300);
});

// Opus review of Sprint 31, finding 1: on a tablet the card's height followed the sheet. Opening the side sheet narrowed the stage,
// the plan got shorter, the card got shorter, and the room under the finger moved. In side mode the height now comes from the rail's
// width whatever the sheet does, and the plan letterboxes when the sheet is open.
// Opus re-check: that rule sized from the rail ALWAYS, but from 900 px the sheet is open by default, so the plan (drawn in the card less
// the sheet) letterboxed in a band of 143 to 190 px. The height now follows the sheet's RESTING state: open from 900 px, the rail below
// it, or the rail once folded by hand. A pick never changes it.
const heightOf = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
const sheetOpenNow = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => !!el.shadowRoot!.querySelector(".fp-active-body"));
/** The real top point of the first room that is a polygon on screen: found by looking, so the click is a real tap. */
const roomPoint = (page: Page) => page.evaluate(() => {
  const el = document.getElementById("card")!, root = el.shadowRoot!;
  for (const p of root.querySelectorAll<SVGPolygonElement>("polygon[data-r]")) {
    const b = p.getBoundingClientRect();
    for (let a = 1; a < 10; a++) for (let c = 1; c < 10; c++) {
      const x = b.left + (b.width * a) / 10, y = b.top + (b.height * c) / 10, t = root.elementFromPoint(x, y);
      if (t === p) return { x, y };
    }
  }
  return null;
});

for (const [name, layout] of Object.entries(HOUSES)) {
  test(`${name} at 768 x 1024: the card is as tall before a room pick, with the sheet open, and after it is let go`, async ({ page }) => {
    await boot(page, layout, { width: 768, height: 1024 });
    expect(await sheetOpenNow(page), "a tablet starts on the rail").toBe(false);
    const before = await heightOf(page);
    const pt = await roomPoint(page);
    expect(pt, "a room to tap").not.toBeNull();
    await page.mouse.click(pt!.x, pt!.y);
    await expect.poll(() => sheetOpenNow(page)).toBe(true);
    expect(await heightOf(page), "sheet open").toBe(before);
    await page.keyboard.press("Escape"); // Back: room to floor, the sheet stays
    await page.keyboard.press("Escape"); // floor to Overview: the sheet folds to the rail
    await expect.poll(() => sheetOpenNow(page)).toBe(false);
    expect(await heightOf(page), "after unpick").toBe(before);
  });
}

/** The empty band under the plan: the svg's box less the plan drawn at its width (the plan meets the box, so a taller box letterboxes). */
const band = (page: Page) => page.evaluate(() => {
  const el = document.getElementById("card")!, svg = el.shadowRoot!.querySelector("svg.fp-zoomable") as SVGSVGElement;
  const f = (el as unknown as { _fit: { w: number; h: number } })._fit, s = svg.getBoundingClientRect();
  return { band: s.height - s.width * (f.h / f.w), box: s.height, w: s.width };
});

for (const size of [{ width: 1280, height: 1000 }, { width: 1600, height: 1200 }, { width: 1024, height: 768 }]) {
  test(`demo at ${size.width} x ${size.height}: the sheet is open by default and the plan has no empty band under it`, async ({ page }) => {
    await boot(page, demo, size);
    expect(await sheetOpenNow(page), "from 900 px the sheet is open").toBe(true);
    const b = await band(page);
    // A band only where the screen cuts the card (the cap), never from the sheet's width.
    const m = await measure(page);
    if (m.bottom < size.height - GUTTER - 2) expect(b.band, `band ${b.band.toFixed(1)} px of ${b.box.toFixed(0)}`).toBeLessThan(2);
    else expect(b.band).toBeGreaterThanOrEqual(-2);
  });
}

test("a fold by hand at 1280 x 1000 changes the height: the plan now has the card less the rail", async ({ page }) => {
  await boot(page, demo, { width: 1280, height: 1000 });
  const open = await heightOf(page);
  await page.locator("floorplan-studio-card .fp-active-collapse").click(); // a real click on the fold button
  await expect.poll(() => sheetOpenNow(page)).toBe(false);
  await expect.poll(() => heightOf(page)).not.toBe(open);
});

test("a room pick at 1280 x 1000 leaves the height alone", async ({ page }) => {
  await boot(page, demo, { width: 1280, height: 1000 });
  const before = await heightOf(page), pt = await roomPoint(page);
  await page.mouse.click(pt!.x, pt!.y);
  await settle(page);
  expect(await heightOf(page)).toBe(before);
});
