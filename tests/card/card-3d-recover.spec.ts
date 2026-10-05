import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, canvas, cam, drawn, viewSelect, open, holder } from "./helpers-3d";

// S12 review fixes: 3D recovers from a failed chunk load and from a lost graphics context, and never leaves a blank canvas
// with no word. Every test drives the real browser; the GPU failures are real (WEBGL_lose_context, a draw call that throws).

const renderers = (page: Page) => page.evaluate(() => (customElements.get("floorplan-studio-card") as unknown as { liveRenderers: number }).liveRenderers);
const note = (page: Page) => card(page).locator("css=.fp-3d-note");
const errorsOf = (page: Page) => { const e: string[] = []; page.on("pageerror", (x) => e.push(String(x))); return e; };

test("S1: a chunk that failed to load is fetched again on the next pick, and 3D appears", async ({ page }) => {
  let fail = true;
  const hits: string[] = [];
  await serve(page);
  await page.route(/floorplan-studio-3d-.*\.js/, async (r) => { hits.push(r.request().url()); if (fail) return r.fulfill({ status: 503, body: "" }); return r.fallback(); });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((layout) => { const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown }; el.setConfig({ layout, floor: "ground", view: "2d" }); el.hass = { states: {}, callService() {} }; }, structuredClone(demo));
  await viewSelect(page).selectOption("3d");
  await expect(note(page)).toContainText(/code did not load/);
  fail = false;
  for (const v of ["2d", "3d"]) await viewSelect(page).selectOption(v);
  await drawn(page);
  await expect(note(page)).toHaveCount(0);
  expect(hits.length, hits.join(" ")).toBe(2); // the first, which failed, and exactly one more
  expect(hits[1]).toMatch(/floorplan-studio-3d-[\w-]+\.js\?r=\d+/);
  expect(await renderers(page)).toBe(1);
});

test("S2: a lost graphics context that comes back restores 3D without a re-pick, and leaks no renderer", async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  expect(await renderers(page)).toBe(1);
  await canvas(page).evaluate((c: HTMLCanvasElement) => {
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext, ext = gl.getExtension("WEBGL_lose_context")!;
    (window as unknown as { __ext: unknown }).__ext = ext;
    ext.loseContext();
  });
  await page.waitForTimeout(300);
  const before = (await cam(page)).drawn; // read before the restore: the frame it brings is the one the test waits for
  await page.evaluate(() => (window as unknown as { __ext: { restoreContext(): void } }).__ext.restoreContext());
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 8000 }).toBeGreaterThan(before);
  await expect(canvas(page)).toHaveCount(1);
  await expect(note(page)).toHaveCount(0);
  expect(await canvas(page).evaluate((c: HTMLCanvasElement) => (c.getContext("webgl2") as WebGL2RenderingContext).isContextLost())).toBe(false);
  expect(await renderers(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("S2: a context that does not come back gives the note and 2D; the next visibility change or reconnect tries 3D once more", async ({ page }) => {
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  const lose = () => canvas(page).evaluate((c: HTMLCanvasElement) => { ((c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext).getExtension("WEBGL_lose_context")!.loseContext(); });
  await lose();
  await expect(note(page)).toContainText(/graphics context was lost/, { timeout: 10000 });
  await expect(canvas(page)).toHaveCount(0);
  expect(await renderers(page)).toBe(0);
  // the tab comes back to the front
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await drawn(page);
  await expect(note(page)).toHaveCount(0);
  expect(await renderers(page)).toBe(1);
  // and again, brought back by a reconnect (a dashboard that re-attaches its cards)
  await lose();
  await expect(note(page)).toContainText(/graphics context was lost/, { timeout: 10000 });
  await page.evaluate(() => { const el = document.getElementById("card")!, p = el.parentElement!; el.remove(); p.appendChild(el); });
  await drawn(page);
  await expect(note(page)).toHaveCount(0);
  expect(await renderers(page)).toBe(1);
});

test("S3: a draw call that throws gives the note and 2D, not a blank canvas", async ({ page }) => {
  const errors = errorsOf(page);
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  await page.evaluate(() => {
    for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype] as unknown as Record<string, unknown>[])
      for (const m of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) if (P[m]) P[m] = () => { throw new Error("boom"); };
  });
  const b = (await canvas(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 120); // a frame is asked for
  await expect(note(page)).toContainText(/could not start/);
  await expect(canvas(page)).toHaveCount(0);
  await expect(card(page).locator("css=svg").first()).toBeVisible();
  expect(await renderers(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("N8: the picked room's ring does not outlive the view (the graphics card holds no geometry once the card is gone)", async ({ page }) => {
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  const at = await page.evaluate(() => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): { x: number; y: number } } }).__fp3d.project(60, 60, 1));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => holder(page).getAttribute("data-ring")).toBe("0");
  const d = (await cam(page)).drawn;
  await expect.poll(async () => (await cam(page)).drawn).toBeGreaterThan(d - 1);
  await page.evaluate(() => { // keep the hook: the card takes its own from the page when it goes
    const w = window as unknown as { __fp3d: { memory(): { geometries: number } }; __mem: () => { geometries: number } };
    w.__mem = w.__fp3d.memory;
    document.getElementById("card")!.remove();
  });
  expect(await page.evaluate(() => (window as unknown as { __mem: () => { geometries: number } }).__mem().geometries)).toBe(0);
});

test("N6: two cards each have a hook, and removing one leaves the other's", async ({ page }) => {
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  await page.evaluate(() => {
    const first = (window as unknown as { __fp3d: object }).__fp3d;
    (window as unknown as { __first: object }).__first = first;
    const el = document.createElement("floorplan-studio-card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown };
    el.id = "card2";
    document.body.appendChild(el);
    el.setConfig({ layout: (document.getElementById("card") as unknown as { _config: { layout: unknown } })._config.layout, floor: "first", view: "3d" });
    el.hass = (document.getElementById("card") as unknown as { hass: unknown }).hass;
  });
  await expect.poll(() => renderers(page)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __fp3d: object; __first: object }).__fp3d !== (window as unknown as { __first: object }).__first)).toBe(true);
  await page.evaluate(() => document.getElementById("card2")!.remove());
  expect(await page.evaluate(() => (window as unknown as { __fp3d: object; __first: object }).__fp3d === (window as unknown as { __first: object }).__first)).toBe(true);
});
