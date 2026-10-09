import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S25.D1 in a real card (Diego, 2026-10-09: "open doors are just holes and closed doors are closed. doors with no sensor are
// left open"). The demo's Front door (ground floor, door 0) and Patio (glass, door 1) have a contact each. Read back from Chromium.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");
const FRONT = "binary_sensor.demo_front_door", PATIO = "binary_sensor.demo_patio_door";
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-01T10:00:00Z" });

async function boot(page: Page, view: string) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ layout, view }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", floor: "ground", view });
    el.hass = { states: {}, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { layout: demo, view });
  await expect(card(page).locator("css=svg line.door-hit")).not.toHaveCount(0);
}
const setStates = (page: Page, states: Record<string, unknown>) => page.evaluate(async (states) => {
  const el = document.getElementById("card") as unknown as { hass: object; updateComplete: Promise<unknown> };
  el.hass = { ...el.hass, states };
  await el.updateComplete;
}, states);
/** The painted stroke of door `i`'s own line, the colour --fp-door / --fp-glass / --fp-open-door resolve to, and the wall-thin width. */
const line = (page: Page, i: number) => card(page).evaluate((el, i) => {
  const l = el.shadowRoot!.querySelector(`svg line.door[data-d="${i}"]`)!, cs = getComputedStyle(l);
  const probe = (v: string) => { const p = document.createElement("i"); p.style.color = `var(${v})`; el.shadowRoot!.querySelector("svg")!.parentNode!.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  return { stroke: cs.stroke, width: l.getAttribute("stroke-width"), cls: l.getAttribute("class")!, door: probe("--fp-door"), glass: probe("--fp-glass"), red: probe("--fp-open-door"), syms: el.shadowRoot!.querySelectorAll(`svg [data-ds="${i}"]`).length };
}, i);
const HOLE = "rgba(0, 0, 0, 0)";

for (const view of ["2d", "2.5d"]) {
  test(`${view}: a door is a hole until its contact says off, a hole again when it is unavailable, red when open; no leaf at any time`, async ({ page }) => {
    await boot(page, view);
    await setStates(page, { [FRONT]: st("off"), [PATIO]: st("off") });
    let d = await line(page, 0), g = await line(page, 1);
    expect(d.stroke, "door closed").toBe(d.door);
    expect(g.stroke, "glass door closed").toBe(g.glass);
    expect(d.syms + g.syms, "no leaf, no symbol").toBe(0);
    await setStates(page, { [FRONT]: st("on"), [PATIO]: st("on") });
    d = await line(page, 0); g = await line(page, 1);
    expect(d.stroke, "door open stays the red alert").toBe(d.red);
    expect(d.cls).toContain("open");
    expect(g.stroke).toBe(g.red);
    for (const v of ["unavailable", "unknown"]) {
      await setStates(page, { [FRONT]: st(v), [PATIO]: st(v) });
      expect((await line(page, 0)).stroke, `door ${v}`).toBe(HOLE);
      expect((await line(page, 1)).stroke, `glass door ${v}`).toBe(HOLE);
      await setStates(page, { [FRONT]: st("off"), [PATIO]: st("off") });
      expect((await line(page, 0)).stroke, `door back to closed`).toBe(d.door);
    }
    await setStates(page, {});
    expect((await line(page, 0)).stroke, "no state").toBe(HOLE);
  });
}

test("2d: the door with no sensor at all (the garage) is a hole whatever the states say", async ({ page }) => {
  await boot(page, "2d");
  await setStates(page, { [FRONT]: st("off"), [PATIO]: st("off"), "cover.demo_garage_door": st("closed") });
  expect((await line(page, 2)).stroke).toBe(HOLE);
});
