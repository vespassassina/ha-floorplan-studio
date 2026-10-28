import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";

// S38.3 (docs/specs/sun-s38.md, criteria 3 to 7): the 3D sun light. The card hands the sun to the view since S38.2 (card-3d-sun-live.spec.ts
// drives it through hass); these tests feed the view directly through the test-build hook `__fp3d.sun()`, which stands where `setLive`'s `sun` field arrives.
// Probe: the demo's ground floor emptied of furniture, devices and openings, walls full, the camera at 0.45 rad polar. The house is
// 800 x 600 cm; its walls are 10 cm thick on the outline, so the south outer face is at y = 605 and the north outer face at y = -5.
// A south face is seen from the south (az 0), a north face from the north (az PI): a Lambert face is lit the same from any camera.

interface Light { x: number; y: number; z: number; intensity: number; colour: string; hemi: number }
type Sun = { azimuth: unknown; elevation: unknown; north?: unknown };
const HA_DARK = "--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--secondary-background-color:#282828";
const hook = <T, A = undefined>(page: Page, fn: (h: any, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const setSun = (page: Page, sun: Sun | null) => hook(page, (h, s) => h.sun(s), sun);
const lightOf = (page: Page) => hook(page, (h) => h.light()) as Promise<Light>;
const frames = (page: Page) => page.locator("floorplan-studio-card").locator("css=.fp-3d").evaluate((el) => +(el.dataset.drawn ?? 0));
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = await frames(page); same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}

async function boot(page: Page, o: { theme?: string; dark?: boolean; night?: boolean; rotate?: number; small?: boolean } = {}) {
  const layout = structuredClone(demo); const g = layout.floors.ground;
  Object.assign(g, { furniture: [], devices: [], unlinked: [], doors: [], openings: [] });
  if (o.rotate) layout.rotate = o.rotate;
  await serve(page); await page.setViewportSize(o.small ? { width: 520, height: 400 } : { width: 1100, height: 800 }); // a frame compared whole is read as numbers: keep it small
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, vars, isDark, isNight]) => {
    document.body.setAttribute("style", vars as string);
    const el = document.getElementById("card") as any; el.setConfig(config);
    el.hass = { states: isNight ? { "sun.sun": { state: "below_horizon", attributes: {}, last_changed: new Date().toISOString() } } : {}, themes: { darkMode: isDark }, callService: () => undefined }; return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", theme: o.theme ?? "blueprint", walls: "full", active_list: false }, o.dark ? HA_DARK : "", !!o.dark, !!o.night] as const);
  await drawn(page); await still(page);
}
const pr = (page: Page, x: number, y: number, z: number) => hook(page, (h, a) => h.project(a[0], a[1], a[2]), [x, y, z]);
async function rgbAt(page: Page, p: { x: number; y: number }, half = 2): Promise<[number, number, number]> {
  const { data } = await readCanvasRect(page, { x: Math.round(p.x - half), y: Math.round(p.y - half), width: 2 * half, height: 2 * half });
  return meanRgb(data).map(Math.round) as [number, number, number];
}
const L = (c: number[]) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
const look = async (page: Page, az: number) => { await hook(page, (h, a) => h.look(a, 0.45), az); await still(page); };
/** The outer face of the south wall seen from the south, and of the north wall seen from the north. Needs the sun set first. */
async function faces(page: Page) {
  await look(page, 0);
  const south = await rgbAt(page, await pr(page, 200, 605, 125));
  await look(page, Math.PI);
  const north = await rgbAt(page, await pr(page, 200, -5, 125));
  return { south, north };
}
/** Every pixel of the canvas, as one string, to compare two frames. */
async function frame(page: Page) {
  const b = (await page.locator("floorplan-studio-card").locator("canvas").boundingBox())!;
  const { data } = await readCanvasRect(page, { x: b.x + b.width / 4, y: b.y + b.height / 4, width: b.width / 2, height: b.height / 2 }); // the middle, where the house is
  return data;
}
const sunned = async (page: Page, sun: Sun | null) => { await setSun(page, sun); await still(page); };

