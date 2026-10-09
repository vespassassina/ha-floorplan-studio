import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, canvas, cam, drawn } from "./helpers-3d";

// S12.5: live state in the 3D view. Pixels are read from real screenshots of the canvas, taps are real `page.mouse`
// events, and the scene's own state (a door's swing, a body's colour, a pool, a ring) is read from the test hook
// `__fp3d.live()` that exists only in the test build (dist-test/). Demo ground floor: Living is room 0 (0..500 x
// 0..400), Kitchen 1 (500..800 x 0..400), Hall 2; device 0 is the living light at (250,200), 1 the kitchen light,
// 5 the hall motion sensor, 7 the heater bar; doors: 0 Front door (plain), 1 Patio (glass), 2 Garage (plain, a cover).

type Where = { x: number; y: number };
const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = iso(600)) => ({ state, attributes, last_changed });
const QUIET = () => ({
  "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("off"),
  "sensor.demo_living_temperature": st("21", { unit_of_measurement: "°C" }), "binary_sensor.demo_hall_motion": st("off"), "climate.demo_living": st("heat", { hvac_action: "idle" }),
  "binary_sensor.demo_front_door": st("off"), "binary_sensor.demo_patio_door": st("off"),
});
interface Live {
  builds: number; children: number;
  doors: { index: number; tag: string; visible: boolean; rot: number; colour: string }[];
  bodies: { index: number; type: string; colour: string; emissive: string }[];
  balls: { index: number; colour: string; shown: boolean }[];
  pools: { room: number; visible: boolean; colour: string; opacity: number }[];
  lifted: number[];
  rings: { room: number; visible: boolean; opacity: number; colour: string }[];
  pulsing: boolean;
}

async function boot(page: Page, config: Record<string, unknown> = {}, states: Record<string, unknown> = QUIET(), layout: unknown = structuredClone(demo)) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", active_list: false, ...config }, states] as const);
  await drawn(page);
  await still(page);
}
/** The view has drawn its last frame: the counter has not moved for 300 ms. */
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
/** A new `hass` with these states (the card re-renders, as on a Home Assistant push), then waits for the frame it asks for. */
async function setStates(page: Page, states: Record<string, unknown>, settle = true) {
  const n = (await cam(page)).drawn;
  await page.evaluate((states) => {
    const el = document.getElementById("card") as unknown as { hass: { callService: unknown } };
    el.hass = { ...el.hass, states } as never;
  }, states);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(n);
  if (settle) await still(page); // not while a pulse plays: frames keep coming until it ends
}
const live = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { live(): unknown } }).__fp3d.live()) as Promise<Live>;
const at = (page: Page, x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): Where } }).__fp3d.project(x, y, z), [x, y, z] as const);
const look = (page: Page, az: number, polar: number) => page.evaluate(([a, p]) => (window as unknown as { __fp3d: { look(a: number, p: number): void } }).__fp3d.look(a, p), [az, polar] as const);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
/** The mean colour of a 20 x 20 px patch of the page around `p`, from a real screenshot. */
async function mean(page: Page, p: Where, half = 10): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    return [r / n, gr / n, b / n] as [number, number, number];
  }, buf.toString("base64"));
}
const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
/** How many pixels of the page region are clearly red (the motion ring's colour in every theme). */
async function reds(page: Page, box: { x: number; y: number; width: number; height: number }, soft = false): Promise<number> {
  const buf = await page.screenshot({ clip: box });
  return page.evaluate(async ([b64, soft]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, [lo, gap] = soft ? [90, 40] : [150, 70]; // half strength over a dark floor is a dull red
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > lo && d[i] > d[i + 1] + gap && d[i] > d[i + 2] + gap) n++;
    return n;
  }, [buf.toString("base64"), soft] as const);
}
const icon = (page: Page, i: number) => card(page).locator(`css=.fp3-ic[data-i="${i}"]`);
const roomLabel = (page: Page, r: number) => card(page).locator(`css=.fp3-rm[data-r="${r}"]`);

