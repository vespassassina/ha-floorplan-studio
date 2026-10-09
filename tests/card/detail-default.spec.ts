import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S25 fix A, B, C, F: the card with its REAL default (`window.__realDetailDefault`, so the harness does not pin `detail: full`).
// Every click is page.mouse at coordinates checked to be the real top element (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: new Date().toISOString() });
const IDLE = { "light.demo_living": st("off"), "switch.demo_living_relay": st("off") };

async function open(page: Page, config: Record<string, unknown>, states: Record<string, unknown> = IDLE, layout: unknown = demo) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript(() => { (window as any).__realDetailDefault = true; });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ cfg, states }) => {
    const el = document.getElementById("card") as any;
    el.setConfig(cfg);
    el.hass = { states, callService: () => {} };
    await el.updateComplete;
  }, { cfg: { layout, floor: "ground", theme: "light", ...config }, states });
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const level = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null);
/** Device i's computed display and the real top element at its centre. */
const dev = (page: Page, i: number) => card(page).evaluate((el, i) => {
  const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
  const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
  return { display: getComputedStyle(g).display, x, y, hit: !!top?.closest(`g[data-x="${i}"]`) };
}, i);
const LAMP = 0; // demo ground floor, device 0: light.demo_living
async function clickOn(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    const r = t.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return top && (top === t || t.contains(top)) ? { x, y } : null;
  }, sel);
  expect(p, `${sel} is the top element at its centre`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}

test("A: kiosk with zoom off cannot change the level, so the default is full: the idle lamp is drawn and a real click opens its popup", async ({ page }) => {
  await open(page, { kiosk: true, zoom: false });
  expect(await level(page)).toBe("near");
  const d = await dev(page, LAMP);
  expect(d.display).not.toBe("none");
  expect(d.hit).toBe(true);
  await page.mouse.click(d.x, d.y);
  await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
});

test("A: kiosk alone has no Detail button, so the default is full too", async ({ page }) => {
  await open(page, { kiosk: true });
  expect(await level(page)).toBe("near");
  expect((await dev(page, LAMP)).display).not.toBe("none");
  await expect(card(page).locator("css=.fp-detail-toggle")).toHaveCount(0);
});

test("A: active_list false with zoom off is full as well; with zoom left on it stays auto (the viewer can zoom)", async ({ page }) => {
  await open(page, { active_list: false, zoom: false });
  expect(await level(page)).toBe("near");
  expect((await dev(page, LAMP)).display).not.toBe("none");
  await page.reload();
  await open(page, { active_list: false });
  expect(await level(page)).toBe("far");
});

test("A: a normal card keeps auto: far at fit, the idle lamp hidden; zoom off alone still has the Detail button, so auto", async ({ page }) => {
  await open(page, {});
  expect(await level(page)).toBe("far");
  expect((await dev(page, LAMP)).display).toBe("none");
  await page.reload();
  await open(page, { zoom: false });
  expect(await level(page)).toBe("far");
});

test("A: an explicit detail wins: auto in a kiosk is far, minimal on a normal card is far, full in a kiosk with zoom off is near", async ({ page }) => {
  await open(page, { kiosk: true, zoom: false, detail: "auto" });
  expect(await level(page)).toBe("far");
  expect((await dev(page, LAMP)).display).toBe("none");
  await page.reload();
  await open(page, { kiosk: true, detail: "minimal" });
  expect(await level(page)).toBe("far");
});

