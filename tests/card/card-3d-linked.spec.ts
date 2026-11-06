import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, cam, drawn } from "./helpers-3d";

// B53.11: a linked plant and appliance in 3D. Clicks are real page.mouse events at screen positions the view
// itself projects (finding 3); pixels come from the canvas read in the page (tests/helpers/pixels.ts), not from a screenshot.
// The test hook `__fp3d` exists only in dist-test/.

type Pt = { x: number; y: number };
type Piece = { index: number; tag: string; on: boolean; colour: string; emissive: string; visible: boolean; transparent: boolean; opacity: number; depthWrite: boolean; depthFunc: number; renderOrder: number; twin: null | { visible: boolean; colorWrite: boolean; depthWrite: boolean; renderOrder: number } };
type Hook = { live(): { builds: number; pieces: Piece[] }; project(x: number, y: number, z: number): Pt; look(az: number, polar: number): void; carParts(tag: string, shown: boolean): void; pick(x: number, y: number): unknown };
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T09:30:15Z" });
// The Living room is 500 x 400 cm. The piece stands in the middle of it and is the floor's only furniture, index 0.
const layoutOf = (piece: Record<string, unknown>) => {
  const layout = structuredClone(demo);
  layout.floors.ground.furniture = [{ id: "p-1", x: 250, y: 200, rot: 0, w: 60, h: 60, name: "Piece", ...piece }];
  return layout;
};
// Home Connect washer (sensor enum run/ready, door contact) and a Mi Flora style moisture sensor.
const STATES = (o: Record<string, unknown> = {}) => ({
  "sensor.washer": st("ready"), "binary_sensor.washer_door": st("off", { device_class: "door" }), "sensor.fern": st("55", { device_class: "moisture", unit_of_measurement: "%" }), ...o,
});
const DRY = { "sensor.fern": st("9", { device_class: "moisture", unit_of_measurement: "%" }) };
const WASHER = { symbol: "washer", entity: "sensor.washer", attached: ["binary_sensor.washer_door"] };
const FERN = { symbol: "plant", entity: "sensor.fern", minMoisture: 30 };

async function boot(page: Page, layout: unknown, states: Record<string, unknown>) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[]; __info: string[] };
    w.__calls = []; w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d" }, states] as const);
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function setStates(page: Page, states: Record<string, unknown>) {
  const n = (await cam(page)).drawn;
  await page.evaluate((states) => { const el = document.getElementById("card") as unknown as { hass: { callService: unknown } }; el.hass = { ...el.hass, states } as never; }, states);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(n);
  await still(page);
}
const hook = <T>(page: Page, fn: (h: Hook, arg: never) => T, arg?: unknown) => page.evaluate(([src, a]) => (new Function("h", "a", `return (${src})(h, a)`))((window as unknown as { __fp3d: Hook }).__fp3d, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const pieces = (page: Page) => hook(page, (h) => h.live().pieces);
const at = (page: Page, x: number, y: number, z: number) => hook(page, (h, p) => h.project((p as number[])[0], (p as number[])[1], (p as number[])[2]), [x, y, z]);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
/** The colour a CSS expression resolves to on the card (what the view's own palette reads). */
const cssHex = (page: Page, css: string) => card(page).evaluate((host, css) => {
  const p = document.createElement("span"); p.style.color = css; host.shadowRoot!.appendChild(p);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(p).color)!; p.remove();
  return `#${[1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join("")}`;
}, css);

const handOver = (page: Page, states: Record<string, unknown>) => page.evaluate((states) => { const el = document.getElementById("card") as unknown as { hass: { callService: unknown } }; el.hass = { ...el.hass, states } as never; }, states);
const bodyOf = async (page: Page) => (await pieces(page)).filter((p) => p.index === 0)[0];

test.describe("3D view: a thirsty plant", () => {
  test("keeps its green and breathes the water blue; with water it is black again, and still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await boot(page, layoutOf(FERN), STATES());
    const rest = await bodyOf(page);
    expect(rest.emissive).toBe("#000000");
    await handOver(page, STATES(DRY));
    const water = await cssHex(page, "var(--fp-plant-thirsty)");
    await expect.poll(async () => (await bodyOf(page)).emissive, { timeout: 5000 }).not.toBe("#000000");
    const seen: string[] = [];
    for (let i = 0; i < 14; i++) { seen.push((await bodyOf(page)).emissive); await page.waitForTimeout(200); }
    expect(new Set(seen).size, "it breathes").toBeGreaterThan(4);
    const blueish = (h: string) => parseInt(h.slice(5, 7), 16) >= parseInt(h.slice(1, 3), 16);
    for (const s of seen) expect(blueish(s), `${s} leans blue like ${water}`).toBe(true);
    expect((await bodyOf(page)).colour, "the plant keeps its own colour").toBe(rest.colour);
    await handOver(page, STATES());
    await expect.poll(async () => (await bodyOf(page)).emissive, { timeout: 5000 }).toBe("#000000");
    await still(page);
  });
  test("under reduced motion the glow is held still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, layoutOf(FERN), STATES());
    await setStates(page, STATES(DRY));
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) { seen.push((await bodyOf(page)).emissive); await page.waitForTimeout(300); }
    expect(seen[0]).not.toBe("#000000");
    expect(new Set(seen).size).toBe(1);
  });
});

