import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";
import { floorPlace, stairReport } from "../../src/core";
import { FIRST_TO_GROUND } from "../fixtures/hand-align-truth";

// S29.11: the stair report rows and Align stairs, and the panel's controls at 1024 x 768 and 748 x 800.
// The expected numbers come from core's own `stairReport` and `floorPlace` on the page's live layout (the report is
// asserted against the function the spec names), and from the fixture's truth for Align stairs. Real clicks and keys.

const EDITOR = "floorplan-studio-editor";
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const depth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);

async function setup(page: Page, size = { width: 1280, height: 800 }, mutate?: (l: any) => void) {
  await page.setViewportSize(size);
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  const l = JSON.parse(JSON.stringify(FIXTURE));
  mutate?.(l);
  await page.evaluate(([tag, x]) => { (document.querySelector(tag as string) as any).layout = x; }, [EDITOR, l] as const);
  await page.locator('.chip[data-f="first"]').click();
}
const openAlign = async (page: Page) => { await page.locator("#mFloors > summary").click(); await page.locator("#alignFloor").click(); await expect(page.locator("#alignPanel")).toBeVisible(); };
async function press(page: Page, sel: string) {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}
/** The report rows as the panel shows them, parsed: name, cm, name below, degrees or null. */
async function rows(page: Page) {
  const texts = await page.locator("#alignStairs li").allTextContents();
  return texts.map((t) => {
    const m = /^(.*): (\d+(?:\.\d+)?) cm from (.*?)(?:, (\d+(?:\.\d+)?)° off)?$/.exec(t.trim());
    if (!m) throw new Error(`stair row not in the form "Name: N cm from Other[, D° off]": ${t}`);
    return { name: m[1], cm: Number(m[2]), from: m[3], deg: m[4] === undefined ? null : Number(m[4]) };
  });
}
const truth = async (page: Page) => { const l = await layoutOf(page); return stairReport(l.floors.first, l.floors.ground, floorPlace(l, "first", "ground")); };

test("the report's numbers are stairReport's and change after a press", async ({ page }) => {
  await setup(page);
  await openAlign(page);
  const before = await rows(page), t0 = await truth(page);
  expect(before).toHaveLength(t0.length);
  expect(t0.length).toBeGreaterThan(0);
  expect(before[0].name).toBe(t0[0].name);
  expect(before[0].from).toBe(t0[0].nearest!.name);
  expect(Math.abs(before[0].cm - t0[0].distance!)).toBeLessThan(1);
  expect(Math.abs(before[0].deg! - t0[0].angle!)).toBeLessThan(0.1);
  await page.locator('[data-step="50"]').click();
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await rows(page))[0].cm).not.toBe(before[0].cm);
  const after = await rows(page), t1 = await truth(page);
  expect(Math.abs(after[0].cm - t1[0].distance!)).toBeLessThan(1);
  expect(Math.abs(after[0].deg! - t1[0].angle!)).toBeLessThan(0.1);
  await page.locator('[data-angle="3"]').click();
  await page.locator(EDITOR).focus();
  await page.keyboard.press(".");
  await expect.poll(async () => (await rows(page))[0].deg).not.toBe(after[0].deg);
  const t2 = await truth(page), turned = await rows(page);
  expect(Math.abs(turned[0].deg! - t2[0].angle!)).toBeLessThan(0.1);
});

test("Align stairs lays the stairs on the stairs below in one step and says what it did", async ({ page }) => {
  await setup(page);
  await openAlign(page);
  const d0 = await depth(page);
  await expect(page.locator("#alignStairsBtn")).toBeEnabled();
  await press(page, "#alignStairsBtn");
  await expect.poll(() => depth(page)).toBe(d0 + 1);
  const l = await layoutOf(page), p = floorPlace(l, "first", "ground");
  expect(Math.abs(p.turn - FIRST_TO_GROUND.turn)).toBeLessThan(0.2);
  expect(Math.hypot(p.shift[0] - FIRST_TO_GROUND.shift[0], p.shift[1] - FIRST_TO_GROUND.shift[1])).toBeLessThan(2);
  await expect(page.locator("#status")).toHaveText(/^Aligned First stairs to Ground stairs: moved \d+ cm, turned \d+(\.\d)?°$/);
  const r = await rows(page);
  expect(r[0].cm).toBeLessThan(2);
  expect(r[0].deg!).toBeLessThan(0.2);
  await page.locator("#undo").click();
  expect(await depth(page)).toBe(d0);
});

