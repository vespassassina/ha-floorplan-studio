import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// The open doorway in the card, in a real Chromium: closed it draws nothing at all; when its contact says open it
// wears the same dashed alert as any door (Diego, 2026-10-05: "open ... do not draw the door").

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");
const SENSOR = "binary_sensor.hall_arch";

/** The websocket reply has the shape websocket.py sends: `{ layout }` (CLAUDE.md finding 21). */
async function boot(page: Page, view: string, contact: "on" | "off") {
  const layout = structuredClone(demo);
  layout.floors.first.doors.push({ id: "arch", name: "Hall arch", kind: "open", a: [500, 0], b: [590, 0], sensors: [SENSOR] });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ layout, view, contact, SENSOR }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", floor: "first", view });
    el.hass = { states: { [SENSOR]: { state: contact, attributes: {}, last_changed: new Date().toISOString() } }, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { layout, view, contact, SENSOR });
  await expect(card(page).locator("css=svg line.door-hit-open")).toHaveCount(1);
}

test("2D: a closed doorway draws no line at all; the plan holds one door line fewer than doors", async ({ page }) => {
  await boot(page, "2d", "off");
  const n = await card(page).evaluate((el) => ({ doors: el.shadowRoot!.querySelectorAll("svg line.door-hit").length, drawn: el.shadowRoot!.querySelectorAll("svg line.door:not(.door-hit)").length, alert: el.shadowRoot!.querySelectorAll("svg line.door-alert").length }));
  expect(n.drawn).toBe(n.doors - 1);
  expect(n.alert).toBe(0);
});

test("2D: an open contact on it draws the dashed alert line in the open-door colour, and the pulse", async ({ page }) => {
  await boot(page, "2d", "on");
  const r = await card(page).evaluate((el) => {
    const hit = el.shadowRoot!.querySelector("svg line.door-hit-open")!, i = hit.getAttribute("data-d")!;
    const l = el.shadowRoot!.querySelector(`svg line.door-open[data-d="${i}"]`)!, cs = getComputedStyle(l);
    return { cls: l.getAttribute("class"), dash: cs.strokeDasharray, stroke: cs.stroke, alert: el.shadowRoot!.querySelectorAll("svg line.door-alert").length };
  });
  expect(r.cls).toMatch(/door-open.*\bopen\b/);
  expect(r.dash).not.toBe("none");
  expect(r.alert).toBe(1);
  expect(r.stroke).toMatch(/^(rgb|color)\(/);
});

test("2.5D: closed, nothing stands in the gap; open, the red frame does", async ({ page }) => {
  await boot(page, "2.5d", "off");
  await expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
  const leafs = (p: Page) => card(p).evaluate((el) => ({ opn: el.shadowRoot!.querySelectorAll("svg polygon.opn").length, open: el.shadowRoot!.querySelectorAll("svg polygon.opn.open").length }));
  const closed = await leafs(page);
  await boot(page, "2.5d", "on");
  await expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
  const on = await leafs(page);
  expect(on.open).toBeGreaterThan(closed.open); // the red frame of the doorway appears
});

test("CSS pair: a selected doorway is a faint line, an open one is not; an open one keeps its full colour", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}"><line class="door door-open sel" x1="0" y1="0" x2="9" y2="0"/><line class="door door-open sel open" x1="0" y1="0" x2="9" y2="0"/><line class="door door-door sel" x1="0" y1="0" x2="9" y2="0"/></g>`).join("")}</svg></body></html>`);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => [...g.children].map((l) => getComputedStyle(l).strokeOpacity));
    expect(Number(r[0]), t).toBeLessThan(0.5);
    expect(Number(r[0]), t).toBeGreaterThan(0);
    expect(r[1], t).toBe("1");
    expect(r[2], t).toBe("1");
  }
});
