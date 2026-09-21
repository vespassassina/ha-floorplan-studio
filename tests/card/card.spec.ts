import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

// Opus review of S2.1: the card's own chrome (p.msg, anything outside the <svg>) is styled by FLOORPLAN_CSS's
// :host rules, which read data-theme off the host element. This must follow hass.themes.darkMode, never the
// OS's prefers-color-scheme. A same-direction test (dark hass under dark OS) would pass without the fix, since
// prefers-color-scheme alone would already give the dark tokens; the crossed pairs below are the point.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const LIGHT_INK = "rgb(58, 58, 58)"; // --fp-text light, #3a3a3a
const DARK_INK = "rgb(216, 226, 242)"; // --fp-text dark, #d8e2f2

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

test("S2.1 review: the host follows hass.themes.darkMode, crossed against the OS colour scheme, not the OS itself", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await configure(page, {}, { states: {}, themes: { darkMode: true } });
  await expect.poll(() => msgColor(page)).toBe(DARK_INK);

  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await configure(page, {}, { states: {}, themes: { darkMode: false } });
  await expect.poll(() => msgColor(page)).toBe(LIGHT_INK);
  void testInfo;
});

test("S2.1 review: with no hass.themes at all the card is never hard-coded, and follows the OS instead", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page);
  await configure(page, {}, { states: {} });
  await expect.poll(() => msgColor(page)).toBe(DARK_INK);
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
  expect(await heaterStroke()).toBe("rgb(139, 133, 120)"); // --fp-idle

  await configure(
    page,
    { layout: structuredClone(demo) },
    { states: { "climate.demo_living": { state: "heat", attributes: { hvac_action: "heating" }, last_changed: new Date().toISOString() } } },
  );
  expect(await heaterStroke()).toBe("rgb(232, 128, 26)"); // --fp-heater
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

  await configure(page, { layout: structuredClone(demo), room_glow: true }, { states: { "light.demo_living": { state: "off", attributes: {}, last_changed: new Date().toISOString() } } });
  expect(await livingFill()).toBe("rgb(233, 227, 211)"); // --fp-room, the light is off

  await configure(page, { layout: structuredClone(demo), room_glow: true }, { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });
  // --fp-glow mixed 25% into the room's own --fp-room, not read outright (S2.9 Opus review: the old rule read
  // --fp-glow directly and so replaced the room's colour instead of tinting it; fixed for room_glow and the
  // S1.37 "on" tint in the same pass). Chromium serialises a color-mix() computed value as color(srgb ...), not
  // rgb(...); 0.92549/0.889216/0.777451 * 255 = 236/227/198, the 25%-glow/75%-room mix.
  expect(await livingFill()).toBe("color(srgb 0.92549 0.889216 0.777451)");

  // room_glow: false (or absent): the same lit light gives no glow at all, even though the light itself is on.
  await configure(page, { layout: structuredClone(demo) }, { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });
  expect(await livingFill()).toBe("rgb(233, 227, 211)");
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
  await configure(page, { layout }, { states: { "switch.demo_pump": { state: "on", attributes: {}, last_changed: new Date().toISOString() } } });

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
  await expect(chips).toHaveCount(2);
  for (const tag of await chips.evaluateAll((els) => els.map((e) => e.tagName))) expect(tag).toBe("BUTTON");

  const pairs = await chips.evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return { pressed: el.getAttribute("aria-pressed"), bg: s.backgroundColor, fg: s.color }; }));
  for (const { pressed, bg, fg } of pairs) expect(ratio(rgbOf(bg), rgbOf(fg)), `aria-pressed=${pressed}`).toBeGreaterThanOrEqual(4.5);

  // Tab reaches a chip and Enter activates it, like any other button (no custom keyboard handling needed).
  await chips.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
});
