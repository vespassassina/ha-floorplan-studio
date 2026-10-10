import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S27.15: the card's floor switch is animated, in 2D and in 2.5D (3D cuts). Real clicks on the floor tabs and a real Enter in the
// search. The animation itself is recorded in the page (animationstart / animationend on the plan root, with the time and the
// data-switch it ran under), so a test reads what happened and never waits for a time to pass. Reduced motion is the real media query.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")); // floors: ground, first, test
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8")); // ground, first, second
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function boot(page: Page, config: Record<string, unknown> = {}, layout: unknown = demo) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    try { localStorage.clear(); } catch { /* file: origin without storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout, floor: "all", theme: "light", ...config });
  await expect(card(page).locator("css=svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const tab = (page: Page, title: string) => card(page).locator("css=.fp-floors button", { hasText: title });
const shown = (page: Page, title: string) => expect(tab(page, title)).toHaveAttribute("aria-pressed", "true");

interface Rec { type: string; name: string; dir: string | null; t: number; elapsed: number; dur: number | null }
/** Records the plan root's animation events and, for every floor tab click, the first frame after it. Call after the plan is on screen. */
const record = (page: Page) => card(page).evaluate((el) => {
  const w = window as unknown as { __rec: Rec[]; __frames: { t: number; text: string }[] };
  w.__rec = []; w.__frames = [];
  const root = el.shadowRoot!, svg = root.querySelector("svg.fp-zoomable") as SVGSVGElement;
  for (const type of ["animationstart", "animationend", "animationcancel"]) svg.addEventListener(type, (e) => {
    if (e.target !== svg) return;
    // The animation's own numbers, not the wall clock: `elapsedTime` is set by the browser at the end, `duration` is what the rule asked for.
    const a = svg.getAnimations().find((x) => (x as CSSAnimation).animationName === (e as AnimationEvent).animationName);
    w.__rec.push({ type, name: (e as AnimationEvent).animationName, dir: svg.getAttribute("data-switch"), t: performance.now(), elapsed: (e as AnimationEvent).elapsedTime, dur: a ? Number(a.effect!.getTiming().duration) : null });
  });
  for (const b of root.querySelectorAll(".fp-floors button")) b.addEventListener("click", () => {
    // Lit renders in a microtask after the click: the first frame after the click must already hold the new floor.
    requestAnimationFrame(() => w.__frames.push({ t: performance.now(), text: [...svg.querySelectorAll("text")].map((x) => x.textContent).join("|") }));
  });
});
const rec = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Rec[] }).__rec);
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: { t: number; text: string }[] }).__frames);
const running = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.getAnimations().filter((a) => (a as CSSAnimation).animationName?.startsWith("fp-floor-in")).length);

