import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// Opus re-check of Sprint 31, findings 2 and 3: where focus goes when Back or Escape takes the sheet up a level.
// Real mouse and real keys on the built card in the harness.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

async function boot(page: Page, size: { width: number; height: number }) {
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
  }, { layout: demo, floor: "ground", theme: "light" });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}

/** The real top point of the first room that is a polygon on screen, found by looking. */
const roomPoint = (page: Page) => page.evaluate(() => {
  const root = document.getElementById("card")!.shadowRoot!;
  for (const p of root.querySelectorAll<SVGPolygonElement>("polygon[data-r]")) {
    const b = p.getBoundingClientRect();
    for (let a = 1; a < 10; a++) for (let c = 1; c < 10; c++) {
      const x = b.left + (b.width * a) / 10, y = b.top + (b.height * c) / 10;
      if (root.elementFromPoint(x, y) === p) return { x, y };
    }
  }
  return null;
});
/** Class of the focused element inside the card's shadow root, and whether the page's own focus is outside the card. */
const focusIn = (page: Page) => page.evaluate(() => {
  const el = document.getElementById("card")!, a = el.shadowRoot!.activeElement;
  return { inside: a ? a.className : null, outside: document.activeElement?.id ?? null };
});
const picked = (page: Page) => page.evaluate(() => { const c = document.getElementById("card") as unknown as { _pickedRoom: unknown; _pickedFloor: unknown }; return { room: !!c._pickedRoom, floor: !!c._pickedFloor }; });

test("768 x 1024: Escape twice from a room lands focus on the rail's open button", async ({ page }) => {
  await boot(page, { width: 768, height: 1024 });
  const pt = await roomPoint(page);
  await page.mouse.click(pt!.x, pt!.y);
  await expect.poll(() => picked(page)).toMatchObject({ room: true });
  await page.keyboard.press("Escape"); // room to floor
  await expect.poll(() => picked(page)).toEqual({ room: false, floor: true });
  await page.keyboard.press("Escape"); // floor to Overview: the sheet folds to the rail
  await expect.poll(() => picked(page)).toEqual({ room: false, floor: false });
  await expect.poll(async () => (await focusIn(page)).inside).toContain("fp-rail-open");
});

test("1280 x 1000: Back with focus on a button outside the card leaves it there, though the pointer is over the card", async ({ page }) => {
  await boot(page, { width: 1280, height: 1000 });
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "elsewhere"; b.textContent = "elsewhere"; b.style.cssText = "position:fixed;right:0;bottom:0"; document.body.append(b); });
  const pt = await roomPoint(page);
  await page.mouse.click(pt!.x, pt!.y); // a real pick; the pointer stays over the plan
  await expect.poll(() => picked(page)).toMatchObject({ room: true });
  await page.evaluate(() => document.getElementById("elsewhere")!.focus());
  await page.keyboard.press("Escape"); // the card owns the key by hover only
  await expect.poll(() => picked(page)).toEqual({ room: false, floor: true });
  const f = await focusIn(page);
  expect(f.outside, "focus is still on the page's own button").toBe("elsewhere");
  expect(f.inside).toBeNull();
});

test("1280 x 1000: Back with focus inside the card moves it to the sheet's own control", async ({ page }) => {
  await boot(page, { width: 1280, height: 1000 });
  const pt = await roomPoint(page);
  await page.mouse.click(pt!.x, pt!.y);
  await expect.poll(() => picked(page)).toMatchObject({ room: true });
  await page.keyboard.press("Escape");
  await expect.poll(() => picked(page)).toEqual({ room: false, floor: true });
  await expect.poll(async () => (await focusIn(page)).inside).toMatch(/fp-back|fp-active-collapse|fp-handle/);
});
