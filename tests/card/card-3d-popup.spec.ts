import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, holder, canvas, drawn } from "./helpers-3d";

// S14.2 in the 3D view: a tap on a device opens the popup and operates nothing, its button makes the one call, OFF asks
// first except for a light, and a mouse hover over a device names it. Every move and click is a real page.mouse event at
// the screen position of a solid, asked of the view's test hook (`__fp3d`, built only into dist-test/), and the view itself
// is asked what it finds there first (CLAUDE.md finding 3). Demo ground floor: device 0 is the living light, 3 the TV plug,
// 6 the camera.

type Where = { x: number; y: number };
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = {
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["brightness"], brightness: 128 }),
  "light.demo_kitchen": st("on"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"), "camera.demo_hall": st("idle"),
};

async function boot(page: Page) {
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
    // callService(domain, service, data), as Home Assistant's hass has it
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", view: "3d" }, STATES] as const);
  await drawn(page);
  await settled(page);
}
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
const where = (page: Page, kind: string, index: number) => page.evaluate(([k, i]) => (window as unknown as { __fp3d: { where(k: string, i: number): Where | null } }).__fp3d.where(k as string, i as number), [kind, index] as const);
const picks = (page: Page, p: Where) => page.evaluate((p) => (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y), p);
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const tip = (page: Page) => card(page).locator("css=.fp-tip");

/** The screen position of device `i`, after checking the view reports that device there. */
async function device(page: Page, i: number) {
  await page.waitForTimeout(400); // two taps within 350 ms and 24 px are a double tap, by design: keep clear of the last one
  await settled(page);
  const p = (await where(page, "device", i))!;
  expect(await picks(page, p), `what the view finds at ${Math.round(p.x)},${Math.round(p.y)}`).toEqual({ type: "device", index: i });
  return p;
}

test.describe("3D popup", () => {
  test("a real tap on a light opens its popup and calls nothing; the button makes exactly one call, with no confirm for a light", async ({ page }) => {
    await boot(page);
    const p = await device(page, 0);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page)).toHaveAttribute("role", "dialog");
    await expect(pop(page)).toHaveAttribute("aria-label", "Living light");
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("50 %");
    expect(await calls(page)).toEqual([]);
    expect(await infos(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(["light.turn_off light.demo_living"]);
  });

  test("a plug's OFF asks first in 3D too", async ({ page }) => {
    await boot(page);
    // From the default camera the TV plug sits behind the 110 cm wall between Hall and Living: its icon is hidden there (overlay.ts,
    // `blocked`) and a pick at that spot correctly meets the wall. Steeper from above the icon is drawn, and it is what is tapped.
    await page.evaluate(() => (window as unknown as { __fp3d: { look(az: number, polar: number): void } }).__fp3d.look(0, 0.5));
    const p = await device(page, 3);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
    await pop(page).locator("css=.fp-pop-do").click();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Confirm turn off");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(["switch.turn_off switch.demo_tv_plug"]);
  });

  test("a camera has More info only", async ({ page }) => {
    await boot(page);
    const p = await device(page, 6);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveCount(0);
    await pop(page).locator("css=.fp-pop-more").click();
    expect(await infos(page)).toEqual(["camera.demo_hall"]);
    expect(await calls(page)).toEqual([]);
  });

  test("a hold opens more-info and no popup; Escape closes a popup; a tap on the empty background closes it; a second tap on the icon closes it", async ({ page }) => {
    await boot(page);
    const p = await device(page, 0);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    expect(await infos(page)).toEqual(["light.demo_living"]);
    await expect(pop(page)).toHaveCount(0);

    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);

    await page.waitForTimeout(400);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    const b = (await canvas(page).boundingBox())!;
    await page.mouse.click(b.x + b.width - 12, b.y + b.height - 12);
    await expect(pop(page)).toHaveCount(0);

    await page.waitForTimeout(400);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    await page.waitForTimeout(400);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("the popup stays inside the card", async ({ page }) => {
    await boot(page);
    const p = await device(page, 6);
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    const c = (await card(page).boundingBox())!, b = (await pop(page).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.y).toBeGreaterThanOrEqual(c.y);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height + 0.5);
  });
});

test.describe("3D hover tooltip", () => {
  test("a mouse over a device shows its name and state; off it, or a press and drag, hides it", async ({ page }) => {
    await boot(page);
    await expect(tip(page)).toBeHidden();
    const p = await device(page, 0);
    await page.mouse.move(p.x + 60, p.y + 60);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText("Living light");
    await expect(tip(page)).toContainText("50 %");
    const b = (await canvas(page).boundingBox())!;
    await page.mouse.move(b.x + b.width - 12, b.y + b.height - 12, { steps: 4 });
    await expect(tip(page)).toBeHidden();

    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 30, { steps: 4 });
    await expect(tip(page)).toBeHidden();
    await page.mouse.up();
    expect(await calls(page)).toEqual([]);
  });
});
