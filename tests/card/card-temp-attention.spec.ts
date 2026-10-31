import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S42.3 (docs/specs/temp-range.md, decision 12 and criterion 6): the Attention row of a room out of range taps to the room, as a
// tap on the room does on the plan. The click is a real page.mouse click at the row's own coordinates, checked to be the top
// element there (CLAUDE.md finding 3). `_tempWarn` is set by hand: S42.4 fills it from the onset memory.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const layout = structuredClone(demo);
layout.tempRange = { min: 17, max: 26 };
Object.assign(layout.floors.ground.rooms[1], { temps: ["sensor.demo_kitchen_temperature"] }); // Kitchen, room 1
Object.assign(layout.floors.first.rooms[0], { temps: ["sensor.demo_bedroom_temperature"] }); // Bedroom, room 0 of the first floor
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-31T09:30:15Z" });
const STATES = { "sensor.demo_kitchen_temperature": st("27.4", { unit_of_measurement: "°C" }), "sensor.demo_bedroom_temperature": st("15.5", { unit_of_measurement: "°C" }) };

async function boot(page: Page, width: number, floor = "ground") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown>; _tempWarn: unknown };
      el.setConfig(config);
      el._tempWarn = { "room-ground-2": "hot", "room-first-1": "cold" };
      el.hass = { states, callService: () => {} };
      return el.updateComplete;
    },
    [{ layout, floor }, STATES] as const,
  );
}
/** A phone sheet rests at peek with its rows out of reach: a real tap on its handle raises it. */
async function openSheet(page: Page, width: number) {
  if (width >= 640) return;
  const h = card(page).locator("css=.fp-bottom .fp-handle");
  await h.click();
  await expect(h).toHaveAttribute("aria-expanded", "true");
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const picked = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll("svg polygon.room-picked")].map((p) => Number(p.getAttribute("data-picked"))));

/** The row's centre once its box has stopped moving (a phone sheet rises over 0.2 s), checked to be the real top element there. */
async function rowPoint(page: Page, name: string) {
  const sel = `css=.fp-ov-attn .fp-active-row:has(.fp-ov-name:text-is("${name}"))`;
  let last = "", same = 0;
  await expect.poll(async () => { const b = await card(page).locator(sel).boundingBox(); const k = JSON.stringify(b); same = k === last ? same + 1 : 0; last = k; return same; }, { timeout: 4000 }).toBeGreaterThanOrEqual(3);
  const p = await card(page).locator(sel).evaluate((row) => {
    const r = row.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = (row.getRootNode() as ShadowRoot).elementFromPoint(x, y);
    return { x, y, hit: !!top && row.contains(top) };
  });
  expect(p.hit, `row ${name} is the top element at its centre`).toBe(true);
  return p;
}

for (const width of [1280, 375]) {
  test.describe(`a temperature row at ${width} px`, () => {
    test("reads 'Kitchen 27.4 °C, above 26' and a tap picks that room", async ({ page }) => {
      await boot(page, width);
      const row = card(page).locator('css=.fp-ov-attn .fp-active-row:has(.fp-ov-name:text-is("Kitchen"))');
      await expect(row.locator("css=.fp-row-state")).toHaveText("27.4 °C, above 26");
      expect(await picked(page)).toEqual([]);
      await openSheet(page, width);
      const p = await rowPoint(page, "Kitchen");
      await page.mouse.click(p.x, p.y);
      expect(await picked(page)).toEqual([1]);
      await expect(card(page).locator("css=.fp-room .fp-room-name")).toHaveText("Kitchen");
    });

    test("a row of another floor switches to that floor and picks its room", async ({ page }) => {
      await boot(page, width, "all");
      // The Overview lists the floor on show; "All floors" lists every one (the card's own state, as the floor picker sets it).
      await card(page).evaluate((el) => { const c = el as unknown as { _overviewAll: boolean; requestUpdate(): void }; c._overviewAll = true; c.requestUpdate(); });
      await expect(card(page).locator("css=.fp-ov-attn .fp-active-row")).toHaveCount(2);
      await openSheet(page, width);
      const p = await rowPoint(page, "Bedroom");
      await page.mouse.click(p.x, p.y);
      await expect(card(page).locator("css=.fp-room .fp-room-name")).toHaveText("Bedroom");
      expect(await picked(page)).toEqual([0]);
    });
  });
}
