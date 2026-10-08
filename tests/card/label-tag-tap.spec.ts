import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Opus review of Sprint 23, M1: a name on a tag (S23.3, `text.lbl.lbl-on`) is drawn over the icons. The plate took no clicks
// but the name on it did, so a tap on a device under the name found no device and picked the room instead. Real
// page.mouse clicks at the screen point where a device's disc sits under the name (finding 3).

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// One small room packed with switches: every spot is covered, so its name goes on a tag over the icons.
const devices: { id: string; type: string; entity: string; x: number; y: number }[] = [];
for (let x = 10; x < 300; x += 20) for (let y = 10; y < 120; y += 20) devices.push({ id: `s${x}-${y}`, type: "switch", entity: `switch.s${x}_${y}`, x, y });
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
    // The disc centre of a device that lies inside the name's own box, as the screen draws them.
    const hit = await card(page).evaluate((el) => {
      const root = el.shadowRoot!, t = root.querySelector("svg text.lbl-on")!.getBoundingClientRect();
      for (const g of root.querySelectorAll("svg g[data-x]")) {
        const h = g.querySelector(".halo")!.getBoundingClientRect(), x = h.x + h.width / 2, y = h.y + h.height / 2;
        if (x > t.left + 2 && x < t.right - 2 && y > t.top + 2 && y < t.bottom - 2) return { x, y, i: Number(g.getAttribute("data-x")) };
      }
      return null;
    });
    expect(hit, "a device sits under the tagged name").not.toBeNull();
    const top = await card(page).evaluate((el, p) => el.shadowRoot!.elementFromPoint(p.x, p.y)?.closest("g[data-x]")?.getAttribute("data-x") ?? null, hit!);
    expect(top, "the top element at the disc is the device's group").toBe(String(hit!.i));
    await page.mouse.click(hit!.x, hit!.y);
    // The device's own action: a tap opens its popup (S14.2), named after it, and calls nothing.
    await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", `Switch ${devices[hit!.i].id}`);
    expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual([]);
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll("svg polygon.room-picked").length), "the room is not picked").toBe(0);
  });
}
