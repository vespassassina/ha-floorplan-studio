import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { serve, ORIGIN, card, drawn, cam } from "./helpers-3d";
import { loadCard } from "./form-harness";
import { FIRST_TO_GROUND, GROUND_TO_BASEMENT } from "../fixtures/hand-align-truth";
import { checkedIn, pick } from "./menu-helper";

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
  belowSolids(): { kind: string; tag: string; base: number[][]; rot: number | null }[];
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
    // S32.4 premise change: the first view is now the exact box fit, closer than the old sphere, so from the south the house stands
    // between the camera and the north garden and a ray to it meets the house. Looked at from the north, the garden is in front.
    await hook(page, (h) => h.look(Math.PI + 0.6, 0.9));
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

// S27.14: the card gives the view its floors below: `floors_below` in YAML, a Floors below select beside Walls, kept per viewer. The
// card calls `setBelow` with `floorsBelow`, the `floorElevation` differences and `floorPlace`. What is drawn is read back through the
// view's test hook, as above, so the card's numbers are tested at the pixel end, not by spying on the call.
async function bootCard(page: Page, config: Record<string, unknown> = {}, layout: unknown = structuredClone(stress)) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configureCard(page, config, layout);
  await drawn(page);
}
/** setConfig again on the same page: a reload of the dashboard, with the storage kept. */
async function configureCard(page: Page, config: Record<string, unknown>, layout: unknown = structuredClone(stress)) {
  await page.evaluate((cfg) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor: "first", view: "3d", active_list: false, ...config });
  await drawn(page);
}
// S31.6: Floors below is a radio group of the header menu (`below:off|ghost|solid`), no longer a select.
const BELOW_MODES = ["off", "ghost", "solid"] as const;
const belowNow = (page: Page) => checkedIn(page, "below", BELOW_MODES);
const y0 = async (page: Page) => (await hook(page, (h) => h.floors())).extent.y0;
/** Waits until the view draws no floor below (it renders on demand: there is no frame to wait for when nothing changes). */
const noneBelow = (page: Page, why = "") => expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000, message: why }).toBe(0);

