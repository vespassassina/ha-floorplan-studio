import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Layout, Pt } from "../../src/core/schema";
import { FIRST_TO_GROUND, GROUND_TO_BASEMENT, type TruePlace } from "../fixtures/hand-align-truth";
import { seeded, starFloor } from "../fixtures/align-turn";

// S30.8: the Align panel shows and applies the turn. The ground of `hand-align-house.json` is stored with no pose; its
// truth is GROUND_TO_BASEMENT (turn -2.50, shift [-57, 112]). Real page.mouse at button centres (finding 3); the corners
// are compared in the house, so a sign, an axis or a pivot error fails. Numbers are asymmetric and not round.

const EDITOR = "floorplan-studio-editor";
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const STRESS = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const depth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const searches = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).alignSearches as number, EDITOR);
const frame = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function setup(page: Page, floor: string, mutate?: (l: any) => void, size = { width: 1280, height: 800 }, layout: any = FIXTURE) {
  await page.setViewportSize(size);
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  const l = JSON.parse(JSON.stringify(layout));
  mutate?.(l);
  await page.evaluate(([tag, x]) => { (document.querySelector(tag as string) as any).layout = x; }, [EDITOR, l] as const);
  await page.locator(`.chip[data-f="${floor}"]`).click();
}
const openAlign = async (page: Page) => { await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); await expect(page.locator("#alignPanel")).toBeVisible(); };
async function press(page: Page, sel: string) {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

/** Where the stored outline of `floor` sits in the house: its pose applied (the floor below the ground is the basement, which has no pose). */
const corners = async (page: Page, floor: string): Promise<Pt[]> => {
  const f = (await layoutOf(page)).floors[floor] as any, rot = ((f.rotation ?? 0) * Math.PI) / 180, off = f.offset ?? [0, 0];
  return f.outline.map((p: Pt) => [p[0] * Math.cos(rot) - p[1] * Math.sin(rot) + off[0], p[0] * Math.sin(rot) + p[1] * Math.cos(rot) + off[1]] as Pt);
};
const truthCorners = (stored: Pt[], t: TruePlace): Pt[] => stored.map((p) => {
  const a = (t.turn * Math.PI) / 180;
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a) + t.shift[0], p[0] * Math.sin(a) + p[1] * Math.cos(a) + t.shift[1]] as Pt;
});
const worst = (a: Pt[], b: Pt[]) => a.reduce((m, p, i) => Math.max(m, Math.hypot(p[0] - b[i][0], p[1] - b[i][1])), 0);
const rotationOf = async (page: Page, floor: string) => ((await layoutOf(page)).floors[floor] as any).rotation as number | undefined;
const offsetOf = async (page: Page, floor: string) => ((await layoutOf(page)).floors[floor] as any).offset as Pt | undefined;

test("the ground from no pose says the turn and the other turn; Apply writes both in one undo step, Undo restores no pose, Move works after", async ({ page }) => {
  await setup(page, "ground");
  const stored = ((await layoutOf(page)).floors.ground.outline) as Pt[];
  const d0 = await depth(page);
  await openAlign(page);
  await expect(page.locator("#alignScore")).toHaveText(/^68 % match$/);
  await expect(page.locator("#alignMove")).toHaveText(/^Turn 2\.5° anticlockwise, move the centre \d+ cm (left|right)/);
  await expect(page.locator("#alignAlt")).toHaveText(/^A half turn \(177\.5°\) fits about as well \(68 %\)\. Check the plan before you apply it\.$/);
  expect(await rotationOf(page, "ground"), "a preview writes nothing").toBeUndefined();
  await press(page, "#alignApply");
  const err = worst(await corners(page, "ground"), truthCorners(stored, GROUND_TO_BASEMENT));
  expect(err, `worst outline corner ${err} cm from the truth`).toBeLessThan(2);
  expect(Math.abs((await rotationOf(page, "ground"))! - GROUND_TO_BASEMENT.turn)).toBeLessThan(0.2);
  expect(await depth(page)).toBe(d0 + 1);
  await expect(page.locator("#status")).toHaveText(/^Aligned to Basement: 68 % match, turned 2\.5° anticlockwise$/);
  await expect(page.locator("#alignMove")).toHaveText("Already aligned");
  await expect(page.locator("#alignApply")).toBeDisabled();
  await page.locator("#undo").click();
  expect(await rotationOf(page, "ground")).toBeUndefined();
  expect(await offsetOf(page, "ground")).toBeUndefined();
  expect(await depth(page)).toBe(d0);
  await press(page, "#alignRight"); // Move still works after an Apply and an Undo
  await expect.poll(async () => (await offsetOf(page, "ground"))?.[0]).toBe(5);
  await press(page, "#alignApply");
  await press(page, "#alignRight");
  expect(await depth(page)).toBe(d0 + 3);
});

