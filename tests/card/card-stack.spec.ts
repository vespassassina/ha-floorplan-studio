import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hasItem, isDisabled, rotateLeft, rotateRight } from "./menu-helper";
import { cardSource } from "../../scripts/card-source.mjs";

// The card's zoom cluster: one vertical stack (zoom in, zoom out, fit) at the top right of the stage. S31.6: rotate and
// reset moved into the header's ⋯ menu with the look controls, and the toolbar is gone. Real mouse coordinates
// (CLAUDE.md finding 3): a click that lands on the wrong element is the defect this guards against.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

type Cfg = Record<string, unknown>;
const STACK = ["Zoom in", "Zoom out", "Fit"];
const GONE = ["Rotate left", "Rotate right", "Reset view"]; // now menu items, not buttons

async function boot(page: Page, config: Cfg, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    (config) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = { states: {}, callService: () => undefined };
      return el.updateComplete;
    },
    config,
  );
}

const card = (page: Page) => page.locator("floorplan-studio-card");
const BASE = { layout: structuredClone(demo), floor: "ground", view: "2.5d" };
const planDeg = (page: Page) =>
  card(page).evaluate((el) => {
    const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
    return m ? Number(m[1]) : 0;
  });
/** Centre of a stack button, and the element the browser would really hit there. */
const probe = (page: Page, label: string) =>
  card(page).evaluate((el, label) => {
    const b = el.shadowRoot!.querySelector<HTMLElement>(`.fp-stack button[aria-label="${label}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = el.shadowRoot!.elementFromPoint(x, y);
    return { x, y, hit: !!top && b.contains(top), w: r.width, h: r.height };
  }, label);

for (const width of [1280, 375]) {
  test.describe(`stack at ${width} px`, () => {
    test("the three buttons sit in one column, in order, and each takes a real click; rotate and reset are no buttons any more", async ({ page }) => {
      await boot(page, BASE, width);
      const ps = [];
      for (const l of STACK) ps.push({ l, ...(await probe(page, l))! });
      for (const p of ps) {
        expect(p.hit, `${p.l} is the top element at its centre`).toBe(true);
        expect(p.w).toBe(28);
        expect(p.h).toBe(28);
      }
      for (let i = 1; i < ps.length; i++) {
        expect(ps[i].x, `${ps[i].l} same x`).toBeCloseTo(ps[0].x, 1);
        expect(ps[i].y, `${ps[i].l} below ${ps[i - 1].l}`).toBeGreaterThan(ps[i - 1].y);
      }
      const g = await card(page).evaluate((el) => {
        const root = el.shadowRoot!;
        const stack = root.querySelector(".fp-stack")!.getBoundingClientRect();
        const host = el.getBoundingClientRect();
        const panel = root.querySelector(".fp-active")?.getBoundingClientRect();
        const chips = root.querySelector(".fp-floors")?.getBoundingClientRect();
        const meets = (a: DOMRect, b?: DOMRect) => !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          stackTop: stack.top, stackRight: stack.right, hostRight: host.right,
          stageTop: root.querySelector("svg")!.getBoundingClientRect().top,
          loose: [...root.querySelectorAll("button, select, input")].map((c) => c.getAttribute("aria-label")),
          toolbar: root.querySelectorAll(".fp-zoom, .fp-viewonly").length,
          panelMeets: meets(stack, panel), chipsMeet: meets(stack, chips),
        };
      });
      expect(g.stackTop - g.stageTop, "the stack is 8 px in from the top of the stage").toBeCloseTo(8, 0);
      expect(g.hostRight - g.stackRight).toBeCloseTo(8, 0);
      expect(g.panelMeets).toBe(false);
      expect(g.chipsMeet).toBe(false);
      // The toolbar is gone; the old look controls and the rotate pair are not loose in the card (they are in the menu).
      expect(g.toolbar).toBe(0);
      for (const l of [...GONE, "View", "Tilt", "Walls", "Theme", "Labels", "Device names"]) expect(g.loose).not.toContain(l);
      for (const v of ["rotate:-1", "rotate:1", "reset"]) expect(await hasItem(page, v), v).toBe(true);
    });

    test("the menu's Rotate right turns the plan, and Rotate left turns it back; Reset view is enabled after a turn", async ({ page }) => {
      await boot(page, BASE, width);
      const before = await planDeg(page);
      await rotateRight(page);
      await expect.poll(() => planDeg(page)).not.toBe(before);
      await expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
      const turned = await planDeg(page);
      expect(Math.abs(turned - before)).toBe(45);
      expect(await isDisabled(page, "reset"), "a turn is a difference to reset").toBe(false);
      await rotateLeft(page);
      await expect.poll(() => planDeg(page)).toBe(before);
    });
  });
}

test("zoom in at its real coordinates zooms the plan", async ({ page }) => {
  await boot(page, BASE, 1280);
  const vb = () => card(page).evaluate((el) => Number(el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/)[2]));
  const w0 = await vb();
  const z = (await probe(page, "Zoom in"))!;
  await page.mouse.click(z.x, z.y);
  await expect.poll(vb).toBeLessThan(w0);
});

test("rotate_switch: false drops the rotate pair from the menu and keeps the cluster", async ({ page }) => {
  await boot(page, { ...BASE, rotate_switch: false }, 1280);
  expect(await hasItem(page, "rotate:-1")).toBe(false);
  expect(await hasItem(page, "rotate:1")).toBe(false);
  for (const l of STACK) expect(await probe(page, l), l).not.toBeNull();
});

test("kiosk draws neither toolbar, stack nor menu", async ({ page }) => {
  await boot(page, { ...BASE, kiosk: true }, 1280);
  await expect(card(page).locator("css=.fp-zoom, .fp-stack, .fp-viewonly, fp-menu")).toHaveCount(0);
});

test("zoom: false shows no zoom chrome; rotate and reset stay in the menu", async ({ page }) => {
  await boot(page, { ...BASE, zoom: false }, 1280);
  await expect(card(page).locator("css=.fp-zoom, .fp-stack")).toHaveCount(0);
  for (const l of STACK) expect(await probe(page, l), l).toBeNull();
  for (const v of ["rotate:-1", "rotate:1", "reset"]) expect(await hasItem(page, v), v).toBe(true);
});

test("view_switch: false leaves the stack alone at the top right, with no toolbar; Rotate and Reset stay in the menu", async ({ page }) => {
  await boot(page, { ...BASE, view_switch: false }, 1280);
  await expect(card(page).locator("css=.fp-zoom")).toHaveCount(0);
  // S31.5: the stack is at the top right of the stage (the plan's box), 8 px in; the header band is above the stage.
  const top = await card(page).evaluate((el) => el.shadowRoot!.querySelector(".fp-stack")!.getBoundingClientRect().top - el.shadowRoot!.querySelector("svg")!.getBoundingClientRect().top);
  expect(top).toBeCloseTo(8, 0);
  for (const l of STACK) expect((await probe(page, l))!.hit, l).toBe(true);
  // Rotate is on, so Reset view stays: it is the way back from a turn.
  for (const v of ["rotate:-1", "rotate:1", "reset"]) expect(await hasItem(page, v), v).toBe(true);
});
