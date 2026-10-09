import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Opus review of Sprint 11, the card side: a tap on a room's name, readout or furniture picks the room (1); a double
// tap leaves the pick alone (3); the motion border pulses three times and a redraw does not replay them (5); the
// keyboard asks the same question the pointer does (9); the panel names the room (12). Every click is a real
// page.mouse click at coordinates found with elementsFromPoint (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-04T09:30:15Z") => ({ state, attributes, last_changed });

const layout = structuredClone(demo);
Object.assign(layout.floors.ground.rooms[0], { temps: ["sensor.t1"], motion: ["binary_sensor.m1"] });
// Living's lamp names a second entity, so a tap on it opens the chooser instead of guessing (S10.4).
Object.assign(layout.floors.ground.devices[0], { attached: ["sensor.lamp_power"] });
const STATES = (motionAgoMs = 0) => ({
  "light.demo_living": st("on", { friendly_name: "Living light" }), "light.demo_kitchen": st("on"), "sensor.lamp_power": st("4", { unit_of_measurement: "W" }),
  "sensor.t1": st("21", { unit_of_measurement: "°C" }), "binary_sensor.m1": st("off"), ...(motionAgoMs ? { "binary_sensor.m1": st("on", {}, new Date(Date.now() - motionAgoMs).toISOString()) } : {}),
});

async function boot(page: Page, opts: { states?: Record<string, unknown>; config?: Record<string, unknown>; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states]) => {
      const w = window as unknown as { __calls: string[] };
      w.__calls = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
      return el.updateComplete;
    },
    [{ layout, floor: "ground", ...(opts.config ?? {}) }, opts.states ?? STATES()] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const picked = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll("svg polygon.room-picked")].map((p) => Number(p.getAttribute("data-picked"))));

/** The centre of the first element matching `sel` (optionally with text), and whether it is the real top element there. */
async function centreOf(page: Page, sel: string, text?: string) {
  const p = await card(page).evaluate((el, [sel, text]) => {
    const root = el.shadowRoot!;
    const node = [...root.querySelectorAll<SVGGraphicsElement>(sel as string)].find((n) => !text || n.textContent === text);
    if (!node) return null;
    const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, top: node.contains(root.elementsFromPoint(x, y)[0] ?? null) };
  }, [sel, text ?? null] as const);
  expect(p, `${sel} ${text ?? ""} exists`).not.toBeNull();
  return p!;
}
/** A point inside the first `sel` element where that element really is the top one (a sofa symbol has gaps, so not its centre). */
async function pointOn(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const root = el.shadowRoot!, node = root.querySelector<SVGGraphicsElement>(sel)!, r = node.getBoundingClientRect();
    for (let y = r.top + 2; y < r.bottom; y += 3) for (let x = r.left + 2; x < r.right; x += 3) if (node.contains(root.elementsFromPoint(x, y)[0] ?? null)) return { x, y };
    return null;
  }, sel);
  expect(p, `${sel} has a clickable point`).not.toBeNull();
  return p!;
}
/** A point on the bare floor of room `i`: the real top element there is its polygon. */
async function floorPoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!, r = poly.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    return null;
  }, i);
  expect(p, `room ${i} has bare floor`).not.toBeNull();
  return p!;
}

test.describe("1: a tap on a room's name, readout or furniture picks the room", () => {
  test("the room name, at real coordinates", async ({ page }) => {
    await boot(page);
    const p = await centreOf(page, "svg text.lbl", "Living");
    expect(p.top, "the name is the top element at its own centre").toBe(true);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([0]);
  });
  test("the temperature readout", async ({ page }) => {
    await boot(page);
    const p = await centreOf(page, "svg text.val");
    expect(p.top, "the readout is the top element").toBe(true);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([0]);
  });
  test("2D furniture, the sofa in Living", async ({ page }) => {
    await boot(page);
    const p = await pointOn(page, "svg g.furn");
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([0]);
  });
  for (const [view, rotation] of [["2.5d", 0], ["2d", 90], ["2.5d", 90]] as const)
    test(`the name on a ${view} plan turned ${rotation} degrees`, async ({ page }) => {
      await boot(page, { config: { view, rotation, tilt: 0.5 } });
      const p = await centreOf(page, "svg text.lbl", "Living");
      await page.mouse.click(p.x, p.y);
      expect(await picked(page)).toEqual([0]);
    });
  // S23.3: a 2.5D stem's foot is an obstacle now, so the Kitchen name no longer sits on the lamp's pin; it used to, and
  // this test clicked the pin to prove the name won. What stays: the name, beside the pin, is the top element and picks.
  test("in 2.5D (rotation 270, tilt 0.5) the Kitchen name keeps off the lamp's pin, and a tap on it picks the room", async ({ page }) => {
    await boot(page, { config: { view: "2.5d", tilt: 0.5, rotation: 270 } });
    const pin = await centreOf(page, 'svg circle.stem-top[cx="650"][cy="200"]');
    const top = await card(page).evaluate((el, [x, y]) => el.shadowRoot!.elementsFromPoint(x!, y!)[0]?.textContent ?? null, [pin.x, pin.y] as const);
    expect(top, "no name on the pin").not.toBe("Kitchen");
    const p = await centreOf(page, "svg text.lbl[data-rl]", "Kitchen");
    expect(p.top, "the name is the top element at its own centre").toBe(true);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([1]);
  });
  test("a loose sensor's value text is the device's: no pick (B)", async ({ page }) => {
    await boot(page, { states: { ...STATES(), "sensor.demo_living_temperature": st("19", { unit_of_measurement: "°C" }) } });
    const v = await centreOf(page, "svg text.val:not([data-rv])");
    expect(v.top, "the device's value is the top element").toBe(true);
    await page.mouse.click(v.x, v.y);
    expect(await picked(page)).toEqual([]);
  });
  // A fill with no name draws nothing, so this one has a name (it takes no label either).
  test("a fill on top of a room is looked through to the room (C)", async ({ page }) => {
    const l = structuredClone(layout);
    l.floors.ground.rooms.push({ id: "room-fill", name: "Rug", area: "", kind: "fill", pts: [[60, 260], [160, 260], [160, 340], [60, 340]], wk: ["none", "none", "none", "none"] });
    const n = l.floors.ground.rooms.length - 1;
    await boot(page, { config: { layout: l } });
    const p = await floorPoint(page, n);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([0]);
  });
  test("a device is still never a pick", async ({ page }) => {
    await boot(page);
    const p = await centreOf(page, 'svg g[data-x="1"]');
    expect(p.top).toBe(true);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([]);
  });
});

