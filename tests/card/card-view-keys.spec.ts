import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The card's keys and its floor memory in real Chromium: a real pointer over the card, a real keyboard, a real reload.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const card = (page: Page) => page.locator("floorplan-studio-card");
const button = (page: Page, label: string) => card(page).locator(`css=button[aria-label="${label}"]`);
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
const viewBox = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number));
const planDeg = (page: Page) => card(page).evaluate((el) => {
  const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
});
const chip = (page: Page, n: number) => card(page).locator(`css=.fp-floors button:nth-child(${n})`);

/** The config a dashboard hands over, and the layout over the websocket in the shape websocket.py sends: `{ layout }` (CLAUDE.md finding 21). */
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
const hoverCard = async (page: Page) => {
  const box = (await card(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};
const PINNED = { type: "custom:floorplan-studio-card", floor: "ground" };

test.describe("the floor survives a reload (default install: no floor pinned, a chip per floor)", () => {
  const NO_PIN = { type: "custom:floorplan-studio-card" };

  test("the second floor is still the one shown after page.reload", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, NO_PIN);
    await expect(chip(page, 1)).toHaveAttribute("aria-pressed", "true");
    await chip(page, 2).click();
    await expect(chip(page, 2)).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await boot(page, NO_PIN);
    await expect(chip(page, 2)).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, 1)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("the keys, with a real pointer and a real keyboard", () => {
  test("hover the card: Up zooms in, Right turns 45 degrees, Space resets; the page does not scroll", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, PINNED);
    await page.evaluate(() => { document.body.style.height = "4000px"; window.scrollTo(0, 0); });
    await hoverCard(page);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
    await page.keyboard.press("ArrowRight");
    await settled(page);
    expect(await planDeg(page)).toBe(45);
    await page.keyboard.press("Space");
    await settled(page);
    expect(await planDeg(page)).toBe(0);
    expect((await viewBox(page))[2]!).toBeCloseTo(w0, 3);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the pointer away from the card: the same keys do nothing", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, PINNED);
    await page.mouse.move(1, 1);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    expect((await viewBox(page))[2]!).toBe(w0);
    expect(await planDeg(page)).toBe(0);
  });

  test("Space on a focused Rotate right button turns once and does not also reset", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, PINNED);
    await hoverCard(page);
    await button(page, "Rotate right").focus();
    await page.keyboard.press("Space");
    await settled(page);
    expect(await planDeg(page)).toBe(45);
  });

  test("typing in a text field on the page while the pointer is over the card leaves the card alone", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, PINNED);
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "q"; document.body.appendChild(i); });
    await hoverCard(page);
    await page.locator("#q").focus();
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.type(" ");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);
    expect((await viewBox(page))[2]!).toBe(w0);
  });

  test("a turn made by key is still there after a reload", async ({ page }) => {
    await page.goto(URL_);
    await boot(page, PINNED);
    await hoverCard(page);
    await page.keyboard.press("ArrowLeft");
    await settled(page);
    await page.reload();
    await boot(page, PINNED);
    expect(await planDeg(page)).toBe(315);
  });
});