test.describe("3D sun light (S38.3)", () => {
  test("sun at 180 / 40: the south outer face is brighter than the north one by the 6 percent step; with north 180 it is the other way", async ({ page }) => {
    await boot(page);
    await sunned(page, { azimuth: 180, elevation: 40, north: 0 });
    const a = await faces(page);
    expect(L(a.south), `south ${a.south} over north ${a.north}`).toBeGreaterThan(L(a.north) * 1.06);
    await sunned(page, { azimuth: 180, elevation: 40, north: 180 });
    const b = await faces(page);
    expect(L(b.north), `north ${b.north} over south ${b.south}`).toBeGreaterThan(L(b.south) * 1.06);
  });

  test("the light follows the plan: direction (x, z, y) of sunDir, intensity and colour by elevation", async ({ page }) => {
    await boot(page);
    await sunned(page, { azimuth: 90, elevation: 50, north: 0 });
    const e = await lightOf(page);
    expect(e.x).toBeGreaterThan(0.6); expect(e.y).toBeGreaterThan(0.7); expect(Math.abs(e.z)).toBeLessThan(0.01); // east, high; plan y (three z) 0
    expect(e.intensity).toBeCloseTo(1.9, 6); expect(e.colour).toBe("#ffffff");
    await sunned(page, { azimuth: 180, elevation: 0.0001, north: 0 });
    const lo = await lightOf(page);
    expect(lo.intensity).toBeCloseTo(1.9 * 0.6, 3); expect(lo.colour).toBe("#ffd9a0");
    await sunned(page, { azimuth: 180, elevation: 15, north: 0 });
    const m = await lightOf(page);
    expect(m.intensity).toBeCloseTo(1.9 * 0.8, 3); expect(m.colour).toBe("#ffffff");
  });

  test("rotate 90 turns the camera and not the sun: the same wall is bright", async ({ page }) => {
    await boot(page, { rotate: 0 });
    await sunned(page, { azimuth: 0, elevation: 40, north: 0 }); // from the north
    const a = await faces(page);
    expect(L(a.north), `north ${a.north} over south ${a.south}`).toBeGreaterThan(L(a.south) * 1.06);
    await boot(page, { rotate: 90 });
    await sunned(page, { azimuth: 0, elevation: 40, north: 0 });
    const b = await faces(page);
    expect(L(b.north)).toBeGreaterThan(L(b.south) * 1.06);
    expect(Math.abs(L(b.north) - L(a.north)), "the lit wall is as bright as without the turn").toBeLessThanOrEqual(2);
    expect(Math.abs(L(b.south) - L(a.south))).toBeLessThanOrEqual(2);
  });

  test("a low sun (5 degrees) lights the face warmer than a high one (40): red over blue goes up", async ({ page }) => {
    await boot(page);
    await sunned(page, { azimuth: 180, elevation: 40, north: 0 });
    const hi = (await faces(page)).south;
    await sunned(page, { azimuth: 180, elevation: 5, north: 0 });
    const lo = (await faces(page)).south;
    expect(lo[0] / lo[2], `${lo} against ${hi}`).toBeGreaterThan((hi[0] / hi[2]) * 1.03);
  });

  test("no sun (elevation -3, missing, junk) is today's light, pixel for pixel", async ({ page }) => {
    test.setTimeout(90_000); // six settled frames and six frame reads; a loaded runner needs the room
    await boot(page, { small: true });
    const base = await frame(page);
    expect(await lightOf(page)).toMatchObject({ x: -0.5, y: 1, z: 0.8, intensity: 1.9, colour: "#ffffff", hemi: 1.6 });
    for (const sun of [{ azimuth: 180, elevation: -3, north: 0 }, { azimuth: 180 }, { azimuth: "180", elevation: 40, north: 0 }, { azimuth: 180, elevation: Number.NaN, north: 0 }] as Sun[]) {
      await sunned(page, sun);
      expect(await lightOf(page), JSON.stringify(sun)).toMatchObject({ x: -0.5, y: 1, z: 0.8, intensity: 1.9, colour: "#ffffff" });
      expect(await frame(page), JSON.stringify(sun)).toEqual(base);
    }
    await sunned(page, { azimuth: 180, elevation: 40, north: 0 }); // the sun does change the frame ...
    expect(await frame(page)).not.toEqual(base);
    await sunned(page, null); // ... and taking it away puts today's frame back
    expect(await frame(page)).toEqual(base);
  });

  test("night wins over a sun at 40 degrees: today's night light", async ({ page }) => {
    await boot(page, { night: true, small: true });
    const base = await frame(page);
    const night = await lightOf(page);
    expect(night).toMatchObject({ x: -0.5, y: 1, z: 0.8, intensity: 0.35, colour: "#ffffff", hemi: 0.5 });
    await sunned(page, { azimuth: 180, elevation: 40, north: 0 });
    expect(await lightOf(page)).toEqual(night);
    expect(await frame(page)).toEqual(base);
  });
});