test.describe("3D view: the card's floors below (S27.14)", () => {
  test("the menu group after Walls has off, ghost and solid, and each value changes what is drawn as S27.7 does", async ({ page }) => {
    await bootCard(page);
    expect(await belowNow(page)).toBe("off");
    await page.locator("floorplan-studio-card").locator("css=button[aria-label='View options']").click();
    // after Walls: the same menu, in this order
    const order = await page.locator("floorplan-studio-card").locator("css=[role=menu] [role=menuitemradio]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
    expect(order.filter((v) => v?.startsWith("below:"))).toEqual(BELOW_MODES.map((m) => `below:${m}`));
    expect(order.indexOf("walls:low")).toBeLessThan(order.indexOf("below:off"));
    await page.keyboard.press("Escape");
    const one = await y0(page);
    expect(one).toBeGreaterThanOrEqual(-26);
    expect((await hook(page, (h) => h.below())).count).toBe(0);

    await pick(page, "below:solid");
    await expect.poll(() => y0(page), { timeout: 8000 }).toBeCloseTo(-320, 0); // ground's slab bottom: -295 - 25
    const solid = await hook(page, (h) => h.below());
    expect(solid.meshes.some((m) => !m.transparent && m.depthWrite && m.opacity === 1)).toBe(true);

    await pick(page, "below:ghost");
    await expect.poll(async () => (await hook(page, (h) => h.below())).meshes.every((m) => m.transparent), { timeout: 8000 }).toBe(true);
    const ghost = await hook(page, (h) => h.below());
    expect(ghost.count).toBeGreaterThan(0);
    for (const m of ghost.meshes) { expect(m.opacity).toBeLessThanOrEqual(0.25); expect(m.depthWrite).toBe(false); }
    expect(await y0(page)).toBeCloseTo(-320, 0);

    await pick(page, "below:off");
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBe(0);
    expect(await y0(page)).toBe(one);
  });

  test("YAML: off is the default; solid and ghost draw at once; junk is off", async ({ page }) => {
    await bootCard(page, { floors_below: "solid" });
    expect(await belowNow(page)).toBe("solid");
    await expect.poll(() => y0(page), { timeout: 8000 }).toBeCloseTo(-320, 0);
    await configureCard(page, { floors_below: "ghost" });
    expect(await belowNow(page)).toBe("ghost");
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(0);
    for (const junk of ["x", 5, {}, null, [], "SOLID", true]) {
      await configureCard(page, { floors_below: junk });
      expect(await belowNow(page), JSON.stringify(junk)).toBe("off");
      await noneBelow(page, JSON.stringify(junk));
    }
  });

  test("a stored viewer choice wins over YAML, both ways", async ({ page }) => {
    await bootCard(page, { floors_below: "solid" });
    await pick(page, "below:off");
    await configureCard(page, { floors_below: "solid" });
    expect(await belowNow(page)).toBe("off");
    await noneBelow(page);
    await configureCard(page, { floors_below: "off" });
    await pick(page, "below:ghost");
    await configureCard(page, { floors_below: "off" });
    expect(await belowNow(page)).toBe("ghost");
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(0);
    // and a stored value that is not a mode is dropped, so the YAML is in charge again
    await configureCard(page, { floors_below: "solid" });
    await pick(page, "below:ghost");
    await page.evaluate(() => { for (const [k, v] of Object.entries(localStorage)) if (k.startsWith("fp-view:")) localStorage.setItem(k, v.replace('"below":"ghost"', '"below":"<b>"')); });
    await configureCard(page, { floors_below: "solid" });
    expect(await belowNow(page)).toBe("solid");
    await expect.poll(() => y0(page), { timeout: 8000 }).toBeCloseTo(-320, 0);
  });

  test("the floor's offset moves the floor below: the card passes the shift (floorPlace)", async ({ page }) => {
    const lows = async (layout: unknown) => {
      await bootCard(page, { floors_below: "solid" }, layout);
      await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(0);
      const boxes = (await hook(page, (h) => h.below())).meshes.map((m) => m.box);
      return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.min(...boxes.map((b) => b[2]))];
    };
    const home = await lows(structuredClone(stress));
    const moved = structuredClone(stress);
    moved.floors.first.offset = [100, -40]; // the first floor sits 100 cm east and 40 north: the ground floor is 100 west, 40 south of it, on the first floor's plan
    moved.floors.ground.offset = [10, 5];
    const after = await lows(moved);
    expect(after[0] - home[0]).toBeCloseTo(10 - 100, 1);
    expect(after[1] - home[1]).toBeCloseTo(5 + 40, 1); // box is [x, plan y, height, ...], as in the S27.7 test above
    expect(after[2]).toBeCloseTo(home[2], 1); // never up or down
  });

  test("on the third floor both floors below are drawn, at their own heights", async ({ page }) => {
    await bootCard(page, { floors_below: "solid", floor: "second" });
    // stress: first stands 295 above ground; second above first by first's height and slab; both are drawn down to ground's slab
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(1);
    const lowest = await y0(page);
    expect(lowest).toBeLessThan(-295 - 100); // under the first floor's slab, the ground floor is there too
  });

  test("the camera of each floor survives a switch with floors below on (S14.4)", async ({ page }) => {
    await bootCard(page, { floors_below: "solid", floor: "all" });
    const chip = (t: string) => card(page).locator("css=.fp-floors button", { hasText: t });
    const still = async () => { let prev = ""; await expect.poll(async () => { const now = JSON.stringify(await cam(page)); const s = now === prev; prev = now; return s; }, { intervals: [250], timeout: 10000 }).toBe(true); };
    const go = async (t: string) => { await chip(t).click(); await expect(chip(t)).toHaveAttribute("aria-pressed", "true"); await drawn(page); await still(); };
    await still();
    const orbit = async (dx: number, dy: number) => {
      const b = (await card(page).locator("css=canvas").boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await still();
    };
    await orbit(130, 45);
    const ground = await cam(page);
    await go("First");
    await orbit(-90, -30);
    const first = await cam(page);
    expect(Math.abs(first.az - ground.az)).toBeGreaterThan(0.05);
    await expect.poll(() => y0(page), { timeout: 8000 }).toBeCloseTo(-320, 0); // the floor below is drawn on First
    await go("Ground");
    expect((await cam(page)).az).toBeCloseTo(ground.az, 3);
    expect((await cam(page)).polar).toBeCloseTo(ground.polar, 3);
    await go("First");
    expect((await cam(page)).az).toBeCloseTo(first.az, 3);
    expect((await cam(page)).polar).toBeCloseTo(first.polar, 3);
    expect(await y0(page)).toBeCloseTo(-320, 0);
  });

  test("the config form offers floors_below: off is the default and dropped, junk reads off", async ({ page }) => {
    await loadCard(page);
    const mount = (config: Record<string, unknown>) => page.evaluate(async (config) => {
      document.getElementById("editor")?.remove();
      const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): Promise<HTMLElement> };
      const el = await Ctor.getConfigElement();
      (window as any).__events = [];
      el.addEventListener("config-changed", (e) => (window as any).__events.push((e as CustomEvent).detail));
      el.id = "editor";
      document.body.appendChild(el);
      (el as any).setConfig(config);
    }, config);
    const events = () => page.evaluate(() => (window as any).__events);
    await mount({ layout: stress });
    const sel = page.locator("#editor select#floors_below");
    expect(await sel.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["off", "ghost", "solid"]);
    await expect(sel).toHaveValue("off");
    await sel.selectOption("solid");
    expect((await events()).at(-1).config.floors_below).toBe("solid");
    await sel.selectOption("off");
    expect("floors_below" in (await events()).at(-1).config).toBe(false);
    await mount({ floors_below: "<b>", layout: stress });
    await expect(page.locator("#editor select#floors_below")).toHaveValue("off");
    await mount({ floors_below: "ghost", layout: stress });
    await expect(page.locator("#editor select#floors_below")).toHaveValue("ghost");
  });
});

