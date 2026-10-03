import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The card's rotation, its animation and its view memory in real Chromium: real mouse coordinates (CLAUDE.md
// finding 3), computed styles (finding 10), and a reload that goes through the real localStorage.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const KITCHEN_LIGHT = 1; // demo/layout.json: floors.ground.devices[1], light.demo_kitchen

type Cfg = Record<string, unknown>;

async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}

/** Same shape as card.spec.ts's spy: callService records onto `window.__calls`. */
async function configure(page: Page, config: Cfg) {
  await page.evaluate(
    (config) => {
      (window as unknown as { __calls: unknown[] }).__calls = [];
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = {
        states: { "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } },
        callService: (...args: unknown[]) => (window as unknown as { __calls: unknown[] }).__calls.push(args),
      };
      return el.updateComplete;
    },
    config,
  );
}

const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
const button = (page: Page, label: string) => card(page).locator(`css=button[aria-label="${label}"]`);
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
const viewBox = (page: Page) =>
  card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number));
/** The plan's turn in degrees, read from the real DOM: 0 when there is no turned group. */
const planDeg = (page: Page) =>
  card(page).evaluate((el) => {
    const g = el.shadowRoot!.querySelector("svg g.plan-turn");
    const m = g?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
    return m ? Number(m[1]) : 0;
  });
const hostTheme = (page: Page) => card(page).evaluate((el) => el.getAttribute("data-theme"));
const select = (page: Page, label: string) => card(page).locator(`css=select[aria-label="${label}"]`);
const lightCentre = async (page: Page) => {
  const g = card(page).locator(`css=g[data-x="${KITCHEN_LIGHT}"]`);
  await g.scrollIntoViewIfNeeded(); // a turned plan is taller; the light can sit below the fold
  const box = (await g.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe("rotation: the visible turn", () => {
  test("a click turns the plan through intermediate angles and ends exactly at 45", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    // A sampler in the page records the plan's turn on every animation frame, so the test sees the real turn
    // instead of guessing at it with waits.
    await card(page).evaluate((el) => {
      const seen: number[] = [];
      (window as unknown as { __seen: number[] }).__seen = seen;
      const loop = () => {
        const g = el.shadowRoot!.querySelector("svg g.plan-turn");
        const m = g?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
        seen.push(m ? Number(m[1]) : 0);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await button(page, "Rotate right").click();
    await settled(page);
    const seen = await page.evaluate(() => (window as unknown as { __seen: number[] }).__seen);
    const between = seen.filter((d) => d > 0.5 && d < 44.5);
    expect(between.length, `samples ${seen.join(",")}`).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-9);
    expect(seen.at(-1)).toBe(45);
    expect(await planDeg(page)).toBe(45);
  });

  test("the turn lands byte for byte on a direct render at 45", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground", rotation: 45 });
    const direct = await card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.outerHTML);
    await page.evaluate(() => localStorage.clear());
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    await button(page, "Rotate right").click();
    await settled(page);
    const turned = await card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.outerHTML);
    expect(turned).toBe(direct);
  });

  test("a second click mid-turn goes on to 90 with no jump back", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    await button(page, "Rotate right").click();
    await expect.poll(() => planDeg(page)).toBeGreaterThan(2);
    const mid = await planDeg(page);
    await button(page, "Rotate right").click();
    expect(await planDeg(page)).toBeGreaterThanOrEqual(mid - 1e-9);
    await settled(page);
    expect(await planDeg(page)).toBe(90);
  });

  test("names stay upright: a label's own transform undoes the plan's turn", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground", rotation: 90 });
    const t = await card(page).evaluate((el) => el.shadowRoot!.querySelector("svg text.lbl")!.getAttribute("transform"));
    expect(t).toMatch(/^rotate\(-90 /);
  });

  test("prefers-reduced-motion: the plan is at 45 at once, with no frame in between", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    const seen = await card(page).evaluate(async (el) => {
      const out: number[] = [];
      const read = () => {
        const g = el.shadowRoot!.querySelector("svg g.plan-turn");
        const m = g?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
        return m ? Number(m[1]) : 0;
      };
      el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Rotate right"]')!.click();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push(read());
      }
      return out;
    });
    expect(new Set(seen)).toEqual(new Set([45]));
    await settled(page);
  });
});

