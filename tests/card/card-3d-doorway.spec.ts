import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, cam, drawn } from "./helpers-3d";

// S14.5 item 9: an open doorway (door.kind "open") has no leaf, so in 3D its live state is a thin alert-coloured slab in the gap,
// driven by the door's sensors. Closed: nothing shows. Real card, real pointer, the scene's own state from `__fp3d.live()` (test build only).
// Ground floor of the demo, an `open` door at x 100..200 in the north wall (nothing else sits there); the demo's Front door is door 0.

const SENSOR = "binary_sensor.hall_arch", VIBE = "binary_sensor.hall_arch_vibration", FRONT = "binary_sensor.demo_front_door";
const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string) => ({ state, attributes: {}, last_changed: iso(5) });
const QUIET = () => ({ [SENSOR]: st("off"), [VIBE]: st("off"), [FRONT]: st("off") });
const ARCH = 4; // the doorway's index in the ground floor's doors (the demo has four, the last a full-height window)
interface Live { builds: number; doors: { index: number; tag: string; visible: boolean; rot: number; colour: string }[] }
const live = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { live(): unknown } }).__fp3d.live()) as Promise<Live>;
const band = async (page: Page) => (await live(page)).doors.find((d) => d.index === ARCH && d.tag === "band")!;

async function boot(page: Page, states: Record<string, unknown> = QUIET(), config: Record<string, unknown> = {}) {
  const layout = structuredClone(demo);
  layout.floors.ground.doors.push({ id: "arch", name: "Hall arch", kind: "open", a: [100, 0], b: [200, 0], sensors: [SENSOR], vibration: [VIBE] });
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[]; __info: string[] };
    w.__calls = []; w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", active_list: false, walls: "full", ...config }, states] as const);
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
const at = (page: Page, x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): { x: number; y: number } } }).__fp3d.project(x, y, z), [x, y, z] as const);
const picks = (page: Page, p: { x: number; y: number }) => page.evaluate((p) => (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y), p);
async function mean(page: Page, p: { x: number; y: number }, half = 4): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    return [r / n, gr / n, b / n] as [number, number, number];
  }, buf.toString("base64"));
}

