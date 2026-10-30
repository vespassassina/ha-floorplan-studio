import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, type Layout } from "../../src/core/schema";

// S40 review fixes for Move and the Rotation field. Real mouse and keyboard (finding 3); undo steps are counted on the editor's history.

const EDITOR = "floorplan-studio-editor";
const IMG = `${EDITOR} svg image.trace`;
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const traceOf = async (page: Page) => (await layoutOf(page)).floors.ground.trace!;
const hist = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const moving = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).traceMove as boolean, EDITOR);

/** A PNG drawn in the page: left half red, right half blue. */
async function png(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e00"; g.fillRect(0, 0, c.width / 2, c.height);
    g.fillStyle = "#00e"; g.fillRect(c.width / 2, 0, c.width / 2, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h] as const);
  return Buffer.from(b64, "base64");
}
async function openTrace(page: Page) {
  await page.locator(`details.menu > summary:text-is("Edit")`).click();
  await page.locator("#traceBtn").click();
  await expect(page.locator("#tracePanel")).toBeVisible();
}
async function load(page: Page) {
  await openTrace(page);
  await page.locator("#traceFile").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: await png(page, 20, 10) });
  await expect(page.locator(IMG)).toHaveCount(1, { timeout: 15000 });
}
/** Where a room is drawn: a press here, with Move off, selects that room. */
async function roomSpot(page: Page) {
  const b = (await page.locator(`${EDITOR} svg polygon[data-r]`).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const rot = async (page: Page, v: string) => { await page.locator("#traceRot").fill(v); await page.locator("#traceRot").press("Enter"); };

const FIXTURE = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const menu = (page: Page, name: string) => page.locator(`details.menu > summary:text-is("${name}")`).click();
const drawPoints = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).draw?.points?.length ?? -1 as number, EDITOR);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("S40 review 1: every typed rotation leaves a layout that validates; the box shows what was stored", async ({ page }) => {
  await load(page);
  const cases: [string, number, string][] = [
    ["-180", 180, "180"], ["-179.96", 180, "180"], ["-0.05", 0, "0"], ["-0.04", 0, "0"], ["0", 0, "0"], ["0.04", 0, "0"],
    ["179.95", 180, "180"], ["179.96", 180, "180"], ["180", 180, "180"], ["-0.06", 359.9, "-0.1"], ["-90", 270, "-90"],
  ];
  for (const [typed, stored, shown] of cases) {
    await rot(page, "45"); // a different value first, so every case is a real change
    await rot(page, typed);
    const v = validate(await layoutOf(page));
    expect(v.ok, `${typed}: ${v.ok ? "" : v.errors.join("; ")}`).toBe(true);
    expect((await traceOf(page)).rot, typed).toBe(stored);
    await expect(page.locator("#traceRot"), typed).toHaveValue(shown);
  }
});

test("S40 review 2: starting Draw turns Move off, and the clicks add points without moving the image", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  expect(await moving(page)).toBe(true);
  const before = await traceOf(page), h0 = await hist(page);
  await menu(page, "Add");
  const chain = await page.locator("#drawRoom").evaluate((e) => { const out: string[] = []; for (let d = e.closest("details.sub"); d; d = d.parentElement?.closest("details.sub") ?? null) out.unshift(d.id); return out; });
  for (const sub of chain) await page.locator(`#${sub} > summary`).click();
  await page.locator("#drawRoom").click();
  expect(await moving(page)).toBe(false);
  await expect(page.locator("#traceMove")).toHaveAttribute("aria-pressed", "false");
  const b = (await page.locator(`${EDITOR} svg`).first().boundingBox())!;
  for (const [fx, fy] of [[0.55, 0.2], [0.8, 0.2], [0.8, 0.45]]) await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  expect(await drawPoints(page)).toBe(3);
  const t = await traceOf(page);
  expect([t.x, t.y]).toEqual([before.x, before.y]);
  expect(await hist(page)).toBe(h0);
});

