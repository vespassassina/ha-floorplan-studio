import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

// Opus review of S2.1: the card's own chrome (p.msg, anything outside the <svg>) is styled by FLOORPLAN_CSS's
// :host rules, which read data-theme off the host element. Since S2.12 the default is blueprint, whatever the OS or
// hass says; light is a config choice; ha inherits Home Assistant's variables and, when they are absent, falls back
// to the plain light or dark set by hass.themes.darkMode. Crossed pairs (OS one way, hass the other) are the point.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const LIGHT_INK = "rgb(58, 58, 58)"; // --fp-text light, #3a3a3a
const DARK_INK = "rgb(238, 243, 251)"; // blueprint's --fp-text, #eef3fb
const MIDNIGHT_INK = "rgb(216, 226, 242)"; // midnight's --fp-text, #d8e2f2 — still what ha's dark fallback uses

// A plain <script src="../../dist/floorplan-studio-card.js"> fails under file://: Chromium refuses a cross-origin
// module fetch between two file:// URLs (unlike dist/editor.html, which is inlined into one file). Injecting the
// built module's own source as inline content runs without a fetch, so the element defines and upgrades normally.
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

/** Loads harness.html fresh and waits for the card to actually upgrade before configuring it. */
async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}

async function configure(page: Page, config: Record<string, unknown>, hass: Record<string, unknown>) {
  await page.evaluate(
    ([config, hass]) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = hass;
      return el.updateComplete;
    },
    [config, hass] as const,
  );
}

function msgColor(page: Page) {
  return page.locator("floorplan-studio-card").evaluate((el) => {
    const p = el.shadowRoot!.querySelector("p.msg")!;
    return getComputedStyle(p).color;
  });
}

test("S2.12: the default theme is blueprint, whatever the OS colour scheme and hass.themes.darkMode say", async ({ page }) => {
  for (const [os, dark] of [["light", false], ["light", true], ["dark", false]] as const) {
    await page.emulateMedia({ colorScheme: os });
    await open(page);
    await configure(page, {}, { states: {}, themes: { darkMode: dark } });
    await expect.poll(() => msgColor(page), `os ${os}, hass dark ${dark}`).toBe(DARK_INK);
  }
  await open(page);
  await configure(page, {}, { states: {} }); // no hass.themes at all
  await expect.poll(() => msgColor(page)).toBe(DARK_INK);
});

test("S2.12: theme light gives the light ink under a dark OS and a dark hass", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await configure(page, { theme: "light" }, { states: {}, themes: { darkMode: true } });
  await expect.poll(() => msgColor(page)).toBe(LIGHT_INK);
});

test("S2.12: theme ha takes Home Assistant's own colour when it defines one, and the plain light or dark set when it does not", async ({ page }) => {
  await open(page);
  await configure(page, { theme: "ha" }, { states: {}, themes: { darkMode: false } });
  await expect.poll(() => msgColor(page)).toBe(LIGHT_INK); // no --primary-text-color on this page: fallback
  await configure(page, { theme: "ha" }, { states: {}, themes: { darkMode: true } });
  await expect.poll(() => msgColor(page)).toBe(MIDNIGHT_INK);
  await page.evaluate(() => document.documentElement.style.setProperty("--primary-text-color", "rgb(1, 2, 3)"));
  await expect.poll(() => msgColor(page)).toBe("rgb(1, 2, 3)"); // HA's variable wins, in either mode
  await configure(page, { theme: "ha" }, { states: {}, themes: { darkMode: false } });
  await expect.poll(() => msgColor(page)).toBe("rgb(1, 2, 3)");
});

