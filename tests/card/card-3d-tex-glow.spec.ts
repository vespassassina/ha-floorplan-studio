import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, cam, drawn } from "./helpers-3d";
import { uvOf } from "../../src/card/three/tex";
import { textureDeps } from "../../src/core/three-deps";

// S13: floor textures and the lamp's light on the walls, in the 3D view. Real card, demo ground floor, test-build hook `__fp3d`.
// Demo ground: Living is room 0 (0..500 x 0..400), Kitchen 1 (500..800 x 0..400), Hall 2 (0..800 x 400..600); device 0 is the living
// lamp at (250,200), 1 the kitchen lamp at (650,200); the walls are 250 cm and 10 cm thick, the room edges run along their centres.
// Pixels come from real screenshots; what is drawn (a map, a patch of glow) is read from the hook.

interface Tex { id: string; rot: number; scale: number; tileCm: [number, number]; hasMap: boolean; wrap: [number, number]; srgb: boolean; anisotropy: number; verts: number; first: { x: number; y: number; u: number; v: number }[] }
interface Glow { room: number; visible: boolean; faces: { a: [number, number]; b: [number, number]; z0: number; z1: number }[]; pos: number[] }
interface Hook {
  textured(): Tex[];
  live(): { glow: Glow[]; lifted: number[] };
  memory(): { geometries: number; textures: number };
  project(x: number, y: number, z: number): { x: number; y: number };
  look(az: number, polar: number): void;
  setFloor(floor: unknown): void;
  muteGlow(on: boolean): void;
}
const hook = <T, A = undefined>(page: Page, fn: (h: Hook, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string, attributes: Record<string, unknown> = {}, last = iso(600)) => ({ state, attributes, last_changed: last });
const QUIET = () => ({ "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "binary_sensor.demo_hall_motion": st("off") });
const LIVING_ON = () => ({ ...QUIET(), "light.demo_living": st("on", { rgb_color: [255, 170, 60], brightness: 255 }, iso(5)) });

async function boot(page: Page, layout: unknown, config: Record<string, unknown> = {}, states: Record<string, unknown> = QUIET()) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", active_list: false, ...config }, states] as const);
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function setStates(page: Page, states: Record<string, unknown>) {
  const n = (await cam(page)).drawn;
  await page.evaluate((states) => {
    const el = document.getElementById("card") as unknown as { hass: { callService: unknown } };
    el.hass = { ...el.hass, states } as never;
  }, states);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(n);
  await still(page);
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
const textured = (page: Page) => hook(page, (h) => h.textured());
/** Waits until every textured mesh has its map (the tile is rasterised from an image, so it arrives after the first frame), then for the frame to settle. */
async function ready(page: Page, n: number) {
  await expect.poll(async () => (await textured(page)).filter((t) => t.hasMap).length, { timeout: 15000 }).toBe(n);
  await still(page);
}
const at = (page: Page, x: number, y: number, z: number) => hook(page, (h, a) => h.project(a[0], a[1], a[2]), [x, y, z]);
const look = (page: Page, az: number, polar: number) => hook(page, (h, a) => h.look(a[0], a[1]), [az, polar]);
type Px = { x: number; y: number };

/** The luminance of every pixel of a page region (from a real screenshot, 1 device px = 1 css px here), row by row. */
async function lumaOf(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<{ w: number; h: number; l: number[]; rgb: [number, number, number] }> {
  const buf = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, l: number[] = [];
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { l.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]); r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return { w: img.width, h: img.height, l, rgb: [r / n, gr / n, b / n] as [number, number, number] };
  }, buf.toString("base64"));
}
const patch = (p: Px, half = 12) => ({ x: Math.round(p.x - half), y: Math.round(p.y - half), width: 2 * half, height: 2 * half });
const meanLuma = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
const spread = (l: number[]) => { const m = meanLuma(l); return Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length); };
/** How many times a row of pixels crosses between dark and light (hysteresis around the middle of its range). */
function crossings(l: number[]): number {
  const lo = Math.min(...l), hi = Math.max(...l), mid = (lo + hi) / 2, gap = (hi - lo) * 0.2;
  let side = 0, n = 0;
  for (const v of l) { const s = v > mid + gap ? 1 : v < mid - gap ? -1 : 0; if (s !== 0 && s !== side) { if (side !== 0) n++; side = s; } }
  return n;
}
/** The luminance along the screen line p to q, from one screenshot of the strip. */
async function strip(page: Page, p: Px, q: Px): Promise<number[]> {
  const x0 = Math.floor(Math.min(p.x, q.x)), x1 = Math.ceil(Math.max(p.x, q.x)), y = Math.round((p.y + q.y) / 2);
  const r = await lumaOf(page, { x: x0, y: y - 2, width: x1 - x0, height: 5 });
  return r.l.slice(2 * r.w, 3 * r.w); // the middle row
}

const withPaint = (paint: Record<string, unknown>, room = 0) => { const l = structuredClone(demo); Object.assign(l.floors.ground.rooms[room], paint); return l; };
const TOP_DOWN = 0.1;

test.describe("3D view: floor textures (S13)", () => {
  test("a textured room and a textured stair carry the tile's map, with the 2D plan's size, turn and scale", async ({ page }) => {
    const layout = withPaint({ texture: "wood-light" }, 0);
    Object.assign(layout.floors.ground.rooms[1], { texture: "stone-grey", textureRot: 30, textureScale: 0.5 });
    Object.assign(layout.floors.ground.stairs[0], { texture: "wood-dark", textureRot: 90 });
    await boot(page, layout);
    await ready(page, 3);
    const t = await textured(page);
    expect(t.length).toBe(3);
    const wood = t.find((x) => x.id === "wood-light")!, stone = t.find((x) => x.id === "stone-grey")!, stair = t.find((x) => x.id === "wood-dark")!;
    expect(wood.tileCm).toEqual([80, 40]); expect(wood.rot).toBe(0); expect(wood.scale).toBe(1);
    expect(stone.tileCm).toEqual([25, 25]); expect(stone.rot).toBe(30); expect(stone.scale).toBe(0.5); // 50 cm tile at 50%
    expect(stair.rot).toBe(90); expect(stair.tileCm).toEqual([80, 40]);
    for (const x of t) { expect(x.hasMap).toBe(true); expect(x.wrap).toEqual([1000, 1000]); expect(x.srgb).toBe(true); expect(x.anisotropy).toBeGreaterThan(1); }
    // the UVs are the maths of uvOf on the vertex's plan position (x and y), so a board is the same size as on the plan
    for (const x of t) {
      const tile = textureDeps.texture(x.id, x.rot, x.scale)!;
      expect(x.first.length).toBeGreaterThan(2);
      for (const v of x.first) { const [u, w] = uvOf(tile, v.x, v.y); expect(v.u).toBeCloseTo(u, 3); expect(v.v).toBeCloseTo(w, 3); }
    }
    // only the top face is textured: a room's slab has two caps and four sides, 12 triangles per 4-gon room at most 6 of the 12 are top (2): the top is 2 triangles = 6 vertices
    expect(wood.verts).toBe(6);
  });

  test("the textured floor is not the flat colour: a checkerboard has dark and light squares where a flat room has one tone", async ({ page }) => {
    await boot(page, withPaint({ texture: "checker-classic" }));
    await ready(page, 1);
    await look(page, 0, TOP_DOWN);
    await still(page);
    const a = await at(page, 20, 140, 1), b = await at(page, 130, 250, 1); // clear of the sofa, the lamp and the icons
    const tex = await lumaOf(page, { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
    expect(Math.max(...tex.l) - Math.min(...tex.l)).toBeGreaterThan(120); // 238 over 42 in the tile
    expect(spread(tex.l)).toBeGreaterThan(40);
  });

  test("a flat room is one tone (the control for the checkerboard)", async ({ page }) => {
    await boot(page, structuredClone(demo));
    await look(page, 0, TOP_DOWN);
    await still(page);
    const a = await at(page, 20, 140, 1), b = await at(page, 130, 250, 1); // clear of the sofa, the lamp and the icons
    const flat = await lumaOf(page, { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
    expect(spread(flat.l)).toBeLessThan(3);
    expect((await textured(page)).length).toBe(0);
  });

  test("the scale and the turn reach the pixels: a 200% checkerboard has half as many squares along a line as a 100% one, and 45 degrees changes the row", async ({ page }) => {
    const row = async (paint: Record<string, unknown>) => {
      await boot(page, withPaint({ texture: "checker-classic", ...paint }));
      await ready(page, 1);
      await look(page, 0, TOP_DOWN);
      await still(page);
      const p = await at(page, 30, 112, 1), q = await at(page, 470, 112, 1); // 440 cm along the plan, off a square boundary (multiples of 25 cm)
      return crossings(await strip(page, p, q));
    };
    const one = await row({}), two = await row({ textureScale: 2 });
    // 25 cm squares: about 17 boundaries in 440 cm; at 200% 50 cm squares: about 8
    expect(one).toBeGreaterThanOrEqual(14); expect(one).toBeLessThanOrEqual(19);
    expect(two).toBeGreaterThanOrEqual(6); expect(two).toBeLessThanOrEqual(10);
    // turned 45 degrees about the origin, a horizontal line meets the squares' corners: boundaries come at 25*sqrt(2)/... a different count, not 17
    const diag = await row({ textureRot: 45 });
    expect(Math.abs(diag - one)).toBeGreaterThanOrEqual(2);
  });

  test("a bad texture id, rotation or scale given straight to the view draws the flat colour, never throws, and a huge scale is clamped", async ({ page }) => {
    // The card refuses such a layout (validate), so this goes through the view's own door, as a direct caller or a future path would.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await boot(page, structuredClone(demo));
    const floor = structuredClone(demo.floors.ground);
    Object.assign(floor.rooms[0], { texture: "__proto__", textureRot: "x" });
    Object.assign(floor.rooms[1], { texture: "wood-warm", textureRot: "NaN", textureScale: 999 });
    Object.assign(floor.rooms[2], { texture: { a: 1 }, color: "#336699" });
    Object.assign(floor.stairs[0], { texture: "constructor", textureScale: -4 });
    const n = (await cam(page)).drawn;
    await hook(page, (h, f) => h.setFloor(f), floor);
    await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(n);
    await ready(page, 1);
    const t = await textured(page);
    expect(t.length).toBe(1);
    expect(t[0].id).toBe("wood-warm"); expect(t[0].rot).toBe(0); expect(t[0].scale).toBe(2); expect(t[0].tileCm).toEqual([160, 80]);
    expect(errors).toEqual([]);
  });

  test("a floor switch and the end of the view give every texture back: three's own count returns to where it was", async ({ page }) => {
    const layout = withPaint({ texture: "wood-light" }, 0);
    Object.assign(layout.floors.ground.rooms[1], { texture: "stone-grey" });
    await boot(page, layout);
    await ready(page, 2);
    const held = (await hook(page, (h) => h.memory())).textures;
    expect(held).toBeGreaterThanOrEqual(2);
    await select(page, "first");
    expect((await hook(page, (h) => h.memory())).textures).toBe(0);
    expect(await textured(page)).toEqual([]);
    await select(page, "ground");
    await ready(page, 2); // made again, not leaked on top of the old ones
    expect((await hook(page, (h) => h.memory())).textures).toBe(held);
    for (let i = 0; i < 4; i++) { await select(page, "first"); await select(page, "ground"); }
    await ready(page, 2);
    expect((await hook(page, (h) => h.memory())).textures).toBe(held);
  });

  test("a lit lamp still lifts a textured floor: it is brighter and warmer with the lamp on, and back when it is off", async ({ page }) => {
    await boot(page, withPaint({ texture: "wood-dark" }));
    await ready(page, 1);
    await look(page, 0, TOP_DOWN);
    await still(page);
    const p = await at(page, 100, 100, 1);
    const off = await lumaOf(page, patch(p, 20));
    await setStates(page, LIVING_ON());
    const on = await lumaOf(page, patch(p, 20));
    expect(meanLuma(on.l)).toBeGreaterThan(meanLuma(off.l) + 6);
    expect(on.rgb[0] / on.rgb[2]).toBeGreaterThan((off.rgb[0] / off.rgb[2]) * 1.03); // warmer: the lamp is 255,170,60
    expect((await hook(page, (h) => h.live())).lifted).toEqual([0]);
    expect(spread(on.l)).toBeGreaterThan(0.5); // and it is still a texture under the light
    await setStates(page, QUIET());
    const back = await lumaOf(page, patch(p, 20));
    expect(Math.abs(meanLuma(back.l) - meanLuma(off.l))).toBeLessThanOrEqual(1.5);
  });
});

test.describe("3D view: the lamp's light on the walls (S13)", () => {
  const mid = (f: Glow["faces"][number]) => [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  const glow = (page: Page) => hook(page, (h) => h.live().glow);

  test("a lit lamp gives patches to the faces of its own room only; an unlit lamp and a lamp outside every room give none", async ({ page }) => {
    await boot(page, structuredClone(demo), { walls: "full" });
    expect((await glow(page)).filter((g) => g.visible)).toEqual([]);
    await setStates(page, LIVING_ON());
    const g = (await glow(page)).filter((g) => g.visible);
    expect(g.length).toBe(1);
    expect(g[0].room).toBe(0);
    expect(g[0].faces.length).toBeGreaterThan(2);
    for (const f of g[0].faces) { const [x, y] = mid(f); expect(x, "x").toBeGreaterThanOrEqual(0); expect(x, "x").toBeLessThanOrEqual(500); expect(y, "y").toBeGreaterThanOrEqual(0); expect(y, "y").toBeLessThanOrEqual(400); } // inside the living room: not the kitchen's face (x 505) nor an outer face (y -5)
    // the kitchen's own lamp: the kitchen's faces, and none of the living room's
    await setStates(page, { ...QUIET(), "light.demo_kitchen": st("on", {}, iso(5)) });
    const k = (await glow(page)).filter((x) => x.visible);
    expect(k.map((x) => x.room)).toEqual([1]);
    for (const f of k[0].faces) { const [x, y] = mid(f); expect(x).toBeGreaterThanOrEqual(500); expect(x).toBeLessThanOrEqual(800); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(400); }
    // both on: both rooms, each its own
    await setStates(page, { ...LIVING_ON(), "light.demo_kitchen": st("on", {}, iso(5)) });
    expect((await glow(page)).filter((x) => x.visible).map((x) => x.room).sort()).toEqual([0, 1]);
    await setStates(page, QUIET());
    expect((await glow(page)).filter((x) => x.visible)).toEqual([]);
  });

  /** How far (cm) the point (x, y) is from the axis-aligned box x0..x1 by y0..y1: 0 inside it. */
  const outside = (x: number, y: number, [x0, y0, x1, y1]: number[]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
  // A wall face sits 5 cm off a room's edge (half the 10 cm wall) and the patch lifts 0.8 cm more: a vertex of the lamp's own room is within 6 cm of it.
  // The bug this guards lit the stretch of an outline face that is shared by several rooms for 93 cm into the next room.
  test("no vertex of a lamp's glow lies outside the lamp's own room (first-floor Bedroom, ground Kitchen and Living on the demo)", async ({ page }) => {
    await boot(page, structuredClone(demo), { walls: "full" });
    for (const [floor, entity, room, box, name] of [
      ["ground", "light.demo_kitchen", 1, [500, 0, 800, 400], "Kitchen"],
      ["ground", "light.demo_living", 0, [0, 0, 500, 400], "Living"],
      ["first", "light.demo_bedroom", 0, [0, 0, 400, 300], "Bedroom"],
    ] as const) {
      await select(page, floor);
      await setStates(page, { ...QUIET(), "light.demo_bedroom": st("off"), [entity]: st("on", { rgb_color: [255, 170, 60], brightness: 255 }, iso(5)) });
      const g = (await glow(page)).filter((x) => x.visible);
      expect(g.map((x) => x.room), name).toEqual([room]);
      expect(g[0].pos.length, `${name} has vertices`).toBeGreaterThan(30 * 3);
      const far = [] as string[];
      for (let i = 0; i < g[0].pos.length; i += 3) { const d = outside(g[0].pos[i], g[0].pos[i + 2], [...box]); if (d > 6) far.push(`${g[0].pos[i].toFixed(0)},${g[0].pos[i + 2].toFixed(0)} (${d.toFixed(0)} cm out)`); }
      expect(far, `${name}: vertices outside the room`).toEqual([]);
    }
  });

  test("a lamp in no room lights no wall", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.devices.push({ id: "far", type: "light", entity: "light.far", name: "Far", x: 2000, y: 2000 });
    await boot(page, layout, { walls: "full" }, { ...QUIET(), "light.far": st("on", {}, iso(5)) });
    expect((await glow(page)).filter((x) => x.visible)).toEqual([]);
  });

  test("a lowered wall's glow stops at the height it is drawn at", async ({ page }) => {
    await boot(page, structuredClone(demo), { walls: "low" }, LIVING_ON());
    const g = (await glow(page)).filter((x) => x.visible);
    expect(g.length).toBe(1);
    expect(g[0].faces.length).toBeGreaterThan(2);
    for (const f of g[0].faces) { expect(f.z1).toBeLessThanOrEqual(110); expect(f.z1).toBeGreaterThan(0); } // CUT_WALL_HEIGHT (110), not the wall's 250
    expect(Math.max(...g[0].faces.map((f) => f.z1))).toBeGreaterThan(100); // it reaches the new height: a patch stopping at the old 30 or 60 fails
  });

  test("a full-height wall's glow reaches up the wall (the control for the lowered one)", async ({ page }) => {
    await boot(page, structuredClone(demo), { walls: "full" }, LIVING_ON());
    expect(Math.max(...(await glow(page)).flatMap((x) => x.faces.map((f) => f.z1)))).toBeGreaterThan(200);
  });

  test("pixels: the wall near the lamp is brighter with it on than off, further along it less so, and the neighbour's side does not change", async ({ page }) => {
    await boot(page, structuredClone(demo), { walls: "full" });
    // From the west, mostly from above, looking at the living room's east wall (its west face at x 495); the kitchen's face of the same wall is at x 505.
    await look(page, -Math.PI / 2, 0.55);
    await still(page);
    const near = await at(page, 494, 200, 120), far = await at(page, 494, 390, 120);
    const read = async () => ({ near: meanLuma((await lumaOf(page, patch(near, 5))).l), far: meanLuma((await lumaOf(page, patch(far, 5))).l) });
    const before = await read();
    await setStates(page, LIVING_ON());
    const after = await read();
    const rise = { near: after.near - before.near, far: after.far - before.far };
    expect(rise.near).toBeGreaterThan(6); // lit by the lamp
    expect(rise.near).toBeGreaterThan(rise.far + 5); // the same wall, 190 cm further along, past the glow's reach (a flat lift is still there)
    // The pool light and the room lift also brighten the wall, so the patch itself is told apart by hiding only it.
    await hook(page, (h) => h.muteGlow(true)); await still(page);
    const bare = await read();
    await hook(page, (h) => h.muteGlow(false)); await still(page);
    expect(after.near - bare.near, "the patch adds light near the lamp").toBeGreaterThan(4);
    expect(after.far - bare.far, "and less far from it").toBeLessThan((after.near - bare.near) / 2);
    // off again: back to where it was
    await setStates(page, QUIET());
    const back = await read();
    expect(Math.abs(back.near - before.near)).toBeLessThanOrEqual(1.5);
    // the kitchen's face of that wall, seen from the east: a living-room lamp does not reach it
    await look(page, Math.PI / 2, 0.55);
    await still(page);
    const k = await at(page, 506, 200, 120);
    const kBefore = meanLuma((await lumaOf(page, patch(k, 5))).l);
    await setStates(page, LIVING_ON());
    const kAfter = meanLuma((await lumaOf(page, patch(k, 5))).l);
    expect(Math.abs(kAfter - kBefore)).toBeLessThanOrEqual(1.5);
  });
});
