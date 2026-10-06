import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// The slit window in the card, in a real Chromium: the glass band of a slit sits against the top of its wall in 2.5D,
// at half the height of the demo's 120 cm window, and it takes the window's look in every theme (CLAUDE.md findings 10, 16).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");

/** The websocket reply has the shape websocket.py sends: `{ layout }` (CLAUDE.md finding 21). */
async function boot(page: Page, layout: unknown) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ layout }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", floor: "first", view: "2.5d" });
    el.hass = { states: {}, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { layout });
}

test("2.5D: a slit's glass is 60 cm of a 250 cm wall, its head 40 cm under the wall top like a window's, half the demo window's band", async ({ page }) => {
  const l = structuredClone(demo);
  l.floors.first.doors.push({ id: "slit1", name: "Slit window", kind: "slit", a: [500, 0], b: [700, 0] }); // the back wall, in the Bathroom
  await boot(page, l);
  await expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0); // not mid-turn
  await expect(card(page).locator("css=svg polygon.glass.g-slit").first()).toBeAttached();
  const r = await card(page).evaluate((el) => {
    const q = (s: string) => [...el.shadowRoot!.querySelectorAll(s)].map((p) => { const b = p.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, left: b.left, right: b.right }; });
    return { slit: q("svg polygon.glass.g-slit"), win: q("svg polygon.glass.g-window"), walls: q("svg polygon.ws") };
  });
  // A room wall and the outline wall behind it each draw the band (as for the window), on the same spot.
  expect(r.slit.length).toBeGreaterThanOrEqual(1);
  expect(r.win.length).toBeGreaterThanOrEqual(1);
  expect(r.slit.every((q) => Math.abs(q.top - r.slit[0].top) < 0.5 && Math.abs(q.h - r.slit[0].h) < 0.5)).toBe(true);
  // The window band is 120 cm high, the slit 60: half, in real pixels.
  expect(r.slit[0].h / r.win[0].h).toBeCloseTo(0.5, 1);
  // The highest wall side on screen is the back wall's full 250 cm (nothing is above it). A window's head is 40 cm under
  // that (sill 90 + 120 high), so the slit's glass starts 40 cm of wall under the top: in real pixels, 40 cm = a third of the window band.
  const wallTop = Math.min(...r.walls.map((w) => w.top)), pxPerCm = r.win[0].h / 120;
  expect((r.slit[0].top - wallTop) / pxPerCm).toBeGreaterThan(38);
  expect((r.slit[0].top - wallTop) / pxPerCm).toBeLessThan(42);
  // And the glass sits on a block of wall: the wall side beneath it ends where the glass begins.
  expect(r.walls.some((w) => Math.abs(w.top - r.slit[0].bottom) < 1.5 && w.left < r.slit[0].left && w.right > r.slit[0].left)).toBe(true); // (the block leans with the projection, so only overlap is asked)
});

test("2D CSS pair: a slit's line resolves to the window's stroke, not the door's, in every theme", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}"><line class="door door-slit door-window" x1="0" y1="0" x2="9" y2="0"/><line class="door door-window" x1="0" y1="0" x2="9" y2="0"/><line class="door door-door" x1="0" y1="0" x2="9" y2="0"/></g>`).join("")}</svg></body></html>`);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => { const c = (el: Element) => getComputedStyle(el).stroke; const [s, w, d] = [...g.children]; return { s: c(s), w: c(w), d: c(d), win: getComputedStyle(g).getPropertyValue("--fp-window").trim(), door: getComputedStyle(g).getPropertyValue("--fp-door").trim() }; });
    expect(r.s, t).toBe(r.w);
    expect(r.s, t).toMatch(/^(rgb|color)\(/);
    // Role-generated themes give door and window one colour on purpose; where the tokens differ, the slit must follow the window.
    if (r.win !== r.door) expect(r.s, `${t}: not the door colour`).not.toBe(r.d);
  }
});
test("2.5D CSS pair: the slit's glass resolves to the window's colour and opacity in every theme and takes no clicks", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}"><polygon class="glass g-slit" points="0,0 1,0 1,1"/><polygon class="glass g-window" points="0,0 1,0 1,1"/></g>`).join("")}</svg></body></html>`);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const [s, w] = [...g.children];
      return { s: [c(s, "fill"), c(s, "fill-opacity"), c(s, "stroke"), c(s, "pointer-events")], w: [c(w, "fill"), c(w, "fill-opacity"), c(w, "stroke"), c(w, "pointer-events")] };
    });
    expect(r.s[0], t).toMatch(/^(rgb|color)\(/);
    expect(r.s, t).toEqual(r.w);
    expect(Number(r.s[1]), t).toBeLessThan(1);
    expect(r.s[3], t).toBe("none");
  }
});