test("F: the real default is auto: far at fit, mid then near as the card zooms in; the Detail button picks", async ({ page }) => {
  await open(page, { zoom: "wheel" });
  expect(await level(page)).toBe("far");
  const seen: string[] = [];
  const svg = await card(page).evaluate((el) => { const r = el.shadowRoot!.querySelector("svg")!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(svg.x, svg.y);
  for (let i = 0; i < 40 && seen[seen.length - 1] !== "near"; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
    const l = (await level(page))!;
    if (seen[seen.length - 1] !== l) seen.push(l);
  }
  expect(seen).toEqual(["far", "mid", "near"]);
  await clickOn(page, "button.fp-detail-toggle");
  await clickOn(page, 'button.fp-detail[data-detail="minimal"]');
  expect(await level(page)).toBe("far");
  await clickOn(page, 'button.fp-detail[data-detail="full"]');
  expect(await level(page)).toBe("near");
});

// ---- B: an unlocked lock and a low battery stay dots at far -----------------------------------------------------------------------------
const alertLayout = () => {
  const l = structuredClone(demo), g = l.floors.ground;
  g.devices = [
    { id: "l1", type: "lock", entity: "lock.a", name: "Unlocked", x: 100, y: 100 },
    { id: "l2", type: "lock", entity: "lock.b", name: "Jammed", x: 200, y: 100 },
    { id: "l3", type: "contact", entity: "binary_sensor.c", name: "Low contact", x: 300, y: 100 },
    { id: "l4", type: "temp", entity: "sensor.bat", name: "Battery sensor", x: 400, y: 100 },
    { id: "f1", type: "lock", entity: "lock.c", name: "Fine lock", x: 100, y: 200 },
    { id: "f2", type: "contact", entity: "binary_sensor.d", name: "Fine contact", x: 200, y: 200 },
    { id: "f3", type: "temp", entity: "sensor.bat2", name: "Fine battery", x: 300, y: 200 },
  ];
  return l;
};
const alertStates = {
  "lock.a": st("unlocked"), "lock.b": st("jammed"), "binary_sensor.c": st("off", { battery_level: 3 }),
  "sensor.bat": st("4", { device_class: "battery", unit_of_measurement: "%" }),
  "lock.c": st("locked"), "binary_sensor.d": st("off", { battery_level: 80 }), "sensor.bat2": st("85", { device_class: "battery", unit_of_measurement: "%" }),
};
test("B (computed-style pair): at far an unlocked lock, a jammed lock, a battery-low contact and a battery sensor at 4 % are drawn; the same devices fine are not", async ({ page }) => {
  await open(page, { detail: "minimal" }, alertStates, alertLayout());
  expect(await level(page)).toBe("far");
  const shown = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(async (i) => (await dev(page, i)).display));
  for (const i of [0, 1, 2, 3]) expect(shown[i], `device ${i} needs attention`).not.toBe("none");
  // Drawn is not enough: an off disc has no fill, so the dot must be painted (found by looking at the render).
  const halo = await card(page).evaluate((el) => [0, 1, 2, 3].map((i) => { const h = getComputedStyle(el.shadowRoot!.querySelector(`svg g[data-x="${i}"] .halo`)!); return { fill: h.fill, op: h.fillOpacity }; }));
  for (const [i, h] of halo.entries()) { expect(h.op, `device ${i} dot opacity`).toBe("1"); expect(h.fill, `device ${i} dot fill`).not.toMatch(/rgba\(.*, 0\)|none/); }
  expect(shown.slice(4), "fine").toEqual(["none", "none", "none"]);
});

// ---- C: a badge keeps its screen size under a real wheel zoom ------------------------------------------------------------------------
test("C: a room badge is the same size on screen at zoom 1 and zoom 2 (within 1 px) while the room itself grows", async ({ page }) => {
  await open(page, { zoom: "wheel", detail: "minimal" }, { ...IDLE, "light.demo_living": st("on"), "switch.demo_living_relay": st("on") });
  const measure = () => card(page).evaluate((el) => {
    const b = el.shadowRoot!.querySelector(".room-badge")!.getBoundingClientRect();
    const room = el.shadowRoot!.querySelector("svg .room")!.getBoundingClientRect();
    return { w: b.width, h: b.height, room: room.width, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  });
  const before = await measure();
  expect(before.w).toBeGreaterThan(4);
  await page.mouse.move(before.cx, before.cy);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(30); const m = await measure(); if (m.room >= before.room * 2) break; }
  const after = await measure();
  expect(after.room, "the room grew").toBeGreaterThan(before.room * 1.5);
  expect(Math.abs(after.w - before.w), `badge width ${before.w} -> ${after.w}`).toBeLessThanOrEqual(1);
  expect(Math.abs(after.h - before.h), `badge height ${before.h} -> ${after.h}`).toBeLessThanOrEqual(1);
});