// S29.4 and S29.5: the floors below turn. The fixture `hand-align-house.json` stores no pose; the truth says the ground is turned -2.50 degrees and shifted
// [-57, 112] from the basement, the first 4.00 degrees and [83, -41] from the ground. Everything here is worked out by hand from that truth, with no
// helper of src/core, so the expected corners do not come from the code under test. The view's test hook gives back the solids its floor-below meshes
// were made from, in the current floor's frame.
const house = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const rad = (d: number) => (d * Math.PI) / 180;
const turn = (v: number[], d: number): [number, number] => [v[0]! * Math.cos(rad(d)) - v[1]! * Math.sin(rad(d)), v[0]! * Math.sin(rad(d)) + v[1]! * Math.cos(rad(d))];
/** A ground point in the first floor's frame: the inverse of the first-to-ground place, p = R(-t)(p' - s). */
const groundInFirst = (p: number[]): [number, number] => turn([p[0]! - FIRST_TO_GROUND.shift[0], p[1]! - FIRST_TO_GROUND.shift[1]], -FIRST_TO_GROUND.turn);
const TRUE = { turn: -FIRST_TO_GROUND.turn, shift: turn(FIRST_TO_GROUND.shift, -FIRST_TO_GROUND.turn).map((v) => -v) as [number, number] };
const FOOT = (house.floors.ground.stairs[0].pts as number[][]).map(groundInFirst);
const nearest = (base: number[][], want: number[]) => Math.min(...base.map((q) => Math.hypot(q[0]! - want[0]!, q[1]! - want[1]!)));
const stairBase = async (page: Page) => (await hook(page, (h) => h.belowSolids())).filter((x) => x.kind === "stair").flatMap((x) => x.base);
/** The fixture with the truth written as a pose: ground against the basement, first against the ground. */
const posedHouse = (off = false) => {
  const l = structuredClone(house);
  l.floors.ground.rotation = GROUND_TO_BASEMENT.turn; l.floors.ground.offset = GROUND_TO_BASEMENT.shift;
  const o = turn(FIRST_TO_GROUND.shift, GROUND_TO_BASEMENT.turn);
  l.floors.first.rotation = GROUND_TO_BASEMENT.turn + FIRST_TO_GROUND.turn; l.floors.first.offset = [GROUND_TO_BASEMENT.shift[0] + o[0], GROUND_TO_BASEMENT.shift[1] + o[1]];
  if (off) for (const k of ["ground", "first"]) { delete l.floors[k].offset; }
  return l;
};

