import { test, expect, type Page } from "@playwright/test";
import { demo, open, canvas, cam, drawn, holder } from "./helpers-3d";

// 3D fixes: panning. Middle button drag pans; Space held plus a left drag pans; the right button, Shift and two fingers still do;
// a plain left drag rotates. Real page.mouse and page.keyboard at real coordinates (CLAUDE.md finding 3); the camera is read
// from the view's own data attributes (target is "x,z" in cm).

interface Spot { cx: number; cy: number }
async function boot(page: Page): Promise<Spot> {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" }); // the Active list is on: a room pick needs it
  await drawn(page);
  let prev = ""; // the list's inset moves the framing when it opens: wait until the camera has stopped
  await expect.poll(async () => { const c = await cam(page), now = JSON.stringify(c); const same = now === prev; prev = now; return same; }, { intervals: [250], timeout: 10000 }).toBe(true);
  const b = (await canvas(page).boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
const target = async (page: Page) => (await cam(page)).target.split(",").map(Number) as [number, number];
const moved = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ring = (page: Page) => holder(page).getAttribute("data-ring");

/** A drag from the middle of the view: down, move, up. */
async function drag(page: Page, s: Spot, button: "left" | "middle" | "right" = "left", dx = 120, dy = 50) {
  await page.mouse.move(s.cx, s.cy);
  await page.mouse.down({ button });
  await page.mouse.move(s.cx + dx, s.cy + dy, { steps: 8 });
  await page.mouse.up({ button });
}
/** Lets the frame a gesture asked for be drawn (two animation frames), so the data attributes are the new camera. */
async function settle(page: Page) { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }

test.describe("3D view: panning (3D fixes)", () => {
  test("a plain left drag rotates and leaves the target alone", async ({ page }) => {
    const s = await boot(page);
    const c0 = await cam(page), t0 = await target(page);
    await drag(page, s);
    await settle(page);
    const c1 = await cam(page);
    expect(c1.az).not.toBeCloseTo(c0.az, 2);
    expect(c1.polar).not.toBeCloseTo(c0.polar, 2);
    expect(moved(await target(page), t0)).toBeLessThan(0.05);
  });

  test("a middle button drag pans: the target moves, the angle and distance do not", async ({ page }) => {
    const s = await boot(page);
    const c0 = await cam(page), t0 = await target(page);
    await drag(page, s, "middle");
    await settle(page);
    const c1 = await cam(page);
    expect(moved(await target(page), t0)).toBeGreaterThan(20);
    expect(c1.az).toBeCloseTo(c0.az, 4);
    expect(c1.polar).toBeCloseTo(c0.polar, 4);
    expect(c1.dist).toBeCloseTo(c0.dist, 1);
    expect(await holder(page).getAttribute("data-dragged")).toBe("true");
  });

  test("Space held and a left drag pans; the drag without Space rotates again once Space is up", async ({ page }) => {
    const s = await boot(page);
    const c0 = await cam(page), t0 = await target(page);
    await page.mouse.move(s.cx, s.cy);
    await page.keyboard.down("Space");
    await drag(page, s);
    await page.keyboard.up("Space");
    await settle(page);
    const c1 = await cam(page), t1 = await target(page);
    expect(moved(t1, t0)).toBeGreaterThan(20);
    expect(c1.az).toBeCloseTo(c0.az, 4);
    expect(c1.polar).toBeCloseTo(c0.polar, 4);
    await drag(page, s, "left", -90, 0); // Space is up: a rotation, target still
    await settle(page);
    expect((await cam(page)).az).not.toBeCloseTo(c1.az, 2);
    expect(moved(await target(page), t1)).toBeLessThan(0.05);
  });

  test("the right button and Shift still pan", async ({ page }) => {
    const s = await boot(page);
    const t0 = await target(page);
    await drag(page, s, "right");
    await settle(page);
    const t1 = await target(page);
    expect(moved(t1, t0)).toBeGreaterThan(20);
    await page.keyboard.down("Shift");
    await drag(page, s, "left", -100, -40);
    await page.keyboard.up("Shift");
    await settle(page);
    expect(moved(await target(page), t1)).toBeGreaterThan(20);
  });

  test("Space counts only while the pointer is over the view: pressed elsewhere, a drag still rotates; Space over the view is not left to scroll the page", async ({ page }) => {
    const s = await boot(page);
    // a listener after the card's own, on the window: what the page would do with the key, once the card has seen it
    await page.evaluate(() => { const w = window as unknown as { __space: boolean[] }; w.__space = []; window.addEventListener("keydown", (e) => { if (e.code === "Space") w.__space.push(e.defaultPrevented); }); });
    const c0 = await cam(page), t0 = await target(page);
    await page.mouse.move(2, 2); // over the page, off the canvas
    await page.keyboard.down("Space");
    await page.mouse.move(s.cx, s.cy);
    await page.mouse.down();
    await page.mouse.move(s.cx + 120, s.cy + 50, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await settle(page);
    expect((await cam(page)).az).not.toBeCloseTo(c0.az, 2); // rotated
    expect(moved(await target(page), t0)).toBeLessThan(0.05);
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    // the first press was off the view and left to the page; the second was over it and taken
    expect(await page.evaluate(() => (window as unknown as { __space: boolean[] }).__space)).toEqual([false, true]);
  });

  test("losing the window's focus ends Space pan mode; so does the key coming up", async ({ page }) => {
    const s = await boot(page);
    const t0 = await target(page), c0 = await cam(page);
    await page.mouse.move(s.cx, s.cy);
    await page.keyboard.down("Space");
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); // the tab lost focus while the key was down
    await drag(page, s);
    await settle(page);
    await page.keyboard.up("Space");
    expect((await cam(page)).az).not.toBeCloseTo(c0.az, 2); // a rotation, not a pan
    expect(moved(await target(page), t0)).toBeLessThan(0.05);
  });

  test("the middle button does not start the browser's autoscroll, and its click is not let through", async ({ page }) => {
    const s = await boot(page);
    await page.evaluate(() => {
      const w = window as unknown as { __mid: Record<string, boolean[]> };
      w.__mid = { pointerdown: [], auxclick: [] };
      for (const t of ["pointerdown", "auxclick"]) window.addEventListener(t, (e) => { if ((e as MouseEvent).button === 1) w.__mid[t].push(e.defaultPrevented); });
    });
    await page.mouse.move(s.cx, s.cy);
    await page.mouse.click(s.cx, s.cy, { button: "middle" });
    expect(await page.evaluate(() => (window as unknown as { __mid: unknown }).__mid)).toEqual({ pointerdown: [true], auxclick: [true] });
  });

  test("a pan is not a tap: a middle drag or a Space drag that starts on a room picks nothing, and a middle click picks nothing", async ({ page }) => {
    const s = await boot(page);
    const bed = await page.evaluate(`window.__fp3d.project(60, 60, 1)`) as { x: number; y: number };
    await page.mouse.move(bed.x, bed.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(bed.x + 70, bed.y + 30, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    expect(await ring(page)).toBe("");
    await page.mouse.click(bed.x, bed.y, { button: "middle" });
    expect(await ring(page)).toBe("");
    await page.mouse.move(bed.x, bed.y);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(bed.x + 70, bed.y + 30, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(await ring(page)).toBe("");
    expect(s.cx).toBeGreaterThan(0);
    // control: a real tap on the same spot does pick the room (after the double-tap window of the last gesture)
    await page.waitForTimeout(400);
    const here = await page.evaluate(`window.__fp3d.project(60, 60, 1)`) as { x: number; y: number };
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => ring(page)).not.toBe("");
  });
});