// Opus review of S2.2: the light's icon fill comes from render.ts's own `--fp-dev-fill` custom property
// (`.dev.on path{fill:var(--fp-dev-fill,var(--fp-on))}`), never a DOM-manipulation pass in the card. A markup or
// CSS-text assertion cannot tell a real cascade resolution from a coincidence, so this reads the built card's
// actual `<path>` in Chromium with getComputedStyle (CLAUDE.md finding 10).
test("S2.2 review: a lit light's rgb_color resolves through the cascade to the icon's actual computed fill", async ({ page }) => {
  await open(page);
  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "light.demo_kitchen": { state: "on", attributes: { rgb_color: [255, 0, 0] }, last_changed: new Date().toISOString() } } },
  );
  const fill = await page.locator("floorplan-studio-card").evaluate((el) => {
    const g = el.shadowRoot!.querySelector('g[data-x="1"]')!;
    const path = g.querySelector("path")!;
    return getComputedStyle(path).fill;
  });
  expect(fill).toBe("rgb(255, 0, 0)");
});

test("S2.2 review: with no rgb_color the icon's computed fill falls back to --fp-on, not the rgb branch", async ({ page }) => {
  await open(page);
  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "light.demo_kitchen": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } },
  );
  const fill = await page.locator("floorplan-studio-card").evaluate((el) => {
    const g = el.shadowRoot!.querySelector('g[data-x="1"]')!;
    const path = g.querySelector("path")!;
    return getComputedStyle(path).fill;
  });
  expect(fill).not.toBe("rgb(255, 0, 0)");
});

// Opus review CSS pair (CLAUDE.md finding 10): `.heater` and `.heater.on` have the same specificity (one class vs
// two), so which one wins is never in doubt from the source alone — read the built card's actual computed stroke.
test("S2.5 CSS pair: the heater bar's stroke is idle grey off and the heater colour only while heating", async ({ page }) => {
  await open(page);
  const heaterStroke = () =>
    page.locator("floorplan-studio-card").evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector('line[data-xbar="7"]')!).stroke);

  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "climate.demo_living": { state: "heat", attributes: { hvac_action: "idle" }, last_changed: new Date().toISOString() } } },
  );
  expect(await heaterStroke()).toBe("rgb(43, 86, 151)"); // blueprint's --fp-idle, #2b5697

  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "climate.demo_living": { state: "heat", attributes: { hvac_action: "heating" }, last_changed: new Date().toISOString() } } },
  );
  expect(await heaterStroke()).toBe("rgb(255, 138, 31)"); // blueprint's --fp-heater collapses to the single accent, #ff8a1f
});

test("S2.1 review: getCardSize accounts for layout.rotate in a real browser too", async ({ page }) => {
  await open(page);
  const unturned = structuredClone(demo);
  await configure(page, { layout: unturned }, { states: {}, themes: { darkMode: false } });
  const sizeAt0 = await page.locator("floorplan-studio-card").evaluate((el) => (el as unknown as { getCardSize(): number }).getCardSize());

  await open(page);
  const turned = structuredClone(demo);
  (turned as { rotate: number }).rotate = 90;
  await configure(page, { layout: turned }, { states: {}, themes: { darkMode: false } });
  const sizeAt90 = await page.locator("floorplan-studio-card").evaluate((el) => (el as unknown as { getCardSize(): number }).getCardSize());

  expect(sizeAt90).not.toBe(sizeAt0);
});

// S2.6 CSS pair (CLAUDE.md finding 10): `.room:not([fill])` and `.room.glow:not([fill])` both set `fill`, and a
// `[fill]` attribute has beaten a class rule here once before. Read the actual computed fill in Chromium, not the
// class list, so a specificity mistake (equal specificity, source order the wrong way) would be caught here.
test("S2.6 CSS pair: a room's fill is the glow tint only while room_glow is on and a light inside it is on", async ({ page }) => {
  await open(page);
  const livingFill = () => page.locator("floorplan-studio-card").evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector('svg polygon[data-r="0"]')!).fill);

  await configure(page, { layout: structuredClone(demo), theme: "light", room_glow: true }, { states: { "light.demo_living": { state: "off", attributes: {}, last_changed: new Date().toISOString() } } });
  expect(await livingFill()).toBe("rgb(214, 214, 210)"); // --fp-room-empty, the light is off

  await configure(page, { layout: structuredClone(demo), theme: "light", room_glow: true }, { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });
  // --fp-glow mixed 25% into the room's own --fp-room-empty, not read outright (S2.9 Opus review: the old rule read
  // --fp-glow directly and so replaced the room's colour instead of tinting it; fixed for room_glow and the
  // S1.37 "on" tint in the same pass). Chromium serialises a color-mix() computed value as color(srgb ...), not
  // rgb(...); the 25%-glow/75%-room-empty mix of #f5e2a0 and #d6d6d2.
  expect(await livingFill()).toBe("color(srgb 0.869608 0.85098 0.77451)");

  // room_glow: false (or absent): the same lit light gives no glow at all, even though the light itself is on.
  await configure(page, { layout: structuredClone(demo), theme: "light" }, { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });
  expect(await livingFill()).toBe("rgb(214, 214, 210)");
});