test.describe("3D view: the floors below turn (S29.4)", () => {
  test("the ground's stair footprint, under the first floor, is where the truth puts it within 1 cm; with no turn it is not", async ({ page }) => {
    await bootCard(page, {}, structuredClone(house));
    await setBelow(page, [{ floor: house.floors.ground, elevation: -295, shift: TRUE.shift, turn: TRUE.turn }], "solid");
    const base = await stairBase(page);
    expect(base.length).toBeGreaterThan(12); // one block per step
    for (const [i, c] of FOOT.entries()) expect(nearest(base, c), `footprint corner ${i}`).toBeLessThan(1);
    await setBelow(page, [{ floor: house.floors.ground, elevation: -295, shift: TRUE.shift }], "solid"); // the same place without its turn
    const flat = await stairBase(page);
    expect(Math.max(...FOOT.map((c) => nearest(flat, c))), "a floor below that ignores its turn misses a corner by more than 5 cm").toBeGreaterThan(5);
  });

  test("a floor below turned is drawn turned: its mesh extent is the turned solids' extent", async ({ page }) => {
    await bootCard(page, {}, structuredClone(house));
    await setBelow(page, [{ floor: house.floors.ground, elevation: -295, shift: TRUE.shift, turn: TRUE.turn }], "solid");
    const boxes = (await hook(page, (h) => h.below())).meshes.map((m) => m.box), solids = await hook(page, (h) => h.belowSolids());
    const pts = solids.flatMap((x) => x.base);
    const ext = [Math.min(...pts.map((q) => q[0]!)), Math.min(...pts.map((q) => q[1]!)), Math.max(...pts.map((q) => q[0]!)), Math.max(...pts.map((q) => q[1]!))];
    const got = [Math.min(...boxes.map((b) => b[0]!)), Math.min(...boxes.map((b) => b[1]!)), Math.max(...boxes.map((b) => b[3]!)), Math.max(...boxes.map((b) => b[4]!))];
    got.forEach((v, i) => expect(v, `edge ${i}`).toBeCloseTo(ext[i]!, 1));
    // the slab's outline corner (0, 0) of the ground lies at the true place, not at the shift
    const corner = groundInFirst([0, 0]);
    expect(nearest((await hook(page, (h) => h.belowSolids())).filter((x) => x.kind === "floor").flatMap((x) => x.base), corner)).toBeLessThan(1);
  });

  test("a tap on the turned floor below picks nothing, in every mode", async ({ page }) => {
    await bootCard(page, {}, structuredClone(house));
    await hook(page, (h) => h.look(0.6, 0.9));
    for (const mode of ["solid", "ghost"]) {
      await setBelow(page, [{ floor: house.floors.ground, elevation: -295, shift: TRUE.shift, turn: TRUE.turn }], mode);
      // the ground's wing (y 600..900) is clear of the first floor's outline (y -23..645) above it: a point of the wing, at the ground's room-fill top
      const at = await hook(page, (h, p) => h.project(p[0]!, p[1]!, -294), groundInFirst([300, 820]));
      await page.mouse.click(at.x, at.y);
      expect(await hook(page, (h, p) => h.pick(p.x, p.y), at), mode).toBeNull();
      expect(await card(page).locator("css=.fp-3d[data-ring]:not([data-ring=''])").count(), mode).toBe(0);
    }
  });

  test("20 calls with a turning floor below leave no mesh, geometry, solid or scene child behind", async ({ page }) => {
    await bootCard(page, {}, structuredClone(house));
    const one = (t: number) => [{ floor: house.floors.ground, elevation: -295, shift: TRUE.shift, turn: t }];
    await setBelow(page, one(TRUE.turn), "solid");
    const after1 = { mem: await hook(page, (h) => h.memory()), kids: (await hook(page, (h) => h.live())).children, n: (await hook(page, (h) => h.below())).count, solids: (await hook(page, (h) => h.belowSolids())).length };
    for (let i = 0; i < 20; i++) await setBelow(page, one(i % 2 ? TRUE.turn : -TRUE.turn + 0.5 * i), "solid");
    await setBelow(page, one(TRUE.turn), "solid");
    expect((await hook(page, (h) => h.below())).count).toBe(after1.n);
    expect((await hook(page, (h) => h.belowSolids())).length).toBe(after1.solids);
    expect((await hook(page, (h) => h.live())).children).toBe(after1.kids);
    expect((await hook(page, (h) => h.memory())).geometries).toBe(after1.mem.geometries);
  });

  test("junk turns draw the floor unturned and do not throw", async ({ page }) => {
    await bootCard(page, {}, structuredClone(house));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const junk of ["4", null, NaN, 1e9, [4], {}]) {
      await setBelow(page, [{ floor: house.floors.ground, elevation: -295, shift: [0, 0], turn: junk }], "solid");
      expect(nearest(await stairBase(page), house.floors.ground.stairs[0].pts[0]), JSON.stringify(junk)).toBeLessThan(1);
    }
    expect(errors).toEqual([]);
  });
});

