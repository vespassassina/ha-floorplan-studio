import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";

// S27.10: Floors, Align to floor below… opens the Align mode of the Inspector, with the floor below drawn as a ghost.
// The fixture is a ground floor and a first floor over one wing, shifted by [137.4, -61.7], so the move is [-137.4, 61.7].
// Real clicks and real keys on the real elements (finding 3).

const EDITOR = "floorplan-studio-editor";
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/align-house.json", "utf8"));
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const offsetOf = async (page: Page, key: string) => (await layoutOf(page)).floors[key].offset;
const depth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, FIXTURE] as const);
  await page.locator('.chip[data-f="first"]').click();
});

const openAlign = async (page: Page) => { await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); };
const close = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;

test("Align opens with the ghost on, names the floor below, the score and the move in words", async ({ page }) => {
  await expect(page.locator(`${EDITOR} svg g.ghost`)).toHaveCount(0);
  await openAlign(page);
  await expect(page.locator('aside [role=tab][data-mode="align"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#alignPanel")).toContainText("Ground");
  await expect(page.locator("#alignScore")).toHaveText(/^(9\d|100) % match$/);
  await expect(page.locator("#alignMove")).toHaveText(/^13[67] cm left, 6[12] cm down$/);
  await expect(page.locator(`${EDITOR} svg g.ghost`)).toHaveCount(1);
  expect(await offsetOf(page, "first")).toBeUndefined(); // a preview writes nothing
});

test("Apply writes the offset in one undo step, says so, and one Undo clears it", async ({ page }) => {
  const d0 = await depth(page);
  await openAlign(page);
  await page.locator("#alignApply").click();
  const o = (await offsetOf(page, "first"))!;
  expect(close(o[0], -137.4) && close(o[1], 61.7), JSON.stringify(o)).toBe(true);
  expect(await depth(page)).toBe(d0 + 1);
  await expect(page.locator("#status")).toHaveText(/^Aligned to Ground: (9\d|100) % match$/);
  await expect(page.locator("#alignMove")).toHaveText("Already aligned");
  await page.locator("#undo").click();
  expect(await offsetOf(page, "first")).toBeUndefined();
  expect(await depth(page)).toBe(d0);
});

test("under Lock plan Apply is refused, writes nothing, and offers Unlock; then it goes through", async ({ page }) => {
  await page.locator("#fixPlan").check();
  const d0 = await depth(page);
  await openAlign(page);
  await page.locator("#alignApply").click();
  await expect(page.locator(".banner #bannerUnfix")).toHaveText("Unlock");
  expect(await offsetOf(page, "first")).toBeUndefined();
  expect(await depth(page)).toBe(d0);
  await page.locator(".banner #bannerUnfix").click();
  await page.locator("#alignApply").click();
  expect(await offsetOf(page, "first")).toBeDefined();
  expect(await depth(page)).toBe(d0 + 1);
});

test("a weak match says so, and Apply still works", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)), f = l.floors.first;
    // a square turned 30 degrees: no edge of it runs along a wall of the ground floor
    const c = Math.cos(Math.PI / 6) * 300, s = Math.sin(Math.PI / 6) * 300;
    f.outline = [[1000, 1000], [1000 + c, 1000 + s], [1000 + c - s, 1000 + s + c], [1000 - s, 1000 + c]];
    f.owk = ["wall", "wall", "wall", "wall"]; f.rooms = []; f.walls = []; f.doors = []; f.openings = []; f.stairs = []; f.devices = []; f.furniture = []; f.unlinked = []; f.extras = [];
    el.layout = l;
  }, EDITOR);
  await page.locator('.chip[data-f="first"]').click();
  await openAlign(page);
  await expect(page.locator("#alignScore")).toContainText("Weak");
  await expect(page.locator("#alignApply")).toBeEnabled();
});