test.describe("3: a double tap leaves the pick alone", () => {
  test("with a room picked, a double tap on another room or on the same room keeps it", async ({ page }) => {
    await boot(page);
    await page.mouse.click((await floorPoint(page, 0)).x, (await floorPoint(page, 0)).y);
    expect(await picked(page)).toEqual([0]);
    const b = await floorPoint(page, 1);
    await page.mouse.dblclick(b.x, b.y);
    expect(await picked(page), "double tap on the Kitchen").toEqual([0]);
    const a = await floorPoint(page, 0);
    await page.waitForTimeout(450); // past DOUBLE_TAP_MS: the next pair is a new gesture, not a third tap
    await page.mouse.dblclick(a.x, a.y);
    expect(await picked(page), "double tap on the picked room").toEqual([0]);
  });
  test("with nothing picked, a double tap picks nothing; one tap still picks", async ({ page }) => {
    await boot(page);
    // The Kitchen, not Living: the section opens at the top left of the card and would sit under a second tap on Living.
    const a = await floorPoint(page, 1);
    await page.mouse.dblclick(a.x, a.y);
    expect(await picked(page)).toEqual([]);
    await page.waitForTimeout(450);
    await page.mouse.click(a.x, a.y);
    expect(await picked(page)).toEqual([1]);
  });
});

test.describe("5: the room's motion border pulses three times per trip", () => {
  const anim = (page: Page) => card(page).evaluate((el) => {
    const poly = el.shadowRoot!.querySelector("svg polygon.motion-perimeter");
    const a = poly?.getAnimations()[0];
    if (!poly || !a) return null;
    const t = (a.effect as KeyframeEffect).getComputedTiming();
    return { activeMs: Number(t.localTime) - Number(t.delay), iterations: t.iterations };
  });
  test("a state update that does not change the motion state carries the pulses on, it does not replay them", async ({ page }) => {
    await boot(page, { states: STATES(2000) }); // tripped 2 s ago, so the border is 2 s into its 4.2 s of pulses
    const before = await anim(page);
    expect(before, "the border is pulsing").not.toBeNull();
    expect(before!.iterations).toBe(3);
    expect(before!.activeMs).toBeGreaterThanOrEqual(2000);
    await card(page).evaluate((el) => { // an unrelated light changes: the whole plan redraws
      const e = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
      e.hass = { ...e.hass, states: { ...e.hass.states, "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } } };
      return e.updateComplete;
    });
    const after = await anim(page);
    expect(after, "still pulsing").not.toBeNull();
    expect(after!.activeMs, "continues where it was, not from zero").toBeGreaterThanOrEqual(2000);
  });
  test("a trip older than the three pulses has the steady edge and no animation", async ({ page }) => {
    await boot(page, { states: STATES(10_000) });
    expect(await card(page).locator("svg polygon.motion-perimeter").count()).toBe(1);
    expect(await anim(page)).toBeNull();
  });
});

test.describe("9 and 12: the keyboard decides like the pointer; the panel names the room", () => {
  test("Enter on a light that names two entities opens its popup, as a tap does, and calls nothing; the popup's More info opens the chooser", async ({ page }) => {
    await boot(page);
    const f = await floorPoint(page, 0);
    await page.mouse.click(f.x, f.y);
    const row = card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living light" });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
    expect(await calls(page)).toEqual([]);
    await card(page).locator("css=.fp-pop-more").click();
    await expect(card(page).locator("css=.fp-chooser-dialog")).toHaveCount(1);
    expect(await calls(page)).toEqual([]);
  });
  test("Enter on a light with one entity opens its popup, as a tap does; the button then makes the one call", async ({ page }) => {
    await boot(page);
    const f = await floorPoint(page, 1);
    await page.mouse.click(f.x, f.y);
    await card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Kitchen light" }).focus();
    await page.keyboard.press("Enter");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
    expect(await calls(page)).toEqual([]);
    await card(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(["light.turn_off light.demo_kitchen"]);
  });
  test("the panel's label is the room's name while a room is shown, and 'Overview' otherwise (S24.7)", async ({ page }) => {
    await boot(page);
    const label = () => card(page).locator("css=.fp-active").getAttribute("aria-label");
    expect(await label()).toBe("Overview");
    const f = await floorPoint(page, 0);
    await page.mouse.click(f.x, f.y);
    expect(await label()).toBe("Living");
  });
});
