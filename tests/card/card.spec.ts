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
test("S7.11: the card never draws a floor's trace image, even one that is on", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  // A real 2x1 PNG, so a broken <image> is not the reason nothing shows.
  const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC";
  for (const f of Object.values<any>(layout.floors)) f.trace = { src, x: 0, y: 0, w: 800, rot: 0, alpha: 1, on: true };
  await configure(page, { layout }, { states: {} });
  const counts = await page.locator("floorplan-studio-card").evaluate((el) => ({
    rooms: el.shadowRoot!.querySelectorAll("svg polygon[data-r]").length,
    images: el.shadowRoot!.querySelectorAll("svg image").length,
  }));
  expect(counts.rooms).toBeGreaterThan(0);
  expect(counts.images).toBe(0);
});

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
  // S8.9: each door is now two <line data-d> elements, an invisible wider "door-hit" click target plus the
  // visible one; :not(.door-hit) keeps this locator's match count at one, same coordinates either way.
  const line = page.locator("floorplan-studio-card").locator(`css=line[data-d="${index}"]:not(.door-hit)`);
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

// S7.4: zoom and pan in the card. Every gesture goes through page.mouse / page.touchscreen / CDP touch at real
// coordinates (CLAUDE.md finding 3), and every assertion reads the <svg viewBox> attribute the card writes.
test.describe("S7.4 zoom and pan", () => {
  // Narrow and tall enough that the whole ground floor is on screen without scrolling.
  test.use({ viewport: { width: 700, height: 900 } });

  type VB = { x: number; y: number; w: number; h: number };
  const card = (page: Page) => page.locator("floorplan-studio-card");
  const viewBox = (page: Page): Promise<VB> =>
    card(page).evaluate((el) => {
      const [x, y, w, h] = el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);
      return { x: x!, y: y!, w: w!, h: h! };
    });
  const svgBox = async (page: Page) => (await card(page).locator("css=svg").first().boundingBox())!;
  /** Centre of the demo's kitchen light (`g[data-x="1"]`) on screen. */
  const lightAt = async (page: Page) => {
    const b = (await card(page).locator('css=g[data-x="1"]').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  const states = () => ({ "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } });
  /** Plan point under a screen point, for the given viewBox and svg box. */
  const toPlan = (vb: VB, b: { x: number; y: number; width: number; height: number }, sx: number, sy: number) =>
    [vb.x + ((sx - b.x) / b.width) * vb.w, vb.y + ((sy - b.y) / b.height) * vb.h];

  async function ctrlWheel(page: Page, x: number, y: number, dy: number) {
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, dy);
    await page.keyboard.up("Control");
  }

  test("Ctrl+wheel zooms in about the pointer; a plain wheel leaves the plan alone so the dashboard can scroll", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    const px = b.x + b.width * 0.3, py = b.y + b.height * 0.6; // off-centre, so a zoom about the centre would fail

    await page.mouse.move(px, py);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50); // a wheel event that did land would have re-rendered by now
    expect(await viewBox(page)).toEqual(fit);

    const before = toPlan(fit, b, px, py);
    await ctrlWheel(page, px, py, -300);
    await expect.poll(async () => (await viewBox(page)).w).toBeLessThan(fit.w * 0.95);
    const z = await viewBox(page);
    expect(z.w / z.h).toBeCloseTo(fit.w / fit.h, 5);
    const after = toPlan(z, b, px, py);
    expect(after[0]).toBeCloseTo(before[0]!, 0);
    expect(after[1]).toBeCloseTo(before[1]!, 0);
    expect(await calls(page)).toEqual([]);
  });

  test("zoom: \"wheel\" zooms on a plain wheel too", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), zoom: "wheel" }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await viewBox(page)).w).toBeLessThan(fit.w * 0.95);
  });

  test("the plan never zooms out past fit nor in past 8x", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    for (let i = 0; i < 40; i++) await ctrlWheel(page, b.x + b.width / 2, b.y + b.height / 2, -300);
    await expect.poll(async () => (await viewBox(page)).w).toBeCloseTo(fit.w / 8, 3);
    for (let i = 0; i < 40; i++) await ctrlWheel(page, b.x + b.width / 2, b.y + b.height / 2, 300);
    await expect.poll(() => viewBox(page)).toEqual(fit);
  });

  test("zoom buttons: + zooms in, - zooms out, fit goes back; - and fit are disabled at fit", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const zoomIn = card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]');
    const zoomOut = card(page).locator('css=.fp-zoom button[aria-label="Zoom out"]');
    const fitBtn = card(page).locator('css=.fp-zoom button[aria-label="Fit"]');
    await expect(zoomOut).toBeDisabled();
    await expect(fitBtn).toBeDisabled();
    await zoomIn.click();
    await zoomIn.click();
    const z2 = await viewBox(page);
    expect(z2.w).toBeLessThan(fit.w * 0.6);
    await zoomOut.click();
    expect((await viewBox(page)).w).toBeGreaterThan(z2.w);
    await fitBtn.click();
    expect(await viewBox(page)).toEqual(fit);
    expect(await calls(page)).toEqual([]);
  });

  test("a 40 px drag that starts on a light pans the plan and does not toggle the light; a plain click still does", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    // One click (1.5x about the centre): the kitchen light stays on screen and clear of the buttons.
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').click();
    const z = await viewBox(page);
    const b = await svgBox(page);
    const l = await lightAt(page);

    await page.mouse.move(l.x, l.y);
    await page.mouse.down();
    await page.mouse.move(l.x + 20, l.y, { steps: 4 });
    await page.mouse.move(l.x + 40, l.y, { steps: 4 });
    await page.mouse.up();
    const p = await viewBox(page);
    expect(p.w).toBeCloseTo(z.w, 5);
    expect(p.x).toBeCloseTo(z.x - 40 * (z.w / b.width), 0); // the plan followed the pointer 40 px to the right
    expect(p.y).toBeCloseTo(z.y, 5);
    expect(await calls(page)).toEqual([]);

    const l2 = await lightAt(page);
    await page.mouse.click(l2.x, l2.y);
    expect(await calls(page)).toEqual([["light", "toggle", { entity_id: "light.demo_kitchen" }]]);
    expect(p.w).toBeLessThan(fit.w);
  });

  test("a 40 px drag over a light at fit does not toggle it either, and does not move the plan", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const l = await lightAt(page);
    await page.mouse.move(l.x, l.y);
    await page.mouse.down();
    await page.mouse.move(l.x, l.y + 40, { steps: 8 });
    await page.mouse.up();
    expect(await calls(page)).toEqual([]);
    expect(await viewBox(page)).toEqual(fit);
  });

  test("zoom: false keeps the viewBox fixed, shows no buttons and leaves touch-action alone", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), zoom: false }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    await ctrlWheel(page, b.x + b.width / 2, b.y + b.height / 2, -300);
    await page.mouse.dblclick(b.x + 8, b.y + 8);
    await page.waitForTimeout(50);
    expect(await viewBox(page)).toEqual(fit);
    await expect(card(page).locator("css=.fp-zoom")).toHaveCount(0);
    expect(await card(page).evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector("svg")!).touchAction)).toBe("auto");
  });

  // S7.15: at fit the page may scroll under a vertical swipe (there is nothing to pan); zoomed, the plan takes every
  // touch. Both are computed-style pairs for the two CSS rules, and the pair is read again after fit is restored.
  test("with zoom on the svg has touch-action: pan-y at fit and none once zoomed", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const touchAction = () => card(page).evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector("svg")!).touchAction);
    expect(await touchAction()).toBe("pan-y");
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').click();
    await expect.poll(touchAction).toBe("none");
    await card(page).locator('css=.fp-zoom button[aria-label="Fit"]').click();
    await expect.poll(touchAction).toBe("pan-y");
  });

  test("Break it: a wheel over a floor chip leaves the viewBox alone, even with zoom: \"wheel\"", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), floor: "all", zoom: "wheel" }, states());
    const fit = await viewBox(page);
    const chip = (await card(page).locator("css=.fp-floors button").first().boundingBox())!;
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50);
    expect(await viewBox(page)).toEqual(fit);
    // The same wheel over the plan itself does zoom, so the check above is not passing for nothing.
    const b = await svgBox(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await viewBox(page)).w).toBeLessThan(fit.w);
  });

  test("the zoom survives a hass update, and resets on setConfig and on a floor change", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), floor: "all" }, states());
    const fit = await viewBox(page);
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').click();
    const z = await viewBox(page);
    expect(z.w).toBeLessThan(fit.w);

    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
      el.hass = { ...el.hass, states: { "light.demo_kitchen": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } };
      return el.updateComplete;
    });
    expect(await viewBox(page)).toEqual(z);

    await card(page).locator("css=.fp-floors button").nth(1).click();
    const firstFit = await viewBox(page);
    expect(firstFit.w).toBeGreaterThan(z.w); // a new floor opens at its own fit, not at the old zoom
    await expect(card(page).locator('css=.fp-zoom button[aria-label="Zoom out"]')).toBeDisabled();

    await card(page).locator("css=.fp-floors button").nth(0).click();
    expect(await viewBox(page)).toEqual(fit);
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').click();
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), floor: "all" }, states());
    expect(await viewBox(page)).toEqual(fit);
  });

  test("the zoom buttons read at 3:1 or better against their own background in all seven themes", async ({ page }) => {
    await open(page);
    for (const theme of ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha"]) {
      for (const dark of [false, true]) {
        await configure(page, { layout: structuredClone(demo), theme }, { states: {}, themes: { darkMode: dark } });
        const got = await card(page).evaluate((el) =>
          [...el.shadowRoot!.querySelectorAll(".fp-zoom button")].map((btn) => {
            const s = getComputedStyle(btn);
            return { bg: s.backgroundColor, fg: s.color, vis: s.visibility, disp: s.display };
          }),
        );
        expect(got.length, `${theme} dark=${dark}`).toBe(3);
        for (const g of got) {
          expect(g.disp).not.toBe("none");
          expect(ratio(rgbOf(g.bg), rgbOf(g.fg)), `${theme} dark=${dark}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

test.describe("S7.4 touch", () => {
  test.use({ viewport: { width: 700, height: 900 }, hasTouch: true });

  type VB = { x: number; y: number; w: number; h: number };
  const card = (page: Page) => page.locator("floorplan-studio-card");
  const viewBox = (page: Page): Promise<VB> =>
    card(page).evaluate((el) => {
      const [x, y, w, h] = el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);
      return { x: x!, y: y!, w: w!, h: h! };
    });
  const svgBox = async (page: Page) => (await card(page).locator("css=svg").first().boundingBox())!;
  const states = () => ({ "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } });

  test("a double-tap on the plan zooms in 2x at fit, and a double-tap when zoomed goes back to fit", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    const x = b.x + 10, y = b.y + 10; // the padding around the plan: no device, no chip, no button
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect.poll(async () => (await viewBox(page)).w).toBeCloseTo(fit.w / 2, 3);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect.poll(() => viewBox(page)).toEqual(fit);
    expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)).toEqual([]);
  });

  test("a double-tap on a light toggles it twice and does not zoom", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const lb = (await card(page).locator('css=g[data-x="1"]').boundingBox())!;
    await page.touchscreen.tap(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await page.touchscreen.tap(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(2);
    expect(await viewBox(page)).toEqual(fit);
  });

  /** Two fingers through CDP (Playwright's touchscreen has only tap). One session for the whole gesture: CDP keeps
   * the touch state per session. */
  async function toucher(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    return (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: { x: number; y: number; id: number }[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  }

  test("a two-finger pinch inside the plan zooms in", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    const fit = await viewBox(page);
    const b = await svgBox(page);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const touch = await toucher(page);
    await touch("touchStart", [{ x: cx - 50, y: cy, id: 1 }]);
    await touch("touchStart", [{ x: cx - 50, y: cy, id: 1 }, { x: cx + 50, y: cy, id: 2 }]);
    for (let s = 1; s <= 5; s++) await touch("touchMove", [{ x: cx - 50 - s * 10, y: cy, id: 1 }, { x: cx + 50 + s * 10, y: cy, id: 2 }]);
    await touch("touchEnd", []);
    await expect.poll(async () => (await viewBox(page)).w).toBeCloseTo(fit.w / 2, 0);
    expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)).toEqual([]);
  });

  // S7.15: the reason for pan-y at fit. A one-finger vertical swipe that starts on the plan scrolls the page, as it
  // would over any other card; the plan's view does not change. Zoomed in, the same swipe pans the plan and the page
  // stays put. The page is made tall enough to scroll first.
  test("S7.15: a vertical swipe on the plan scrolls the page at fit and pans the plan once zoomed", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    await page.evaluate(() => { document.body.style.height = "4000px"; window.scrollTo(0, 0); });
    const fit = await viewBox(page);
    const b = await svgBox(page);
    const x = b.x + b.width / 2, y0 = b.y + b.height - 40;
    const touch = await toucher(page);
    const swipeUp = async () => {
      await touch("touchStart", [{ x, y: y0, id: 1 }]);
      for (let s = 1; s <= 8; s++) await touch("touchMove", [{ x, y: y0 - s * 30, id: 1 }]);
      await touch("touchEnd", []);
    };
    await swipeUp();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    expect(await viewBox(page)).toEqual(fit);
    expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)).toEqual([]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').tap();
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').tap();
    const z = await viewBox(page);
    expect(z.w).toBeLessThan(fit.w);
    // S8.2 review: the two taps just added `touch-action: none` to the svg (`.fp-zoomed`); Chromium applies
    // touch-action on the compositor thread, a frame or two after the main-thread style/class change, so a touch
    // that starts in the same tick can occasionally scroll the page by a stray pixel before it takes effect. Two
    // rendered frames is the standard wait for a style change to have actually been committed and painted; it is
    // not a blind sleep, and its absence was a real, reproducible (about 1 swipe in 10) race, not test flakiness.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await swipeUp();
    await expect.poll(async () => (await viewBox(page)).y).toBeGreaterThan(z.y);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("Break it: a pinch whose first finger starts outside the svg is ignored", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo) }, states());
    await card(page).locator('css=.fp-zoom button[aria-label="Zoom in"]').tap();
    const z = await viewBox(page);
    const b = await svgBox(page);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const out = { x: b.x / 2, y: cy, id: 1 }; // in the page's left margin, outside the card
    const touch = await toucher(page);
    await touch("touchStart", [out]);
    await touch("touchStart", [out, { x: cx, y: cy, id: 2 }]);
    for (let s = 1; s <= 5; s++) await touch("touchMove", [{ ...out, y: out.y + s * 10 }, { x: cx + s * 12, y: cy - s * 12, id: 2 }]);
    await touch("touchEnd", []);
    await page.waitForTimeout(50);
    expect(await viewBox(page)).toEqual(z);
  });
});

// S7.6: night from the sun. `night: "auto"` (the default) reads `sun.sun`, or the entity `sun` names; `on` and `off` force it.
test("S7.6: sun.sun below the horizon sets night, above clears it; on and off force it; sun overrides the entity; unavailable is day", async ({ page }) => {
  await open(page);
  const s = (state: string) => ({ state, attributes: {}, last_changed: new Date().toISOString() });
  const night = () => page.locator("floorplan-studio-card").evaluate((el) => {
    const g = el.shadowRoot!.querySelector("svg g.night");
    return { on: !!g, overlays: el.shadowRoot!.querySelectorAll("svg polygon.room-night").length };
  });
  const cases: [string, Record<string, unknown>, Record<string, unknown>, boolean][] = [
    ["default, below", {}, { "sun.sun": s("below_horizon") }, true],
    ["default, above", {}, { "sun.sun": s("above_horizon") }, false],
    ["auto, below", { night: "auto" }, { "sun.sun": s("below_horizon") }, true],
    ["no sun entity at all", {}, {}, false],
    ["sun unavailable", {}, { "sun.sun": s("unavailable") }, false],
    ["off, below", { night: "off" }, { "sun.sun": s("below_horizon") }, false],
    ["on, above", { night: "on" }, { "sun.sun": s("above_horizon") }, true],
    ["on, no sun", { night: "on" }, {}, true],
    ["sun override below", { sun: "sensor.x" }, { "sensor.x": s("below_horizon"), "sun.sun": s("above_horizon") }, true],
    ["sun override above", { sun: "sensor.x" }, { "sensor.x": s("above_horizon"), "sun.sun": s("below_horizon") }, false],
    ["sun override on", { sun: "binary_sensor.dark" }, { "binary_sensor.dark": s("on") }, true],
    ["unknown night value is auto", { night: "yes" }, { "sun.sun": s("above_horizon") }, false],
  ];
  for (const [name, extra, states, want] of cases) {
    await configure(page, { layout: structuredClone(demo), theme: "light", ...extra }, { states });
    expect(await night(), name).toEqual({ on: want, overlays: want ? 6 : 0 });
  }
});

test("S7.6: the sun flipping on a live card toggles night without a new config", async ({ page }) => {
  await open(page);
  const s = (state: string) => ({ state, attributes: {}, last_changed: new Date().toISOString() });
  await configure(page, { layout: structuredClone(demo), theme: "light" }, { states: { "sun.sun": s("above_horizon") } });
  const setSun = (state: string) => page.evaluate((st) => {
    const el = document.getElementById("card") as unknown as { hass: unknown; updateComplete: Promise<unknown> };
    el.hass = { states: { "sun.sun": { state: st, attributes: {}, last_changed: new Date().toISOString() } } };
    return el.updateComplete;
  }, state);
  const has = () => page.locator("floorplan-studio-card").evaluate((el) => !!el.shadowRoot!.querySelector("svg g.night"));
  expect(await has()).toBe(false);
  await setSun("below_horizon");
  expect(await has()).toBe(true);
  await setSun("above_horizon");
  expect(await has()).toBe(false);
});

test("S7.6 CSS pair: at night an unlit room is covered by --fp-night, a lit one is clear, in the card", async ({ page }) => {
  await open(page);
  const s = (state: string) => ({ state, attributes: {}, last_changed: new Date().toISOString() });
  await configure(page, { layout: structuredClone(demo), theme: "light", night: "on" }, { states: { "light.demo_kitchen": s("on") } });
  const fills = await page.locator("floorplan-studio-card").evaluate((el) => [0, 1].map((i) => getComputedStyle(el.shadowRoot!.querySelector(`svg polygon[data-night="${i}"]`)!).fill));
  expect(fills).toEqual(["rgba(4, 10, 30, 0.45)", "none"]);
});

// S7.5: kiosk mode for a wall tablet. Real page.mouse gestures at real coordinates (CLAUDE.md finding 3), since the
// hold is a real HOLD_MS + 100 wait, not a fake-timer advance.
test.describe("S7.5 kiosk mode", () => {
  test.use({ viewport: { width: 700, height: 900 } });
  const card = (page: Page) => page.locator("floorplan-studio-card");
  const states = () => ({ "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } });

  /** Configures the card and records every `hass-more-info` fired on it onto `window.__moreInfo`. */
  async function configureRecordingMoreInfo(page: Page, config: Record<string, unknown>) {
    await page.evaluate(
      ([config, states]) => {
        (window as unknown as { __moreInfo: unknown[] }).__moreInfo = [];
        const el = document.getElementById("card") as unknown as EventTarget & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
        el.addEventListener("hass-more-info", (e) => (window as unknown as { __moreInfo: unknown[] }).__moreInfo.push((e as CustomEvent).detail));
        el.setConfig(config);
        el.hass = { states };
        return el.updateComplete;
      },
      [config, states()] as const,
    );
  }
  const moreInfo = (page: Page) => page.evaluate(() => (window as unknown as { __moreInfo: unknown[] }).__moreInfo);

  test(".fp-floors and the zoom buttons are absent under kiosk, and present without it", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floors: ["ground", "first"], kiosk: true }, { states: states() });
    await expect(card(page).locator("css=.fp-floors")).toHaveCount(0);
    await expect(card(page).locator("css=.fp-zoom")).toHaveCount(0);

    await configure(page, { layout: structuredClone(demo), floors: ["ground", "first"] }, { states: states() });
    await expect(card(page).locator("css=.fp-floors")).toHaveCount(1);
    await expect(card(page).locator("css=.fp-zoom")).toHaveCount(1);
  });

  test("a hold of HOLD_MS + 100 on a light fires no hass-more-info under kiosk, and does otherwise", async ({ page }) => {
    const HOLD_MS = 500;
    await open(page);
    await configureRecordingMoreInfo(page, { layout: structuredClone(demo), kiosk: true });
    const light = card(page).locator('css=g[data-x="1"]'); // kitchen light
    const box = (await light.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS + 100);
    expect(await moreInfo(page)).toEqual([]);
    await page.mouse.up();
    expect(await moreInfo(page)).toEqual([]); // the hold consumed nothing to fire; releasing toggles instead

    // Not passing for nothing: the same hold, on a fresh card without kiosk, does fire more-info. A fresh `open`
    // (not a second `configure` on the same element) matters here: the card keeps its `<svg>` element across a
    // config change (S7.4's own comment on `updated()`), so `bindDeviceActions` is bound once per element, and a
    // second `configure` on the same card would still be running with the first bind's `longPress: false`.
    await open(page);
    await configureRecordingMoreInfo(page, { layout: structuredClone(demo) });
    const light2 = card(page).locator('css=g[data-x="1"]');
    const box2 = (await light2.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS + 100);
    expect(await moreInfo(page)).toEqual([{ entityId: "light.demo_kitchen" }]);
    await page.mouse.up();
  });

  test("a plain tap still toggles a light under kiosk", async ({ page }) => {
    await open(page);
    await configureWithCallServiceSpy(page, { layout: structuredClone(demo), kiosk: true }, states());
    const light = await lightAtForKiosk(page);
    await page.mouse.click(light.x, light.y);
    const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
    expect(calls).toEqual([["light", "toggle", { entity_id: "light.demo_kitchen" }]]);
  });

  test("with floors: [first, ground] and kiosk: true the first listed floor shows and there is no switcher", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floors: ["first", "ground"], kiosk: true }, { states: states() });
    await expect(card(page).locator("css=.fp-floors")).toHaveCount(0);
    const rooms = await card(page).locator("css=svg [data-r]").count();
    expect(rooms).toBe(demo.floors.first.rooms.length);
  });

  test("kiosk: \"yes\" (a string) is refused by setConfig with a message naming the key", async ({ page }) => {
    await open(page);
    const threw = await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void };
      try { el.setConfig({ kiosk: "yes" }); return null; } catch (e) { return String(e); }
    });
    expect(threw).toMatch(/kiosk/);
  });

  test("zoom: \"yes\" (an unknown string, left over from S7.4) is refused by setConfig with a message naming the key", async ({ page }) => {
    await open(page);
    const threw = await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void };
      try { el.setConfig({ zoom: "yes" }); return null; } catch (e) { return String(e); }
    });
    expect(threw).toMatch(/zoom/);
  });

  /** Centre of the kitchen light on screen, same as S7.4's `lightAt` above but scoped to this describe block. */
  async function lightAtForKiosk(page: Page) {
    const b = (await card(page).locator('css=g[data-x="1"]').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
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

// S7.10: the vacuum dialog. Real `page.mouse` taps at real coordinates (CLAUDE.md finding 3), the dialog's
// presence and button state read for real in Chromium, never from markup or CSS text alone (finding 10).
function vacuumLayout() {
  const layout = structuredClone(demo);
  layout.floors.ground.devices.push({ id: "vacuum-test", type: "vacuum", entity: "vacuum.test", name: "Test vacuum", x: 200, y: 520 });
  return { layout, idx: layout.floors.ground.devices.length - 1 };
}

async function tapVacuum(page: Page, idx: number) {
  const g = page.locator("floorplan-studio-card").locator(`css=g[data-x="${idx}"]`);
  await g.scrollIntoViewIfNeeded();
  const box = (await g.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("S7.10: a tap on a vacuum opens a real, visible dialog naming it, with Cancel focused by default", async ({ page }) => {
  await open(page);
  const { layout, idx } = vacuumLayout();
  await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live("docked") });

  await tapVacuum(page, idx);

  const card = page.locator("floorplan-studio-card");
  await expect(card.locator("css=.fp-vacuum-dialog p")).toHaveText("Test vacuum");
  const display = await card.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".fp-dialog-backdrop")!).display);
  expect(display).toBe("flex");
  const activeIsCancel = await card.evaluate((el) => el.shadowRoot!.activeElement === el.shadowRoot!.querySelector(".fp-vacuum-dialog button.cancel"));
  expect(activeIsCancel).toBe(true);

  const a11y = await card.evaluate((el) => {
    const dialog = el.shadowRoot!.querySelector(".fp-vacuum-dialog")!;
    const labelledBy = dialog.getAttribute("aria-labelledby")!;
    return { role: dialog.getAttribute("role"), ariaModal: dialog.getAttribute("aria-modal"), labelText: el.shadowRoot!.getElementById(labelledBy)?.textContent };
  });
  expect(a11y).toEqual({ role: "dialog", ariaModal: "true", labelText: "Test vacuum" });
});

test("S7.10: Return to dock calls vacuum.return_to_base with the entity_id, and the dialog closes", async ({ page }) => {
  await open(page);
  const { layout, idx } = vacuumLayout();
  await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live("cleaning") });

  await tapVacuum(page, idx);
  await page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog button.confirm").click();

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([["vacuum", "return_to_base", { entity_id: "vacuum.test" }]]);
  await expect(page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog")).toHaveCount(0);
});

test("S7.10: Start and Pause call vacuum.start and vacuum.pause with the entity_id", async ({ page }) => {
  await open(page);
  const { layout, idx } = vacuumLayout();
  await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live("docked") });

  await tapVacuum(page, idx);
  const buttons = page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog .fp-dialog-actions button");
  await expect(buttons).toHaveText(["Cancel", "Start", "Pause", "Return to dock"]);
  await buttons.nth(1).click(); // Start
  await tapVacuum(page, idx);
  await page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog .fp-dialog-actions button").nth(2).click(); // Pause

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([
    ["vacuum", "start", { entity_id: "vacuum.test" }],
    ["vacuum", "pause", { entity_id: "vacuum.test" }],
  ]);
});

test("S7.10: Cancel calls no service", async ({ page }) => {
  await open(page);
  const { layout, idx } = vacuumLayout();
  await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live("docked") });

  await tapVacuum(page, idx);
  await page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog button.cancel").click();

  const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
  expect(calls).toEqual([]);
  await expect(page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog")).toHaveCount(0);
});

test("S7.10 Break it: unavailable or unknown shows the dialog with Start/Pause/Return to dock disabled, Cancel still enabled", async ({ page }) => {
  for (const state of ["unavailable", "unknown"]) {
    await open(page);
    const { layout, idx } = vacuumLayout();
    await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live(state) });
    await tapVacuum(page, idx);
    const card = page.locator("floorplan-studio-card");
    const disabled = await card.evaluate((el) => [...el.shadowRoot!.querySelectorAll(".fp-vacuum-dialog .fp-dialog-actions button")].map((b) => (b as HTMLButtonElement).disabled));
    expect(disabled, state).toEqual([false, true, true, true]); // Cancel, Start, Pause, Return to dock
  }
});

test("S7.10 Break it: a second tap on the vacuum while the dialog is open does not open a second dialog", async ({ page }) => {
  await open(page);
  const { layout, idx } = vacuumLayout();
  await configureWithCallServiceSpy(page, { layout }, { "vacuum.test": live("docked") });

  await tapVacuum(page, idx);
  await tapVacuum(page, idx);

  await expect(page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog")).toHaveCount(1);
});

test.describe("S7.10 kiosk mode: the vacuum dialog still opens", () => {
  test.use({ viewport: { width: 700, height: 900 } });
  test("a tap opens the dialog under kiosk, same as without it", async ({ page }) => {
    await open(page);
    const { layout, idx } = vacuumLayout();
    await configureWithCallServiceSpy(page, { layout, kiosk: true }, { "vacuum.test": live("docked") });
    await tapVacuum(page, idx);
    await expect(page.locator("floorplan-studio-card").locator("css=.fp-vacuum-dialog")).toHaveCount(1);
  });
});

test.describe("S8.2: the card fills a fixed-height container instead of cropping", () => {
  const card = (page: Page) => page.locator("floorplan-studio-card");
  const svgBox = async (page: Page) => (await card(page).locator("css=svg").first().boundingBox())!;

  /** Wraps `#card` in a fixed-size div, as HA's sections layout does when rows is numeric (`.card.fit-rows`). */
  async function wrapFixed(page: Page, width: number, height: number) {
    await page.evaluate(
      ([width, height]) => {
        const el = document.getElementById("card")!;
        const wrap = document.createElement("div");
        wrap.id = "fixed-wrap";
        wrap.style.width = `${width}px`;
        wrap.style.height = `${height}px`;
        el.parentElement!.insertBefore(wrap, el);
        wrap.appendChild(el);
      },
      [width, height] as const,
    );
  }

  test("in a container shorter than the plan's natural height, the plan's svg still fills the container height and never overflows it (S8.2)", async ({ page }) => {
    await open(page);
    await wrapFixed(page, 400, 300);
    await configure(page, { layout: structuredClone(demo) }, { states: {}, themes: { darkMode: false } });
    const wrapBox = (await page.locator("#fixed-wrap").boundingBox())!;
    const box = await svgBox(page);
    expect(box.height).toBeCloseTo(wrapBox.height, 0);
    expect(box.width).toBeLessThanOrEqual(wrapBox.width + 0.5);
  });

  test("with no fixed height on its container, the plan still sizes by width and its own aspect ratio, unchanged (S8.2)", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo) }, { states: {}, themes: { darkMode: false } });
    const cardBox = (await card(page).boundingBox())!;
    const box = await svgBox(page);
    expect(box.width).toBeCloseTo(cardBox.width, 0);
    expect(box.height).toBeLessThan(cardBox.width); // the demo ground floor is wider than it is tall
  });
});