test("S2.6 CSS pair: a room's own colour (a [fill] attribute) is kept, glow or not — the user's choice wins", async ({ page }) => {
  await open(page);
  const coloured = structuredClone(demo);
  coloured.floors.ground.rooms[0].color = "#123456";
  await configure(page, { layout: coloured, room_glow: true }, { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });
  const fill = await page.locator("floorplan-studio-card").evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector('svg polygon[data-r="0"]')!).fill);
  expect(fill).toBe("rgb(18, 52, 86)");
});

// S2.9 round 3: a room's own boundary is almost always also a wall, and the wall's white halo paints on top of the
// room, right along the same line — a same-width outline drawn on the room polygon itself is nearly invisible
// underneath it (Opus review: rendered the demo pond and looked, a 4x crop showed only slivers of the ring in the
// wall's dash gaps). render.ts now draws the ring a second time, after every wall line, so it is genuinely on top.
test("Opus review CSS pair: S2.9 round 3 an on room's outline paints after the walls (on top of them), and does not block clicks on the room underneath it", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  const pond = layout.floors.ground.rooms[6]; // "Garden pond", kind water, boundary walls all round it
  pond.entity = "switch.demo_pump";
  await configure(page, { layout, theme: "light" }, { states: { "switch.demo_pump": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });

  const info = await page.locator("floorplan-studio-card").evaluate(() => {
    const svg = document.getElementById("card")!.shadowRoot!.querySelector("svg")!;
    const kids = [...svg.querySelectorAll("*")];
    const base = svg.querySelector('polygon[data-r="6"]')!;
    const lastWall = kids.filter((n) => n.tagName === "line" && n.classList.contains("e")).pop()!; // the wall lines only, not a door or heater bar drawn later
    const ring = kids.find((n) => n.tagName === "polygon" && n.getAttribute("class") === "room on ring")!;
    const rs = getComputedStyle(ring);
    return {
      baseFill: getComputedStyle(base).fill, // the room's own water colour: untouched, the ring is a stroke only
      ringStroke: rs.stroke,
      ringFillAttr: ring.getAttribute("fill"),
      ringPointerEvents: rs.pointerEvents,
      ringAfterWalls: kids.indexOf(ring) > kids.indexOf(lastWall), // DOM order: later siblings paint on top in SVG
    };
  });
  expect(info.baseFill).toBe("rgb(169, 207, 227)"); // --fp-water, unmoved by the "on" state
  expect(info.ringStroke).toBe("rgb(138, 81, 23)"); // --fp-active, light theme
  expect(info.ringFillAttr).toBe("none");
  expect(info.ringPointerEvents).toBe("none"); // a click on the pond still reaches the room polygon underneath
  expect(info.ringAfterWalls).toBe(true);
});

// S2.6: the floor switcher chip's readability, same check S1.40/S1.53 already run on the editor's own chips
// (CLAUDE.md finding: never assert a colour from CSS text, read the real cascade).
const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (css: string) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