test("a Turn press, ten Move presses and ten undos run no search; a moved wall runs one", async ({ page }) => {
  await setup(page, "ground");
  await openAlign(page);
  const n0 = await searches(page);
  expect(n0, "opening the mode searched once").toBe(1);
  const d0 = await depth(page);
  await press(page, "#alignTurnR");
  for (let i = 0; i < 10; i++) await press(page, "#alignRight");
  expect(await depth(page), "eleven presses, eleven steps").toBe(d0 + 11);
  expect(await rotationOf(page, "ground")).toBe(0.5);
  for (let i = 0; i < 10; i++) await page.locator("#undo").click();
  expect(await searches(page), "a turn, ten moves, ten undos").toBe(n0);
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    el.st.edit((f: any) => { f.outline[0] = [f.outline[0][0] + 7, f.outline[0][1]]; });
    el.requestUpdate();
  }, EDITOR);
  await frame(page);
  expect(await searches(page), "a moved corner").toBe(n0 + 1);
});

test("an edit on the floor below, with Align open on the ground, runs a new search; an edit that keeps its structure does not", async ({ page }) => {
  // Opus review: the memo key holds both floors. Nothing tested the lower half, so dropping it from the key left a stale answer.
  await setup(page, "ground");
  await openAlign(page);
  const n0 = await searches(page);
  expect(n0, "opening the mode searched once").toBe(1);
  // The same hook as the test above, aimed at the basement (the floor below the ground) while Align stays open on the ground.
  const editBelow = (fn: string) => page.evaluate(([tag, body]) => {
    const el = document.querySelector(tag as string) as any;
    el.st.floor = "basement";
    try { el.st.edit(new Function("f", body as string)); } finally { el.st.floor = "ground"; }
    el.requestUpdate();
  }, [EDITOR, fn] as const);
  await editBelow("f.title = 'Cellar';"); // not structure: the same key
  await frame(page);
  expect(await searches(page), "a title is not structure").toBe(n0);
  await editBelow("f.outline[0] = [f.outline[0][0] + 9, f.outline[0][1]];");
  await frame(page);
  expect(await searches(page), "a moved corner of the floor below").toBe(n0 + 1);
});

test("a floor stored at the other turn keeps it: no turn words, only the move, and the first turn is the other-turn line", async ({ page }) => {
  // Stored at -176 the small tier is -176 itself (the prior), so the answer keeps the turn and names 4 as the other one.
  await setup(page, "first", (l) => { l.floors.first.rotation = -176; });
  await openAlign(page);
  await expect(page.locator("#alignMove")).toHaveText(/^Move the centre /);
  await expect(page.locator("#alignAlt")).toHaveText(/^A half turn \(4\.0°\) fits about as well \(\d+ %\)\./);
  await press(page, "#alignApply");
  expect(await rotationOf(page, "first")).toBeCloseTo(-176, 0);
});