test.describe("rotation: taps", () => {
  test("a tap on a light after a turn still toggles that light (hit-test at real coordinates)", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    await button(page, "Rotate right").click();
    await settled(page);
    const at = await lightCentre(page);
    await page.mouse.click(at.x, at.y);
    expect(await calls(page)).toEqual([["light", "toggle", { entity_id: "light.demo_kitchen" }]]);
  });

  test("a tap while the plan turns is ignored; the same tap after it settles acts", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    const before = await lightCentre(page);
    await button(page, "Rotate right").click();
    await page.mouse.click(before.x, before.y); // where the light was a moment ago, and the plan is moving
    expect(await calls(page)).toEqual([]);
    await settled(page);
    const at = await lightCentre(page);
    await page.mouse.click(at.x, at.y);
    expect(await calls(page)).toEqual([["light", "toggle", { entity_id: "light.demo_kitchen" }]]);
  });

  // CLAUDE.md finding 10: the rule is read where it lands, on the elements that carry their own pointer-events.
  test("CSS pair: while turning the plan and its devices take no pointer events, and after it they do", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    const read = () =>
      card(page).evaluate((el) => {
        const r = el.shadowRoot!;
        return {
          svg: getComputedStyle(r.querySelector("svg")!).pointerEvents,
          device: getComputedStyle(r.querySelector("svg g[data-x]")!).pointerEvents,
          room: getComputedStyle(r.querySelector("svg polygon[data-r], svg .room")!).pointerEvents,
        };
      });
    const idle = await read();
    expect(idle.device).not.toBe("none");
    await card(page).evaluate((el) => el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Rotate right"]')!.click());
    await expect(card(page).locator("css=svg.fp-turning")).toHaveCount(1);
    expect(await read()).toEqual({ svg: "none", device: "none", room: "none" });
    await settled(page);
    expect(await read()).toEqual(idle);
  });
});

test.describe("the card remembers its view", () => {
  const cfg = () => ({ layout: structuredClone(demo), floor: "ground" });

  async function changeEverything(page: Page) {
    await select(page, "View").selectOption("2.5d");
    await select(page, "Theme").selectOption("light");
    await button(page, "Zoom in").click();
    await button(page, "Zoom in").click();
    await button(page, "Rotate right").click();
    await settled(page);
    await button(page, "Rotate right").click();
    await settled(page);
  }

  test("zoom, focus, rotation, view and theme are back after a reload; Reset view brings the defaults back, and they stay", async ({ page }) => {
    await open(page);
    await configure(page, cfg());
    const fresh = await viewBox(page);
    const freshTheme = await hostTheme(page);
    await changeEverything(page);
    const zoomed = await viewBox(page);
    expect(zoomed[2]).toBeLessThan(fresh[2]!);

    await page.reload(); // pagehide flushes the debounced zoom save
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, cfg());
    const back = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(back[i]!).toBeCloseTo(zoomed[i]!, 2);
    expect(await planDeg(page)).toBe(90);
    expect(await select(page, "View").inputValue()).toBe("2.5d");
    expect(await select(page, "Theme").inputValue()).toBe("light");
    expect(await hostTheme(page)).toBe("light");
    expect(await card(page).evaluate((el) => !!el.shadowRoot!.querySelector("svg .ws"))).toBe(true); // 2.5D walls are drawn

    await button(page, "Reset view").click();
    await settled(page);
    expect(await planDeg(page)).toBe(0);
    expect(await select(page, "View").inputValue()).toBe("2d");
    expect(await hostTheme(page)).toBe(freshTheme);
    const reset = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(reset[i]!).toBeCloseTo(fresh[i]!, 2);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fp-view:")))).toEqual([]);

    await page.reload();
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, cfg());
    expect(await planDeg(page)).toBe(0);
    expect(await hostTheme(page)).toBe(freshTheme);
  });

  test("there is no flash of the default: the first frame after a reload is already the remembered one", async ({ page }) => {
    await open(page);
    await configure(page, cfg());
    await button(page, "Rotate right").click();
    await settled(page);
    await select(page, "Theme").selectOption("terminal");
    await page.reload();
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    // setConfig and the first render in one task: whatever the card drew first is what MutationObserver saw first.
    const first = await page.evaluate(async (config) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };
      const seen: { deg: string | null; theme: string | null }[] = [];
      new MutationObserver(() => {
        const g = el.shadowRoot.querySelector("svg g.plan-turn");
        seen.push({ deg: g?.getAttribute("transform")?.slice(0, 10) ?? null, theme: (el as unknown as Element).getAttribute("data-theme") });
      }).observe(el.shadowRoot, { subtree: true, childList: true, attributes: true });
      el.setConfig(config);
      el.hass = { states: {} };
      await el.updateComplete;
      return seen.filter((s) => s.deg !== null || s.theme !== null)[0];
    }, cfg());
    expect(first?.deg).toBe("rotate(45 ");
  });

  test("a second card on the same page with another floor does not share the memory", async ({ page }) => {
    await open(page);
    await configure(page, cfg());
    await button(page, "Rotate right").click();
    await settled(page);
    await configure(page, { ...cfg(), floor: "first" }); // another card to the memory
    expect(await planDeg(page)).toBe(0);
    await configure(page, cfg());
    expect(await planDeg(page)).toBe(45);
  });
});

