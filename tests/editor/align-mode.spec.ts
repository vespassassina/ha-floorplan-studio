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
