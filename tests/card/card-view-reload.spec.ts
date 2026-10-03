import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Field report 0.12.21: "the template and view resets between reloads of the dashboard". These drive the card
// the way Home Assistant does: a config that sets theme, view and tilt, a layout that arrives over the websocket
// after setConfig, setConfig called again with a new equal object, and a real page.reload.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const card = (page: Page) => page.locator("floorplan-studio-card");
const select = (page: Page, label: string) => card(page).locator(`css=select[aria-label="${label}"]`);
const button = (page: Page, label: string) => card(page).locator(`css=button[aria-label="${label}"]`);
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
const viewBox = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number));
const planDeg = (page: Page) => card(page).evaluate((el) => {
  const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
});

/** What a real dashboard config looks like: theme, view and tilt set, the layout from the websocket. Same shape
 * websocket.py sends: `{ layout }` (CLAUDE.md finding 21). */
const HA_CONFIG = { type: "custom:floorplan-studio-card", floor: "ground", theme: "terminal", view: "2.5d", tilt: 0.3 };

async function boot(page: Page, config: Record<string, unknown> = HA_CONFIG) {
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ config, layout }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(structuredClone(config));
    el.hass = {
      states: {},
      connection: { sendMessagePromise: async () => ({ layout }) },
      themes: { darkMode: false },
    };
    await new Promise((r) => setTimeout(r, 50)); // the websocket answer
    await el.updateComplete;
  }, { config, layout: structuredClone(demo) });
}

async function fresh(page: Page) {
  await page.goto(URL_);
  await boot(page);
}

async function reload(page: Page, config?: Record<string, unknown>) {
  await page.reload();
  await boot(page, config);
}

test.describe("a dashboard reload keeps the view (card, HA lifecycle)", () => {
  test("theme, view, tilt, rotation and zoom picked over a config that sets them survive a reload", async ({ page }) => {
    await fresh(page);
    expect(await select(page, "Theme").inputValue()).toBe("terminal");
    await select(page, "Theme").selectOption("light");
    await select(page, "View").selectOption("2d");
    await button(page, "Zoom in").click();
    await button(page, "Rotate right").click();
    await settled(page);
    const before = await viewBox(page);
    await reload(page);
    expect(await select(page, "Theme").inputValue()).toBe("light");
    expect(await select(page, "View").inputValue()).toBe("2d");
    expect(await planDeg(page)).toBe(45);
    const after = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(after[i]!).toBeCloseTo(before[i]!, 2);
  });

  test("setConfig called again with a new equal object (HA does this) keeps what was picked", async ({ page }) => {
    await fresh(page);
    await select(page, "Theme").selectOption("light");
    await button(page, "Zoom in").click();
    const before = await viewBox(page);
    await card(page).evaluate((el, config) => (el as unknown as { setConfig(c: unknown): void }).setConfig(structuredClone(config)), HA_CONFIG);
    await expect.poll(() => select(page, "Theme").inputValue()).toBe("light");
    const after = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(after[i]!).toBeCloseTo(before[i]!, 2);
  });

  test("a dashboard view switch (element removed and put back) keeps the view", async ({ page }) => {
    await fresh(page);
    await select(page, "Theme").selectOption("light");
    await button(page, "Rotate left").click();
    await settled(page);
    await card(page).evaluate((el) => { const p = el.parentElement!; el.remove(); p.appendChild(el); });
    expect(await select(page, "Theme").inputValue()).toBe("light");
    expect(await planDeg(page)).toBe(315);
  });
});