test("a round stair moves and does not turn, and the status says so", async ({ page }) => {
  const disc = Array.from({ length: 16 }, (_, i) => [Math.round((335.8 + 40 * Math.cos((i * Math.PI) / 8)) * 10) / 10, Math.round((258.2 + 40 * Math.sin((i * Math.PI) / 8)) * 10) / 10]);
  await setup(page, undefined, (l) => { Object.assign(l.floors.first.stairs[0], { shape: "round", pts: disc, dia: 80, inner: 20, steps: 12, rot: 0 }); });
  await openAlign(page);
  await expect(page.locator("#alignStairsBtn")).toBeEnabled();
  const row = (await page.locator("#alignStairs li").first().textContent())!;
  expect(row).not.toContain("off"); // a round stair has no axis: distance only
  await press(page, "#alignStairsBtn");
  await expect(page.locator("#status")).toHaveText(/^Aligned First stairs to Ground stairs: moved \d+ cm \(round stairs: moved, not turned\)$/);
  const l = await layoutOf(page);
  expect((l.floors.first as any).rotation ?? 0).toBe(0);
});

test("Align stairs is disabled with no stairs below, and the report says where there are none", async ({ page }) => {
  await setup(page, undefined, (l) => { l.floors.ground.stairs = []; });
  await openAlign(page);
  await expect(page.locator("#alignStairsBtn")).toBeDisabled();
  await expect(page.locator("#alignStairsNone")).toHaveText("No stairs on Ground");
  await expect(page.locator("#alignStairs li")).toHaveCount(0);
});

test("the report says so when this floor has no stairs", async ({ page }) => {
  await setup(page, undefined, (l) => { l.floors.first.stairs = []; });
  await openAlign(page);
  await expect(page.locator("#alignStairsBtn")).toBeDisabled();
  await expect(page.locator("#alignStairsNone")).toHaveText("No stairs on this floor");
});

test("under Lock plan Align stairs is refused and writes nothing", async ({ page }) => {
  await setup(page);
  await page.locator("#fixPlan").check();
  await openAlign(page);
  const d0 = await depth(page);
  await press(page, "#alignStairsBtn");
  await expect(page.locator("#bannerUnfix")).toHaveText("Unlock");
  expect(await depth(page)).toBe(d0);
});

for (const size of [{ width: 1024, height: 768 }, { width: 748, height: 800 }]) {
  test(`${size.width} x ${size.height}: every panel control is its own top element at its centre`, async ({ page }) => {
    await setup(page, size);
    await openAlign(page);
    const ids = await page.evaluate((tag) => [...(document.querySelector(tag) as any).shadowRoot.querySelectorAll("#alignPanel button, #alignPanel input")].map((e: Element) => e.id || e.getAttribute("data-step") || e.getAttribute("data-angle")), EDITOR);
    expect(ids.length).toBeGreaterThanOrEqual(18);
    const n = await page.evaluate((tag) => (document.querySelector(tag) as any).shadowRoot.querySelectorAll("#alignPanel button, #alignPanel input").length, EDITOR);
    for (let i = 0; i < n; i++) {
      const own = await page.evaluateHandle(([tag, k]) => (document.querySelector(tag as string) as any).shadowRoot.querySelectorAll("#alignPanel button, #alignPanel input")[k as number], [EDITOR, i] as const);
      await (own.asElement()!).scrollIntoViewIfNeeded();
      const hit = await page.evaluate(([tag, k]) => {
        const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
        const el = root.querySelectorAll("#alignPanel button, #alignPanel input")[k as number] as HTMLElement;
        const r = el.getBoundingClientRect(), top = root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { ok: top === el || el.contains(top), id: el.id || el.getAttribute("data-step") || el.getAttribute("data-angle"), top: top ? `${top.tagName}#${top.id}` : "none", w: r.width, h: r.height };
      }, [EDITOR, i] as const);
      expect(hit.ok, `${hit.id} is covered by ${hit.top}`).toBe(true);
      expect(hit.w, hit.id!).toBeGreaterThan(0);
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sw).toBeLessThanOrEqual(0);
  });
}

test.describe("a coarse pointer", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("every panel button and box is 44 px tall, buttons 44 px wide", async ({ page }) => {
    await setup(page, { width: 748, height: 800 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await openAlign(page);
    const small = await page.evaluate((tag) => [...(document.querySelector(tag) as any).shadowRoot.querySelectorAll("#alignPanel button, #alignPanel input")].map((b: HTMLElement) => { const r = b.getBoundingClientRect(); return { id: b.id || b.getAttribute("data-step") || b.getAttribute("data-angle"), w: r.width, h: r.height, input: b.tagName === "INPUT" }; }).filter((b) => b.h < 43.5 || (!b.input && b.w < 43.5)), EDITOR);
    expect(small).toEqual([]);
  });
});

test("reduced motion leaves no running animation after presses and Align stairs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await openAlign(page);
  await press(page, "#alignRight");
  await press(page, "#alignTurnR");
  await press(page, "#alignStairsBtn");
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a as CSSAnimation).animationName ?? a.constructor.name));
  expect(running).toEqual([]);
});
