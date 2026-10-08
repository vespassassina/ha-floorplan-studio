import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S22.1 (C1): a lamp lit by its bound relay can be turned off from the card. The demo's Living light (ground device 0) is
// bound to switch.demo_living_relay; the plan draws it on while either entity is on (render.ts `boundClassOf`). Every click is a
// real page.mouse click at a point checked to be the real top element (CLAUDE.md finding 3). The stub records each call the
// way Home Assistant's own hass.callService(domain, service, serviceData) receives it; the card is the caller.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// A second Living lamp on the same relay: two lamps, one relay.
const layout = structuredClone(demo);
layout.floors.ground.devices.push({ id: "demo_living2", type: "light", entity: "light.demo_living2", name: "Living lamp 2", x: 100, y: 100, bound: "switch.demo_living_relay" });
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
// Relay on, both lamps' own light entities off: the plan draws both lit. Kitchen's lamp is off, so nothing else is lit on Ground.
const STATES = () => ({
  "light.demo_living": st("off", { friendly_name: "Living light", supported_color_modes: ["onoff"] }), "light.demo_living2": st("off", { supported_color_modes: ["onoff"] }),
  "switch.demo_living_relay": st("on", { friendly_name: "Living relay" }), "light.demo_kitchen": st("off"),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("off"),
});
type Call = [string, string, Record<string, unknown>];

async function boot(page: Page, states: Record<string, unknown> = STATES()) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      const w = window as unknown as { __calls: unknown[]; __info: string[] };
      w.__calls = []; w.__info = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
      el.setConfig(cfg);
      el.hass = { states: s, callService: (d: string, sv: string, data: unknown) => { w.__calls.push([d, sv, data]); } };
      return el.updateComplete;
    },
    [{ layout }, states] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const pop = (page: Page) => card(page).locator("css=.fp-pop");

/** A point on the element `sel` (inside the card's shadow root) where it, or a descendant, is the real top element. */
async function topPoint(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel)!;
    const r = t.getBoundingClientRect();
    for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
      const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8, top = el.shadowRoot!.elementFromPoint(x, y);
      if (top && (top === t || t.contains(top))) return { x, y };
    }
    return null;
  }, sel);
  expect(p, `${sel} is the top element somewhere on its box`).not.toBeNull();
  return p!;
}
const clickOn = async (page: Page, sel: string) => { const p = await topPoint(page, sel); await page.mouse.click(p.x, p.y); };
async function roomPoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!;
    const r = poly.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    return null;
  }, i);
  expect(p, `room ${i} has bare floor to click`).not.toBeNull();
  return p!;
}

test.describe("S22.1 a relay-lit lamp", () => {
  test("its popup reads on, names the relay, and Turn off calls switch.turn_off on the relay only", async ({ page }) => {
    await boot(page);
    await clickOn(page, 'svg g[data-x="0"]');
    await expect(pop(page)).toHaveAttribute("aria-label", "Living light");
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("on · via Living relay");
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
    expect(await calls(page)).toEqual([]);
    await clickOn(page, ".fp-pop .fp-pop-do"); // a lamp: no confirm step
    expect(await calls(page)).toEqual([["switch", "turn_off", { entity_id: ["switch.demo_living_relay"] }]]);
    await expect(pop(page)).toHaveCount(0);
  });

  test("with the light on too, Turn off calls light.turn_off on the light and switch.turn_off on the relay", async ({ page }) => {
    await boot(page, { ...STATES(), "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["onoff"] }) });
    await clickOn(page, 'svg g[data-x="0"]');
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("on");
    await clickOn(page, ".fp-pop .fp-pop-do");
    expect(await calls(page)).toEqual([
      ["light", "turn_off", { entity_id: ["light.demo_living"] }],
      ["switch", "turn_off", { entity_id: ["switch.demo_living_relay"] }],
    ]);
  });

  test("relay off: the popup reads off and Turn on keeps calling light.turn_on on the light", async ({ page }) => {
    await boot(page, { ...STATES(), "switch.demo_living_relay": st("off", { friendly_name: "Living relay" }) });
    await clickOn(page, 'svg g[data-x="0"]');
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("off");
    await clickOn(page, ".fp-pop .fp-pop-do");
    expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.demo_living" }]]);
  });

  test("More info offers the light and its relay in the chooser", async ({ page }) => {
    await boot(page);
    await clickOn(page, 'svg g[data-x="0"]');
    await clickOn(page, ".fp-pop .fp-pop-more");
    const list = card(page).locator("css=.fp-chooser-dialog .fp-chooser-list button");
    await expect(list).toHaveCount(2);
    await expect(list.nth(1)).toContainText("Living relay");
    await clickOn(page, ".fp-chooser-list button:nth-child(2)");
    expect(await infos(page)).toEqual(["switch.demo_living_relay"]);
    expect(await calls(page)).toEqual([]);
  });

  test("room All off shows for a relay-only room and calls the shared relay once", async ({ page }) => {
    await boot(page);
    const p = await roomPoint(page, 0);
    await page.mouse.click(p.x, p.y);
    await expect(card(page).locator("css=.fp-room-name")).toHaveText("Living");
    await expect(card(page).locator("css=.fp-alloff")).toHaveCount(1);
    await clickOn(page, ".fp-alloff");
    expect(await calls(page)).toEqual([["switch", "turn_off", { entity_id: ["switch.demo_living_relay"] }]]);
  });

  test("floor All off adds the relay next to the lights that are on", async ({ page }) => {
    await boot(page, { ...STATES(), "light.demo_kitchen": st("on"), "light.demo_living2": st("on") });
    await clickOn(page, ".fp-floors button[aria-pressed=true]"); // Ground, the floor shown: selects it
    await expect(card(page).locator("css=.fp-room-name")).toHaveText("Ground");
    await clickOn(page, ".fp-alloff");
    expect(await calls(page)).toEqual([
      ["light", "turn_off", { entity_id: ["light.demo_kitchen", "light.demo_living2"] }],
      ["switch", "turn_off", { entity_id: ["switch.demo_living_relay"] }],
    ]);
  });
});