test.describe("3D view: a linked appliance", () => {
  test("running takes the on colour", async ({ page }) => {
    await boot(page, layoutOf(WASHER), STATES());
    const rest = (await bodyOf(page)).colour;
    await setStates(page, STATES({ "sensor.washer": st("run") }));
    expect((await bodyOf(page)).colour).toBe(await cssHex(page, "var(--fp-active)"));
    await setStates(page, STATES());
    expect((await bodyOf(page)).colour).toBe(rest);
  });
  test("a fridge door open takes the open-door colour; a washer door left ajar does not", async ({ page }) => {
    await boot(page, layoutOf({ ...WASHER, symbol: "fridge" }), STATES());
    const rest = (await bodyOf(page)).colour;
    await setStates(page, STATES({ "binary_sensor.washer_door": st("on", { device_class: "door" }) }));
    expect((await bodyOf(page)).colour).toBe(await cssHex(page, "var(--fp-open-door)"));
    await setStates(page, STATES());
    expect((await bodyOf(page)).colour).toBe(rest);
    await boot(page, layoutOf(WASHER), STATES({ "binary_sensor.washer_door": st("on", { device_class: "door" }) }));
    expect((await bodyOf(page)).colour).not.toBe(await cssHex(page, "var(--fp-open-door)"));
  });
  test("a real tap on it opens the card's popup with its status", async ({ page }) => {
    await boot(page, layoutOf(WASHER), STATES({ "sensor.washer": st("run") }));
    const p = await at(page, 250, 200, 40);
    await page.mouse.click(p.x, p.y);
    const pop = card(page).locator("css=.fp-pop");
    await expect(pop).toBeVisible();
    await expect(pop.locator("css=.fp-pop-state")).toHaveText("Running");
    expect(await calls(page)).toEqual([]);
    expect(await infos(page)).toEqual([]);
  });
});

test.describe("3D view: a robot vacuum", () => {
  const ROBOT = { symbol: "robot-vacuum", entity: "vacuum.robo", w: 35, h: 35 };
  test("out cleaning it is drawn faded like an away car; docked it is opaque again", async ({ page }) => {
    await boot(page, layoutOf(ROBOT), STATES({ "vacuum.robo": st("docked") }));
    const parts = async () => (await pieces(page)).filter((p) => p.index === 0);
    expect((await parts()).length).toBeGreaterThan(0);
    for (const p of await parts()) { expect(p.transparent).toBe(false); expect(p.opacity).toBe(1); }
    await setStates(page, STATES({ "vacuum.robo": st("cleaning") }));
    for (const p of await parts()) { expect(p.transparent).toBe(true); expect(p.opacity).toBeCloseTo(0.35, 2); expect(p.depthWrite).toBe(false); }
    await setStates(page, STATES({ "vacuum.robo": st("docked") }));
    for (const p of await parts()) { expect(p.transparent).toBe(false); expect(p.opacity).toBe(1); }
  });
});
