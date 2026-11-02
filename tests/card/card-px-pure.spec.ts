import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// A settled render is a pure function of the final measured size. `_measurePx` re-renders only when the measured
// scale moves past a tolerance, so a card that was drawn at one width and then nudged by under that tolerance
// must still draw the same markup as a card that was drawn at the final width straight away. (Found as the 2 %
// flake of "the turn lands byte for byte on a direct render": the label y differed by 0.01.)

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

async function open(page: Page, width: number) {
  await page.setViewportSize({ width: 1400, height: 1700 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((w) => { document.getElementById("card")!.style.cssText = `display:block;width:${w}px;height:1500px`; }, width);
}
async function configure(page: Page) {
  await page.evaluate((layout) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout, floor: "ground", rotation: 45 });
    el.hass = { states: {}, callService: () => {} };
    return el.updateComplete;
  }, demo);
}
const frames = (page: Page, n: number) => page.evaluate((n) => new Promise<void>((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r()); f(n); }), n);
const svgHtml = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => el.shadowRoot!.querySelector("svg")!.outerHTML);

for (const [from, to] of [[1000, 1004], [1000, 996], [900, 903]]) {
  test(`a card nudged from ${from} to ${to} px draws what a card at ${to} px draws`, async ({ page }) => {
    await open(page, from);
    await configure(page);
    await frames(page, 4);
    await page.evaluate((w) => { document.getElementById("card")!.style.width = `${w}px`; }, to);
    await frames(page, 6);
    const nudged = await svgHtml(page);

    await page.reload();
    await open(page, to);
    await configure(page);
    await frames(page, 10);
    expect(await svgHtml(page)).toBe(nudged);
  });
}
