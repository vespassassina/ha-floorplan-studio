import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { demo, serve, ORIGIN, drawn, cam } from "./helpers-3d";
import { treeShape } from "../../src/core/tree";
import { furnitureBottom } from "../../src/core/heights";

// S28.7: a tree in 3D is a trunk under a crown, one InstancedMesh of icosahedra for all of them. Real card, the stress layout (15 trees
// on the ground floor) and the demo with one tree standing on the Living room, the hook of the test build, real mouse positions.
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const TREES = stress.floors.ground.furniture.filter((m: { symbol: string }) => m.symbol === "tree") as { x: number; y: number; w: number; h: number; rot: number }[];

interface CrownInfo { count: number; box: number[]; transparent: boolean; opacity: number; faces: number }
interface Hook {
  crowns(): { own: CrownInfo[]; below: CrownInfo[]; inScene: number };
  setBelow(floors: unknown, mode: string): void;
  memory(): { geometries: number; textures: number };
  project(x: number, y: number, z: number): { x: number; y: number };
  pick(x: number, y: number): { type: string; index?: number } | null;
  look(az: number, polar: number): void;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;

async function boot(page: Page, layout: unknown, floor: string) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor, view: "3d", active_list: false });
  await drawn(page);
}
async function select(page: Page, floor: string) {
  const n = (await cam(page)).drawn;
  await page.evaluate(async (floor) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; _config: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.setConfig({ ...el._config, floor });
    await el.updateComplete;
  }, floor);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(n);
}

test.describe("3D view: tree crowns (S28.7)", () => {
  test("one crown mesh holds every tree of the floor, and its z range is treeShape's", async ({ page }) => {
    await boot(page, structuredClone(stress), "ground");
    const c = await hook(page, (h) => h.crowns());
    expect(c.inScene).toBe(1);
    expect(c.own).toHaveLength(1);
    expect(c.own[0].count).toBe(TREES.length);
    expect(c.own[0].faces).toBe(80); // an icosahedron, detail 1, flat
    const shapes = TREES.map((m) => ({ s: treeShape(m as never)!, z0: furnitureBottom(m as never) }));
    expect(c.own[0].box[2]).toBeCloseTo(Math.min(...shapes.map((t) => t.z0 + t.s.crownBottom)), 2);
    expect(c.own[0].box[5]).toBeCloseTo(Math.max(...shapes.map((t) => t.z0 + t.s.crownTop)), 2);
    // asymmetric on purpose: the crown is as wide as the tree's w along x and h along y (rot 0 here), not a ball of one radius
    expect(c.own[0].box[0]).toBeCloseTo(Math.min(...TREES.map((m) => m.x - m.w / 2)), 2);
    expect(c.own[0].box[3]).toBeCloseTo(Math.max(...TREES.map((m) => m.x + m.w / 2)), 2);
    expect(c.own[0].box[1]).toBeCloseTo(Math.min(...TREES.map((m) => m.y - m.h / 2)), 2);
    expect(c.own[0].box[4]).toBeCloseTo(Math.max(...TREES.map((m) => m.y + m.h / 2)), 2);
  });

  test("a floor without trees has no crown mesh, and 20 floor switches leave none behind", async ({ page }) => {
    await boot(page, structuredClone(stress), "first");
    expect((await hook(page, (h) => h.crowns())).inScene).toBe(0);
    await select(page, "ground");
    const geoms = (await hook(page, (h) => h.memory())).geometries;
    for (let i = 0; i < 20; i++) await select(page, i % 2 ? "ground" : "first");
    await select(page, "ground");
    const c = await hook(page, (h) => h.crowns());
    expect(c.inScene).toBe(1);
    expect((await hook(page, (h) => h.memory())).geometries).toBe(geoms);
    await select(page, "first");
    expect((await hook(page, (h) => h.crowns())).inScene).toBe(0);
  });

  test("the floors below keep their crowns, ghost or solid, and drop them with the floor", async ({ page }) => {
    await boot(page, structuredClone(stress), "first");
    const floors = [{ floor: stress.floors.ground, elevation: -295, shift: [0, 0] }];
    await hook(page, (h, a: { floors: unknown }) => h.setBelow(a.floors, "solid"), { floors });
    await expect.poll(async () => (await hook(page, (h) => h.crowns())).below.length).toBe(1);
    let c = await hook(page, (h) => h.crowns());
    expect(c.below[0].count).toBe(TREES.length);
    expect(c.below[0].transparent).toBe(false);
    expect(c.inScene).toBe(1);
    await hook(page, (h, a: { floors: unknown }) => h.setBelow(a.floors, "ghost"), { floors });
    await expect.poll(async () => (await hook(page, (h) => h.crowns())).below[0]?.transparent).toBe(true);
    c = await hook(page, (h) => h.crowns());
    expect(c.below[0].opacity).toBeLessThanOrEqual(0.25);
    await hook(page, (h) => h.setBelow([], "off"));
    await expect.poll(async () => (await hook(page, (h) => h.crowns())).inScene).toBe(0);
  });

  test("a tap on a crown picks what is under it: the room, not the tree", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.furniture.push({ id: "oak", symbol: "tree", x: 250, y: 150, rot: 0, w: 160, h: 160 }); // on the Living room (room 0)
    await boot(page, layout, "ground");
    await hook(page, (h) => h.look(0, 0.3));
    await drawn(page, 2);
    const c = await hook(page, (h) => h.crowns());
    expect(c.own[0].count).toBe(1);
    // the crown's edge at the height of its middle: well off the 12 cm trunk, inside the crown's silhouette
    const mid = (c.own[0].box[2] + c.own[0].box[5]) / 2;
    const at = await hook(page, (h, a: { z: number }) => h.project(250 + 60, 150, a.z), { z: mid });
    const hit = await hook(page, (h, a: { x: number; y: number }) => h.pick(a.x, a.y), at);
    expect(hit).toEqual({ type: "room", index: 0 });
  });
});