test.describe("3D view: lights", () => {
  test("a lamp that is on lights its own room's floor and not the neighbour's; off puts both back", async ({ page }) => {
    await boot(page);
    const living = await at(page, 60, 60, 1), kitchen = await at(page, 720, 60, 1), pool = await at(page, 230, 170, 1);
    const before = { living: await mean(page, living), kitchen: await mean(page, kitchen), pool: await mean(page, pool) };
    const cam0 = await cam(page);
    await setStates(page, { ...QUIET(), "light.demo_living": st("on", { rgb_color: [255, 170, 60], brightness: 255 }, iso(5)) });
    const after = { living: await mean(page, living), kitchen: await mean(page, kitchen), pool: await mean(page, pool) };
    // Living is brighter and warmer (red over blue); the Kitchen, next door and behind a wall, did not move by a grey level
    expect(lum(after.living)).toBeGreaterThan(lum(before.living) + 8);
    expect(after.living[0] / after.living[2]).toBeGreaterThan((before.living[0] / before.living[2]) * 1.03);
    for (let k = 0; k < 3; k++) expect(Math.abs(after.kitchen[k] - before.kitchen[k]), `kitchen channel ${k}`).toBeLessThanOrEqual(1.5);
    // nearer the lamp is brighter still: the pool, not only the room's lift
    expect(lum(after.pool)).toBeGreaterThan(lum(after.living) + 3);
    expect((await live(page)).lifted).toEqual([0]);
    const c1 = await cam(page);
    expect([c1.az, c1.polar, c1.dist, c1.target]).toEqual([cam0.az, cam0.polar, cam0.dist, cam0.target]);
    await setStates(page, QUIET());
    const off = { living: await mean(page, living), kitchen: await mean(page, kitchen), pool: await mean(page, pool) };
    for (const k of ["living", "kitchen", "pool"] as const) for (let i = 0; i < 3; i++) expect(Math.abs(off[k][i] - before[k][i]), `${k} channel ${i} back to unlit`).toBeLessThanOrEqual(1.5);
    expect((await live(page)).lifted).toEqual([]);
  });

  test("the kitchen's own lamp lights the kitchen and leaves the living room alone", async ({ page }) => {
    await boot(page);
    const living = await at(page, 60, 60, 1), kitchen = await at(page, 720, 60, 1);
    const before = { living: await mean(page, living), kitchen: await mean(page, kitchen) };
    await setStates(page, { ...QUIET(), "light.demo_kitchen": st("on", {}, iso(5)) });
    expect(lum(await mean(page, kitchen))).toBeGreaterThan(lum(before.kitchen) + 8);
    const l = await mean(page, living);
    for (let k = 0; k < 3; k++) expect(Math.abs(l[k] - before.living[k])).toBeLessThanOrEqual(1.5);
    expect((await live(page)).lifted).toEqual([1]);
  });

  test("forty lit lamps: the view caps the pools at 32, and still draws and answers", async ({ page }) => {
    const layout = structuredClone(demo);
    const states = QUIET() as Record<string, unknown>;
    for (let i = 0; i < 40; i++) {
      layout.floors.ground.devices.push({ id: `l${i}`, type: "light", entity: `light.many_${i}`, name: `L${i}`, x: 20 + (i % 10) * 70, y: 40 + Math.floor(i / 10) * 90 });
      states[`light.many_${i}`] = st("on", {}, iso(5));
    }
    await boot(page, {}, states, layout);
    const l = await live(page);
    expect(l.pools.filter((p) => p.visible).length).toBeLessThanOrEqual(32);
    expect(l.pools.filter((p) => p.visible).length).toBeGreaterThan(0);
    const t = Date.now();
    await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(560, 420, { steps: 5 }); await page.mouse.up();
    await still(page);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("night dims the scene, and a lit room stays lit against it", async ({ page }) => {
    await boot(page, { night: "off" });
    const living = await at(page, 60, 60, 1), kitchen = await at(page, 720, 60, 1);
    const day = { living: await mean(page, living), kitchen: await mean(page, kitchen) };
    await page.evaluate((layout) => { (document.getElementById("card") as unknown as { setConfig(c: unknown): void }).setConfig({ layout, floor: "ground", view: "3d", active_list: false, night: "on" }); }, structuredClone(demo));
    await still(page);
    const night = { living: await mean(page, living), kitchen: await mean(page, kitchen) };
    expect(lum(night.living)).toBeLessThan(lum(day.living) - 10);
    await setStates(page, { ...QUIET(), "light.demo_living": st("on", {}, iso(5)) });
    const lit = await mean(page, living);
    expect(lum(lit)).toBeGreaterThan(lum(night.living) + 10);
    const k = await mean(page, kitchen);
    for (let i = 0; i < 3; i++) expect(Math.abs(k[i] - night.kitchen[i])).toBeLessThanOrEqual(1.5);
  });
});

test.describe("3D view: doors and windows", () => {
  test("a closed door shows its leaf; open, it swings about its hinge; closed again, it is back; the scene is not rebuilt", async ({ page }) => {
    await boot(page);
    const door = async (i: number) => (await live(page)).doors.find((d) => d.index === i && d.tag === "door-leaf")!;
    const builds = (await live(page)).builds;
    expect(await door(0)).toMatchObject({ visible: true, rot: 0 });
    await setStates(page, { ...QUIET(), "binary_sensor.demo_front_door": st("on", {}, iso(5)) });
    const open = await door(0);
    expect(open.visible).toBe(true);
    expect(Math.abs(open.rot)).toBeGreaterThan(1.1); // about 70 degrees
    expect(Math.abs(open.rot)).toBeLessThan(1.35);
    expect(open.colour).not.toBe((await door(2)).colour); // the open door is red (--fp-open-door), the other is the door colour
    await setStates(page, QUIET());
    expect(await door(0)).toMatchObject({ visible: true, rot: 0 });
    expect((await live(page)).builds).toBe(builds);
  });

  test("a glass door has its pane while its sensor says closed and none when open, unavailable or without a state (S25.D1)", async ({ page }) => {
    await boot(page);
    const pane = async () => (await live(page)).doors.find((d) => d.index === 1 && d.tag === "glass")!;
    expect(await pane()).toMatchObject({ visible: true });
    await setStates(page, { ...QUIET(), "binary_sensor.demo_patio_door": st("on", {}, iso(5)) });
    expect((await pane()).visible).toBe(false);
    await setStates(page, QUIET());
    expect((await pane()).visible).toBe(true);
    await setStates(page, { ...QUIET(), "binary_sensor.demo_patio_door": st("unavailable") });
    expect((await pane()).visible).toBe(false);
    await setStates(page, QUIET()); // closed again, so the next is a change the view has to draw
    const without: Record<string, unknown> = QUIET();
    delete without["binary_sensor.demo_patio_door"];
    await setStates(page, without);
    expect((await pane()).visible).toBe(false);
  });

  test("a plain door is a hole (no leaf) when its sensor is unavailable, unknown or has no state, and in the garage with no sensor (S25.D1)", async ({ page }) => {
    await boot(page);
    const door = async (i: number) => (await live(page)).doors.find((d) => d.index === i && d.tag === "door-leaf")!;
    expect(await door(0)).toMatchObject({ visible: true });
    for (const v of ["unavailable", "unknown"]) {
      await setStates(page, { ...QUIET(), "binary_sensor.demo_front_door": st(v) });
      expect((await door(0)).visible, v).toBe(false);
      await setStates(page, QUIET()); // closed again between the two, so each is a change the view has to draw
      expect((await door(0)).visible).toBe(true);
    }
    const without: Record<string, unknown> = QUIET();
    delete without["binary_sensor.demo_front_door"];
    await setStates(page, without);
    expect((await door(0)).visible, "no state").toBe(false);
    expect((await door(2)).visible, "garage: no sensor").toBe(false);
    await setStates(page, QUIET());
    expect((await door(0)).visible).toBe(true);
    expect((await door(2)).visible).toBe(false);
  });

  test("an alarmed door (vibration) stays shut and turns red; a garage cover that is open opens its leaf", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.doors[0].vibration = ["binary_sensor.demo_front_vibration"];
    await boot(page, {}, { ...QUIET(), "binary_sensor.demo_front_vibration": st("off") }, layout);
    const door = async (i: number) => (await live(page)).doors.find((d) => d.index === i && d.tag === "door-leaf")!;
    const shut = (await door(0)).colour;
    await setStates(page, { ...QUIET(), "binary_sensor.demo_front_vibration": st("on", {}, iso(5)) });
    expect(await door(0)).toMatchObject({ visible: true, rot: 0 });
    expect((await door(0)).colour).not.toBe(shut);
    await setStates(page, { ...QUIET(), "cover.demo_garage_door": st("open", {}, iso(5)) });
    expect(Math.abs((await door(2)).rot)).toBeGreaterThan(1.1);
    expect((await door(2)).visible).toBe(true); // an open cover is an alert: the leaf stands there, swung, in the cover colour
  });
});

test.describe("3D view: devices", () => {
  test("a radiator that is heating is tinted with the heater colour; idle again, it goes back", async ({ page }) => {
    await boot(page);
    const body = async () => (await live(page)).bodies.find((b) => b.index === 7)!;
    const idle = (await body()).colour;
    const bar = await at(page, 150, 8, 40);
    const px0 = await mean(page, bar, 4);
    await setStates(page, { ...QUIET(), "climate.demo_living": st("heat", { hvac_action: "heating" }, iso(5)) });
    const hot = (await body()).colour, rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    expect(hot).not.toBe(idle);
    expect(rgb(hot)[0]).toBeGreaterThan(rgb(hot)[2] + 40); // orange, not grey
    expect(rgb(hot)[0] - rgb(hot)[2]).toBeGreaterThan(rgb(idle)[0] - rgb(idle)[2] + 40);
    const px1 = await mean(page, bar, 4);
    expect(px1[0] - px1[2]).toBeGreaterThan(px0[0] - px0[2] + 10);
    await setStates(page, QUIET());
    expect((await body()).colour).toBe(idle);
  });

  test("a ball takes its state's colour: a light that is on is not the colour of one that is off; an unavailable one is the colour of an off one", async ({ page }) => {
    await boot(page);
    const ball = async (i: number) => (await live(page)).balls.find((b) => b.index === i)!;
    const off = (await ball(0)).colour;
    await setStates(page, { ...QUIET(), "light.demo_living": st("on", {}, iso(5)), "light.demo_kitchen": st("unavailable") });
    expect((await ball(0)).colour).not.toBe(off);
    expect((await ball(1)).colour).toBe(off); // S23.5: the ball of an unavailable lamp is idle, like off; its icon carries the dashed ring and badge
    expect((await ball(1)).colour).not.toBe((await ball(0)).colour);
    await setStates(page, QUIET());
    expect((await ball(0)).colour).toBe(off);
  });

  test("a room's own sensor draws no ball, no icon and no pick; its readout is in the room's label", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.rooms[0].temps = ["sensor.demo_living_temperature"];
    await boot(page, {}, QUIET(), layout);
    expect((await live(page)).balls.find((b) => b.index === 4)).toBeUndefined();
    await expect(icon(page, 4)).toHaveCount(0);
    await expect(icon(page, 0)).toHaveCount(1);
  });
});

