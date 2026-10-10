import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { serve, ORIGIN, card, drawn, cam } from "./helpers-3d";

// S27.7: the 3D view can draw the floors below, through the view's `setBelow` (the card calls it from S27.14). Real card, the stress layout,
// the test hook of the test build. Stress: ground is 270 high with a 25 slab, so `first` stands 295 above it. Ground's back garden is
// x -500..2500, y -1500..-400, clear of the first floor's outline (0..2000 x 0..1400).
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const GROUND = stress.floors.ground;
const BELOW = [{ floor: GROUND, elevation: -295, shift: [0, 0] }];

interface BelowInfo { count: number; meshes: { transparent: boolean; opacity: number; depthWrite: boolean; box: number[] }[] }
interface Hook {
  floors(): { extent: { y0: number; y1: number } };
  live(): { children: number };
  memory(): { geometries: number; textures: number };
  project(x: number, y: number, z: number): { x: number; y: number };
  pick(x: number, y: number): unknown;
  look(az: number, polar: number): void;
  setBelow(floors: unknown, mode: string): void;
  below(): BelowInfo;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;

async function boot(page: Page) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout: structuredClone(stress), floor: "first", view: "3d", active_list: false });
  await drawn(page);
}
/** Gives the view floors below and waits for the frame after. */
async function setBelow(page: Page, floors: unknown, mode: string) {
  const n = (await cam(page)).drawn;
  await hook(page, (h, a: { floors: unknown; mode: string }) => h.setBelow(a.floors, a.mode), { floors, mode });
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(n);
}

test.describe("3D view: floors below (S27.7)", () => {
  test("off draws the one floor only; solid reaches below the slab of the floor under; ghost is translucent and writes no depth", async ({ page }) => {
    await boot(page);
    const one = (await hook(page, (h) => h.floors())).extent;
    expect(one.y0).toBeGreaterThanOrEqual(-26);
    expect((await hook(page, (h) => h.below())).count).toBe(0);

    await setBelow(page, BELOW, "off");
    expect((await hook(page, (h) => h.floors())).extent).toEqual(one);
    expect((await hook(page, (h) => h.below())).count).toBe(0);

    await setBelow(page, BELOW, "solid");
    const solid = await hook(page, (h) => h.below());
    expect(solid.count).toBeGreaterThan(0);
    // ground's slab bottom: -295 - 25 = -320; its walls reach -295 + 270 = -25
    expect((await hook(page, (h) => h.floors())).extent.y0).toBeCloseTo(-320, 0);
    expect(solid.meshes.some((m) => !m.transparent && m.depthWrite && m.opacity === 1)).toBe(true);

    await setBelow(page, BELOW, "ghost");
    const ghost = await hook(page, (h) => h.below());
    expect(ghost.count).toBeGreaterThan(0);
    for (const m of ghost.meshes) { expect(m.transparent).toBe(true); expect(m.opacity).toBeLessThanOrEqual(0.25); expect(m.depthWrite).toBe(false); }
    expect((await hook(page, (h) => h.floors())).extent.y0).toBeCloseTo(-320, 0);

    await setBelow(page, BELOW, "off");
    expect((await hook(page, (h) => h.floors())).extent).toEqual(one);
  });

  test("the shift puts the lower floor at its place in the house", async ({ page }) => {
    await boot(page);
    const lows = async (shift: number[]) => {
      await setBelow(page, [{ floor: GROUND, elevation: -295, shift }], "solid");
      const boxes = (await hook(page, (h) => h.below())).meshes.map((m) => m.box);
      return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[3])), Math.max(...boxes.map((b) => b[4]))];
    };
    const home = await lows([0, 0]), moved = await lows([137, -61]);
    // the whole drawn extent of the floor, lawns and fences included, moves by exactly the shift and no more (float32 geometry: 0.01 cm)
    [137, -61, 137, -61].forEach((d, i) => expect(moved[i] - home[i], `edge ${i}`).toBeCloseTo(d, 1));
    expect(home[0]).toBeLessThan(-490); // the west lawn: this is the ground floor and not the first
  });

  test("a tap on a lower floor's garden picks nothing, in every mode", async ({ page }) => {
    await boot(page);
    await hook(page, (h) => h.look(0.6, 0.9));
    for (const mode of ["off", "solid", "ghost"]) {
      await setBelow(page, BELOW, mode);
      if (mode !== "off") expect((await hook(page, (h) => h.below())).count, mode).toBeGreaterThan(0);
      // the back garden of ground (room fill top at -294), nothing of the first floor above it
      const at = await hook(page, (h) => h.project(500, -900, -294));
      await page.mouse.click(at.x, at.y);
      expect(await hook(page, (h, p) => h.pick(p.x, p.y), at), mode).toBeNull();
      expect(await card(page).locator("css=.fp-3d[data-ring]:not([data-ring=''])").count(), mode).toBe(0);
    }
  });

  test("20 calls with solid leave no mesh, geometry or scene child behind", async ({ page }) => {
    await boot(page);
    await setBelow(page, BELOW, "solid");
    const after1 = { mem: await hook(page, (h) => h.memory()), kids: (await hook(page, (h) => h.live())).children, n: (await hook(page, (h) => h.below())).count };
    for (let i = 0; i < 20; i++) await setBelow(page, BELOW, i % 2 ? "solid" : "ghost");
    await setBelow(page, BELOW, "solid");
    expect((await hook(page, (h) => h.below())).count).toBe(after1.n);
    expect((await hook(page, (h) => h.live())).children).toBe(after1.kids);
    expect((await hook(page, (h) => h.memory())).geometries).toBe(after1.mem.geometries);
    await setBelow(page, BELOW, "off");
    expect((await hook(page, (h) => h.live())).children).toBeLessThan(after1.kids);
  });

  test("junk floors and junk modes draw nothing and do not throw", async ({ page }) => {
    await boot(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const junk of [null, 5, "x", [null], [{ floor: 5 }], [{ floor: GROUND, elevation: "a", shift: "b" }], [{}]]) {
      await setBelow(page, junk, "solid");
      expect((await hook(page, (h) => h.floors())).extent.y1).toBeLessThan(300);
    }
    await setBelow(page, BELOW, "bogus");
    expect((await hook(page, (h) => h.below())).count).toBe(0);
    expect(errors).toEqual([]);
  });
});
