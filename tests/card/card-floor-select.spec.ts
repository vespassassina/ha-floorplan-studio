import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S20.1 and S20.2: the room panel's "All off" button, and the floor pill that selects its floor and loads the same panel.
// Every click is a real page.mouse click or a real key press (CLAUDE.md finding 3). The stub hass records each call as
// the card makes it: callService(domain, service, data) is the shape of Home Assistant's own hass.callService.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// Ground: Living (room 0) gets two more lamps, one off and one on; Kitchen's lamp is on. The Living lamp is bound to a switch (the
// card still acts on the light entity), and the TV plug (a switch) is on in the Living room: neither may appear in the call.
const layout = structuredClone(demo);
const lamp = (id: string, x: number, y: number) => ({ id, type: "light", entity: `light.${id}`, name: id, x, y });
layout.floors.ground.devices.push(lamp("demo_living2", 100, 100), lamp("demo_living3", 150, 300));
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on"), "light.demo_living2": st("off"), "light.demo_living3": st("on"), "light.demo_kitchen": st("on"),
  "switch.demo_living_relay": st("on"), "switch.demo_tv_plug": st("on"), "switch.demo_hall": st("on"), "light.demo_bedroom": st("on"),
});

// The Living lamp is bound to a relay and the plan draws it on while either is on (a bound light is one lamp), so a test that wants
// it off turns the relay off too.
const RELAY_OFF = { "switch.demo_living_relay": st("off") };
type Call = [string, string, { entity_id: string | string[] }];
async function boot(page: Page, width = 1280, states: Record<string, unknown> = STATES(), config: Record<string, unknown> = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      const w = window as unknown as { __calls: unknown[] };
      w.__calls = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      // The shape is Home Assistant's: callService(domain, service, serviceData).
      el.hass = { states: s, callService: (d: string, sv: string, data: unknown) => { w.__calls.push([d, sv, data]); } };
      return el.updateComplete;
    },
    [{ layout, ...config }, states] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);
const setStates = (page: Page, states: Record<string, unknown>) => card(page).evaluate((el, s) => { const e = el as unknown as { hass: object; updateComplete: Promise<unknown> }; e.hass = { ...e.hass, states: s }; return e.updateComplete; }, states);
const pill = (page: Page, name: string) => card(page).locator("css=.fp-floors button", { hasText: name });
const panel = (page: Page) => card(page).locator("css=.fp-room");
const allOff = (page: Page) => card(page).locator("css=.fp-alloff");
const click = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y);
const picked = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll("svg polygon.room-picked")].map((p) => Number(p.getAttribute("data-picked"))));

async function floorPoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!;
    const r = poly.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    return null;
  }, i);
  expect(p, `room ${i} has bare floor to click`).not.toBeNull();
  return p!;
}
async function backgroundPoint(page: Page) {
  const p = await card(page).evaluate((el) => {
    const svg = el.shadowRoot!.querySelector("svg")!, r = svg.getBoundingClientRect();
    for (let y = r.bottom - 4; y > r.top; y -= 6) for (let x = r.left + 4; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === svg) return { x, y };
    return null;
  });
  expect(p, "the plan has bare background").not.toBeNull();
  return p!;
}
const factOf = (page: Page, label: string) => panel(page).locator("css=.fp-room-facts > div", { has: page.locator(`dt:text-is("${label}")`) }).locator("dd");

