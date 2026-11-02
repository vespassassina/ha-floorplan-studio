import { test, expect, type Page } from "@playwright/test";
import { hasItem, menuButton, menuPanel } from "./menu-helper";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S31.5 (docs/specs/card-layout-touch.md, D1; criteria 2, 5, 9): the card's chrome sits around the plan, not over it. The host is a
// grid: header bar, side sheet, stage (the plan's own `<svg>`), the zoom cluster on the stage. Real `page.mouse` clicks on the real
// top element (finding 3); the hass stub has the shape the card gets from Home Assistant (finding 21). Keys of the card that are
// not in the spec's table (rotate, which S31.6 moved into the menu) stay where 0.28.1 had them.

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
const STATES = () => ({ "light.kitchen_spot_1": st("on"), "light.study_desk_lamp": st("on"), "light.guest_bedroom_bedside_left": st("off") });

async function boot(page: Page, config: Record<string, unknown>, size = { width: 1280, height: 900 }, seed?: Record<string, string>) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s, store]) => {
      try { localStorage.clear(); for (const [k, v] of Object.entries(store ?? {})) localStorage.setItem(k, v); } catch { /* file: origin without storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, callService: () => {} };
      return el.updateComplete;
    },
    [{ layout, theme: "light", ...config }, STATES(), seed ?? null] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
type Box = { x: number; y: number; width: number; height: number };
const boxes = (page: Page, sels: string[]) => card(page).evaluate((el, sels) => {
  const out: Record<string, Box | null> = {};
  for (const s of sels) { const r = (s === ":host" ? el : el.shadowRoot!.querySelector(s))?.getBoundingClientRect(); out[s] = r && (r.width || r.height) ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; }
  return out;
}, sels);
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const meets = (a: Box, b: Box) => Math.min(right(a), right(b)) - Math.max(a.x, b.x) > 0.5 && Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 0.5;

async function topPoint(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
      const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8, top = el.shadowRoot!.elementFromPoint(x, y);
      if (top && (top === t || t.contains(top))) return { x, y };
    }
    return null;
  }, sel);
  expect(p, `${sel} is the top element somewhere on its box`).not.toBeNull();
  return p!;
}
const clickOn = async (page: Page, sel: string) => { const p = await topPoint(page, sel); await page.mouse.click(p.x, p.y); };
const roomAt = (name: string, floor = "ground") => (layout.floors[floor].rooms as { name: string }[]).findIndex((r) => r.name === name);
const regionName = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector(".fp-active")?.getAttribute("aria-label") ?? null);
const sheetState = (page: Page) => card(page).evaluate((el) => { const a = el.shadowRoot!.querySelector<HTMLElement>(".fp-active"); return { folded: a ? a.classList.contains("fp-active-folded") || a.classList.contains("fp-rail") : null, scroll: a?.querySelector<HTMLElement>(".fp-active-body")?.scrollTop ?? null }; });
const viewBox = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number));
const rehass = (page: Page) => card(page).evaluate((el, s) => { (el as unknown as { hass: unknown }).hass = { states: s, callService: () => {} }; return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; }, STATES());

for (const size of [{ width: 1280, height: 900 }, { width: 768, height: 1024 }]) {
  test.describe(`S31.5 the frame at ${size.width} x ${size.height}`, () => {
    test("criterion 2: no chrome box meets the plan's box, the zoom cluster apart", async ({ page }) => {
      await boot(page, {}, size);
      const b = await boxes(page, [".fp-head", ".fp-floors", ".fp-active", "svg", ".fp-stack"]);
      expect(b[".fp-head"], "a header bar").not.toBeNull();
      expect(b["svg"], "the plan").not.toBeNull();
      expect(b[".fp-active"], "a sheet or its rail").not.toBeNull();
      for (const chrome of [".fp-head", ".fp-floors", ".fp-active"]) expect(meets(b[chrome]!, b["svg"]!), `${chrome} does not meet the plan`).toBe(false);
      expect(b[".fp-floors"]!.y, "the floor tabs are in the header").toBeGreaterThanOrEqual(b[".fp-head"]!.y - 0.5);
      expect(bottom(b[".fp-floors"]!)).toBeLessThanOrEqual(bottom(b[".fp-head"]!) + 0.5);
      // The cluster is the one thing on the plan, and it is inside the plan's box.
      expect(b[".fp-stack"]!.x).toBeGreaterThanOrEqual(b["svg"]!.x - 0.5);
      expect(right(b[".fp-stack"]!)).toBeLessThanOrEqual(right(b["svg"]!) + 0.5);
      expect(bottom(b[".fp-stack"]!)).toBeLessThanOrEqual(bottom(b["svg"]!) + 0.5);
    });

    test("the plan's box is the stage's: under the header, beside the sheet, to the card's edge", async ({ page }) => {
      await boot(page, {}, size);
      const b = await boxes(page, [":host", ".fp-head", ".fp-active", "svg"]);
      expect(b["svg"]!.y).toBeCloseTo(bottom(b[".fp-head"]!), 0);
      expect(right(b["svg"]!)).toBeCloseTo(right(b[":host"]!), 0);
      expect(b["svg"]!.x).toBeCloseTo(right(b[".fp-active"]!), 0);
      expect(b[".fp-head"]!.x).toBeCloseTo(b[":host"]!.x, 0);
      expect(b[".fp-head"]!.width).toBeCloseTo(b[":host"]!.width, 0);
    });

    test("a double tap off a device zooms about the tap, with the sheet beside the plan", async ({ page }) => {
      await boot(page, {}, size);
      // At 768 the sheet starts as a rail and a tap on a room would open it, narrowing the plan under the finger. The sheet is
      // opened by hand first (a viewer's choice, kept), so the box the double tap lands in is the box it is measured in.
      if (await card(page).evaluate((el) => !!el.shadowRoot!.querySelector("button[aria-label='Open overview']"))) await clickOn(page, "button[aria-label='Open overview']");
      const r = (await boxes(page, ["svg"]))["svg"]!, vb0 = await viewBox(page);
      // A spot with no device, door or piece under it, found by looking (the real top element).
      const spot = await card(page).evaluate((el, r) => {
        // Near the middle, where clamping at an edge cannot move the box: the room under the tap is left as it was by a double tap.
        for (let a = 12; a < 29; a++) for (let b = 12; b < 29; b++) {
          const px = r.x + (r.width * a) / 40, py = r.y + (r.height * b) / 40, t = el.shadowRoot!.elementFromPoint(px, py);
          if (t && t.closest("svg.fp-zoomable") && !t.closest("[data-x], [data-d], [data-u], [data-f], .fp-stack")) return { x: px, y: py };
        }
        return null;
      }, r);
      expect(spot, "the plan has a free spot").not.toBeNull();
      const { x, y } = spot!;
      const under = (vb: number[]) => [vb[0] + ((x - r.x) / r.width) * vb[2], vb[1] + ((y - r.y) / r.height) * vb[3]];
      await page.mouse.dblclick(x, y);
      await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.6);
      const vb1 = await viewBox(page), a = under(vb0), c = under(vb1);
      expect(Math.hypot(a[0] - c[0], a[1] - c[1]), "the plan point under the finger stays under it").toBeLessThan(vb0[2] * 0.01);
    });

    test("a drag pans by the finger's distance in the stage's own scale", async ({ page }) => {
      await boot(page, {}, size);
      const r = (await boxes(page, ["svg"]))["svg"]!;
      await clickOn(page, ".fp-stack button[aria-label='Zoom in']");
      await clickOn(page, ".fp-stack button[aria-label='Zoom in']");
      const vb0 = await viewBox(page);
      const x = r.x + r.width * 0.5, y = r.y + r.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 60, y - 10, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await viewBox(page))[0]).not.toBe(vb0[0]);
      const vb1 = await viewBox(page);
      // Panned 60 screen px: the box moves 60 px of the stage's width in plan units (unless it hit an edge, which only shortens it).
      const expected = (60 / r.width) * vb0[2];
      expect(vb1[0] - vb0[0]).toBeGreaterThan(expected * 0.5);
      expect(vb1[0] - vb0[0]).toBeLessThanOrEqual(expected * 1.02);
    });

    test("a pinch zooms about the fingers' middle, read in the stage's own box", async ({ page }) => {
      await boot(page, {}, size);
      if (await card(page).evaluate((el) => !!el.shadowRoot!.querySelector("button[aria-label='Open overview']"))) await clickOn(page, "button[aria-label='Open overview']");
      const r = (await boxes(page, ["svg"]))["svg"]!, vb0 = await viewBox(page);
      // Off the middle on purpose: a box read from the wrong origin (the card's, not the stage's) moves the point under the fingers.
      const mx = r.x + r.width * 0.65, my = r.y + r.height * 0.4;
      // Playwright's touchscreen has only tap; two fingers go through CDP, one session for the whole gesture (as card.spec.ts does).
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: { x: number; y: number; id: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
      await touch("touchStart", [{ x: mx - 40, y: my, id: 1 }]);
      await touch("touchStart", [{ x: mx - 40, y: my, id: 1 }, { x: mx + 40, y: my, id: 2 }]);
      for (let k = 1; k <= 5; k++) await touch("touchMove", [{ x: mx - 40 - k * 12, y: my, id: 1 }, { x: mx + 40 + k * 12, y: my, id: 2 }]);
      await touch("touchEnd", []);
      await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(vb0[2] * 0.7);
      const vb1 = await viewBox(page), r1 = (await boxes(page, ["svg"]))["svg"]!;
      const under = (vb: number[], box: Box) => [vb[0] + ((mx - box.x) / box.width) * vb[2], vb[1] + ((my - box.y) / box.height) * vb[3]];
      const a = under(vb0, r), c = under(vb1, r1);
      expect(Math.hypot(a[0] - c[0], a[1] - c[1]), "the plan point between the fingers stays between them").toBeLessThan(vb0[2] * 0.02);
    });
  });
}

test.describe("S31.5 criterion 5: the side sheet", () => {
  const size = { width: 1280, height: 900 };

  test("beside the plan and open from 900 px; folding it widens the plan and the fold is kept per card without x or y", async ({ page }) => {
    await boot(page, {}, size);
    const open = await boxes(page, [".fp-active", "svg", ".fp-active-body"]);
    expect(open[".fp-active-body"], "open at 1280").not.toBeNull();
    expect(open[".fp-active"]!.width, "the sheet is clamp(260, 32 %, 320) wide").toBeCloseTo(320, 0);
    await clickOn(page, "button[aria-label='Fold overview']");
    const folded = await boxes(page, [".fp-active", "svg"]);
    expect(folded[".fp-active"]!.width, "a 52 px rail").toBeCloseTo(52, 0);
    expect(folded["svg"]!.width, "the plan takes the room").toBeGreaterThan(open["svg"]!.width + 200);
    const kept = await card(page).evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-active-panel:")).map(([, v]) => JSON.parse(v) as Record<string, unknown>));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ collapsed: true, chosen: true });
    expect(Object.keys(kept[0]), "no drag position any more").not.toContain("x");
    expect(Object.keys(kept[0])).not.toContain("y");
    await clickOn(page, "button[aria-label='Open overview']");
    expect((await boxes(page, [".fp-active"]))[".fp-active"]!.width).toBeCloseTo(320, 0);
  });

  test("a stored position is ignored and a stored fold kept", async ({ page }) => {
    await boot(page, {}, size);
    await clickOn(page, "button[aria-label='Fold overview']");
    const key = await card(page).evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("fp-active-panel:"))!);
    await boot(page, {}, size, { [key]: JSON.stringify({ collapsed: true, chosen: true, x: 0.9, y: 0.9 }) });
    const b = await boxes(page, [":host", ".fp-active"]);
    expect(b[".fp-active"]!.x, "the sheet is at the card's left edge, not where x said").toBeCloseTo(b[":host"]!.x, 0);
    expect(b[".fp-active"]!.width, "folded, as stored").toBeCloseTo(52, 0);
  });

  test("a room pick, a floor tab and Back: the levels, one at a time", async ({ page }) => {
    await boot(page, { floor: undefined }, size);
    expect(await regionName(page)).toBe("Overview");
    await clickOn(page, `svg polygon[data-r="${roomAt("Kitchen")}"]`);
    expect(await regionName(page)).toBe("Kitchen");
    await clickOn(page, "button[aria-label='Back']");
    expect(await regionName(page), "Back from a room goes to its floor").toBe("Ground");
    await clickOn(page, "button[aria-label='Back']");
    expect(await regionName(page), "Back from a floor goes to the Overview").toBe("Overview");
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelector("button[aria-label='Back']") !== null), "no Back at the top").toBe(false);
    await clickOn(page, ".fp-floors button:nth-child(2)");
    expect(await regionName(page)).toBe("First");
  });

  test("a hass update keeps the level, the scroll and the fold", async ({ page }) => {
    await boot(page, {}, size);
    await clickOn(page, `svg polygon[data-r="${roomAt("Kitchen")}"]`);
    await card(page).evaluate((el) => { el.shadowRoot!.querySelector<HTMLElement>(".fp-active-body")!.scrollTop = 40; });
    const before = await sheetState(page);
    await rehass(page);
    expect(await regionName(page)).toBe("Kitchen");
    expect(await sheetState(page)).toEqual(before);
    await clickOn(page, "button[aria-label='Back']");
    await clickOn(page, "button[aria-label='Back']");
    await clickOn(page, "button[aria-label='Fold overview']");
    await rehass(page);
    expect((await sheetState(page)).folded).toBe(true);
  });
});

test.describe("S31.5 criterion 5: a tablet starts folded", () => {
  test("768 wide: the rail, not the sheet; a room pick opens the room's level beside the plan", async ({ page }) => {
    await boot(page, {}, { width: 768, height: 1024 });
    const rail = await boxes(page, [".fp-active", ".fp-active-body"]);
    expect(rail[".fp-active"]!.width).toBeCloseTo(52, 0);
    expect(rail[".fp-active-body"]).toBeNull();
    await clickOn(page, `svg polygon[data-r="${roomAt("Kitchen")}"]`);
    expect(await regionName(page)).toBe("Kitchen");
    const b = await boxes(page, [".fp-active", "svg"]);
    expect(meets(b[".fp-active"]!, b["svg"]!)).toBe(false);
    expect(b[".fp-active"]!.width).toBeGreaterThanOrEqual(260);
  });
});

test.describe("Opus review of S31: Escape in the side sheet does what Back does", () => {
  for (const size of [{ width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
    test(`${size.width} wide: Escape goes room, floor, Overview, one level at a time`, async ({ page }) => {
      await boot(page, {}, size);
      await clickOn(page, `svg polygon[data-r="${roomAt("Kitchen")}"]`);
      expect(await regionName(page)).toBe("Kitchen");
      await page.keyboard.press("Escape");
      await expect.poll(() => regionName(page), { message: "the Floor level, not the Overview" }).not.toBe("Kitchen");
      expect(await regionName(page)).not.toBe("Overview");
      await page.keyboard.press("Escape");
      await expect.poll(() => regionName(page)).toBe("Overview");
    });
  }
});

test.describe("S31.5 criterion 9: the old keys in the new frame", () => {
  const size = { width: 1280, height: 900 };
  const present = (page: Page, sel: string) => card(page).evaluate((el, sel) => el.shadowRoot!.querySelector(sel) !== null, sel);

  test("kiosk: no header, no sheet, no cluster; the plan is the whole card", async ({ page }) => {
    await boot(page, { kiosk: true }, size);
    for (const s of [".fp-head", ".fp-active", ".fp-stack", ".fp-floors", ".fp-zoom"]) expect(await present(page, s), s).toBe(false);
    const b = await boxes(page, [":host", "svg"]);
    expect(b["svg"]!.width).toBeCloseTo(b[":host"]!.width, 0);
    expect(b["svg"]!.y).toBeCloseTo(b[":host"]!.y, 0);
  });

  test("kiosk with zoom: the cluster stays off in kiosk, as in 0.28.1 (zoom is by gesture)", async ({ page }) => {
    await boot(page, { kiosk: true, zoom: true, rotate_switch: true }, size);
    expect(await present(page, ".fp-head")).toBe(false);
    expect(await present(page, ".fp-active")).toBe(false);
  });

  test("active_list: false: tabs and View options stay, no Search, no sheet", async ({ page }) => {
    await boot(page, { active_list: false }, size);
    expect(await present(page, ".fp-active")).toBe(false);
    expect(await present(page, ".fp-floors")).toBe(true);
    expect(await present(page, "fp-menu")).toBe(true);
    expect(await present(page, "button[aria-label='Search']")).toBe(false);
    const b = await boxes(page, [":host", "svg"]);
    expect(right(b["svg"]!)).toBeCloseTo(right(b[":host"]!), 0);
    expect(b["svg"]!.x).toBeCloseTo(b[":host"]!.x, 0);
  });

  test("view_switch: false: the menu has no look items; the header keeps tabs and Search", async ({ page }) => {
    await boot(page, { view_switch: false }, size);
    // Moved premise (S31.6): the menu stays for Detail, Layers, Rotate and Reset; what the switch removes is the look items.
    expect(await present(page, "fp-menu")).toBe(true);
    for (const v of ["view:2d", "theme:light", "labels", "names"]) expect(await hasItem(page, v), v).toBe(false);
    expect(await hasItem(page, "detail:auto")).toBe(true);
    expect(await present(page, ".fp-zoom")).toBe(false);
    expect(await present(page, "button[aria-label='Search']")).toBe(true);
  });

  test("rotate_switch alone: the header has no menu; the rotate items are in the cluster's menu (S31.6; they were buttons in the stack)", async ({ page }) => {
    await boot(page, { view_switch: false, zoom: false, rotate_switch: true }, size);
    // Moved premise: with view_switch off Detail, Layers, Rotate and Reset stay, so the header's menu is there after all.
    expect(await present(page, ".fp-stack")).toBe(false);
    expect(await present(page, ".fp-stack button[aria-label='Rotate left']")).toBe(false);
    expect(await hasItem(page, "rotate:-1")).toBe(true);
    expect(await hasItem(page, "rotate:1")).toBe(true);
  });

  test("zoom: false: no zoom buttons, the header and the sheet stay", async ({ page }) => {
    await boot(page, { zoom: false }, size);
    expect(await present(page, "button[aria-label='Zoom in']")).toBe(false);
    expect(await present(page, "button[aria-label='Fit']")).toBe(false);
    expect(await present(page, ".fp-head")).toBe(true);
    expect(await present(page, ".fp-active")).toBe(true);
  });

  test("a pinned floor and a one-floor layout: no tabs", async ({ page }) => {
    await boot(page, { floor: "ground" }, size);
    expect(await present(page, ".fp-floors")).toBe(false);
    expect(await present(page, "button[aria-label='Search']")).toBe(true);
    const one = { ...layout, floors: { ground: layout.floors.ground } };
    await boot(page, { layout: one }, size);
    expect(await present(page, ".fp-floors")).toBe(false);
    expect(await present(page, ".fp-head")).toBe(true);
  });

  test("View options opens the menu in a popover over the plan and closes again", async ({ page }) => {
    await boot(page, {}, size);
    // Moved premise: it used to unfold the old toolbar in a plain box; the menu is a popover on purpose (it must not push the plan).
    const planBefore = (await boxes(page, ["svg"]))["svg"]!;
    await expect(menuPanel(page)).toHaveCount(0);
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await menuButton(page).click();
    await expect(menuPanel(page)).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    const planOpen = (await boxes(page, ["svg"]))["svg"]!;
    expect(planOpen).toEqual(planBefore);
    await menuButton(page).click();
    await expect(menuPanel(page)).toHaveCount(0);
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  });
});
