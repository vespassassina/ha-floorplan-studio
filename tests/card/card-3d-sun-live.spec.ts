import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";

// S38.2 (docs/specs/sun-s38.md, criterion 2), end to end: the card reads `azimuth` and `elevation` from the sun entity's state and the
// 3D light follows them. card-3d-sun.spec.ts feeds the view through the test hook `__fp3d.sun()`; here the hook only reads, and the
// sun arrives the way Home Assistant sends it, in `hass.states`. The probe house is the one that spec describes (ground floor, no
// furniture, devices or openings; south outer face at y = 605, north at y = -5).
//
// Where the shape comes from (finding 21): Home Assistant core, homeassistant/components/sun/entity.py. `SunEntity.state_attributes`
// returns `{ "next_dawn", "next_dusk", "next_midnight", "next_noon", "next_rising", "next_setting" (ISO strings), "elevation",
// "azimuth", "rising" }`, with STATE_ATTR_AZIMUTH = "azimuth" and STATE_ATTR_ELEVATION = "elevation" in sun/const.py; the two angles
// are floats (azimuth.dd degrees clockwise from north, elevation.dd above the horizon, negative below), the state is "above_horizon"
// or "below_horizon". Here: those keys, as numbers (JSON), no extra keys needed.

interface Light { x: number; y: number; z: number; intensity: number; colour: string; hemi: number }
const sunState = (azimuth: unknown, elevation: unknown, state = "above_horizon") => ({
  state, last_changed: "2026-10-27T10:00:00Z",
  attributes: { next_dawn: "2026-10-28T05:40:00+00:00", next_dusk: "2026-10-28T16:50:00+00:00", next_midnight: "2026-10-28T23:15:00+00:00", next_noon: "2026-10-28T11:15:00+00:00", next_rising: "2026-10-28T06:10:00+00:00", next_setting: "2026-10-28T16:20:00+00:00", elevation, azimuth, rising: false },
});
const hook = <T, A = undefined>(page: Page, fn: (h: any, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const lightOf = (page: Page) => hook(page, (h) => h.light()) as Promise<Light>;
const frames = (page: Page) => page.locator("floorplan-studio-card").locator("css=.fp-3d").evaluate((el) => +(el.dataset.drawn ?? 0));
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = await frames(page); same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
const FIXED = { x: -0.5, y: 1, z: 0.8, intensity: 1.9, colour: "#ffffff", hemi: 1.6 };

async function boot(page: Page, states: Record<string, unknown>, o: { north?: number; rotation?: number; config?: Record<string, unknown> } = {}) {
  const layout = structuredClone(demo); const g = layout.floors.ground;
  Object.assign(g, { furniture: [], devices: [], unlinked: [], doors: [], openings: [] });
  layout.north = o.north ?? 0;
  if (o.rotation !== undefined) g.rotation = o.rotation;
  await serve(page); await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, st]) => {
    const el = document.getElementById("card") as any; el.setConfig(config);
    el.hass = { states: st, themes: { darkMode: false }, callService: () => undefined }; return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", theme: "blueprint", walls: "full", active_list: false, ...o.config }, states] as const);
  await drawn(page); await still(page);
}
/** A hass update as Home Assistant makes one: a new object, new states. */
const setStates = async (page: Page, states: Record<string, unknown>) => {
  await page.evaluate((st) => { const el = document.getElementById("card") as any; el.hass = { states: st, themes: { darkMode: false }, callService: () => undefined }; return el.updateComplete; }, states);
  await still(page);
};
const pr = (page: Page, x: number, y: number, z: number) => hook(page, (h, a) => h.project(a[0], a[1], a[2]), [x, y, z]);
async function rgbAt(page: Page, p: { x: number; y: number }): Promise<[number, number, number]> {
  const { data } = await readCanvasRect(page, { x: Math.round(p.x - 2), y: Math.round(p.y - 2), width: 4, height: 4 });
  return meanRgb(data).map(Math.round) as [number, number, number];
}
const L = (c: number[]) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
async function faces(page: Page) {
  await hook(page, (h, a) => h.look(a, 0.45), 0); await still(page);
  const south = await rgbAt(page, await pr(page, 200, 605, 125));
  await hook(page, (h, a) => h.look(a, 0.45), Math.PI); await still(page);
  const north = await rgbAt(page, await pr(page, 200, -5, 125));
  return { south, north };
}

/** The outer face the camera looks at head on, by the `look` angle and a point on the face (house 800 x 600 cm, walls 10 cm thick), in stored coordinates. */
const FACE = { south: [0, 200, 605], north: [Math.PI, 200, -5], east: [Math.PI / 2, 805, 300], west: [-Math.PI / 2, -5, 300] } as const;
async function faceLevel(page: Page, f: keyof typeof FACE) {
  const [az, x, y] = FACE[f];
  await hook(page, (h, a) => h.look(a, 0.45), az); await still(page);
  return L(await rgbAt(page, await pr(page, x, y, 125)));
}

test.describe("a floor turned in the house (review of Sprint 38, item 1)", () => {
  // A floor's stored point sits in the house at R(rotation) . p + offset, so a floor turned 90 degrees clockwise has the house's south
  // at its stored east. The 3D view draws the floor in its stored frame, so the sun's bearing there is azimuth + north - rotation.
  test("rotation 90, north 0, sun 180 / 40 (north - rotation is -90): the face that looks south in the house, the stored east, is the lit one", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(180, 40) }, { north: 0, rotation: 90 });
    const east = await faceLevel(page, "east"), west = await faceLevel(page, "west");
    expect(east, `east ${east} over west ${west}`).toBeGreaterThan(west * 1.06);
  });

  test("rotation -90, north 0, sun 180 / 40: the house's south is the stored west", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(180, 40) }, { north: 0, rotation: -90 });
    const west = await faceLevel(page, "west"), east = await faceLevel(page, "east");
    expect(west, `west ${west} over east ${east}`).toBeGreaterThan(east * 1.06);
  });

  test("north 90 and rotation 90 cancel: the stored south is lit by a sun at 180", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(180, 40) }, { north: 90, rotation: 90 });
    const south = await faceLevel(page, "south"), north = await faceLevel(page, "north");
    expect(south, `south ${south} over north ${north}`).toBeGreaterThan(north * 1.06);
  });
});

