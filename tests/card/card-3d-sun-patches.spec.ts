import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";

// S38.4 (docs/specs/sun-s38.md, criteria 8 to 12): the sun's patches on the floor behind the windows. The card does not hand the sun to the
// view yet (S38.2), so the tests feed it through the test-build hook `__fp3d.sun()`.
// The house is the demo's ground floor emptied of furniture and devices: 800 x 600 cm; room 0 is x 0..500, y 0..400, room 1 x 500..800, y 0..400,
// room 2 x 0..800, y 400..600. The outline and the outer edges are `external`; the edges at y = 400 and x = 500 are plain walls.
// A pixel is read with and without the windows (the same house, the same sun, the windows turned into doors, which cast none), so the floor's own
// Lambert shading cancels and only the patch is left. The camera looks almost straight down, from the south.
// A window is 160 cm wide, sill 90, head 210. The sun at azimuth 180, elevation 40 sends a point h up to h / tan 40 = 1.19 h cm into the room.

type Sun = { azimuth: unknown; elevation: unknown; north?: unknown };
type Win = { kind?: string; a: [number, number]; b: [number, number] };
const hook = <T, A = undefined>(page: Page, fn: (h: any, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const frames = (page: Page) => page.locator("floorplan-studio-card").locator("css=.fp-3d").evaluate((el) => +(el.dataset.drawn ?? 0));
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = await frames(page); same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
const sunned = async (page: Page, sun: Sun | null) => { await hook(page, (h, s) => h.sun(s), sun); await still(page); };
const patches = (page: Page) => hook(page, (h) => h.patches()) as Promise<{ builds: number; shown: { room: number; ring: number[][]; colour: string; strength: number }[] }>;
const count = (page: Page) => page.locator("floorplan-studio-card").locator("css=.fp-3d").evaluate((el) => el.dataset.sunPatches ?? "");

const windows = (list: Win[], kind: string) => list.map((w, i) => ({ id: `w${i}`, name: `W${i}`, kind: w.kind ?? kind, a: w.a, b: w.b }));
async function boot(page: Page, wins: Win[], o: { theme?: string; dark?: boolean; night?: boolean; asDoors?: boolean; devices?: unknown[] } = {}) {
  const layout = structuredClone(demo), g = layout.floors.ground;
  Object.assign(g, { furniture: [], devices: o.devices ?? [], unlinked: [], doors: windows(wins, o.asDoors ? "door" : "window"), openings: [] });
  await serve(page); await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, isNight]) => {
    const el = document.getElementById("card") as any; el.setConfig(config);
    (window as any).__states = isNight ? { "sun.sun": { state: "below_horizon", attributes: {}, last_changed: new Date().toISOString() } } : {};
    el.hass = { states: (window as any).__states, themes: { darkMode: false }, callService: () => undefined }; return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", theme: o.theme ?? "blueprint", walls: "full", active_list: false }, !!o.night] as const);
  await drawn(page); await still(page);
  await hook(page, (h) => h.look(0, 0.1)); await still(page);
}
/** Luminance of the floor at a plan point, the pixel a hair above the floor top. */
async function floorAt(page: Page, x: number, y: number): Promise<number> {
  const p = await hook(page, (h, a) => h.project(a[0], a[1], 1.6), [x, y]) as { x: number; y: number };
  const { data } = await readCanvasRect(page, { x: Math.round(p.x - 1), y: Math.round(p.y - 1), width: 2, height: 2 });
  const c = meanRgb(data);
  return Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
}
const SUN: Sun = { azimuth: 180, elevation: 40, north: 0 };
const SOUTH: Win = { a: [100, 600], b: [260, 600] };

/** The floor at each point with the windows and with them turned into doors, under the same sun. */
async function pair(page: Page, wins: Win[], pts: [number, number][], sun: Sun = SUN) {
  await boot(page, wins); await sunned(page, sun);
  const lit = [] as number[];
  for (const [x, y] of pts) lit.push(await floorAt(page, x, y));
  const shown = (await patches(page)).shown.length;
  await boot(page, wins, { asDoors: true }); await sunned(page, sun);
  const plain = [] as number[];
  for (const [x, y] of pts) plain.push(await floorAt(page, x, y));
  return { lit, plain, shown };
}

test.describe("3D sun patches (S38.4)", () => {
  test("a south window, sun at 180 / 40: the floor inside the predicted patch is brighter, the floor outside it is not; a north window casts none", async ({ page }) => {
    // Predicted: x 100..260; y from the head's shadow, 600 - 210 / tan 40 = 350, clipped at room 2's wall y = 400, to the sill's, 600 - 90 / tan 40 = 493.
    // Inside: (180, 450), plateau of the feather. Outside: (180, 560) between the wall and the sill's shadow; (50, 450) and (320, 450) beside it.
    const north: Win = { a: [100, 0], b: [260, 0] };
    const r = await pair(page, [SOUTH, north], [[180, 450], [180, 560], [50, 450], [320, 450], [180, 100], [180, 200]]);
    expect(r.shown, "one patch: the south window's").toBe(1);
    expect(r.lit[0] - r.plain[0], `inside ${r.lit[0]} over ${r.plain[0]}`).toBeGreaterThanOrEqual(20);
    for (const i of [1, 2, 3]) expect(Math.abs(r.lit[i] - r.plain[i]), `outside point ${i}: ${r.lit[i]} against ${r.plain[i]}`).toBeLessThanOrEqual(2);
    for (const i of [4, 5]) expect(Math.abs(r.lit[i] - r.plain[i]), `behind the north window, point ${i}: ${r.lit[i]} against ${r.plain[i]}`).toBeLessThanOrEqual(2);
  });

  test("an opening between two rooms and a door on a south external wall cast none", async ({ page }) => {
    const between: Win = { a: [500, 100], b: [500, 300] }, door: Win = { kind: "door", a: [300, 600], b: [460, 600] };
    // The sun in the east shines at the window between rooms 0 and 1: room 0 at (440, 200) must stay as it is. The sun in the south at the door: (380, 450).
    for (const [sun, pt] of [[{ azimuth: 90, elevation: 40, north: 0 }, [440, 200]], [SUN, [380, 450]]] as [Sun, [number, number]][]) {
      // A real south window on the same wall shows the machinery is on: with the sun in the south it alone casts.
      const r = await pair(page, [between, door, SOUTH], [pt], sun);
      expect(r.shown, JSON.stringify(sun)).toBe(sun === SUN ? 1 : 0);
      expect(Math.abs(r.lit[0] - r.plain[0]), `${pt}: ${r.lit[0]} against ${r.plain[0]}`).toBeLessThanOrEqual(2);
    }
  });

  test("a patch never leaves its room: beyond room 2's wall, inside the unclipped quad, the floor is unchanged", async ({ page }) => {
    // The unclipped quad reaches y = 350; room 2 ends at y = 400. (180, 372) is in room 0, 28 cm past the wall, and in plain view from the south.
    const r = await pair(page, [SOUTH], [[180, 450], [180, 372], [180, 360]]);
    expect(r.lit[0] - r.plain[0], "the patch is there, inside the room").toBeGreaterThanOrEqual(20);
    expect(Math.abs(r.lit[1] - r.plain[1]), `room 0 at (180, 372): ${r.lit[1]} against ${r.plain[1]}`).toBeLessThanOrEqual(2);
    expect(Math.abs(r.lit[2] - r.plain[2]), `room 0 at (180, 360): ${r.lit[2]} against ${r.plain[2]}`).toBeLessThanOrEqual(2);
  });

  test("30 south windows: 24 patches, data-sun-patches 24/30", async ({ page }) => {
    const wins: Win[] = Array.from({ length: 30 }, (_, i) => ({ a: [10 + i * 26, 600], b: [30 + i * 26, 600] }));
    await boot(page, wins); await sunned(page, SUN);
    expect(await count(page)).toBe("24/30");
    expect((await patches(page)).shown).toHaveLength(24);
    await sunned(page, null);
    expect(await count(page), "no sun: none").toBe("0/0");
    expect((await patches(page)).shown).toHaveLength(0);
  });

  test("night wins over the sun, and so does a sun under the horizon: no patch", async ({ page }) => {
    await boot(page, [SOUTH], { night: true }); await sunned(page, SUN);
    expect(await count(page)).toBe("0/0");
    await boot(page, [SOUTH]); await sunned(page, { azimuth: 180, elevation: -3, north: 0 });
    expect(await count(page)).toBe("0/0");
    await sunned(page, SUN);
    expect(await count(page)).toBe("1/1");
  });

  test("a hass update that changes a light and leaves the sun alone builds no patch; a sun that moves 1 degree does", async ({ page }) => {
    const light = { id: "l1", type: "light", entity: "light.test", name: "Test", x: 600, y: 500 };
    await boot(page, [SOUTH], { devices: [light] }); await sunned(page, SUN);
    const before = (await patches(page)).builds;
    expect(before).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => { const el = document.getElementById("card") as any; el.hass = { states: { "light.test": { state: "on", attributes: {}, last_changed: new Date().toISOString() } }, themes: { darkMode: false }, callService: () => undefined }; return el.updateComplete; });
    await still(page);
    expect(await page.locator("floorplan-studio-card").locator("css=.fp-3d").evaluate((el) => el.dataset.pools), "the light is lit: the update reached the view").toMatch(/^1\//);
    expect((await patches(page)).builds, "a light changed, the sun did not").toBe(before);
    await sunned(page, { azimuth: 180.4, elevation: 40.4, north: 0 });
    expect((await patches(page)).builds, "0.4 degrees: no build").toBe(before);
    await sunned(page, { azimuth: 181.2, elevation: 40, north: 0 });
    expect((await patches(page)).builds, "1.2 degrees in azimuth: one build").toBe(before + 1);
    await sunned(page, { azimuth: 181.2, elevation: 38.9, north: 0 });
    expect((await patches(page)).builds, "1.1 degrees in elevation: one build").toBe(before + 2);
  });

  test("a light theme caps the patch as it caps a wall glow", async ({ page }) => {
    await boot(page, [SOUTH], { theme: "light" }); await sunned(page, { azimuth: 180, elevation: 70, north: 0 });
    const light = (await patches(page)).shown[0];
    await boot(page, [SOUTH], { theme: "blueprint" }); await sunned(page, { azimuth: 180, elevation: 70, north: 0 });
    const dark = (await patches(page)).shown[0];
    expect(dark.strength, "sin 70 times the gain, uncapped").toBeGreaterThan(0.4);
    expect(light.strength).toBeCloseTo(0.35, 6);
  });

  test("a low sun throws a warm patch", async ({ page }) => {
    // A fullwindow (sill 0): a window's sill shadow lies past room 2's far wall at 8 degrees.
    await boot(page, [{ kind: "fullwindow", a: [100, 600], b: [260, 600] }]); await sunned(page, { azimuth: 180, elevation: 8, north: 0 });
    const warm = (await patches(page)).shown[0].colour, [r, g, b] = [1, 3, 5].map((i) => parseInt(warm.slice(i, i + 2), 16));
    expect(r, warm).toBe(255); expect(g, warm).toBeLessThan(250); expect(b, warm).toBeLessThan(g - 10); // between white and #ffd9a0: green 237, blue 211 at 8 degrees
    expect(g, warm).toBeGreaterThan(0xd9);
    await sunned(page, { azimuth: 180, elevation: 40, north: 0 });
    expect((await patches(page)).shown[0].colour).toBe("#ffffff");
  });
});