test.describe("3D view: the open doorway's alert band", () => {
  test("closed it is hidden; a contact, a vibration or the other way round shows it; the scene is not rebuilt", async ({ page }) => {
    await boot(page);
    const builds = (await live(page)).builds;
    expect(await band(page)).toMatchObject({ visible: false });
    await setStates(page, { ...QUIET(), [SENSOR]: st("on") });
    expect(await band(page)).toMatchObject({ visible: true });
    await setStates(page, QUIET());
    expect(await band(page)).toMatchObject({ visible: false });
    await setStates(page, { ...QUIET(), [VIBE]: st("on") });
    expect(await band(page)).toMatchObject({ visible: true });
    await setStates(page, { ...QUIET(), [SENSOR]: st("unavailable") });
    expect(await band(page)).toMatchObject({ visible: false }); // a dead sensor never paints an opening
    expect((await live(page)).builds).toBe(builds);
  });

  test("it is the alert colour, the same as an open plain door's leaf, and it never swings", async ({ page }) => {
    await boot(page);
    await setStates(page, { ...QUIET(), [SENSOR]: st("on"), [FRONT]: st("on") });
    const leaf = (await live(page)).doors.find((d) => d.index === 0 && d.tag === "door-leaf")!;
    const b = await band(page);
    expect(b.colour).toBe(leaf.colour);
    expect(b.rot).toBe(0);
    expect(leaf.rot).not.toBe(0);
  });

  test("the pixels: the gap, seen from inside, turns red when tripped and is back to the room behind when closed", async ({ page }) => {
    await boot(page);
    const p = await at(page, 150, 0, 100);
    const rgb = async () => mean(page, p);
    const before = await rgb();
    await setStates(page, { ...QUIET(), [SENSOR]: st("on") });
    const on = await rgb();
    expect(on[0] - on[2], "redder than blue").toBeGreaterThan(before[0] - before[2] + 25);
    await setStates(page, QUIET());
    const after = await rgb();
    for (let k = 0; k < 3; k++) expect(Math.abs(after[k] - before[k]), `channel ${k} back to closed`).toBeLessThanOrEqual(2);
  });

  test("a tap on the band is a tap on that door: the view finds the door, its popup names it, and More info lists both its entities in the chooser", async ({ page }) => {
    await boot(page, { ...QUIET(), [SENSOR]: st("on") });
    const p = await at(page, 150, 0, 100);
    expect(await picks(page, p)).toEqual({ type: "door", index: ARCH });
    await page.mouse.click(p.x, p.y);
    // S14.2: a tap opens the popup and operates nothing. The arch names a contact and a vibration sensor: two entities, so its
    // More info opens the chooser (actions.ts `moreInfoOf`), as on any door.
    const pop = page.locator("css=floorplan-studio-card").locator("css=.fp-pop");
    await expect(pop).toHaveAttribute("aria-label", "Hall arch");
    await pop.locator("css=.fp-pop-more").click();
    const dlg = page.locator("css=floorplan-studio-card").locator("css=.fp-chooser-dialog");
    await expect(dlg.locator("css=p")).toHaveText("Hall arch");
    await expect(dlg.locator("css=.fp-chooser-list button")).toHaveCount(2);
  });

  test("with low walls the band is cut to the low height with its wall: red at 100 cm, not at 160; full walls are red at both", async ({ page }) => {
    const redness = async (z: number) => { const c = await mean(page, await at(page, 150, 0, z)); return c[0] - c[2]; };
    await boot(page, { ...QUIET(), [SENSOR]: st("on") }, { walls: "full" });
    const full = [await redness(100), await redness(160)];
    await boot(page, { ...QUIET(), [SENSOR]: st("on") }, { walls: "low" });
    const low = [await redness(100), await redness(160)];
    expect(full[0]).toBeGreaterThan(40);
    expect(full[1]).toBeGreaterThan(40);
    expect(low[0]).toBeGreaterThan(40);
    expect(low[1]).toBeLessThan(low[0] - 30);
  });
});

// S28.10: a door and a window stand in a frame. The frame is trim, 5 cm wide and 2 cm proud of the wall, and a tap on it is a tap on the door.
// The demo's Front door is door 0: x 300..390 in the south wall (20 thick), so its left jamb stands at x 295..300 and reaches y 612.
test.describe("3D view: framed openings", () => {
  test("a tap on the door's frame finds that door and opens its popup", async ({ page }) => {
    await boot(page);
    const p = await at(page, 297.5, 612, 100);
    expect(await picks(page, p)).toEqual({ type: "door", index: 0 });
    await page.mouse.click(p.x, p.y);
    await expect(page.locator("css=floorplan-studio-card").locator("css=.fp-pop")).toHaveAttribute("aria-label", "Front door");
  });

  test("a closed door's leaf is quiet, an open one is the alert colour; the frame keeps its own colour either way", async ({ page }) => {
    await boot(page);
    const closed = (await live(page)).doors.find((d) => d.index === 0 && d.tag === "door-leaf")!;
    await setStates(page, { ...QUIET(), [FRONT]: st("on") });
    const open = (await live(page)).doors.find((d) => d.index === 0 && d.tag === "door-leaf")!;
    expect(closed.colour).not.toBe(open.colour);
    const rgb = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    const dist = rgb(open.colour).reduce((a, v, k) => a + Math.abs(v - rgb(closed.colour)[k]), 0);
    expect(dist, "the open leaf is far from the quiet one").toBeGreaterThan(60);
  });

  test("the pixels: beside the gap the jamb is the frame colour, not the wall's", async ({ page }) => {
    await boot(page);
    const jamb = await mean(page, await at(page, 297.5, 612, 100), 2), wall = await mean(page, await at(page, 250, 612, 100), 2);
    expect(Math.abs(jamb[0] - wall[0]) + Math.abs(jamb[1] - wall[1]) + Math.abs(jamb[2] - wall[2]), "the jamb differs from the wall beside it").toBeGreaterThan(18);
  });
});
