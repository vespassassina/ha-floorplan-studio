import { test, expect, type Page } from "@playwright/test";
import { demo, open, configure, canvas, cam, drawn, card } from "./helpers-3d";

// S14.4: the card remembers the 3D camera per floor (azimuth, polar, distance, target), restores it when you come back to
// the floor, and on reload. Real page.mouse at real coordinates (CLAUDE.md finding 3); the camera is read from the view's own
// data attributes. The floors are the demo's: Ground and First. The storage entry is read as a test of the real thing.

const CFG = { layout: structuredClone(demo), floor: "all", view: "3d", active_list: false };
const chip = (page: Page, title: string) => card(page).locator(`css=.fp-floors button`, { hasText: title });

async function still(page: Page) { // the camera has stopped moving (the framing settles when the view gets its size)
  let prev = "";
  await expect.poll(async () => { const now = JSON.stringify(await cam(page)); const same = now === prev; prev = now; return same; }, { intervals: [250], timeout: 10000 }).toBe(true);
}
async function boot(page: Page, cfg: Record<string, unknown> = CFG) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, structuredClone(cfg));
  await drawn(page);
  await still(page);
}
async function centre(page: Page) {
  const b = (await canvas(page).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** A left drag (orbit), then a wheel turn (zoom), then a middle drag (pan), each at real coordinates. */
async function move(page: Page, dx: number, dy: number, wheel: number) {
  const c = await centre(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, wheel);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(c.x - dx / 2, c.y + dy, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await still(page);
}
async function go(page: Page, title: string) {
  await chip(page, title).click();
  await expect(chip(page, title)).toHaveAttribute("aria-pressed", "true");
  await drawn(page);
  await still(page);
}
type Cam = Awaited<ReturnType<typeof cam>>;
const same = (a: Cam, b: Cam) => {
  expect(a.az).toBeCloseTo(b.az, 3);
  expect(a.polar).toBeCloseTo(b.polar, 3);
  expect(a.dist).toBeCloseTo(b.dist, 0);
  const [ax, az] = a.target.split(",").map(Number), [bx, bz] = b.target.split(",").map(Number);
  expect(ax).toBeCloseTo(bx!, 0);
  expect(az).toBeCloseTo(bz!, 0);
};
const differs = (a: Cam, b: Cam) => Math.abs(a.az - b.az) > 0.05 || Math.abs(a.polar - b.polar) > 0.05 || Math.abs(a.dist - b.dist) > 5 || a.target !== b.target;
const stored = (page: Page) => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => JSON.parse(v) as { floors?: [string, { cam?: unknown }][] }));
const hasCam = (page: Page, floor: string) => expect.poll(async () => !!(await stored(page))[0]?.floors?.find(([k]) => k === floor)?.[1].cam, { timeout: 5000 }).toBe(true);

test.describe("3D view memory per floor (S14.4)", () => {
  test("each floor comes back with the camera it was left with", async ({ page }) => {
    await boot(page);
    await move(page, 130, 45, -300);
    const ground = await cam(page);
    await go(page, "First");
    await move(page, -90, -30, 250);
    const first = await cam(page);
    expect(differs(first, ground)).toBe(true);

    await go(page, "Ground");
    same(await cam(page), ground);
    await go(page, "First");
    same(await cam(page), first);
  });

  test("a floor never moved keeps the way of looking it was reached with, framed for itself", async ({ page }) => {
    await boot(page);
    const start = await cam(page);
    await go(page, "First");
    const first = await cam(page);
    expect(first.az).toBeCloseTo(start.az, 3);
    expect(first.polar).toBeCloseTo(start.polar, 3);
    await expect.poll(async () => (await stored(page))[0]?.floors ?? []).toEqual([]); // nothing was moved, so nothing is stored
  });

  test("a reload brings back the camera of the floor shown and of the other", async ({ page }) => {
    await boot(page);
    await move(page, 130, 45, -300);
    const ground = await cam(page);
    await go(page, "First");
    await move(page, -90, -30, 250);
    const first = await cam(page);
    await hasCam(page, "ground");
    await hasCam(page, "first");

    await page.reload();
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, structuredClone(CFG));
    await drawn(page);
    await still(page);
    await expect(chip(page, "First")).toHaveAttribute("aria-pressed", "true");
    same(await cam(page), first);
    await go(page, "Ground");
    same(await cam(page), ground);
  });

  test("Reset camera sends the floor back to the first view and forgets it; the other floor keeps its own", async ({ page }) => {
    await boot(page);
    const start = await cam(page);
    await move(page, 130, 45, -300);
    const ground = await cam(page);
    await go(page, "First");
    await move(page, -90, -30, 250);
    const first = await cam(page);
    await hasCam(page, "first");

    await card(page).locator('css=button[aria-label="Reset camera"]').click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await still(page);
    expect(differs(await cam(page), first)).toBe(true);
    expect((await cam(page)).az).toBeCloseTo(start.az, 3);
    await expect.poll(async () => (await stored(page))[0]?.floors?.map(([k]) => k)).toEqual(["ground"]);

    await go(page, "Ground");
    same(await cam(page), ground);
    await go(page, "First");
    expect((await cam(page)).az).toBeCloseTo(ground.az, 3); // forgotten: it is the look carried over from Ground again, not `first`
    expect(differs(await cam(page), first)).toBe(true);
  });

  test("with storage blocked the floors still remember in the page, and the card draws", async ({ page }) => {
    await page.addInitScript(() => {
      const refuse = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: refuse, configurable: true });
    });
    await boot(page);
    await move(page, 130, 45, -300);
    const ground = await cam(page);
    await go(page, "First");
    await move(page, -90, -30, 250);
    await go(page, "Ground");
    same(await cam(page), ground);
  });

  test("switching to 2D and zooming there does not drop the stored camera", async ({ page }) => {
    await boot(page);
    await move(page, 130, 45, -300);
    await hasCam(page, "ground");
    await card(page).locator('css=select[aria-label="View"]').selectOption("2d");
    await expect(card(page).locator("css=canvas")).toHaveCount(0);
    await card(page).locator('css=button[aria-label="Zoom in"]').click();
    await expect.poll(async () => !!(await stored(page))[0]?.floors?.find(([k]) => k === "ground")?.[1].cam).toBe(true);
  });
});