test.describe("S20.1 All off in the room panel", () => {
  test("one light.turn_off with only the lights that are on; not the lamp that is off, the switch-bound relay or the plug", async ({ page }) => {
    await boot(page);
    await click(page, await floorPoint(page, 0));
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("Living");
    await allOff(page).click();
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.demo_living", "light.demo_living3"] }]]);
  });

  test("it follows hass: gone when every light of the room is off, and nothing is called without a press", async ({ page }) => {
    await boot(page);
    await click(page, await floorPoint(page, 0));
    await expect(allOff(page)).toHaveCount(1);
    await setStates(page, { ...STATES(), ...RELAY_OFF, "light.demo_living": st("off"), "light.demo_living3": st("off") });
    await expect(allOff(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    await setStates(page, { ...STATES(), ...RELAY_OFF, "light.demo_living": st("off") }); // one on again: the button is back and names that one only
    await allOff(page).click();
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.demo_living3"] }]]);
  });

  test("a room with no light on never shows it, and another room's lights are not in the call", async ({ page }) => {
    await boot(page, 1280, { ...STATES(), ...RELAY_OFF, "light.demo_living": st("off"), "light.demo_living3": st("off") });
    await click(page, await floorPoint(page, 0));
    await expect(panel(page)).toHaveCount(1);
    await expect(allOff(page)).toHaveCount(0);
    await click(page, await floorPoint(page, 1)); // Kitchen: its lamp is on
    await allOff(page).click();
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.demo_kitchen"] }]]);
  });

  test("a lamp lit only by its bound relay is on in the plan, so it is in the call, by its light entity", async ({ page }) => {
    await boot(page, 1280, { ...STATES(), "light.demo_living": st("off"), "light.demo_living3": st("off") }); // relay still on
    await click(page, await floorPoint(page, 0));
    await expect(factOf(page, "Lights on")).toHaveText("Living light");
    await allOff(page).click();
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.demo_living"] }]]);
  });

  test("read-only Home Assistant (no callService) does not throw", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await boot(page);
    await card(page).evaluate((el) => { const e = el as unknown as { hass: { states: object }; updateComplete: Promise<unknown> }; e.hass = { states: e.hass.states }; return e.updateComplete; });
    await click(page, await floorPoint(page, 0));
    await allOff(page).click();
    expect(errors).toEqual([]);
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("S20.2 selecting a floor from its pill", () => {
  test("a pill click switches the floor, selects it and loads the panel with the floor's own summary", async ({ page }) => {
    await boot(page);
    await expect(panel(page)).toHaveCount(0);
    await pill(page, "First").click();
    await expect(pill(page, "First")).toHaveAttribute("aria-pressed", "true"); // aria-pressed still marks the floor shown
    await expect(pill(page, "First")).toHaveClass(/fp-floor-picked/);
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("First");
    await expect(factOf(page, "Lights on")).toHaveText("Bedroom light");
    await expect(card(page).locator("css=.fp-room-devices")).toContainText("Office");
    expect(await picked(page)).toEqual([]); // no room is outlined: it is the floor
  });

  test("the panel holds every room's devices, and All off acts on every light on the floor", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click(); // the shown floor: selected, not switched
    await expect(pill(page, "Ground")).toHaveClass(/fp-floor-picked/);
    await expect(factOf(page, "Lights on")).toHaveText("Living light, Kitchen light, demo_living3");
    await expect(card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Kitchen light" })).toHaveCount(1);
    await expect(card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living light" })).toHaveCount(1);
    await allOff(page).click();
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.demo_living", "light.demo_kitchen", "light.demo_living3"] }]]);
  });

  test("a room pick replaces the floor selection, and the pill lets go", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click();
    await click(page, await floorPoint(page, 1));
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("Kitchen");
    await expect(pill(page, "Ground")).not.toHaveClass(/fp-floor-picked/);
    expect(await picked(page)).toEqual([1]);
    await pill(page, "Ground").click(); // the floor replaces the room
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("Ground");
    expect(await picked(page)).toEqual([]);
  });

  test("clicking the selected pill again, Escape, the empty plan and the x each clear it", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click();
    await pill(page, "Ground").click();
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page, "Ground")).not.toHaveClass(/fp-floor-picked/);

    await pill(page, "Ground").click();
    await click(page, await backgroundPoint(page));
    await expect(panel(page)).toHaveCount(0);

    await pill(page, "Ground").click();
    await card(page).locator("css=.fp-room-clear").click();
    await expect(panel(page)).toHaveCount(0);

    await pill(page, "Ground").click();
    await page.mouse.move(400, 300); // the pointer over the card, so it owns the key
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page, "Ground")).not.toHaveClass(/fp-floor-picked/);
  });

  test("switching floor with a pill moves the selection to that floor; the old floor's is gone", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click();
    await pill(page, "First").click();
    await expect(pill(page, "Ground")).not.toHaveClass(/fp-floor-picked/);
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("First");
  });

  test("the selection survives a hass update and follows the state", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click();
    await card(page).locator("css=.fp-room-devices .fp-info-btn").first().click(); // an open details block must survive too
    await setStates(page, { ...STATES(), "light.demo_kitchen": st("off") });
    await expect(pill(page, "Ground")).toHaveClass(/fp-floor-picked/);
    await expect(factOf(page, "Lights on")).toHaveText("Living light, demo_living3");
    await expect(card(page).locator("css=.fp-room-devices .fp-info")).toHaveCount(1);
  });

  test("setConfig clears it", async ({ page }) => {
    await boot(page);
    await pill(page, "Ground").click();
    await expect(panel(page)).toHaveCount(1); // it was open, so the absence below means something
    await card(page).evaluate((el, l) => { const e = el as unknown as { setConfig(c: unknown): void; updateComplete: Promise<unknown> }; e.setConfig({ layout: l }); return e.updateComplete; }, layout);
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page, "Ground")).not.toHaveClass(/fp-floor-picked/);
  });

  test("the pill works from the keyboard", async ({ page }) => {
    await boot(page);
    await pill(page, "First").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("First");
    await page.keyboard.press("Escape"); // focus is in the card, so it owns the key
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText("First");
  });

  test("a narrow card shows the panel on top of nothing else", async ({ page }) => {
    await boot(page, 375);
    await pill(page, "First").click();
    const covered = await panel(page).evaluate((el) => { const r = el.getBoundingClientRect(); return !(el.getRootNode() as ShadowRoot).elementFromPoint(r.x + 8, r.y + 8)?.closest(".fp-room"); });
    expect(covered).toBe(false);
  });

  test("kiosk draws no pills, so nothing selects a floor", async ({ page }) => {
    await boot(page, 1280, STATES(), { kiosk: true });
    await expect(card(page).locator("css=.fp-floors")).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });

  test("a floor name that is markup is text", async ({ page }) => {
    const bad = structuredClone(layout);
    bad.floors.first.title = '"><script>window.__pwned=1</script>';
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(URL_);
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await card(page).evaluate((el, l) => { const e = el as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> }; e.setConfig({ layout: l }); e.hass = { states: {} }; return e.updateComplete; }, bad);
    await card(page).locator("css=.fp-floors button").nth(1).click();
    await expect(panel(page).locator("css=.fp-room-name")).toHaveText('"><script>window.__pwned=1</script>');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe("CSS pairs (finding 10): the rule reaches the pixel", () => {
  test("a selected pill looks different from an idle one and from a shown-only one, in the card's own variables", async ({ page }) => {
    await boot(page);
    const look = (name: string) => pill(page, name).evaluate((b) => { const s = getComputedStyle(b); return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, shadow: s.boxShadow }; });
    const idle = await look("First");
    const shown = await look("Ground");
    await pill(page, "Ground").click();
    const picked = await look("Ground");
    expect(picked).not.toEqual(shown);
    expect(picked).not.toEqual(idle);
    expect(picked.bg).toBe(shown.bg); // the shown floor keeps its fill; the selection is an extra ring, not a second fill
    expect(picked.shadow).not.toBe("none"); // the ring
  });
  test("the All off button is a real, clickable size and the top element at its centre", async ({ page }) => {
    await boot(page);
    await click(page, await floorPoint(page, 0));
    const b = (await allOff(page).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(28);
    const top = await allOff(page).evaluate((el) => { const r = el.getBoundingClientRect(), hit = (el.getRootNode() as ShadowRoot).elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && el.contains(hit); });
    expect(top).toBe(true);
  });
});
