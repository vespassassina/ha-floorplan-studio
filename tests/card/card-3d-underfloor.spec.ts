import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, cam, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";

// B54.4, spec D27, criterion 6: in 3D the floor of a room warmed from below is multiplied toward --fp-floor-heat, on the path that warms a lit room's
// floor. Pixels come from the canvas itself. Demo ground floor: Living is room 0 (0..500 x 0..400), Kitchen room 1 (500..800 x 0..400); the heater
// bar `heater-living` (a 100,8 to 260,8) reads climate.demo_living, so it stands in Living. State shape: HA's climate entity, `hvac_action` as classOf reads it.
type Where = { x: number; y: number };
const iso = (agoS = 0) => new Date(Date.now() - agoS * 1000).toISOString();
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: iso(600) });
const QUIET = (action = "idle") => ({
  "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("off"),
  "sensor.demo_living_temperature": st("21", { unit_of_measurement: "°C" }), "binary_sensor.demo_hall_motion": st("off"), "climate.demo_living": st("heat", { hvac_action: action }),
  "binary_sensor.demo_front_door": st("off"), "binary_sensor.demo_patio_door": st("off"),
});
const flagged = (on: boolean) => {
  const l = structuredClone(demo);
  if (on) l.floors.ground.devices.find((d: { id: string }) => d.id === "heater-living").underfloor = true;
  return l;
};

async function boot(page: Page, layout: unknown, states: Record<string, unknown>) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => {} };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", theme: "light", active_list: false }, states] as const);
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
const live = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { live(): { heated: number[] } } }).__fp3d.live());
const at = (page: Page, x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): Where } }).__fp3d.project(x, y, z), [x, y, z] as const);
async function mean(page: Page, p: Where, half = 10): Promise<[number, number, number]> {
  return meanRgb((await readCanvasRect(page, { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half })).data);
}
const warmth = (c: number[]) => c[0] / c[2];

test("a flagged heater that is heating warms its room's floor; idle puts it back; the neighbour never moves", async ({ page }) => {
  await boot(page, flagged(true), QUIET());
  const living = await at(page, 100, 100, 1), kitchen = await at(page, 720, 60, 1);
  const before = { living: await mean(page, living), kitchen: await mean(page, kitchen) };
  expect((await live(page)).heated).toEqual([]);
  await setStates(page, QUIET("heating"));
  const after = { living: await mean(page, living), kitchen: await mean(page, kitchen) };
  expect((await live(page)).heated).toEqual([0]);
  // redder, by an asymmetric margin the lamp's lift (which also lifts blue) would not give; blue falls
  expect(warmth(after.living)).toBeGreaterThan(warmth(before.living) * 1.08);
  expect(after.living[2]).toBeLessThan(before.living[2] - 8);
  for (let k = 0; k < 3; k++) expect(Math.abs(after.kitchen[k] - before.kitchen[k]), `kitchen channel ${k}`).toBeLessThanOrEqual(1.5);
  await setStates(page, QUIET("idle"));
  const off = await mean(page, living);
  for (let k = 0; k < 3; k++) expect(Math.abs(off[k] - before.living[k]), `living channel ${k} back`).toBeLessThanOrEqual(1.5);
  expect((await live(page)).heated).toEqual([]);
});

test("the same heating without the flag changes nothing", async ({ page }) => {
  await boot(page, flagged(false), QUIET());
  const living = await at(page, 100, 100, 1);
  const before = await mean(page, living);
  await setStates(page, QUIET("heating"));
  const after = await mean(page, living);
  expect((await live(page)).heated).toEqual([]);
  for (let k = 0; k < 3; k++) expect(Math.abs(after[k] - before[k]), `channel ${k}`).toBeLessThanOrEqual(1.5);
});