for (const view of ["2d", "2.5d"]) {
  test.describe(`S27.15 the card's floor switch, ${view}`, () => {
    test("default motion: a click on a tab runs the animation on the plan root the way it travels, and it ends after its own 220 ms", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await boot(page, { view });
      await record(page);
      await tab(page, "First").click();
      await shown(page, "First");
      await expect.poll(async () => (await rec(page)).some((r) => r.type === "animationend"), { timeout: 3000 }).toBe(true);
      let r = await rec(page);
      expect(r.map((x) => [x.type, x.name, x.dir])).toEqual([["animationstart", "fp-floor-in-up", "up"], ["animationend", "fp-floor-in-up", "up"]]);
      // Deterministic: no real-time bound. The rule asked for 220 ms and the browser reports it ran its whole 0.22 s.
      expect(r[0].dur).toBe(220);
      expect(r[1].elapsed).toBeCloseTo(0.22, 5);
      expect(await running(page)).toBe(0);
      expect(await card(page).locator("css=svg.fp-zoomable").getAttribute("data-switch")).toBeNull(); // nothing is left behind

      await tab(page, "Ground").click(); // and down
      await shown(page, "Ground");
      await expect.poll(async () => (await rec(page)).filter((x) => x.type === "animationend").length, { timeout: 3000 }).toBe(2);
      r = await rec(page);
      expect(r.slice(2).map((x) => [x.type, x.name, x.dir])).toEqual([["animationstart", "fp-floor-in-down", "down"], ["animationend", "fp-floor-in-down", "down"]]);
    });

    test("the new floor is drawn in the first frame, animating or not; the old floor is not kept", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await boot(page, { view });
      await record(page);
      await tab(page, "First").click();
      await expect.poll(async () => (await frames(page)).length).toBe(1);
      const [f] = await frames(page);
      expect(f.text).toContain("Bedroom");
      expect(f.text).not.toContain("Kitchen");
      expect(await card(page).locator("css=svg.fp-zoomable").count()).toBe(1); // one plan: no copy of the old floor
    });

    test("reduced motion: no animation ever runs, no data-switch is set, and the new floor is drawn in the same frame", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await boot(page, { view });
      await record(page);
      const seen = await card(page).evaluate((el) => {
        const svg = el.shadowRoot!.querySelector("svg.fp-zoomable")!, marks: string[] = [];
        new MutationObserver((m) => { for (const x of m) if (x.attributeName === "data-switch") marks.push(String(svg.getAttribute("data-switch"))); }).observe(svg, { attributes: true });
        (window as unknown as { __marks: string[] }).__marks = marks;
        return true;
      });
      expect(seen).toBe(true);
      for (const t of ["First", "Ground", "First"]) {
        await tab(page, t).click();
        await shown(page, t);
        expect(await running(page), t).toBe(0);
      }
      await expect.poll(async () => (await frames(page)).length).toBe(3);
      expect((await frames(page))[0].text).toContain("Bedroom");
      expect(await rec(page)).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __marks: string[] }).__marks)).toEqual([]);
    });
  });
}

test.describe("S27.15 the card's floor switch, every way onto another floor", () => {
  test("a search Enter onto another floor animates it, up and then down", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await boot(page, {}, stress);
    await record(page);
    const b = (await card(page).locator("css=svg.fp-zoomable").boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6);
    await page.keyboard.press("/");
    await page.keyboard.type("library");
    await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Library");
    await page.keyboard.press("Enter"); // a room on the second floor, from the ground floor: up
    await shown(page, "Second");
    await expect.poll(async () => (await rec(page)).some((r) => r.type === "animationend"), { timeout: 3000 }).toBe(true);
    expect((await rec(page)).map((x) => [x.type, x.name, x.dir])).toEqual([["animationstart", "fp-floor-in-up", "up"], ["animationend", "fp-floor-in-up", "up"]]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("/");
    await page.keyboard.type("first");
    await page.keyboard.press("Enter"); // the first floor itself, from the second: down
    await shown(page, "First");
    await expect.poll(async () => (await rec(page)).filter((r) => r.type === "animationend").length, { timeout: 3000 }).toBe(2);
    expect((await rec(page)).slice(2).map((x) => [x.type, x.name, x.dir])).toEqual([["animationstart", "fp-floor-in-down", "down"], ["animationend", "fp-floor-in-down", "down"]]);
  });

  test("3D cuts: a switch in 3D leaves nothing behind for the 2D plan that follows", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await boot(page, { view: "3d" });
    await tab(page, "First").click();
    await shown(page, "First");
    await card(page).locator('css=select[aria-label="View"]').selectOption("2d");
    await expect(card(page).locator("css=svg.fp-zoomable")).toHaveCount(1);
    expect(await card(page).locator("css=svg.fp-zoomable").getAttribute("data-switch")).toBeNull();
    expect(await running(page)).toBe(0);
  });

  test("a switch to the floor already shown, and one made again before the first ends, leave one animation and no stale attribute", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await boot(page);
    await record(page);
    await tab(page, "First").click();
    await tab(page, "First").click(); // same floor: nothing new
    await tab(page, "Ground").click(); // before the first has ended: the animation restarts, going down
    await shown(page, "Ground");
    await expect.poll(async () => (await rec(page)).filter((r) => r.type === "animationend").length, { timeout: 3000 }).toBeGreaterThan(0);
    const r = await rec(page);
    expect(r.at(-1)).toMatchObject({ type: "animationend", name: "fp-floor-in-down", dir: "down" });
    expect(await running(page)).toBe(0);
    expect(await card(page).locator("css=svg.fp-zoomable").getAttribute("data-switch")).toBeNull();
  });
});