// S2.7: a tap on a door with a cover must hit the real `<line data-d>` at its actual screen coordinates
// (CLAUDE.md finding 3: a Playwright test that dispatches events on the wrong element passed while the real
// click was broken), and the dialog's presence, focus and cascade are read for real in Chromium (finding 10),
// never asserted from markup or CSS text alone.
const GARAGE_DOOR_INDEX = 2; // demo/layout.json: floors.ground.doors[2], "Garage door", cover only, no sensor

/** Configures the card with a `callService` that records every call onto `window.__calls` in the page, since a
 * function cannot cross `page.evaluate`'s own serialization boundary — the calls are read back afterwards. */
async function configureWithCallServiceSpy(page: Page, config: Record<string, unknown>, states: Record<string, unknown>) {
  await page.evaluate(
    ([config, states]) => {
      (window as unknown as { __calls: unknown[] }).__calls = [];
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = {
        states,
        callService: (...args: unknown[]) => (window as unknown as { __calls: unknown[] }).__calls.push(args),
      };
      return el.updateComplete;
    },
    [config, states] as const,
  );
}

async function tapDoor(page: Page, index: number) {
  const line = page.locator("floorplan-studio-card").locator(`css=line[data-d="${index}"]`);
  await line.scrollIntoViewIfNeeded(); // the demo's garage door sits below the fold at the default viewport size
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("S2.7: a tap on the garage door's cover opens a real, visible dialog with Cancel focused by default", async ({ page }) => {
  await open(page);
  await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, { "cover.demo_garage_door": { state: "closed", attributes: {}, last_changed: new Date().toISOString() } });

  await tapDoor(page, GARAGE_DOOR_INDEX);

  const card = page.locator("floorplan-studio-card");
  await expect(card.locator("css=.fp-dialog p")).toHaveText("Open Garage door?");
  const display = await card.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".fp-dialog-backdrop")!).display);
  expect(display).toBe("flex"); // really laid out and visible, not just present in the DOM

  const activeIsCancel = await card.evaluate((el) => el.shadowRoot!.activeElement === el.shadowRoot!.querySelector(".fp-dialog button.cancel"));
  expect(activeIsCancel).toBe(true); // Cancel is the default focused action, not Open
});

test("S2.7: Open calls cover.open_cover with the door's entity_id, and the dialog closes", async ({ page }) => {
  await open(page);
  await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, { "cover.demo_garage_door": { state: "closed", attributes: {}, last_changed: new Date().toISOString() } });

  await tapDoor(page, GARAGE_DOOR_INDEX);
  await page.locator("floorplan-studio-card").locator("css=.fp-dialog button.confirm").click();

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([["cover", "open_cover", { entity_id: "cover.demo_garage_door" }]]);
  await expect(page.locator("floorplan-studio-card").locator("css=.fp-dialog")).toHaveCount(0);
});

test("S2.7: Cancel calls no service", async ({ page }) => {
  await open(page);
  await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, { "cover.demo_garage_door": { state: "closed", attributes: {}, last_changed: new Date().toISOString() } });

  await tapDoor(page, GARAGE_DOOR_INDEX);
  await page.locator("floorplan-studio-card").locator("css=.fp-dialog button.cancel").click();

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([]);
});

test("S2.7: a tap on an open cover opens a dialog reading \"Close Garage door?\" with a Close button, role=dialog, aria-modal=true, and aria-labelledby naming the question (Opus review)", async ({ page }) => {
  await open(page);
  await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, { "cover.demo_garage_door": { state: "open", attributes: {}, last_changed: new Date().toISOString() } });

  await tapDoor(page, GARAGE_DOOR_INDEX);

  const card = page.locator("floorplan-studio-card");
  await expect(card.locator("css=.fp-dialog p")).toHaveText("Close Garage door?");
  await expect(card.locator("css=.fp-dialog button.confirm")).toHaveText("Close");

  const a11y = await card.evaluate((el) => {
    const dialog = el.shadowRoot!.querySelector(".fp-dialog")!;
    const labelledBy = dialog.getAttribute("aria-labelledby")!;
    return {
      role: dialog.getAttribute("role"),
      ariaModal: dialog.getAttribute("aria-modal"),
      labelText: el.shadowRoot!.getElementById(labelledBy)?.textContent,
    };
  });
  expect(a11y).toEqual({ role: "dialog", ariaModal: "true", labelText: "Close Garage door?" });

  await card.locator("css=.fp-dialog button.confirm").click();
  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([["cover", "close_cover", { entity_id: "cover.demo_garage_door" }]]);
});

