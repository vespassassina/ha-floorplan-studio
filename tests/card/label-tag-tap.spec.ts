import { test, expect, type Page } from "@playwright/test";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// Opus review of Sprint 23, M1: a name on a tag (S23.3, `text.lbl.lbl-on`) is drawn over the icons. The plate took no clicks
// but the name on it did, so a tap on a device under the name found no device and picked the room instead. Real
// page.mouse clicks at the screen point where a device's disc sits under the name (finding 3).

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

// One small room packed with switches: every spot is covered, so its name goes on a tag over the icons. The rows are at
// y = 20, 40, 60 ..., so a switch sits exactly at the room's centre (150, 60), where the name is drawn, at any font.
const devices: { id: string; type: string; entity: string; x: number; y: number }[] = [];
for (let x = 10; x < 300; x += 20) for (let y = 20; y < 120; y += 20) devices.push({ id: `s${x}-${y}`, type: "switch", entity: `switch.s${x}_${y}`, x, y });
const pts = [[0, 0], [300, 0], [300, 120], [0, 120]];
const layout = {
  version: 2, unit: "cm", north: 0, rotate: 0, catalog: [],
  floors: { ground: { title: "Ground", outline: pts, owk: pts.map(() => "external"), walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    rooms: [{ id: "den", name: "Den", area: "", kind: "room", pts, wk: pts.map(() => "wall") }], devices } },
};
const states = Object.fromEntries(devices.map((d) => [d.entity, { state: "off", attributes: { friendly_name: `Switch ${d.id}` }, last_changed: "2026-10-08T10:00:00Z" }]));

async function boot(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground" }, states] as const);
}
const card = (page: Page) => page.locator("floorplan-studio-card");

for (const width of [1280, 375]) {
  test(`a tap on a device under a tagged name reaches the device, not the room, at ${width} px`, async ({ page }) => {
    await boot(page, width);
    await expect(card(page).locator("css=svg text.lbl-on")).toHaveCount(1);
    // The point of the name's own box nearest a device's disc centre, as the screen draws them. The box is as small as
    // 21 x 13 px at 375 px and the discs 24 px apart: with the old grid (rows at y = 10, 30 ...) a centre fell in the box
    // by luck of the font on a Mac and not on the CI runner. Now a switch sits at the room's centre, under the name.
    const hit = await card(page).evaluate((el) => {
      const root = el.shadowRoot!, t = root.querySelector("svg text.lbl-on")!.getBoundingClientRect();
      // For each disc the point of the name's box nearest its centre; the disc that comes closest wins.
      let best: { x: number; y: number; d: number; r: number } | null = null;
      for (const g of root.querySelectorAll("svg g[data-x]")) {
        const h = g.querySelector(".halo")!.getBoundingClientRect(), cx = h.x + h.width / 2, cy = h.y + h.height / 2;
        const x = Math.min(Math.max(cx, t.left + 1), t.right - 1), y = Math.min(Math.max(cy, t.top + 1), t.bottom - 1), d = Math.hypot(cx - x, cy - y);
        if (!best || d < best.d) best = { x, y, d, r: h.width };
      }
      if (best && best.d <= best.r * 0.2) {
        const g = root.elementFromPoint(best.x, best.y)?.closest("g[data-x]");
        return { x: best.x, y: best.y, d: best.d, i: g ? Number(g.getAttribute("data-x")) : null };
      }
      return null;
    });
    expect(hit, "a device disc overlaps the tagged name").not.toBeNull();
    expect(hit!.i, "the top element at that point is a device's group, not the name").not.toBeNull();
    await page.mouse.click(hit!.x, hit!.y);
    // S25.5: at 375 px these switches, 20 cm apart, overlap, so the first tap fans the stack out and the device is tapped again where the ring put it.
    if (await card(page).locator("css=svg .spider-leader").count()) {
      const at = await card(page).evaluate((el, i) => { const r = el.shadowRoot!.querySelector(`svg g[data-x="${i}"] .halo`)!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, hit!.i!);
      await page.mouse.click(at.x, at.y);
    }
    // The device's own action: a tap opens its popup (S14.2), named after it, and calls nothing.
    await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", `Switch ${devices[hit!.i!].id}`);
    expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual([]);
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll("svg polygon.room-picked").length), "the room is not picked").toBe(0);
  });
}