test.describe("3D view: motion", () => {
  const ring = async (page: Page, room = 2) => (await live(page)).rings.find((r) => r.room === room)!;
  // The Hall owns its motion sensor (a room `motion` list, DECISIONS S11.1): only such a room pulses in 2D, so it is what 3D pulses too.
  const hallLayout = () => { const l = structuredClone(demo); l.floors.ground.rooms[2].motion = ["binary_sensor.demo_hall_motion"]; return l; };

  test("a sensor that trips pulses its room's edge three times, holds, then fades from last_changed and goes", async ({ page }) => {
    await boot(page, {}, QUIET(), hallLayout());
    expect((await ring(page)).visible).toBe(false);
    const hall = await at(page, 150, 540, 1);
    const box = { x: Math.max(0, hall.x - 160), y: Math.max(0, hall.y - 90), width: 320, height: 180 };
    const base = await reds(page, box, true); // soft: the pulse's trough is a dull red
    await setStates(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("on", {}, iso(0)) }, false);
    expect(await ring(page)).toMatchObject({ visible: true });
    await expect.poll(async () => (await live(page)).pulsing).toBe(true);
    // the pulse is a real animation: frames keep coming while it plays
    const f0 = (await cam(page)).drawn;
    await page.waitForTimeout(600);
    expect((await cam(page)).drawn).toBeGreaterThan(f0 + 3);
    const seen = new Set<number>();
    // it breathes: the opacity takes more than two values while the pulse plays (polled, because a loaded machine draws few frames)
    await expect.poll(async () => { seen.add(Math.round((await ring(page)).opacity * 20)); return seen.size; }, { intervals: [60], timeout: 3000 }).toBeGreaterThan(2);
    await expect.poll(() => reds(page, box, true), { intervals: [100], timeout: 3000 }).toBeGreaterThan(base + 30); // on screen at some point of the breath
    // three pulses of 1.4 s, then steady, and then no frame at all
    await expect.poll(async () => (await live(page)).pulsing, { timeout: 8000 }).toBe(false);
    await still(page);
    await page.waitForTimeout(1300); // the card's own one-second tick may hand over the last, steady value once
    await still(page);
    const f1 = (await cam(page)).drawn;
    await page.waitForTimeout(1500);
    expect((await cam(page)).drawn).toBe(f1);
    expect((await ring(page)).opacity).toBeCloseTo(1, 1);
    // it goes off a moment later: the card remembers when it was last on, so the edge keeps its strength and starts to fade from there
    await setStates(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("off", {}, iso(0)) });
    const held = await ring(page);
    expect(held.visible).toBe(true);
    expect(held.opacity).toBeGreaterThan(0.9);
    expect((await live(page)).pulsing).toBe(false);
  });

  test("a sensor that went off 60 s ago (default fade 120 s) leaves half an edge; 150 s ago, none", async ({ page }) => {
    await boot(page, {}, { ...QUIET(), "binary_sensor.demo_hall_motion": st("off", {}, iso(60)) }, hallLayout());
    const hall = await at(page, 150, 540, 1);
    const box = { x: Math.max(0, hall.x - 160), y: Math.max(0, hall.y - 90), width: 320, height: 180 };
    const half = await ring(page);
    expect(half.visible).toBe(true);
    expect(half.opacity).toBeGreaterThan(0.35);
    expect(half.opacity).toBeLessThan(0.65);
    expect((await live(page)).pulsing).toBe(false);
    expect(await reds(page, box, true)).toBeGreaterThan(20); // seen on screen, not only in the scene
    await setStates(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("off", {}, iso(150)) });
    expect((await ring(page)).visible).toBe(false);
    expect(await reds(page, box, true)).toBeLessThanOrEqual(5);
  });

  test("with reduced motion the edge is steady: no pulse, no frames", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, {}, QUIET(), hallLayout());
    await setStates(page, { ...QUIET(), "binary_sensor.demo_hall_motion": st("on", {}, iso(0)) });
    const r = (await live(page)).rings.find((x) => x.room === 2)!;
    expect(r).toMatchObject({ visible: true });
    expect(r.opacity).toBeCloseTo(1, 2);
    expect((await live(page)).pulsing).toBe(false);
    const f = (await cam(page)).drawn;
    await page.waitForTimeout(1200);
    expect((await cam(page)).drawn).toBe(f);
  });
});

