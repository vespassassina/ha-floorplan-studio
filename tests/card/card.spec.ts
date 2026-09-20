import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

// Opus review of S2.1: the card's own chrome (p.msg, anything outside the <svg>) is styled by FLOORPLAN_CSS's
// :host rules, which read data-theme off the host element. This must follow hass.themes.darkMode, never the
// OS's prefers-color-scheme. A same-direction test (dark hass under dark OS) would pass without the fix, since
// prefers-color-scheme alone would already give the dark tokens; the crossed pairs below are the point.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const LIGHT_INK = "rgb(58, 58, 58)"; // --fp-text light, #3a3a3a
const DARK_INK = "rgb(232, 230, 224)"; // --fp-text dark, #e8e6e0

// A plain <script src="../../dist/floorplan-studio-card.js"> fails under file://: Chromium refuses a cross-origin
// module fetch between two file:// URLs (unlike dist/editor.html, which is inlined into one file). Injecting the
// built module's own source as inline content runs without a fetch, so the element defines and upgrades normally.
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

/** Loads harness.html fresh and waits for the card to actually upgrade before configuring it. */
async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}

async function configure(page: Page, config: Record<string, unknown>, hass: Record<string, unknown>) {
  await page.evaluate(
    ([config, hass]) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = hass;
      return el.updateComplete;
    },
    [config, hass] as const,
  );
}

function msgColor(page: Page) {
  return page.locator("floorplan-studio-card").evaluate((el) => {
    const p = el.shadowRoot!.querySelector("p.msg")!;
    return getComputedStyle(p).color;
  });
}

test("S2.1 review: the host follows hass.themes.darkMode, crossed against the OS colour scheme, not the OS itself", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await configure(page, {}, { states: {}, themes: { darkMode: true } });
  await expect.poll(() => msgColor(page)).toBe(DARK_INK);

  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await configure(page, {}, { states: {}, themes: { darkMode: false } });
  await expect.poll(() => msgColor(page)).toBe(LIGHT_INK);
  void testInfo;
});

test("S2.1 review: with no hass.themes at all the card is never hard-coded, and follows the OS instead", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await configure(page, {}, { states: {} });
  await expect.poll(() => msgColor(page)).toBe(DARK_INK);
});

// Opus review of S2.2: the light's icon fill comes from render.ts's own `--fp-dev-fill` custom property
// (`.dev.on path{fill:var(--fp-dev-fill,var(--fp-on))}`), never a DOM-manipulation pass in the card. A markup or
// CSS-text assertion cannot tell a real cascade resolution from a coincidence, so this reads the built card's
// actual `<path>` in Chromium with getComputedStyle (CLAUDE.md finding 10).
test("S2.2 review: a lit light's rgb_color resolves through the cascade to the icon's actual computed fill", async ({ page }) => {
  await open(page);
  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "light.demo_kitchen": { state: "on", attributes: { rgb_color: [255, 0, 0] }, last_changed: new Date().toISOString() } } },
  );
  const fill = await page.locator("floorplan-studio-card").evaluate((el) => {
    const g = el.shadowRoot!.querySelector('g[data-x="1"]')!;
    const path = g.querySelector("path")!;
    return getComputedStyle(path).fill;
  });
  expect(fill).toBe("rgb(255, 0, 0)");
});

test("S2.2 review: with no rgb_color the icon's computed fill falls back to --fp-on, not the rgb branch", async ({ page }) => {
  await open(page);
  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "light.demo_kitchen": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } },
  );
  const fill = await page.locator("floorplan-studio-card").evaluate((el) => {
    const g = el.shadowRoot!.querySelector('g[data-x="1"]')!;
    const path = g.querySelector("path")!;
    return getComputedStyle(path).fill;
  });
  expect(fill).not.toBe("rgb(255, 0, 0)");
});

test("S2.1 review: getCardSize accounts for layout.rotate in a real browser too", async ({ page }) => {
  await open(page);
  const unturned = structuredClone(demo);
  await configure(page, { layout: unturned }, { states: {}, themes: { darkMode: false } });
  const sizeAt0 = await page.locator("floorplan-studio-card").evaluate((el) => (el as unknown as { getCardSize(): number }).getCardSize());

  await open(page);
  const turned = structuredClone(demo);
  (turned as { rotate: number }).rotate = 90;
  await configure(page, { layout: turned }, { states: {}, themes: { darkMode: false } });
  const sizeAt90 = await page.locator("floorplan-studio-card").evaluate((el) => (el as unknown as { getCardSize(): number }).getCardSize());

  expect(sizeAt90).not.toBe(sizeAt0);
});