// S29.5: the card gives `floorPlace`: the turn and the shift together.
test.describe("3D view: the card passes the pose of the floors (S29.5)", () => {
  test("the card's floors below sit where the poses put them: the stair footprint, within 1 cm", async ({ page }) => {
    await bootCard(page, { floors_below: "solid" }, posedHouse());
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(0);
    const base = await stairBase(page);
    for (const [i, c] of FOOT.entries()) expect(nearest(base, c), `footprint corner ${i}`).toBeLessThan(1);
  });

  test("changing only a floor's rotation draws the floor below again (the offsets are zero, so the shift stays [0, 0])", async ({ page }) => {
    const layout = structuredClone(house);
    await bootCard(page, { floors_below: "solid" }, layout);
    await expect.poll(async () => (await hook(page, (h) => h.below())).count, { timeout: 8000 }).toBeGreaterThan(0);
    const corner = house.floors.ground.stairs[0].pts[2] as number[];
    expect(nearest(await stairBase(page), corner), "a floor with no pose lies as drawn").toBeLessThan(0.01);
    // the same layout object, the floor objects the card already holds: only a number changes, so the elevation, the shift and the floors are what they were
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { _layout: { floors: Record<string, { rotation?: number }> }; requestUpdate(): void; updateComplete: Promise<unknown> };
      el._layout.floors.first!.rotation = 3;
      el.requestUpdate();
      return el.updateComplete;
    });
    // the floor below is now 3 degrees anticlockwise of the first floor's frame: ground to first has turn -3
    const want = turn(corner, -3);
    await expect.poll(async () => nearest(await stairBase(page), want), { timeout: 8000, message: "the floor below turned by -3 degrees" }).toBeLessThan(0.05);
  });
});