test.describe("3D view: the overlay", () => {
  test("the room readout is the 2D readout; the name sits at the room", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.rooms[0].temps = ["sensor.demo_living_temperature"];
    await boot(page, {}, QUIET(), layout);
    await expect(roomLabel(page, 0).locator("css=.fp3-name")).toHaveText("Living");
    const readout = await roomLabel(page, 0).locator("css=.fp3-val").textContent();
    expect(readout).toMatch(/^21(\.0)?\u202F°C$/); // S23.1: a narrow no-break space before the unit
    // the same state, the same layout, drawn in 2D
    const twoD = await page.evaluate(([layout, states]) => {
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; updateComplete: Promise<unknown> };
      void states;
      el.setConfig({ layout, floor: "ground", view: "2d" });
      return el.updateComplete.then(() => el.shadowRoot!.querySelector('text[data-rv="0"]')?.textContent ?? null);
    }, [layout, QUIET()] as const);
    expect(readout).toBe(twoD);
  });

  test("the toggles: Labels off hides every name and readout; Names shows the device names", async ({ page }) => {
    await boot(page, {}, QUIET());
    await expect(roomLabel(page, 0).locator("css=.fp3-name")).toBeVisible();
    await expect(card(page).locator("css=.fp3-dn")).toHaveCount(0);
    await card(page).locator('css=button[aria-label="Device names"]').click();
    await expect(card(page).locator("css=.fp3-dn").first()).toBeVisible();
    await card(page).locator('css=button[aria-label="Labels"]').click();
    await expect(card(page).locator("css=.fp3-name")).toHaveCount(0);
    await expect(card(page).locator("css=.fp3-dn")).toHaveCount(0);
    await expect(icon(page, 0)).toBeVisible(); // the icons stay, as in 2D
  });

  test("an icon is a real glyph in the state's class, and a real click on it opens that entity's popup, whose button makes the one call, through the canvas", async ({ page }) => {
    await boot(page, {}, { ...QUIET(), "light.demo_living": st("on", {}, iso(600)) });
    const i = icon(page, 0);
    await expect(i).toBeVisible();
    await expect(i.locator("css=g.dev.dev-light.on path")).toHaveCount(1);
    expect(await i.locator("css=path").evaluate((p) => getComputedStyle(p).fill)).not.toBe(await icon(page, 1).locator("css=path").evaluate((p) => getComputedStyle(p).fill)); // lit and off differ
    const b = (await i.boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
    // the overlay never takes the pointer: what is under it is the canvas
    expect(await page.evaluate(([x, y]) => (document.getElementById("card")!.shadowRoot!.elementFromPoint(x, y) as HTMLElement | null)?.tagName, [x, y] as const)).toBe("CANVAS");
    await page.mouse.click(x, y);
    await expect(card(page).locator("css=.fp-pop")).toBeVisible();
    expect(await calls(page)).toEqual([]); // a tap operates nothing
    await card(page).locator("css=.fp-pop-do").click();
    await expect.poll(() => calls(page)).toEqual(["light.turn_off light.demo_living"]);
    await page.waitForTimeout(400);
    expect(await calls(page)).toEqual(["light.turn_off light.demo_living"]); // once
  });

  test("a drag that starts on an icon still turns the camera", async ({ page }) => {
    await boot(page);
    const b = (await icon(page, 0).boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2, c0 = await cam(page);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await cam(page)).az).not.toBeCloseTo(c0.az, 2);
    expect(await calls(page)).toEqual([]);
  });

  test("a label behind a wall is hidden, and comes back when the camera does", async ({ page }) => {
    await boot(page);
    await card(page).locator('css=select[aria-label="Walls"]').selectOption("full");
    await still(page);
    await look(page, 0, 0.12); // almost top-down: nothing stands in front of anything
    await still(page);
    await expect(roomLabel(page, 1)).toBeVisible();
    await expect(roomLabel(page, 0)).toBeVisible();
    // from the west, low: the Kitchen is behind Living's walls and the dividing wall, Living's own label behind its west wall
    await look(page, -Math.PI / 2, 1.3);
    await still(page);
    await expect(roomLabel(page, 1)).toBeHidden();
    await look(page, 0, 0.12);
    await still(page);
    await expect(roomLabel(page, 1)).toBeVisible();
  });
});