test("the offset fields nudge it, one undo step per change, and Reset deletes the key", async ({ page }) => {
  await openAlign(page);
  const d0 = await depth(page);
  await page.locator("#alignX").fill("50");
  await page.locator("#alignX").press("Enter");
  expect(await offsetOf(page, "first")).toEqual([50, 0]);
  expect(await depth(page)).toBe(d0 + 1);
  await page.locator("#alignY").fill("-20");
  await page.locator("#alignY").press("Enter");
  expect(await offsetOf(page, "first")).toEqual([50, -20]);
  expect(await depth(page)).toBe(d0 + 2);
  await page.locator("#alignX").fill("50"); // unchanged: no step
  await page.locator("#alignX").press("Enter");
  expect(await depth(page)).toBe(d0 + 2);
  await page.locator("#alignX").fill("abc"); // junk: refused, the field goes back
  await page.locator("#alignX").press("Enter");
  expect(await offsetOf(page, "first")).toEqual([50, -20]);
  await expect(page.locator("#alignX")).toHaveValue("50");
  await page.locator("#alignReset").click();
  expect(await offsetOf(page, "first")).toBeUndefined();
  expect(await depth(page)).toBe(d0 + 3);
});

test("Escape and the X close the mode, and the ghost goes with it", async ({ page }) => {
  await openAlign(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#alignPanel")).toHaveCount(0);
  await expect(page.locator(`${EDITOR} svg g.ghost`)).toHaveCount(0);
  await expect(page.locator('aside [role=tab][data-mode="align"]')).toHaveCount(0);
  await openAlign(page);
  await page.locator("#alignClose").click();
  await expect(page.locator("#alignPanel")).toHaveCount(0);
  await expect(page.locator(`${EDITOR} svg g.ghost`)).toHaveCount(0);
});

test("switching floor closes the mode", async ({ page }) => {
  await openAlign(page);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(page.locator("#alignPanel")).toHaveCount(0);
});

test("the mode survives a hass update", async ({ page }) => {
  await openAlign(page);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.hassState = { "light.x": { state: "on" } }; el.ha = { floors: [], areas: [], entities: [] }; }, EDITOR);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.hassState = { "light.x": { state: "off" } }; }, EDITOR);
  await expect(page.locator("#alignPanel")).toHaveCount(1);
  await expect(page.locator(`${EDITOR} svg g.ghost`)).toHaveCount(1);
});

test("a host-driven floor change never renders the Align panel on the old floor (review 27, finding 7)", async ({ page }) => {
  await openAlign(page);
  const renders = await page.evaluate(async (tag) => {
    const el = document.querySelector(tag) as any, log: Array<{ floor: string; key: string | null; mode: string }> = [], orig = el.render.bind(el);
    el.render = () => { log.push({ floor: el.st.floor, key: el.alignKey, mode: el.asideMode }); return orig(); };
    el.floor = "ground"; // the host's property, not a chip click
    await el.updateComplete;
    el.render = orig;
    return log;
  }, EDITOR);
  expect(renders.length).toBeGreaterThan(0);
  for (const r of renders) expect(r.mode === "align" && r.key !== r.floor, JSON.stringify(r)).toBe(false);
  await expect(page.locator("#alignPanel")).toHaveCount(0);
});

test("an offset beyond the coordinate limit says so, not 'Already aligned' (review 27, finding 8)", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.offset = [1e7, 0]; // the limit
    // Shift the first floor 237.4 cm west of where it is stored: laying it on the ground floor then asks for +100 cm in x.
    const mv = (p: number[]) => [p[0] - 237.4, p[1]], f = l.floors.first;
    f.outline = f.outline.map(mv); f.rooms = f.rooms.map((r: any) => ({ ...r, pts: r.pts.map(mv) }));
    f.walls = f.walls.map((w: any) => ({ ...w, a: mv(w.a), b: mv(w.b) }));
    el.layout = l;
  }, EDITOR);
  await page.locator('.chip[data-f="first"]').click();
  await openAlign(page);
  const d0 = await depth(page);
  await expect(page.locator("#alignApply")).toBeEnabled();
  await page.locator("#alignApply").click();
  await expect(page.locator("#status")).not.toHaveText(/Already aligned/);
  await expect(page.locator("#status")).toHaveText(/beyond the limit/);
  expect(await offsetOf(page, "first")).toBeUndefined();
  expect(await depth(page)).toBe(d0);
});

