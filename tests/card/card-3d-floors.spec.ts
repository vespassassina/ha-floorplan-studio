import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, cam, drawn } from "./helpers-3d";

// S12.6, spec assumption I (criterion 8): in 3D the selected floor is solid, the floors below it are drawn dimmed at their real
// elevation (no live state, no icons, not pickable), the floors above are not drawn. Real card, demo floors, real mouse.
// Demo: ground is 250 cm high with a 25 cm slab, so `first` stands 275 cm above it and `test` 550 cm. The garden (x 800..900,
// y 380..540) is on the ground floor only; the first floor is 0..810 x 0..610.

interface Hook {
  floors(): { below: { key: string; y0: number; y1: number; opacity: number; meshes: number; pickable: boolean }[]; extent: { y0: number; y1: number } };
  live(): { children: number; lifted: number[]; pools: { visible: boolean }[] };
  memory(): { geometries: number; textures: number };
  project(x: number, y: number, z: number): { x: number; y: number };
  pick(x: number, y: number): unknown;
  look(az: number, polar: number): void;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string, last = iso(600)) => ({ state, attributes: {}, last_changed: last });
const QUIET = () => ({ "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "light.demo_bedroom": st("off"), "binary_sensor.demo_hall_motion": st("off") });

async function boot(page: Page, floor: string, states: Record<string, unknown> = QUIET()) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor, view: "3d", active_list: false }, states] as const);
  await drawn(page);
}
/** Selects a floor the way the card does when the user taps a floor tab (its config key), and waits for the frame after. */
async function select(page: Page, floor: string) {
  const n = (await cam(page)).drawn;
  await page.evaluate(async (floor) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; _config: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.setConfig({ ...el._config, floor });
    await el.updateComplete;
  }, floor);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(n);
}

test.describe("3D view: floors (S12.6)", () => {
  test("the floor below is there, lower, and dimmed; the ground floor has nothing below it", async ({ page }) => {
    await boot(page, "first");
    const f = await hook(page, (h) => h.floors());
    expect(f.below.map((b) => b.key)).toEqual(["ground"]);
    const g = f.below[0];
    expect(g.meshes).toBeGreaterThan(0);
    expect(g.y1).toBeLessThanOrEqual(-275 + 251); // its top (250 cm walls) is a storey under the selected floor's z 0, slab included
    expect(g.y0).toBeCloseTo(-275 - 25, 0); // its own slab, 275 cm below
    expect(g.opacity).toBeGreaterThan(0.1);
    expect(g.opacity).toBeLessThan(0.6); // dimmed: see-through
    expect(g.pickable).toBe(false);
    await select(page, "test");
    expect((await hook(page, (h) => h.floors())).below.map((b) => b.key)).toEqual(["ground", "first"]);
    await select(page, "ground");
    expect((await hook(page, (h) => h.floors())).below).toEqual([]);
  });

  test("floors above are not drawn: the scene reaches no higher than the selected floor's own walls", async ({ page }) => {
    await boot(page, "ground");
    const e0 = (await hook(page, (h) => h.floors())).extent;
    expect(e0.y1).toBeLessThanOrEqual(251); // ground walls are 250 cm; the first floor would reach 525
    expect(e0.y0).toBeGreaterThanOrEqual(-26);
    await select(page, "first");
    const e1 = (await hook(page, (h) => h.floors())).extent;
    expect(e1.y1).toBeLessThanOrEqual(251);
    expect(e1.y0).toBeLessThan(-290); // the ground floor below it
    await select(page, "test");
    const e2 = (await hook(page, (h) => h.floors())).extent;
    expect(e2.y1).toBeLessThanOrEqual(251);
    expect(e2.y0).toBeLessThan(-570); // two floors below
  });

  test("a tap on the dimmed floor picks nothing; a tap on the selected floor still does", async ({ page }) => {
    await boot(page, "first");
    await hook(page, (h) => h.look(0.6, 0.9));
    await expect.poll(async () => (await cam(page)).az).toBeCloseTo(0.6, 2);
    // the garden's floor (ground only), one centimetre above the ground slab: nothing of the first floor is in the way
    const garden = await hook(page, (h) => h.project(850, 460, -275 + 1));
    await page.mouse.click(garden.x, garden.y);
    expect(await card(page).locator("css=.fp3-rm.picked, .fp-3d[data-ring]:not([data-ring=''])").count()).toBe(0);
    expect(await hook(page, (h, p) => h.pick(p.x, p.y), garden)).toBeNull();
    // the bedroom of the selected floor (room 0) answers
    const bed = await hook(page, (h) => h.project(100, 100, 1));
    const picked = await hook(page, (h, p) => h.pick(p.x, p.y), bed);
    expect(picked).toMatchObject({ type: "room", index: 0 });
  });

  test("a lamp on the ground floor lights nothing on the floor above, and nothing is lit on the dimmed floor", async ({ page }) => {
    const on = { ...QUIET(), "light.demo_living": st("on", iso(5)), "light.demo_kitchen": st("on", iso(5)) };
    await boot(page, "ground", on);
    expect((await hook(page, (h) => h.live())).lifted).toEqual([0, 1]);
    await select(page, "first");
    const l = await hook(page, (h) => h.live());
    expect(l.lifted).toEqual([]);
    expect(l.pools.filter((p) => p.visible)).toEqual([]);
    expect(await card(page).locator("css=.fp3-ic").count()).toBe(6); // only the first floor's six devices, none of the ground floor's eight
  });

  test("switching keeps the angle, reframes the distance, and 20 switches leave no mesh behind", async ({ page }) => {
    await boot(page, "ground");
    await select(page, "first");
    const fresh = await cam(page);
    await select(page, "ground");
    await hook(page, (h) => h.look(1.1, 0.7));
    await page.mouse.move(550, 400);
    await page.mouse.wheel(0, -600); // zoom in
    await expect.poll(async () => (await cam(page)).dist).toBeLessThan(fresh.dist * 0.9);
    const before = await cam(page);
    await select(page, "first");
    const after = await cam(page);
    expect(after.az).toBeCloseTo(before.az, 3);
    expect(after.polar).toBeCloseTo(before.polar, 3);
    expect(after.dist).toBeCloseTo(fresh.dist, 0); // the distance frames the new floor, as a fresh view of it would
    // twice round to warm every cache, then twenty more
    const cycle = async () => { for (const k of ["test", "ground", "first"]) await select(page, k); };
    await cycle(); await cycle();
    const base = { m: await hook(page, (h) => h.memory()), c: (await hook(page, (h) => h.live())).children };
    for (let i = 0; i < 7; i++) await cycle(); // 21 switches
    expect(await hook(page, (h) => h.memory())).toEqual(base.m);
    expect((await hook(page, (h) => h.live())).children).toBe(base.c);
    expect(await page.evaluate(() => (customElements.get("floorplan-studio-card") as unknown as { liveRenderers: number }).liveRenderers)).toBe(1);
  });
});