test.describe("the card hands sun.sun to the 3D view (S38.2)", () => {
  test("sun.sun at 180 / 40, north 0: the south face is brighter than the north one; with layout.north 180 it is the other way", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(180, 40) }, { north: 0 });
    const a = await faces(page);
    expect(L(a.south), `south ${a.south} over north ${a.north}`).toBeGreaterThan(L(a.north) * 1.06);
    await boot(page, { "sun.sun": sunState(180, 40) }, { north: 180 });
    const b = await faces(page);
    expect(L(b.north), `north ${b.north} over south ${b.south}`).toBeGreaterThan(L(b.south) * 1.06);
  });

  test("the light stands where the entity says (azimuth 90, elevation 50: east and high)", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(90, 50) });
    const e = await lightOf(page);
    expect(e.x).toBeGreaterThan(0.6); expect(e.y).toBeGreaterThan(0.7); expect(Math.abs(e.z)).toBeLessThan(0.01);
  });

  test("config sun: sun.other is the entity that is read, and sun.sun is then ignored", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(270, 50), "sun.other": sunState(90, 50) }, { config: { sun: "sun.other" } });
    const e = await lightOf(page);
    expect(e.x, "east from sun.other, not west from sun.sun").toBeGreaterThan(0.6);
  });

  test("junk attributes give today's light", async ({ page }) => {
    for (const junk of [sunState("180", 40), sunState(180, Number.NaN), sunState(180, null), sunState(undefined, 40), sunState(180, -3, "below_horizon")]) {
      await boot(page, { "sun.sun": junk }, {});
      const e = await lightOf(page);
      // below_horizon is night as well (S7.6): the night light, which has the same direction. The rest is the day light, fixed.
      expect(e, JSON.stringify(junk)).toMatchObject({ x: FIXED.x, y: FIXED.y, z: FIXED.z, colour: "#ffffff" });
      expect(e.intensity, JSON.stringify(junk)).toBe(junk.state === "below_horizon" ? 0.35 : FIXED.intensity);
    }
  });

  test("a binary_sensor named as the sun (state on, no attributes) gives the night light and no sun", async ({ page }) => {
    await boot(page, { "binary_sensor.x": { state: "on", attributes: {}, last_changed: "2026-10-27T10:00:00Z" } }, { config: { sun: "binary_sensor.x" } });
    expect(await lightOf(page)).toMatchObject({ x: FIXED.x, y: FIXED.y, z: FIXED.z, intensity: 0.35 });
  });

  test("a hass update that changes only the sun's azimuth moves the light (no device reads the sun)", async ({ page }) => {
    await boot(page, { "sun.sun": sunState(90, 50) });
    const east = await lightOf(page);
    expect(east.x).toBeGreaterThan(0.6);
    await setStates(page, { "sun.sun": sunState(270, 50) });
    const west = await lightOf(page);
    expect(west.x, `west ${JSON.stringify(west)} after east ${JSON.stringify(east)}`).toBeLessThan(-0.6);
    expect(west.y).toBeCloseTo(east.y, 6);
  });
});