test("S2.7 Break it: a second tap on the door while the dialog is open does not open a second dialog", async ({ page }) => {
  await open(page);
  await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, { "cover.demo_garage_door": { state: "closed", attributes: {}, last_changed: new Date().toISOString() } });

  await tapDoor(page, GARAGE_DOOR_INDEX);
  await tapDoor(page, GARAGE_DOOR_INDEX);

  await expect(page.locator("floorplan-studio-card").locator("css=.fp-dialog")).toHaveCount(1);
});

test("S2.6: floor chips are real, keyboard-reachable buttons outside the <svg>, at least 4.5:1 in both states", async ({ page }) => {
  await open(page);
  await configure(page, { layout: structuredClone(demo), floor: "all" }, { states: {} });

  const chips = page.locator("floorplan-studio-card").locator("css=.fp-floors button");
  await expect(chips).toHaveCount(3);
  for (const tag of await chips.evaluateAll((els) => els.map((e) => e.tagName))) expect(tag).toBe("BUTTON");

  const pairs = await chips.evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return { pressed: el.getAttribute("aria-pressed"), bg: s.backgroundColor, fg: s.color }; }));
  for (const { pressed, bg, fg } of pairs) expect(ratio(rgbOf(bg), rgbOf(fg)), `aria-pressed=${pressed}`).toBeGreaterThanOrEqual(4.5);

  // Tab reaches a chip and Enter activates it, like any other button (no custom keyboard handling needed).
  await chips.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
});

// S2.10 CSS pair: the class names are asserted in render.test.ts; this reads the icon's computed fill in Chromium,
// because `.dev-ac.cool.on` has to outrank the catch-all `.dev.on` (CLAUDE.md finding 10).
test("S2.10 CSS pair: an air conditioner's icon is blue cooling, orange heating, idle grey otherwise", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  layout.floors.ground.devices.push({ id: "ac-test", type: "ac", entity: "climate.demo_ac", x: 300, y: 300 });
  const idx = layout.floors.ground.devices.length - 1;
  const fillFor = async (state: string, attributes: Record<string, unknown>) => {
    await configure(page, { layout, theme: "light" }, { states: { "climate.demo_ac": { state, attributes, last_changed: new Date().toISOString() } } });
    return page.locator("floorplan-studio-card").evaluate((el, i) => getComputedStyle(el.shadowRoot!.querySelector(`g[data-x="${i}"] path:not(.cone)`)!).fill, idx);
  };
  expect(await fillFor("cool", { hvac_action: "cooling" })).toBe("rgb(44, 127, 184)");
  expect(await fillFor("heat", { hvac_action: "heating" })).toBe("rgb(232, 128, 26)");
  const idle = await fillFor("cool", { hvac_action: "idle" });
  expect(idle).not.toBe("rgb(44, 127, 184)");
  expect(await fillFor("off", { hvac_action: "cooling" })).toBe(idle);
});