test.describe("S8.3: in HA's panel view the plan fits the screen", () => {
  const card = (page: Page) => page.locator("floorplan-studio-card");
  const svgBox = async (page: Page) => (await card(page).locator("css=svg").first().boundingBox())!;

  // hui-panel-view gives the card no definite height, so `height:100%` fell back to width x aspect: on Diego's
  // 1454 px wide panel the plan drew 1951 px tall on a 902 px window, and "fit" looked zoomed in.
  test("layout = panel caps the card at the viewport height below HA's header, and leaving it restores the natural height (S8.3)", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 400 });
    await open(page);
    await configure(page, { layout: structuredClone(demo) }, { states: {}, themes: { darkMode: false } });
    const before = await svgBox(page);
    expect(before.height).toBeGreaterThan(400 - 56); // the bug: taller than the screen
    await card(page).evaluate((el) => { (el as unknown as { layout: string }).layout = "panel"; });
    await expect.poll(async () => (await svgBox(page)).height).toBeCloseTo(400 - 56, 0);
    expect((await card(page).boundingBox())!.height).toBeCloseTo(400 - 56, 0);
    await card(page).evaluate((el) => { (el as unknown as { layout: string }).layout = "grid"; });
    await expect.poll(async () => (await svgBox(page)).height).toBeCloseTo(before.height, 0);
  });
});