// SPEC: tops, sun faces and shade faces step apart by at least 6 percent in every theme. tests/card/card-3d-colors.spec.ts holds it for
// the fixed light; here it holds with the real sun at four bearings and two elevations. The top is a wall top, the sun face the
// outer face the sun shines on, the shade face the one that faces away.
const THEMES = [["blueprint", false], ["light", false], ["ha", true]] as const;
const WALLS: Record<number, { sun: [number, number, number]; shade: [number, number, number]; az: number; shadeAz: number }> = {
  // sun bearing -> the outer face it shines on (point, camera az) and the opposite one. Camera az 0 sees south faces, PI north, PI/2 east, -PI/2 west (look(): positive turns east).
  0: { sun: [200, -5, 125], az: Math.PI, shade: [200, 605, 125], shadeAz: 0 },
  180: { sun: [200, 605, 125], az: 0, shade: [200, -5, 125], shadeAz: Math.PI },
  90: { sun: [805, 200, 125], az: Math.PI / 2, shade: [-5, 200, 125], shadeAz: -Math.PI / 2 },
  270: { sun: [-5, 200, 125], az: -Math.PI / 2, shade: [805, 200, 125], shadeAz: Math.PI / 2 },
};
for (const [theme, dark] of THEMES) {
  test(`3D sun, ${theme}: top, sun face and shade face step down by 6 percent at four bearings, 10 and 50 degrees up`, async ({ page }) => {
    await boot(page, { theme, dark });
    for (const elevation of [10, 50]) for (const az of [0, 90, 180, 270]) {
      await sunned(page, { azimuth: az, elevation, north: 0 });
      const w = WALLS[az];
      await look(page, w.az);
      const sun = L(await rgbAt(page, await pr(page, ...w.sun))), top = L(await rgbAt(page, await pr(page, 400, 0, 250)));
      await look(page, w.shadeAz);
      const shade = L(await rgbAt(page, await pr(page, ...w.shade)));
      const tag = `${theme} az ${az} el ${elevation}: top ${top} sun ${sun} shade ${shade}`;
      expect(sun, tag).toBeGreaterThan(shade * 1.06);
      if (elevation >= 30) expect(top, tag).toBeGreaterThan(sun * 1.06);
      // A low sun grazes a flat top (sin 10 degrees) and meets a wall face square (cos 10), so the top is darker than the sun face by
      // nature, in every theme (blueprint 85 / 96, light 86 / 96, ha 75 / 84). They still step apart by more than 6 percent.
      else expect(Math.abs(top - sun), tag).toBeGreaterThan(Math.min(top, sun) * 0.06);
      expect(top, tag).toBeGreaterThan(shade * 1.06);
    }
  });
}
