import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S37.7 defect 5: at 1024 px wide the card's + / - / Fit buttons sat on the faint outline of the floor below (Floor below on, demo
// home, first floor: the ground floor reaches past the first floor's right edge, so its lines run under the buttons). The ghost is
// not a hit target, so the test cannot ask elementFromPoint; it walks every ghost path in 1 px steps, maps each point to the screen
// and counts those that are inside the svg's own box (what shows) and inside the button stack's box (what covers).
const home = JSON.parse(readFileSync("demo/home.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function boot(page: Page, width: number, config: Record<string, unknown>) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout: home, floor: "first", ...config });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
/** Visible ghost points, and how many of them lie under the zoom buttons. */
const ghostUnderStack = (page: Page) => page.locator("floorplan-studio-card").evaluate((card) => {
  const root = card.shadowRoot!, svg = root.querySelector("svg.fp-zoomable") as SVGSVGElement, s = svg.getBoundingClientRect();
  const stack = root.querySelector(".fp-stack")!.getBoundingClientRect();
  let shown = 0, covered = 0;
  for (const path of root.querySelectorAll<SVGPathElement>("g.ghost path")) {
    const m = path.getScreenCTM()!, len = path.getTotalLength();
    for (let l = 0; l <= len; l += 1) {
      const p = path.getPointAtLength(l), x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
      if (x < s.left || x > s.right || y < s.top || y > s.bottom) continue; // cropped by the svg: not on screen
      shown++;
      if (x >= stack.left && x <= stack.right && y >= stack.top && y <= stack.bottom) covered++;
    }
  }
  return { shown, covered, stack: { left: stack.left, right: stack.right }, svgRight: s.right };
});

for (const width of [1024, 1280]) {
  test(`the zoom buttons sit on no ghost outline at ${width} px wide`, async ({ page }) => {
    await boot(page, width, { ghost_floor: true });
    const r = await ghostUnderStack(page);
    expect(r.shown, "the ghost is drawn (else this proves nothing)").toBeGreaterThan(5000);
    expect(r.covered, `ghost points under the buttons (stack ${JSON.stringify(r.stack)}, svg right ${r.svgRight})`).toBe(0);
  });
}

test("the plan keeps its full width when the ghost is off: the buttons still sit over it", async ({ page }) => {
  await boot(page, 1024, {});
  const r = await page.locator("floorplan-studio-card").evaluate((card) => {
    const root = card.shadowRoot!;
    return { svgRight: root.querySelector("svg.fp-zoomable")!.getBoundingClientRect().right, stackRight: root.querySelector(".fp-stack")!.getBoundingClientRect().right };
  });
  expect(r.stackRight).toBeLessThanOrEqual(r.svgRight); // the cluster is over the plan on purpose; only the ghost makes room
});

// The same on a touch screen, where the buttons are 44 px wide (touch-css.ts): the gutter grows with them.
test.describe("coarse pointer", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("the 44 px zoom buttons sit on no ghost outline at 1024 px wide", async ({ page }) => {
    await boot(page, 1024, { ghost_floor: true });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the pointer is coarse").toBe(true);
    const r = await ghostUnderStack(page);
    expect(r.shown).toBeGreaterThan(5000);
    expect(r.covered, `ghost points under the buttons (stack ${JSON.stringify(r.stack)}, svg right ${r.svgRight})`).toBe(0);
  });
});