test("no Align search runs while a drag is in progress, nor when a device drag ends (review 27, finding 10; S28.12)", async ({ page }) => {
  // a light on the first floor to drag (rooms of the fixture are snapped to their walls and do not move)
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.first.devices.push({ type: "light", entity: "light.drag_me", x: 400, y: 100 });
    el.layout = l;
  }, EDITOR);
  await page.locator('.chip[data-f="first"]').click();
  await openAlign(page);
  const searches = () => page.evaluate((tag) => (document.querySelector(tag) as any).alignSearches as number, EDITOR);
  const n0 = await searches();
  expect(n0).toBeGreaterThan(0); // opening the mode searched once
  // a real press on the icon (top element checked), then a long drag in many small moves
  const at = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot, g = root.querySelector("svg g[data-x]")!, r = g.getBoundingClientRect();
    for (let a = 4; a < 12; a++) for (let b = 4; b < 12; b++) { const x = r.left + (r.width * a) / 16, y = r.top + (r.height * b) / 16; if (root.elementFromPoint(x, y)?.closest("g[data-x]") === g) return { x, y }; }
    return null;
  }, EDITOR);
  expect(at, "the icon is the top element somewhere").not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(at!.x + i * 3, at!.y + i);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).drag?.type, EDITOR), "a drag is in progress").toBe("dev");
  expect(await searches(), "no search during the drag").toBe(n0);
  await page.mouse.up();
  await expect.poll(() => page.evaluate((tag) => (document.querySelector(tag) as any).drag, EDITOR)).toBeNull();
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  // S28.12: a light moved, not a wall: what the search reads is the same, so the drag's end does not search either
  // (a changed wall searches once: the stress test below).
  expect(await searches(), "no search for the whole gesture").toBe(n0);
});

// S28.12: the memo keys on what the search reads (`alignKey`), not on floor objects, so a nudge and an undo do not search.
test.describe("Align on the stress layout's first floor, made heavy (S28.12)", () => {
  const STRESS = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
  const searches = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).alignSearches as number, EDITOR);
  const frame = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  test.beforeEach(async ({ page }) => {
    // 300 short external walls on a floor give the search real work, like the huge floor of the field report
    await page.evaluate(([tag, l]) => {
      const el = document.querySelector(tag as string) as any, lay = JSON.parse(JSON.stringify(l));
      for (const key of ["ground", "first"]) {
        const f = lay.floors[key];
        for (let i = 0; i < 300; i++) { const x = (i % 30) * 60 + (key === "first" ? 7 : 0), y = Math.floor(i / 30) * 90 + 3 * (i % 7); f.walls.push({ a: [x, y], b: [x + 50, y + 11 + (i % 5)], kind: "external" }); }
      }
      el.layout = lay;
    }, [EDITOR, STRESS] as const);
    await page.locator('.chip[data-f="first"]').click();
    await openAlign(page);
  });

  const nudge = async (page: Page, v: string) => {
    const box = page.locator("#alignX");
    await box.fill(v);
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    await expect(box).not.toBeFocused();
    await frame(page);
    return Date.now() - t0;
  };

  test("10 nudges and 10 undos do not search; a moved wall adds one search; a nudge is quick", async ({ page }) => {
    const n0 = await searches(page);
    expect(n0, "opening the mode searched once").toBe(1);
    const ms: number[] = [];
    for (let i = 1; i <= 10; i++) ms.push(await nudge(page, String(i * 3)));
    expect(await searches(page), "10 nudges").toBe(n0);
    const x = (await layoutOf(page)).floors.first.offset!;
    expect(x[0]).toBe(30);
    for (let i = 0; i < 10; i++) await page.locator("#undo").click();
    expect(await searches(page), "10 undos").toBe(n0);
    expect((await layoutOf(page)).floors.first.offset ?? [0, 0]).toEqual([0, 0]);
    ms.sort((a, b) => a - b);
    expect(ms[5], `median nudge ${ms.join(",")} ms`).toBeLessThan(100);
    // an edit of the structure searches once
    await page.evaluate((tag) => {
      const el = document.querySelector(tag) as any;
      el.st.edit((f: any) => { f.walls[f.walls.length - 1].b = [900, 900]; });
      el.requestUpdate();
    }, EDITOR);
    await frame(page);
    expect(await searches(page), "a moved wall").toBe(n0 + 1);
  });
});