test("S40 review 3: the Move hint sits in the Trace panel and is really seen", async ({ page }) => {
  await load(page);
  await expect(page.locator("#traceMoveHint")).toHaveCount(0);
  await page.locator("#traceMove").click();
  const hint = page.locator("#traceMoveHint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("drag the image, arrows nudge it");
  const h = (await hint.boundingBox())!, p = (await page.locator("#tracePanel").boundingBox())!;
  expect(h.x).toBeGreaterThanOrEqual(p.x);
  expect(h.y).toBeGreaterThanOrEqual(p.y);
  expect(h.x + h.width).toBeLessThanOrEqual(p.x + p.width + 1);
  expect(h.y + h.height).toBeLessThanOrEqual(p.y + p.height + 1);
  const top = await page.evaluate(([tag, x, y]) => {
    const e = (document.querySelector(tag as string) as any).renderRoot.elementFromPoint(x, y) as Element | null;
    return e?.closest("#traceMoveHint") ? "hint" : e?.id || e?.tagName;
  }, [EDITOR, h.x + h.width / 2, h.y + h.height / 2] as const);
  expect(top).toBe("hint");
  await page.locator(EDITOR).focus();
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
});

test("S40 review 4: Escape in a trace drag puts the image back, adds no undo step and ends Move", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  const before = await traceOf(page), h0 = await hist(page), from = await roomSpot(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.mouse.move(from.x + 90, from.y + 45, { steps: 4 });
  const live = () => page.evaluate((tag) => (document.querySelector(tag) as any).st.f.trace.x as number, EDITOR);
  expect(await live()).not.toBe(before.x); // the drag is live
  await page.keyboard.press("Escape");
  await page.mouse.move(from.x + 150, from.y + 80, { steps: 4 });
  await page.mouse.up();
  const t = await traceOf(page);
  expect([t.x, t.y]).toEqual([before.x, before.y]);
  expect(await live()).toBe(before.x); // the editor's own state, not only the exported layout
  expect(await hist(page)).toBe(h0);
  expect(await moving(page)).toBe(false);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("S40 review 5: a floor switch turns Move off, and coming back does not resume it", async ({ page }) => {
  await page.evaluate(([tag, x]) => { (document.querySelector(tag as string) as any).layout = x; }, [EDITOR, JSON.parse(JSON.stringify(FIXTURE))] as const);
  await page.locator('.chip[data-f="ground"]').click();
  await load(page);
  await page.locator("#traceMove").click();
  expect(await moving(page)).toBe(true);
  await page.locator('.chip[data-f="first"]').click();
  expect(await moving(page)).toBe(false);
  await page.locator('.chip[data-f="ground"]').click();
  expect(await moving(page)).toBe(false);
  await expect(page.locator("#traceMove")).toHaveAttribute("aria-pressed", "false");
});

// Opus re-check of S40: Align and Place are Inspector modes with their own mouse handling; Move must not stay armed under them.
test("S40 re-check: opening Align turns Move off", async ({ page }) => {
  await page.evaluate(([tag, x]) => { (document.querySelector(tag as string) as any).layout = x; }, [EDITOR, JSON.parse(readFileSync("tests/fixtures/align-house.json", "utf8"))] as const);
  await page.locator('.chip[data-f="first"]').click();
  await load(page);
  await page.locator("#traceMove").click();
  expect(await moving(page)).toBe(true); // control: it was on
  await page.locator("#mFloors > summary").click();
  await page.locator("#alignFloor").click();
  await expect(page.locator('aside [role=tab][data-mode="align"]')).toHaveAttribute("aria-selected", "true");
  expect(await moving(page)).toBe(false);
});

test("S40 re-check: opening Place turns Move off", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  expect(await moving(page)).toBe(true); // control: it was on
  // The Place button needs Home Assistant data for a room; the method is what the button calls (as tests/editor/help-key.spec.ts does).
  await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; ed.ha = { floors: [], areas: [], entities: [] }; ed.openPlace(0); }, EDITOR);
  await expect(page.locator('aside [role=tab][data-mode="place"]')).toHaveAttribute("aria-selected", "true");
  expect(await moving(page)).toBe(false);
});
