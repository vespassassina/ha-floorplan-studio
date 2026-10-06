import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, holder, canvas, cam, drawn } from "./helpers-3d";

// S12.4 (spec G, criteria 4, 5 and 10): taps in the 3D view mean what they mean on the plan. Every click is a real
// page.mouse event at the screen position of something in the model, asked of the view's test hook (`__fp3d`, built only into dist-test/), because a test that dispatched events on an element would pass while the real
// click on the canvas was broken (CLAUDE.md finding 3). Demo ground floor: Living is room 0, Kitchen 1, Hall 2; device 0
// is the living light, 4 the living temperature sensor (no toggle), 7 the heater.

type Where = { x: number; y: number };
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-04T09:30:15Z" });
const STATES = { "light.demo_living": st("on"), "light.demo_kitchen": st("on"), "sensor.demo_living_temperature": st("21"), "climate.demo_living": st("heat"), "switch.demo_hall": st("off") };

async function boot(page: Page, config: Record<string, unknown> = {}) {
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
    // callService(domain, service, data), as Home Assistant's hass has it (toggleEntity in src/card/actions.ts is the caller)
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", view: "3d", ...config }, STATES] as const);
  await drawn(page);
  await settled(page);
}
/** The Active list moves the framing when it opens, grows or shrinks (a room pick widens it): wait until the camera has stopped moving. */
async function settled(page: Page) {
  let prev = "";
  await expect.poll(async () => {
    const v = ["inset", "az", "polar", "dist", "target", "lowered"].map((k) => holder(page).getAttribute(`data-${k}`));
    const now = (await Promise.all(v)).join("|"), same = now === prev;
    prev = now;
    return same;
  }, { intervals: [250], timeout: 10000 }).toBe(true);
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const ring = (page: Page) => holder(page).getAttribute("data-ring");
/** The screen position of a solid's top (kind and index) or of a plan point (x, y, z in cm), from the page's own camera. */
const where = (page: Page, kind: string, index: number) => page.evaluate(([k, i]) => (window as unknown as { __fp3d: { where(k: string, i: number): Where | null } }).__fp3d.where(k as string, i as number), [kind, index] as const);
const at = (page: Page, x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): Where } }).__fp3d.project(x, y, z), [x, y, z] as const);
const picks = (page: Page, p: Where) => page.evaluate((p) => (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y), p);
const panel = (page: Page) => card(page).locator("css=.fp-active");

/** A click at `p`, after checking the view itself reports `want` there: a wrong spot fails here, not as a mystery later. */
async function click(page: Page, locate: () => Promise<Where | null>, want: unknown) {
  await page.waitForTimeout(400); // two taps within 350 ms and 24 px are a double tap, by design (as in 2D): keep clear of the last one
  await settled(page);
  const p = (await locate())!;
  expect(await picks(page, p), `what the view finds at ${Math.round(p.x)},${Math.round(p.y)}`).toEqual(want);
  await page.mouse.click(p.x, p.y);
}

test.describe("3D view: taps on devices", () => {
  test("a tap on a light toggles that entity and opens nothing else", async ({ page }) => {
    await boot(page);
    await click(page, () => where(page, "device", 0), { type: "device", index: 0 });
    await expect.poll(() => calls(page)).toEqual(["light.toggle light.demo_living"]);
    expect(await infos(page)).toEqual([]);
    expect(await ring(page)).toBe(""); // a device never picks a room
  });

  test("a hold on a light opens its more-info and does not toggle", async ({ page }) => {
    await boot(page);
    const p = (await where(page, "device", 0))!;
    expect(await picks(page, p)).toEqual({ type: "device", index: 0 });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(650); // the hold time is 500 ms (actions.ts HOLD_MS)
    await page.mouse.up();
    await expect.poll(() => infos(page)).toEqual(["light.demo_living"]);
    expect(await calls(page)).toEqual([]);
  });

  test("a tap on a camera opens its more-info and never toggles (a NO_TOGGLE type, finding 20)", async ({ page }) => {
    await boot(page);
    await click(page, () => where(page, "device", 6), { type: "device", index: 6 });
    await expect.poll(() => infos(page)).toEqual(["camera.demo_hall"]);
    expect(await calls(page)).toEqual([]);
  });

  test("the hit proxy is bigger than the ball: a click a little beside it still hits the device, one far from it hits the floor", async ({ page }) => {
    await boot(page);
    const p = (await where(page, "device", 0))!;
    expect(await picks(page, { x: p.x + 14, y: p.y })).toEqual({ type: "device", index: 0 });
    // the same light, far from the ball: the room under the ray
    expect(await picks(page, { x: p.x + 160, y: p.y })).not.toEqual({ type: "device", index: 0 });
  });
});

