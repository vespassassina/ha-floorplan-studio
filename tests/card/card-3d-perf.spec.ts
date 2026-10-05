import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, canvas, cam, drawn } from "./helpers-3d";

// S12.6, spec J (criterion 10): the view draws on demand, and a hostile layout renders or falls back without an error.
// Frames are counted with `data-drawn`, which the view bumps once per render. Real card, real browser, real mouse.

const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string, last = iso(600), attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: last });
const QUIET = () => ({ "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "binary_sensor.demo_hall_motion": st("off") });
const hallLayout = () => { const l = structuredClone(demo); l.floors.ground.rooms[2].motion = ["binary_sensor.demo_hall_motion"]; return l; };

const trouble = (page: Page) => {
  const seen: string[] = [];
  page.on("pageerror", (e) => seen.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") seen.push(`console.error: ${m.text()}`); });
  return seen;
};
async function boot(page: Page, layout: unknown, states: Record<string, unknown> = QUIET()) {
  await page.addInitScript(() => { (window as unknown as { __FP3D_TEST__: boolean }).__FP3D_TEST__ = true; });
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", active_list: false }, states] as const);
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
const frames = async (page: Page) => (await cam(page)).drawn;
const push = (page: Page, states: Record<string, unknown>) => page.evaluate(async (states) => {
  const el = document.getElementById("card") as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
  el.hass = { ...el.hass, states };
  await el.updateComplete;
}, states);

test.describe("3D view: renders on demand (S12.6)", () => {
  test("idle: no frame for two seconds", async ({ page }) => {
    await boot(page, structuredClone(demo));
    const n = await frames(page);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toBe(n);
  });

  test("a pulse asks for frames while it plays and none after it; a fade asks for one a second, and none when it is over", async ({ page }) => {
    await boot(page, hallLayout());
    await push(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("on", iso(0)) });
    const n = await frames(page);
    await page.waitForTimeout(600);
    expect(await frames(page)).toBeGreaterThan(n + 3); // it is an animation: frames while it plays (three pulses of 1.4 s)
    // the view says when the last pulse has played (a loaded machine draws few frames, so counting them would guess)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fp3d: { live(): { pulsing: boolean } } }).__fp3d.live().pulsing), { timeout: 12000, intervals: [100] }).toBe(false);
    await page.waitForTimeout(1500); // the card's next one-second tick tells the view the pulse is over: one last frame, with the value it already shows
    await still(page);
    const held = await frames(page);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toBe(held);
    // off a while ago: the edge fades by last_changed, and the card's one-second timer is its only clock: at most a frame a second
    await push(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("off", iso(150)) });
    await still(page);
    const f = await frames(page);
    await page.waitForTimeout(3000);
    expect(await frames(page) - f).toBeLessThanOrEqual(4);
  });

  test("a fade that is over asks for no frame at all", async ({ page }) => {
    await boot(page, hallLayout(), { ...QUIET(), "binary_sensor.demo_hall_motion": st("off", iso(5000)) });
    const g = await frames(page);
    await page.waitForTimeout(2500);
    expect(await frames(page)).toBe(g);
  });

  test("a hundred hass updates, a frame apart, that change nothing are a handful of renders, not a hundred", async ({ page }) => {
    const states = { ...QUIET(), "light.demo_living": st("on", iso(5)) };
    await boot(page, hallLayout(), states);
    const n = await frames(page);
    await page.evaluate(async (states) => {
      const el = document.getElementById("card") as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
      for (let i = 0; i < 100; i++) { el.hass = { ...el.hass, states: { ...states } }; await el.updateComplete; await new Promise((r) => requestAnimationFrame(r)); } // one a frame, so only an unchanged state keeps the view from drawing
    }, states);
    await still(page);
    expect(await frames(page) - n).toBeLessThanOrEqual(3);
  });

  test("a hundred updates in one task are at most one frame", async ({ page }) => {
    const states = { ...QUIET(), "light.demo_kitchen": st("on", iso(5)) };
    await boot(page, hallLayout(), states);
    const n = await frames(page);
    await page.evaluate((states) => {
      const el = document.getElementById("card") as unknown as { hass: Record<string, unknown> };
      for (let i = 0; i < 100; i++) el.hass = { ...el.hass, states: { ...states, "sensor.noise": { state: String(i), attributes: {}, last_changed: new Date().toISOString() } } };
    }, states);
    await still(page);
    expect(await frames(page) - n).toBeLessThanOrEqual(1);
  });
});

/** A layout a stranger could have written, with `mutate` applied to the ground floor. */
const hostile = (mutate: (g: any) => void) => { const l = structuredClone(demo); mutate(l.floors.ground); return l; };

test.describe("3D view: hostile layouts, in a real browser (S12.6)", () => {
  const cases: [string, (g: any) => void][] = [
    ["5000 pieces of furniture", (g) => { g.furniture = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: (i % 100) * 8, y: Math.floor(i / 100) * 12, rot: i % 360, w: 15, h: 15 })); }],
    ["a zero-height wall", (g) => { g.walls.push({ id: "z", a: [0, 0], b: [300, 0], kind: "wall", height: 0 }); }],
    ["a NaN and an Infinity size", (g) => { g.furniture.push({ id: "nan", symbol: "sofa", x: 10, y: 10, rot: 0, w: null, h: 50 }, { id: "inf", symbol: "table", x: 1e999, y: 0, rot: 0, w: 50, h: 50 }); }],
    ["a room with 2000 points", (g) => { g.rooms.push({ id: "big", name: "Big", kind: "room", pts: Array.from({ length: 2000 }, (_, i) => [450 + 200 * Math.cos((i / 2000) * 2 * Math.PI), 300 + 200 * Math.sin((i / 2000) * 2 * Math.PI)]) }); }],
    ["300 devices", (g) => { for (let i = 0; i < 300; i++) g.devices.push({ id: `d${i}`, type: i % 3 ? "light" : "temp", entity: `light.many_${i}`, name: `D${i}`, x: (i % 30) * 25, y: Math.floor(i / 30) * 40 }); }],
  ];
  for (const [name, mutate] of cases) {
    test(`${name}: the view draws or the card falls back, with no error`, async ({ page }) => {
      const seen = trouble(page), t0 = Date.now();
      const layout = hostile(mutate);
      // `null` for NaN and the long literal for Infinity cannot survive JSON, so the layout goes in as the browser's own object
      if (name.startsWith("a NaN")) { const g = layout.floors.ground; g.furniture[g.furniture.length - 2].w = NaN; g.furniture[g.furniture.length - 1].x = Infinity; }
      await serve(page);
      await page.addInitScript(() => { (window as unknown as { __FP3D_TEST__: boolean }).__FP3D_TEST__ = true; });
      await page.goto(`${ORIGIN}/harness.html`);
      await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
      await page.evaluate(async (layout) => {
        const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
        el.setConfig({ layout, floor: "ground", view: "3d" });
        el.hass = { states: {}, callService: () => undefined };
        await el.updateComplete;
      }, layout);
      await expect.poll(async () => (await canvas(page).count()) + (await card(page).locator("css=.fp-3d-note, p.msg").count()), { timeout: 10000 }).toBeGreaterThan(0);
      // a layout the validator accepts must draw; one it refuses (NaN) falls back to its line
      if (!name.startsWith("a NaN")) expect(await canvas(page).count()).toBe(1);
      if (await canvas(page).count()) await drawn(page);
      else expect(await card(page).locator("css=.fp-3d-note, p.msg").first().textContent()).toMatch(/3D|plan could not be used/i); // the fallback says why, in its one line
      expect(Date.now() - t0).toBeLessThan(10000);
      expect(seen).toEqual([]);
    });
  }

  test("a floor named __proto__ renders or falls back, with no error", async ({ page }) => {
    const seen = trouble(page);
    await serve(page);
    await page.addInitScript(() => { (window as unknown as { __FP3D_TEST__: boolean }).__FP3D_TEST__ = true; });
    await page.goto(`${ORIGIN}/harness.html`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    const raw = JSON.stringify(demo).replace('"floors":{"ground":', '"floors":{"__proto__":'); // JSON.parse makes it an own key, as a file would
    await page.evaluate(async (raw) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig({ layout: JSON.parse(raw), view: "3d" });
      el.hass = { states: {}, callService: () => undefined };
      await el.updateComplete;
    }, raw);
    await expect.poll(async () => (await canvas(page).count()) + (await card(page).locator("css=.fp-3d-note, p.msg").count()), { timeout: 10000 }).toBeGreaterThan(0);
    if (await canvas(page).count()) await drawn(page);
    expect(seen).toEqual([]);
  });

  test("a tap on a floor of 5000 pieces of furniture is answered in under a second", async ({ page }) => {
    const seen = trouble(page);
    await boot(page, hostile((g) => { g.furniture = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: (i % 100) * 8, y: Math.floor(i / 100) * 12, rot: i % 360, w: 15, h: 15 })); }));
    const at = await page.evaluate(() => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): { x: number; y: number } } }).__fp3d.project(300, 500, 1));
    const t0 = Date.now();
    await page.mouse.click(at.x, at.y);
    const took = await page.evaluate(([x, y]) => { const t = performance.now(); (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(x, y); return performance.now() - t; }, [at.x, at.y] as const);
    expect(took).toBeLessThan(1000);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(seen).toEqual([]);
  });
});
