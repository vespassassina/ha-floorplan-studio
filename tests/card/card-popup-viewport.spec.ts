import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S22.2 (C3): the device popup stays inside the visible window on a card taller than the screen. The review saw a 304 px popup open
// at y=872 under a tap at y=858, ending 276 px below the window. Every tap is a real page.mouse click on the icon's real top element
// (CLAUDE.md finding 3). The card is made taller than the window by its wrapper (harness.html: :host is height 100%).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
// A light with brightness, colour temperature and hue: the tallest popup the card draws.
const LIGHT = { supported_color_modes: ["color_temp", "hs"], brightness: 128, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000, hs_color: [30, 60] };
const STATES = { "light.demo_living": st("on", { friendly_name: "Living light", ...LIGHT }), "light.demo_kitchen": st("on", { friendly_name: "Kitchen light", ...LIGHT }) };

async function boot(page: Page, width: number, height: number, cardHeight: number) {
  await page.setViewportSize({ width, height });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s, h]) => {
      document.body.style.margin = "0";
      document.getElementById("wrap")!.style.height = `${h}px`;
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, callService: () => {} };
      return el.updateComplete;
    },
    [{ layout: demo, floor: "ground", active_list: false }, STATES, cardHeight] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const pop = (page: Page) => card(page).locator("css=.fp-pop");

/** Scrolls the page so device `i` sits `fromTop` px below the top of the window, then clicks it for real. */
async function tapAt(page: Page, i: number, fromTop: (innerHeight: number) => number) {
  const where = await page.evaluate(() => innerHeight);
  const y0 = await card(page).evaluate((el, i) => { const r = el.shadowRoot!.querySelector(`svg g[data-x="${i}"]`)!.getBoundingClientRect(); return r.y + r.height / 2 + window.scrollY; }, i);
  await page.evaluate((y) => window.scrollTo(0, y), y0 - fromTop(where));
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector(`svg g[data-x="${i}"]`)!, r = g.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return { x, y, hit: !!top?.closest(`g[data-x="${i}"]`), cardTop: el.getBoundingClientRect().top, cardBottom: el.getBoundingClientRect().bottom };
  }, i);
  expect(p.hit, `device ${i} is the top element at its centre`).toBe(true);
  await page.mouse.click(p.x, p.y);
  await expect(pop(page)).toBeVisible();
  return p;
}
const popBox = (page: Page) => card(page).evaluate((el) => { const r = el.shadowRoot!.querySelector(".fp-pop")!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, ih: innerHeight, iw: innerWidth }; });

test.describe("S22.2 the popup stays in the visible window", () => {
  test("a tap near the bottom of the window on a card taller than it opens the popup above the point, fully visible", async ({ page }) => {
    await boot(page, 1280, 700, 1600);
    const p = await tapAt(page, 1, (ih) => ih - 40); // the Kitchen light, 40 px above the bottom edge
    expect(p.cardBottom, "the card runs on below the window").toBeGreaterThan(700);
    const b = await popBox(page);
    expect(b.h, "a full light popup, not a sliver").toBeGreaterThan(250);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.bottom).toBeLessThanOrEqual(b.ih);
    expect(b.bottom, "above the tapped point").toBeLessThanOrEqual(p.y);
  });

  test("a tap near the top of the window, with the card's top scrolled away, opens below the point, fully visible", async ({ page }) => {
    await boot(page, 1280, 700, 1600);
    const p = await tapAt(page, 1, () => 40);
    expect(p.cardTop, "the card starts above the window").toBeLessThan(0);
    const b = await popBox(page);
    expect(b.top).toBeGreaterThanOrEqual(p.y);
    expect(b.bottom).toBeLessThanOrEqual(b.ih);
  });

  test("a window too short for the whole popup keeps it inside; its sliders scroll", async ({ page }) => {
    await boot(page, 1280, 300, 1600);
    await tapAt(page, 1, (ih) => ih - 30);
    const b = await popBox(page);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.bottom).toBeLessThanOrEqual(b.ih);
    await expect(pop(page).locator("css=.fp-pop-do")).toBeInViewport({ ratio: 1 }); // the button is still reachable
  });
});