// ---- S8.11: opening masks are per-shadow-root, so two cards never wrongly collide -------------------------------

// render.ts derives an opening mask's id from the content of its own cut lines (tag(), FNV-1a — mirroring
// texturePatternId's precedent), not a global counter, so renderFloor stays pure: called twice on equal input it
// is byte-identical. Two cards showing the same floor therefore mint the very same mask id — safe only because
// each card is its own shadow root, where a url(#id) reference resolves against that root alone. This test mounts
// a second card in the same page (harness.html has only #card) and proves the two never interfere: same content,
// same id, both cut correctly; then one card's content changes and the other's rendering and mask are untouched.
async function addSecondCard(page: Page) {
  await page.evaluate(() => {
    const el = document.createElement("floorplan-studio-card");
    el.id = "card2";
    document.getElementById("wrap")!.appendChild(el);
  });
  await page.waitForFunction(() => customElements.get("floorplan-studio-card") !== undefined);
}
async function configureId(page: Page, id: string, config: Record<string, unknown>, hass: Record<string, unknown>) {
  await page.evaluate(
    ([id, config, hass]) => {
      const el = document.getElementById(id as string) as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = hass;
      return el.updateComplete;
    },
    [id, config, hass] as const,
  );
}
function svgHtml(page: Page, id: string) {
  return page.locator(`#${id}`).evaluate((el) => el.shadowRoot!.querySelector("svg")!.outerHTML);
}
function maskIdsIn(html: string): string[] {
  return [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
}

test("S8.11: two cards showing the same floor mint the same (content-derived) mask id, each safely scoped to its own shadow root", async ({ page }) => {
  await open(page);
  await addSecondCard(page);
  const layout = structuredClone(demo);
  await configure(page, { layout, floor: "first" }, { states: {} });
  await configureId(page, "card2", { layout, floor: "first" }, { states: {} });

  const html1 = await svgHtml(page, "card"), html2 = await svgHtml(page, "card2");
  const ids1 = maskIdsIn(html1), ids2 = maskIdsIn(html2);
  expect(ids1, "the first floor's one opening should produce exactly one mask").toHaveLength(1);
  expect(ids2).toEqual(ids1); // same content -> same deterministic id, in each card's own scope
  expect(html1).toContain(`mask="url(#${ids1[0]})"`);
  expect(html2).toContain(`mask="url(#${ids2[0]})"`);

  // Mutate only card2 (a different opening: different content -> a different id, or none at all here) and
  // confirm card1's own svg — id, mask content, everything — is untouched by whatever card2 now does.
  const layout2 = structuredClone(demo);
  layout2.floors.first.openings = [];
  await configureId(page, "card2", { layout: layout2, floor: "first" }, { states: {} });
  const html2b = await svgHtml(page, "card2");
  expect(maskIdsIn(html2b), "card2 now has no openings, so no mask at all").toHaveLength(0);
  const html1b = await svgHtml(page, "card");
  expect(html1b).toBe(html1); // card1 rendered nothing new: still the same markup, same mask, same id
});

// Diego's field review of the S8.11 4x crops was of the plain card, not the editor (opening-light-4x.png,
// opening-ha-dark-4x.png, 2026-09-26): both defects below are fixed once, in src/core/render.ts, and CLAUDE.md
// finding 8 says the editor and the card share one draw path — but the crops that found them were card
// screenshots, so a card-side regression test guards the path that actually shipped the bug.
const FIRST_OPENING_A: [number, number] = [600, 600], FIRST_OPENING_B: [number, number] = [700, 600];
const OPENING_MID_X = (FIRST_OPENING_A[0] + FIRST_OPENING_B[0]) / 2; // 650
const ROOM_FILL_LIGHT: [number, number, number] = [0x4a, 0x6f, 0xa5]; // Office's own colour, demo/layout.json
const WALL_LIGHT: [number, number, number] = [0x1a, 0x19, 0x17]; // --fp-wall-external, light theme
function closeToRgb(px: [number, number, number, number], rgb: [number, number, number]) {
  return Math.abs(px[0] - rgb[0]) <= 2 && Math.abs(px[1] - rgb[1]) <= 2 && Math.abs(px[2] - rgb[2]) <= 2;
}
async function cardScreenOf(page: Page, x: number, y: number) {
  return page.locator("floorplan-studio-card").evaluate((el, [px, py]) => {
    const svg = (el as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const q = new DOMPoint(px as number, py as number).matrixTransform(svg.getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [x, y] as const);
}

test("S8.11 fix 1 (card): the mask cut has square ends — 1.5cm inside a is a hole, 1.5cm outside a is still wall", async ({ page }) => {
  await open(page);
  await configure(page, { layout: demo, floor: "first", theme: "light" }, { states: {} });
  const { decodePng, pixelAt } = await import("../core/util/png");

  const insideA = await cardScreenOf(page, FIRST_OPENING_A[0] + 1.5, 600);
  const outsideA = await cardScreenOf(page, FIRST_OPENING_A[0] - 1.5, 600);
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const insidePx = pixelAt(png, insideA.x, insideA.y);
  const outsidePx = pixelAt(png, outsideA.x, outsideA.y);

  expect(closeToRgb(insidePx, WALL_LIGHT), `1.5cm inside a (${insidePx}) must not be the wall colour`).toBe(false);
  expect(closeToRgb(outsidePx, WALL_LIGHT), `1.5cm outside a (${outsidePx}) should still be the external wall colour`).toBe(true);
});

// This must fail with the round cap restored: reverting src/core/render.ts's opening line back to
// stroke-linecap="round" erases the "outside a" point too (verified by hand, see the S8.11 report).

// Opus review of S8.11, item 3 (2026-09-26): the seam patch that used to repaint over an opening's centreline is
// gone (removed from src/core/render.ts). Diego's 4x crops of a test layout, not the demo — one opening on the
// house's own outline, one between two differently-coloured rooms, all three themes — showed no visible line, and a
// pixel scan across the full width of each opening (tests/card/zzz-seam-scan.spec.ts, run and deleted, not
// committed) found the two rooms' polygons already meet exactly at the shared wall centreline with no gap and no
// blended sliver, once fix 2's wider cut (OPENING_EXTRA, above) is in place: the old patch was covering a seam that
// this fix already closes as a side effect. This is that test layout's own regression test, replacing the old,
// patch-dependent "S8.11 fix 2" test above (which sampled the demo's *external*-wall opening at its literal
// centreline — the boundary between a room and open air, where the far side is correctly blank, not room fill; not
// a meaningful place to assert "room fill").
const SEAM_LAYOUT = {
  version: 2, unit: "cm", north: 0, rotate: 0,
  floors: {
    test: {
      title: "Seam test",
      outline: [[0, 0], [600, 0], [600, 400], [0, 400]],
      owk: ["external", "external", "external", "external"],
      rooms: [
        { id: "room-a", name: "Blue", label: "", kind: "room", color: "#4a6fa5", pts: [[0, 0], [300, 0], [300, 400], [0, 400]], wk: ["external", "wall", "external", "external"] },
        { id: "room-b", name: "Green", label: "", kind: "room", color: "#2f8f3f", pts: [[300, 0], [600, 0], [600, 400], [300, 400]], wk: ["external", "external", "external", "wall"] },
      ],
      openings: [{ id: "opening-internal", a: [300, 150], b: [300, 250] }],
    },
  },
};
const GREEN_FILL: [number, number, number] = [0x2f, 0x8f, 0x3f]; // room-b's own colour, SEAM_LAYOUT above

test("S8.11 review (card): the internal opening's centre, between two differently-coloured rooms, is a real room fill — not white, not a blend", async ({ page }) => {
  await open(page);
  await configure(page, { layout: SEAM_LAYOUT, floor: "test", theme: "light" }, { states: {} });
  const { decodePng, pixelAt } = await import("../core/util/png");

  const centre = await cardScreenOf(page, 300, 200); // the opening's own centre: wall centreline x, mid-length y
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const centrePx = pixelAt(png, centre.x, centre.y);

  expect(closeToRgb(centrePx, GREEN_FILL), `opening centre (${centrePx}) should be a real room fill, not background or a blend`).toBe(true);
});

// This must fail with the opening removed (`openings: []` on the same layout): with no hole to cut, this exact
// point sits dead centre of the solid internal wall and reads its colour, (43,42,39,255), not a room fill —
// verified by hand, reverting the test layout's own `openings` array once and rerunning, see the S8.11 report.

// ---- Opus review of S8.11: the opening mask has no region, so it defaults to -10%/120% of the viewport measured
// from the *coordinate system's own* 0,0 — not the viewBox's x/y. Any floor viewed away from the origin (zoomed in,
// or simply drawn somewhere else in plan space) then has its walls erased outright, wherever they fall outside that
// accidental rectangle. Two independent reproductions: a zoomed-in viewBox that excludes 0,0 (mirrors "zoom in twice
// in the card" from the field report), and a floor whose own content is offset far from 0,0 (mirrors "a floor offset
// by ±5000"). Both are plain wall-colour checks, not sub-pixel colour blends, so they do not depend on antialiasing.
function shiftPt(p: [number, number], dx: number, dy: number): [number, number] { return [p[0] + dx, p[1] + dy]; }
/** Deep-shifts every coordinate a first floor built like the demo's actually carries (outline, rooms, openings). Any
 * field this floor does not use (devices, walls, stairs, trace) is left as `[]`/absent, on purpose: a minimal
 * reproduction, not a copy of the demo. */
function shiftFirstFloor(floor: any, dx: number, dy: number) {
  const f = structuredClone(floor);
  f.outline = f.outline.map((p: [number, number]) => shiftPt(p, dx, dy));
  f.rooms = f.rooms.map((r: any) => ({ ...r, pts: r.pts.map((p: [number, number]) => shiftPt(p, dx, dy)) }));
  f.openings = (f.openings ?? []).map((op: any) => ({ ...op, a: shiftPt(op.a, dx, dy), b: shiftPt(op.b, dx, dy) }));
  return f;
}

test("S8.11 fix (blocker, card): a wall far from the origin, seen through a zoomed viewBox that excludes 0,0, is still wall colour", async ({ page }) => {
  await open(page);
  await configure(page, { layout: demo, floor: "first", theme: "light" }, { states: {} });
  const { decodePng, pixelAt } = await import("../core/util/png");

  // A small window well away from 0,0, over a stretch of the same external wall as the opening but far from it
  // (x=450..550, nowhere near the 600-700 opening), so only the missing-mask-region bug — not the opening itself —
  // can make this pixel not-wall.
  await page.locator("floorplan-studio-card").evaluate((el) => {
    const svg = (el as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "450 550 100 100");
  });
  const zoomedWall = await cardScreenOf(page, 500, 600);
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const px = pixelAt(png, zoomedWall.x, zoomedWall.y);
  expect(closeToRgb(px, WALL_LIGHT), `wall at (500,600), viewed through a viewBox excluding 0,0 (${px}) should still be the external wall colour`).toBe(true);
});

// This must fail with `<mask>`'s own x/y/width/height removed: the mask's default region (-10%/120% of the
// viewport, measured from the coordinate system's 0,0, not from the viewBox's own x/y) then excludes this whole
// zoomed-in view, so the entire wall group under the mask is erased and this pixel reads as room fill instead.

test("S8.11 fix (blocker, card): a floor offset by +5000 still shows its walls", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  layout.floors.first = shiftFirstFloor(layout.floors.first, 5000, 5000);
  await configure(page, { layout, floor: "first", theme: "light" }, { states: {} });
  const { decodePng, pixelAt } = await import("../core/util/png");

  // The same far-from-the-opening wall point as above, shifted by the same +5000,+5000.
  const shiftedWall = await cardScreenOf(page, 5000 + 500, 5000 + 600);
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const px = pixelAt(png, shiftedWall.x, shiftedWall.y);
  expect(closeToRgb(px, WALL_LIGHT), `wall at (5500,5600) on a floor offset by +5000 (${px}) should still be the external wall colour`).toBe(true);
});

// This must fail the same way: the floor's own fit viewBox sits around (4940,4940), nowhere near the mask's
// accidental default region, so the whole wall group vanishes and this reads as room fill, not wall.

// ---- Opus review of S8.11: the mask cut and the wall's own halo (.eh) are exactly the same width (both
// wallWidthAt(...) + 2), so their two edges land on the identical plan coordinate. Two independently antialiased
// edges landing on the same line do not reliably cancel out — a browser's mask-coverage sampling and its
// stroke-coverage sampling round sub-pixel coverage slightly differently — and one particular row right on that
// coincident line renders as a partial blend of the halo's white and the room's own fill, instead of cleanly one or
// the other: a faint line along the hole (found zoomed in, same as the mask-region blocker above; the demo card's
// own default fit is coarse enough — about 1.3 device px per cm — that this single-row artifact happens not to
// land on a sampled pixel there, so the test zooms in, as the field report did, to make it land reliably).
test("S8.11 fix (halo seam, card): the cut no longer coincides with the wall's own halo edge, so no faint blended line survives along the hole", async ({ page }) => {
  await open(page);
  await configure(page, { layout: demo, floor: "first", theme: "light" }, { states: {} });
  const { decodePng, pixelAt } = await import("../core/util/png");

  // Zoomed in over the opening (empirically confirmed to expose the coincident-edge artifact reliably, unlike the
  // card's own coarser default fit).
  await page.locator("floorplan-studio-card").evaluate((el) => {
    const svg = (el as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "620 580 60 40");
  });
  // y=589 is the external wall's own halo edge (600 - (WALL_WIDTH_EXTERNAL + WALL_HALO_EXTRA)/2 = 600 - 11): where
  // the old, too-narrow cut used to end too, coincident with the halo's own edge. Widening the cut moves the hole's
  // edge a further 2cm out, so this row now sits solidly inside the hole with a real margin, not on a seam.
  const seamPoint = await cardScreenOf(page, OPENING_MID_X, 589);
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const px = pixelAt(png, seamPoint.x, seamPoint.y);

  expect(closeToRgb(px, ROOM_FILL_LIGHT), `the old halo/cut coincidence row (${px}) should be plain room fill, not a blended halo line`).toBe(true);
});

// This must fail with the cut narrowed back to wallWidthAt(...) + 2 (its old width, exactly the halo's own width):
// the sampled row then sits precisely on the coincident edge and reads as a blend, e.g. (142,165,199,255) — neither
// the halo's white nor the room's own fill (verified by hand, see the S8.11 report).