test.describe("3D view: taps on rooms", () => {
  test("a tap on a room floor picks it: its ring, its name in the panel; the same room again clears; Escape clears; off the house clears", async ({ page }) => {
    await boot(page);
    await click(page, () => at(page, 60, 60, 1), { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("0");
    await expect(panel(page)).toHaveAttribute("aria-label", "Living");
    // the room section widens the list, which moves the framing a little: find the spot again
    await expect.poll(async () => (await holder(page).getAttribute("data-inset"))).toMatch(/^0\.[3-9]/);
    await click(page, () => at(page, 60, 60, 1), { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("");
    await expect(panel(page)).toHaveAttribute("aria-label", "Active devices");
    // Kitchen, then Escape
    await click(page, () => at(page, 700, 60, 1), { type: "room", index: 1 });
    await expect.poll(() => ring(page)).toBe("1");
    await page.keyboard.press("Escape");
    await expect.poll(() => ring(page)).toBe("");
    // Kitchen again, then a tap on the empty background
    await click(page, () => at(page, 700, 60, 1), { type: "room", index: 1 });
    await expect.poll(() => ring(page)).toBe("1");
    const b = (await canvas(page).boundingBox())!;
    await page.mouse.click(b.x + b.width - 12, b.y + b.height - 12);
    await expect.poll(() => ring(page)).toBe("");
  });

  test("furniture counts as its room's floor", async ({ page }) => {
    await boot(page);
    await click(page, () => where(page, "furniture", 0), { type: "room", index: 0 }); // the sofa stands in Living
    await expect.poll(() => ring(page)).toBe("0");
  });

  test("a lowered wall is looked over: a tap on the floor behind the front wall picks that room; with full walls it is the wall, which clears", async ({ page }) => {
    await boot(page);
    await click(page, () => at(page, 150, 450, 1), { type: "room", index: 2 }); // the Hall, 150 cm inside its south wall (S14.5: the low wall is 110 cm, so a nearer point is hidden), from a camera in the south
    await expect.poll(() => ring(page)).toBe("2");
    await expect.poll(async () => (await holder(page).getAttribute("data-inset"))).toMatch(/^0\.[3-9]/); // the room section widened the list
    await card(page).locator('css=select[aria-label="Walls"]').selectOption("full");
    await expect.poll(async () => (await holder(page).getAttribute("data-lowered"))).toBe("");
    await click(page, () => at(page, 150, 450, 1), { type: "other" }); // the wall in front of it now
    await expect.poll(() => ring(page)).toBe("");
  });

  test("a tap on a standing far wall is nothing, and clears the pick (as a tap on a wall does on the plan)", async ({ page }) => {
    await boot(page);
    await click(page, () => at(page, 60, 60, 1), { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("0");
    await click(page, () => at(page, 250, 10, 120), { type: "other" }); // the north wall's inner face, in full height
    await expect.poll(() => ring(page)).toBe("");
  });

  test("a double tap leaves the pick as it was; the wheel neither picks nor clears", async ({ page }) => {
    await boot(page);
    const p = await at(page, 60, 60, 1);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(100);
    expect(await ring(page)).toBe(""); // nothing was picked before: still nothing
    await click(page, async () => p, { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("0");
    await page.waitForTimeout(450); // past the double-tap window
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await cam(page)).dist).toBeLessThan(10000);
    expect(await ring(page)).toBe("0");
    await page.mouse.dblclick(p.x + 2, p.y + 2); // the second tap's pair: back to the pick as it was before them
    await page.waitForTimeout(100);
    expect(await ring(page)).toBe("0");
  });

  test("a drag of 30 px is never a tap: it turns the camera and leaves the pick alone, picked or not", async ({ page }) => {
    await boot(page);
    const p = await at(page, 60, 60, 1), c0 = await cam(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30, p.y, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await cam(page)).az).not.toBeCloseTo(c0.az, 3);
    expect(await ring(page)).toBe(""); // nothing picked by the drag
    expect(await holder(page).getAttribute("data-dragged")).toBe("true");
    await click(page, () => at(page, 60, 60, 1), { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("0");
    const q = await at(page, 700, 60, 1); // a drag that starts on another room does not clear or move the pick
    await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 30, q.y + 8, { steps: 6 }); await page.mouse.up();
    expect(await ring(page)).toBe("0");
  });

  test("the pick survives a Home Assistant state update, and the camera stays where the user put it", async ({ page }) => {
    await boot(page);
    const b = (await canvas(page).boundingBox())!;
    await page.mouse.move(b.x + 300, b.y + 300); await page.mouse.down(); await page.mouse.move(b.x + 360, b.y + 300, { steps: 6 }); await page.mouse.up();
    await click(page, () => at(page, 60, 60, 1), { type: "room", index: 0 });
    await expect.poll(() => ring(page)).toBe("0");
    const before = await cam(page);
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: { states: Record<string, unknown> } };
      el.hass = { ...el.hass, states: { ...el.hass.states, "light.demo_living": { state: "off", attributes: {}, last_changed: "2026-10-05T09:30:15Z" } } };
    });
    await page.waitForTimeout(150);
    expect(await ring(page)).toBe("0");
    await expect(panel(page)).toHaveAttribute("aria-label", "Living");
    const after = await cam(page);
    expect(after.az).toBeCloseTo(before.az, 6);
    expect(after.dist).toBeCloseTo(before.dist, 3);
  });
});

test.describe("3D view: 5000 furniture pieces (spec criterion 10)", () => {
  test("it draws, and a tap on a piece picks its room in well under a second", async ({ page }) => {
    const bad = structuredClone(demo);
    bad.floors.ground.furniture = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: 10 + (i % 100) * 7, y: 10 + Math.floor(i / 100) * 7, rot: i % 360, w: 6, h: 6 }));
    await boot(page, { layout: bad });
    const p = (await where(page, "furniture", 4999))!;
    const timed = await page.evaluate((p) => { const t = performance.now(); (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y); return performance.now() - t; }, p);
    expect(timed).toBeLessThan(500);
    const t0 = Date.now();
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => ring(page), { timeout: 1000 }).not.toBe("");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