// S2.13: the four monitored types draw their own icon in the idle grey on the round disc, whatever the entity says.
test("S2.13 CSS pair: battery, inverter, server and access point draw an icon in idle grey on the disc", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  const types = ["battery", "inverter", "server", "access_point"];
  const first = layout.floors.ground.devices.length;
  types.forEach((t, i) => layout.floors.ground.devices.push({ id: `mon-${t}`, type: t, entity: `sensor.demo_${t}`, x: 500 + i * 60, y: 300 }));
  await configure(page, { layout, theme: "light" }, { states: Object.fromEntries(types.map((t) => [`sensor.demo_${t}`, { state: "on", attributes: {}, last_changed: new Date().toISOString() }])) });
  const got = await page.locator("floorplan-studio-card").evaluate((el, [f, n]) => {
    const idle = getComputedStyle(el.shadowRoot!.querySelector("svg")!).getPropertyValue("--fp-idle").trim();
    return { idle, items: Array.from({ length: n as number }, (_, k) => {
      const g = el.shadowRoot!.querySelector(`g[data-x="${(f as number) + k}"]`)!;
      return { d: g.querySelector("path")!.getAttribute("d")!.length, fill: getComputedStyle(g.querySelector("path")!).fill, halo: !!g.querySelector("circle.halo") };
    }) };
  }, [first, types.length]);
  const rgb = (h: string) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
  for (const it of got.items) { expect(it.d).toBeGreaterThan(20); expect(it.halo).toBe(true); expect(it.fill).toBe(rgb("#8b8578")); }
});

// S7.8: a person is placed like any device, moves to the room its room sensor names, and a tap opens more-info.
function personLayout() {
  const layout = structuredClone(demo);
  layout.floors.ground.devices.push({ id: "person-test", type: "person", entity: "person.test", x: 200, y: 520, room: "sensor.test_room" });
  return { layout, idx: layout.floors.ground.devices.length - 1 };
}
const live = (state: string) => ({ state, attributes: {}, last_changed: new Date().toISOString() });

test("S7.8: a real tap on a person opens more-info for the person and calls no service", async ({ page }) => {
  await open(page);
  const { layout, idx } = personLayout();
  await configureWithCallServiceSpy(page, { layout }, { "person.test": live("home") });
  await page.evaluate(() => {
    (window as unknown as { __more: unknown[] }).__more = [];
    document.getElementById("card")!.addEventListener("hass-more-info", (e) => (window as unknown as { __more: unknown[] }).__more.push((e as CustomEvent).detail));
  });
  const g = page.locator("floorplan-studio-card").locator(`css=g[data-x="${idx}"]`);
  await g.scrollIntoViewIfNeeded();
  const box = (await g.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __more: unknown[] }).__more)).toEqual([{ entityId: "person.test" }]);
  expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)).toEqual([]);
});

test("S7.8: when the room sensor changes, the person glides to the new room: a real CSS transition runs on transform", async ({ page }) => {
  await open(page);
  const { layout, idx } = personLayout();
  await configure(page, { layout }, { states: { "person.test": live("home"), "sensor.test_room": live("Living") } });
  const moved = await page.locator("floorplan-studio-card").evaluate(async (el, i) => {
    const card = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
    const before = el.shadowRoot!.querySelector(`g[data-x="${i}"]`)!.getBoundingClientRect();
    card.hass = { ...card.hass, states: { ...card.hass.states, "sensor.test_room": { state: "Kitchen", attributes: {}, last_changed: new Date().toISOString() } } };
    await card.updateComplete;
    const g = el.shadowRoot!.querySelector(`g[data-x="${i}"]`)!;
    const anims = g.getAnimations().map((a) => (a as CSSTransition).transitionProperty);
    const mid = g.getBoundingClientRect();
    return { anims, dx: mid.x - before.x };
  }, idx);
  expect(moved.anims).toContain("transform");
  expect(moved.dx).toBeLessThan(50); // right after the update the icon is still near Living, not already in the Kitchen
});

test("S7.8: under prefers-reduced-motion the person jumps, no transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const { layout, idx } = personLayout();
  await configure(page, { layout }, { states: { "person.test": live("home"), "sensor.test_room": live("Living") } });
  const anims = await page.locator("floorplan-studio-card").evaluate(async (el, i) => {
    const card = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
    card.hass = { ...card.hass, states: { ...card.hass.states, "sensor.test_room": { state: "Kitchen", attributes: {}, last_changed: new Date().toISOString() } } };
    await card.updateComplete;
    return el.shadowRoot!.querySelector(`g[data-x="${i}"]`)!.getAnimations().length;
  }, idx);
  expect(anims).toBe(0);
});