test("the first floor stored at the truth's pose says Already aligned and Apply is disabled", async ({ page }) => {
  await setup(page, "first", (l) => { l.floors.first.rotation = FIRST_TO_GROUND.turn; l.floors.first.offset = [...FIRST_TO_GROUND.shift]; });
  await openAlign(page);
  const d0 = await depth(page);
  await expect(page.locator("#alignMove")).toHaveText("Already aligned");
  await expect(page.locator("#alignApply")).toBeDisabled();
  expect(await depth(page)).toBe(d0);
});

test("a weak case (a floor below that shares one wall) shows the weak line and Apply still applies", async ({ page }) => {
  await setup(page, "first", (l) => {
    const g = l.floors.ground, star = starFloor(seeded(4));
    g.outline = star.outline; g.owk = star.outline.map(() => "wall"); g.walls = star.walls; g.rooms = []; g.doors = []; g.openings = []; g.stairs = []; g.devices = []; g.furniture = []; g.unlinked = []; g.extras = [];
  });
  const d0 = await depth(page);
  await openAlign(page);
  await expect(page.locator("#alignScore")).toContainText("Weak match");
  await expect(page.locator("#alignApply")).toBeEnabled();
  await press(page, "#alignApply");
  expect(await depth(page)).toBe(d0 + 1);
  expect(await offsetOf(page, "first")).toBeDefined();
});

test("under Lock plan Apply is refused and writes nothing", async ({ page }) => {
  await setup(page, "ground");
  await page.locator("#fixPlan").check();
  const d0 = await depth(page);
  await openAlign(page);
  await press(page, "#alignApply");
  await expect(page.locator(".banner #bannerUnfix")).toHaveText("Unlock");
  expect(await rotationOf(page, "ground")).toBeUndefined();
  expect(await offsetOf(page, "ground")).toBeUndefined();
  expect(await depth(page)).toBe(d0);
});

test("Align on the heavy stress floor shows the score within 1500 ms of the click", async ({ page }) => {
  await setup(page, "first", (lay) => {
    for (const key of ["ground", "first"]) {
      const f = lay.floors[key];
      for (let i = 0; i < 300; i++) { const x = (i % 30) * 60 + (key === "first" ? 7 : 0), y = Math.floor(i / 30) * 90 + 3 * (i % 7); f.walls.push({ a: [x, y], b: [x + 50, y + 11 + (i % 5)], kind: "external" }); }
    }
  }, undefined, STRESS);
  await page.locator("#mFloors > summary").click();
  const t0 = Date.now();
  await page.locator("#alignFloor").click();
  await expect(page.locator("#alignScore")).toBeVisible({ timeout: 1500 });
  expect(Date.now() - t0).toBeLessThan(1500);
});

for (const size of [{ width: 1024, height: 768 }, { width: 748, height: 800 }]) {
  test(`${size.width} x ${size.height}: Apply and the other-turn line are their own top element at their centre`, async ({ page }) => {
    await setup(page, "ground", undefined, size);
    await openAlign(page);
    await expect(page.locator("#alignAlt")).toBeVisible();
    for (const id of ["alignApply", "alignAlt", "alignMove", "alignScore"]) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const hit = await page.evaluate(([tag, i]) => {
        const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot, el = root.getElementById(i as string)!;
        const r = el.getBoundingClientRect(), top = root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { ok: top === el || el.contains(top), top: top ? `${top.tagName}#${top.id}` : "none", h: r.height };
      }, [EDITOR, id] as const);
      expect(hit.ok, `${id} is covered by ${hit.top}`).toBe(true);
      expect(hit.h, id).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("the other-turn line is text: a floor named with markup shows it as text", async ({ page }) => {
  await setup(page, "ground", (l) => { l.floors.basement.title = '"><img src=x onerror=window.__x=1>'; });
  await openAlign(page);
  await press(page, "#alignApply");
  await expect(page.locator("#status")).toContainText('"><img src=x onerror=window.__x=1>');
  expect(await page.evaluate(() => (window as any).__x)).toBeUndefined();
  expect(await page.locator("#alignPanel img").count()).toBe(0);
});
