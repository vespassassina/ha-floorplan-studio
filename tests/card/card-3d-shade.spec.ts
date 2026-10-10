import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn, cam } from "./helpers-3d";

// S28.8: the ground plane and the contact shadows in 3D. Real card, the demo ground floor emptied of furniture, devices and
// unlinked boxes (so the pixels next to a wall are the wall's shade alone), the test-build hook, real screenshots.
// The demo's wall between Living (0..500 x 0..400) and Kitchen stands on x = 500, 10 cm thick.
interface ShadeInfo { verts: number; opacity: number; depthWrite: boolean; transparent: boolean; box: number[]; colour: string }
interface Hook {
  shade(): { ground: ShadeInfo | null; own: ShadeInfo[]; below: ShadeInfo[]; inScene: number; grounds: number };
  shadeVisible(on: boolean): void;
  calls(): number;
  setBelow(floors: unknown, mode: string): void;
  memory(): { geometries: number; textures: number };
  project(x: number, y: number, z: number): { x: number; y: number };
  pick(x: number, y: number): { type: string; index?: number } | null;
  look(az: number, polar: number): void;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const bare = () => { const l = structuredClone(demo); Object.assign(l.floors.ground, { furniture: [], devices: [], unlinked: [] }); return l; };

async function boot(page: Page, layout: unknown, theme = "light", floor = "ground") {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor, view: "3d", theme, active_list: false });
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function select(page: Page, floor: string) {
  const n = (await cam(page)).drawn;
  await page.evaluate(async (floor) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; _config: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.setConfig({ ...el._config, floor });
    await el.updateComplete;
  }, floor);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(n);
  await still(page);
}
/** Mean luminance of a square of the page, from a real screenshot. */
async function lumaAt(page: Page, p: { x: number; y: number }, half: number): Promise<number> {
  const buf = await page.screenshot({ clip: { x: Math.round(p.x - half), y: Math.round(p.y - half), width: 2 * half, height: 2 * half } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    return s / (d.length / 4);
  }, buf.toString("base64"));
}
const at = (page: Page, x: number, y: number, z: number) => hook(page, (h, a) => h.project(a[0], a[1], a[2]), [x, y, z]);

test.describe("3D view: ground and contact shadows (S28.8)", () => {
  test("one ground and one shadow mesh for the floor, no depth write, translucent, and at most two more draw calls", async ({ page }) => {
    await boot(page, structuredClone(demo));
    const s = await hook(page, (h) => h.shade());
    expect(s.grounds).toBe(1);
    expect(s.inScene).toBe(1);
    expect(s.own).toHaveLength(1);
    expect(s.own[0].depthWrite).toBe(false);
    expect(s.own[0].transparent).toBe(true);
    expect(s.own[0].opacity).toBeCloseTo(0.16, 3); // --fp-shade-alpha in the light theme (SHADE_ALPHA)
    expect(s.own[0].verts).toBeGreaterThan(100);
    const on = await hook(page, (h) => h.calls());
    await hook(page, (h) => h.shadeVisible(false));
    const off = await hook(page, (h) => h.calls());
    expect(on - off).toBeGreaterThanOrEqual(1);
    expect(on - off).toBeLessThanOrEqual(2);
  });

  test("the ground is 1.5 times the plan, lower than its slab, and never the page's own colour", async ({ page }) => {
    await boot(page, structuredClone(demo));
    const g = (await hook(page, (h) => h.shade())).ground!;
    const w = g.box[3] - g.box[0], d = g.box[4] - g.box[1];
    expect(w).toBeGreaterThan(800 * 1.4);
    expect(w).toBeLessThan(1300 * 1.6 * 1.0); // the demo is 800 to 1200 cm across; 1.5 times, never 3
    expect(d).toBeGreaterThan(400);
    expect(g.box[2]).toBeCloseTo(-25, 3); // the slab's bottom
    expect(g.box[5]).toBeCloseTo(g.box[2], 3); // flat
  });

  for (const theme of ["light", "blueprint"]) {
    test(`${theme}: the pixel 4 cm off a wall foot is at least 4 % darker than the middle of its room, and not without the mesh`, async ({ page }) => {
      await boot(page, bare(), theme);
      await hook(page, (h) => h.look(0, 0.1));
      await still(page);
      const foot = await at(page, 491, 200, 0), mid = await at(page, 250, 90, 0); // clear of the room name; the wall on x = 500 is 10 thick: its face is at 495, and the camera, left of it, sees that face lean away from the floor
      const lit = await lumaAt(page, mid, 6), shaded = await lumaAt(page, foot, 1);
      expect((lit - shaded) / lit).toBeGreaterThanOrEqual(0.04);
      await hook(page, (h) => h.shadeVisible(false));
      await still(page);
      const bareFoot = await lumaAt(page, foot, 1), bareMid = await lumaAt(page, mid, 6);
      expect(Math.abs(bareMid - bareFoot) / bareMid).toBeLessThan(0.02); // the control: nothing else darkens that pixel
    });
  }

  test("a tap on the ground picks nothing, and the ground colour follows the theme", async ({ page }) => {
    await boot(page, structuredClone(demo), "light");
    await hook(page, (h) => h.look(0, 0.3));
    await still(page);
    const g = (await hook(page, (h) => h.shade())).ground!;
    const p = await hook(page, (h, a: { x: number; y: number; z: number }) => h.project(a.x, a.y, a.z), { x: g.box[0] + 20, y: (g.box[1] + g.box[4]) / 2, z: g.box[2] });
    expect(await hook(page, (h, a: { x: number; y: number }) => h.pick(a.x, a.y), p)).toBeNull();
    await boot(page, structuredClone(demo), "blueprint");
    const b = (await hook(page, (h) => h.shade())).ground!;
    expect(b.colour).not.toBe(g.colour);
  });

  test("20 floor switches leave one ground and the same geometry count", async ({ page }) => {
    await boot(page, structuredClone(demo), "light", "first");
    await select(page, "ground");
    const geoms = (await hook(page, (h) => h.memory())).geometries;
    for (let i = 0; i < 20; i++) await select(page, i % 2 ? "ground" : "first");
    await select(page, "ground");
    const s = await hook(page, (h) => h.shade());
    expect(s.grounds).toBe(1);
    expect(s.inScene).toBe(1);
    expect((await hook(page, (h) => h.memory())).geometries).toBe(geoms);
  });

  test("a floor below gets its shadow mesh, and the ground goes under it", async ({ page }) => {
    await boot(page, structuredClone(demo), "light", "first");
    const above = (await hook(page, (h) => h.shade())).ground!.box[2];
    await hook(page, (h, a: { floors: unknown }) => h.setBelow(a.floors, "solid"), { floors: [{ floor: demo.floors.ground, elevation: -295, shift: [0, 0] }] });
    await expect.poll(async () => (await hook(page, (h) => h.shade())).below.length).toBe(1);
    const s = await hook(page, (h) => h.shade());
    expect(s.inScene).toBe(2); // this floor's and the one below's
    expect(s.ground!.box[2]).toBeCloseTo(-320, 2); // the lower slab's bottom (-295 - 25)
    expect(s.ground!.box[2]).toBeLessThan(above);
    expect(s.below[0].opacity).toBeCloseTo(0.16, 3);
    await hook(page, (h) => h.setBelow([], "off"));
    await expect.poll(async () => (await hook(page, (h) => h.shade())).inScene).toBe(1);
    expect((await hook(page, (h) => h.shade())).ground!.box[2]).toBeCloseTo(above, 2);
  });
});