test.describe("3D view: the same scene, updated in place", () => {
  test("a Home Assistant update changes lights, doors and icons without a rebuild, a new canvas or a camera move", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { (document.getElementById("card")!.shadowRoot!.querySelector("canvas") as unknown as { __mark?: number }).__mark = 1; });
    const b = (await canvas(page).boundingBox())!;
    await page.mouse.move(b.x + 300, b.y + 300); await page.mouse.down(); await page.mouse.move(b.x + 350, b.y + 320, { steps: 5 }); await page.mouse.up();
    await still(page);
    const l0 = await live(page), c0 = await cam(page);
    const icons0 = await card(page).locator("css=.fp3-ic").count();
    await setStates(page, { ...QUIET(), "light.demo_living": st("on", {}, iso(5)), "binary_sensor.demo_front_door": st("on", {}, iso(5)), "climate.demo_living": st("heat", { hvac_action: "heating" }, iso(5)) });
    await setStates(page, { ...QUIET(), "light.demo_kitchen": st("on", {}, iso(5)) });
    const l1 = await live(page), c1 = await cam(page);
    expect(l1.builds).toBe(l0.builds);
    expect(l1.children).toBe(l0.children);
    expect([c1.az, c1.polar, c1.dist, c1.target]).toEqual([c0.az, c0.polar, c0.dist, c0.target]);
    expect(await card(page).locator("css=.fp3-ic").count()).toBe(icons0);
    expect(await page.evaluate(() => (document.getElementById("card")!.shadowRoot!.querySelector("canvas") as unknown as { __mark?: number }).__mark)).toBe(1);
    expect(l1.lifted).toEqual([1]);
  });
});