test.describe("toolbar", () => {
  test("view_switch: false hides the View controls (theme, labels, names) but keeps the zoom, rotate and reset buttons (Diego, 0.12.22)", async ({ page }) => {
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground", view_switch: false });
    await expect(select(page, "Theme")).toHaveCount(0);
    for (const l of ["Labels", "Device names"]) await expect(button(page, l)).toHaveCount(0);
    for (const l of ["Zoom in", "Rotate left", "Rotate right", "Reset view"]) await expect(button(page, l)).toHaveCount(1);
  });

  test("rotate_switch: false and kiosk hide rotate and reset", async ({ page }) => {
    for (const cfg of [{ rotate_switch: false, view_switch: false }, { kiosk: true }]) {
      await open(page);
      await configure(page, { layout: structuredClone(demo), floor: "ground", ...cfg });
      for (const l of ["Rotate left", "Rotate right", "Reset view"]) await expect(button(page, l), JSON.stringify(cfg)).toHaveCount(0);
    }
  });

  test("on a 375 px card the toolbar stays inside the card and clear of the card's edges", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground", view: "2.5d" });
    const r = await card(page).evaluate((el) => {
      const host = el.getBoundingClientRect();
      const bar = el.shadowRoot!.querySelector(".fp-zoom")!.getBoundingClientRect();
      const kids = [...el.shadowRoot!.querySelectorAll(".fp-zoom > *")].map((k) => k.getBoundingClientRect());
      return { host: { l: host.left, r: host.right }, bar: { l: bar.left, r: bar.right }, kids: kids.map((k) => ({ l: k.left, r: k.right })) };
    });
    expect(r.bar.l).toBeGreaterThanOrEqual(r.host.l);
    expect(r.bar.r).toBeLessThanOrEqual(r.host.r);
    for (const k of r.kids) {
      expect(k.l).toBeGreaterThanOrEqual(r.host.l);
      expect(k.r).toBeLessThanOrEqual(r.host.r);
    }
  });

  test("a wrapped toolbar on a narrow card does not cover the Active list's fold button", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await configure(page, { layout: structuredClone(demo), floor: "ground", view: "2.5d" });
    const r = await card(page).evaluate((el) => {
      const bar = el.shadowRoot!.querySelector(".fp-zoom")!.getBoundingClientRect();
      const head = el.shadowRoot!.querySelector(".fp-active-collapse")!.getBoundingClientRect();
      return { barBottom: bar.bottom, barHeight: bar.height, headTop: head.top };
    });
    expect(r.barHeight).toBeGreaterThan(36); // the premise: it really wrapped
    expect(r.headTop).toBeGreaterThanOrEqual(r.barBottom);
  });
});
