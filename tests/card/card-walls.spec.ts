import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The Walls select in the card toolbar, in a real Chromium with a real reload. The drawn wall height is read from
// the DOM (the screen rectangle of the wall's side polygon), not from a string of the markup (CLAUDE.md findings
// 10 and 16).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const card = (page: Page) => page.locator("floorplan-studio-card");
const select = (page: Page, label: string) => card(page).locator(`css=select[aria-label="${label}"]`);
const button = (page: Page, label: string) => card(page).locator(`css=button[aria-label="${label}"]`);
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);

/** The websocket reply has the shape websocket.py sends: `{ layout }` (CLAUDE.md finding 21). */
async function boot(page: Page, config: Record<string, unknown>) {
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ config, layout }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(structuredClone(config));
    el.hass = { states: {}, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { config, layout: structuredClone(demo) });
}
const CONFIG = { type: "custom:floorplan-studio-card", floor: "ground", view: "2.5d" };
async function fresh(page: Page, config: Record<string, unknown> = CONFIG) {
  await page.goto(URL_);
  await boot(page, config);
}

/** Screen heights of every wall side polygon, tallest first, in real coordinates. */
const wallHeights = (page: Page) => card(page).evaluate((el) =>
  [...el.shadowRoot!.querySelectorAll("svg polygon.ws")].map((p) => p.getBoundingClientRect().height).sort((a, b) => b - a));
/** The wall that is lowest on screen: the front wall at rotation 0. */
const frontWall = (page: Page) => card(page).evaluate((el) => {
  const rects = [...el.shadowRoot!.querySelectorAll("svg polygon.ws")].map((p) => p.getBoundingClientRect());
  // The front wall is the wide one lowest on screen.
  const wide = rects.filter((r) => r.width > r.height * 2);
  return wide.sort((a, b) => b.bottom - a.bottom)[0]!.height;
});
const tallest = async (page: Page) => (await wallHeights(page))[0]!;
const mean = async (page: Page) => { const h = await wallHeights(page); return h.reduce((a, b) => a + b, 0) / h.length; };

test.describe("the card's Walls select (real browser, real reload)", () => {
  test("lists Full height, Cutaway and Low, Cutaway chosen by default, only in 2.5D", async ({ page }) => {
    await fresh(page);
    const s = select(page, "Walls");
    expect(await s.locator("option").allTextContents()).toEqual(["Full height", "Cutaway", "Low"]);
    expect(await s.inputValue()).toBe("cut");
    await select(page, "View").selectOption("2d");
    await expect(s).toHaveCount(0);
  });

  test("the three modes draw different wall heights", async ({ page }) => {
    await fresh(page);
    await button(page, "Rotate right").click();
    await settled(page);
    const seen: Record<string, { tall: number; mean: number }> = {};
    for (const m of ["full", "cut", "low"]) {
      await select(page, "Walls").selectOption(m);
      seen[m] = { tall: await tallest(page), mean: await mean(page) };
    }
    // Full is the model height everywhere; low is the cutaway height everywhere; cut is between, by wall.
    expect(seen.full!.mean).toBeGreaterThan(seen.cut!.mean + 1);
    expect(seen.cut!.mean).toBeGreaterThan(seen.low!.mean + 1);
    expect(seen.full!.tall).toBeGreaterThan(seen.low!.tall + 1);
  });

  test("a front wall is taller in Full than in Low, and Cutaway lowers it to Low's height", async ({ page }) => {
    await fresh(page);
    await select(page, "Walls").selectOption("full");
    const full = await frontWall(page);
    await select(page, "Walls").selectOption("cut");
    const cut = await frontWall(page);
    await select(page, "Walls").selectOption("low");
    const low = await frontWall(page);
    expect(full).toBeGreaterThan(low + 1);
    expect(cut).toBeCloseTo(low, 0);
  });

  test("Full survives a real reload; Reset view returns to the config's mode", async ({ page }) => {
    await fresh(page, { ...CONFIG, walls: "low" });
    expect(await select(page, "Walls").inputValue()).toBe("low");
    const lowTall = await tallest(page);
    await select(page, "Walls").selectOption("full");
    const fullTall = await tallest(page);
    expect(fullTall).toBeGreaterThan(lowTall + 1);
    await page.reload();
    await boot(page, { ...CONFIG, walls: "low" });
    expect(await select(page, "Walls").inputValue()).toBe("full");
    expect(await tallest(page)).toBeCloseTo(fullTall, 1);
    await button(page, "Reset view").click();
    await settled(page);
    expect(await select(page, "Walls").inputValue()).toBe("low");
    await page.reload();
    await boot(page, { ...CONFIG, walls: "low" });
    expect(await select(page, "Walls").inputValue()).toBe("low");
    expect(await tallest(page)).toBeCloseTo(lowTall, 1);
  });

  test("junk in the config and in storage is Cutaway", async ({ page }) => {
    await fresh(page, { ...CONFIG, walls: "<script>" });
    expect(await select(page, "Walls").inputValue()).toBe("cut");
    await select(page, "Walls").selectOption("full");
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("fp-view:")) localStorage.setItem(k, JSON.stringify({ v: 1, walls: "../../etc", labels: false }));
    });
    await page.reload();
    await boot(page, { ...CONFIG, walls: "<script>" });
    expect(await select(page, "Walls").inputValue()).toBe("cut");
  });
});
