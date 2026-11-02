import { test, expect, type Page } from "@playwright/test";
import { validate, type Layout } from "../../src/core/schema";

// S40.2: Move and turn the trace image. Real mouse and keyboard (finding 3); undo steps are counted on the editor's history.

const EDITOR = "floorplan-studio-editor";
const IMG = `${EDITOR} svg image.trace`;
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const traceOf = async (page: Page) => (await layoutOf(page)).floors.ground.trace!;
const hist = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const moving = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).traceMove as boolean, EDITOR);
const selOf = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR);
const viewOf = (page: Page) => page.evaluate((tag) => ({ ...(document.querySelector(tag) as any).st.view }), EDITOR);

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
/** Screen pixels per plan cm, read off the drawn image. */
async function pxPerCm(page: Page) {
  return (await page.locator(IMG).boundingBox())!.width / (await traceOf(page)).w;
}
/** Where a room is drawn: a press here, with Move off, selects that room. */
async function roomSpot(page: Page) {
  const b = (await page.locator(`${EDITOR} svg polygon[data-r]`).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
const rot = async (page: Page, v: string) => { await page.locator("#traceRot").fill(v); await page.locator("#traceRot").press("Enter"); };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("S40.2: Move is only offered with an image loaded and shown", async ({ page }) => {
  await openTrace(page);
  await expect(page.locator("#traceMove")).toHaveCount(0);
  await page.locator("#traceFile").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: await png(page, 20, 10) });
  await expect(page.locator("#traceMove")).toHaveCount(1);
  await page.locator("#traceOn").uncheck();
  await expect(page.locator("#traceMove")).toHaveCount(0);
});

test("S40.2: with Move on, a 100 px drag moves x and y by the matching cm in one undo step; nothing under it is selected", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  await expect(page.locator("#traceMove")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#statusBar")).toContainText("Move: drag the image, arrows nudge it");
  const k = await pxPerCm(page), before = await traceOf(page), h0 = await hist(page);
  await dragBy(page, await roomSpot(page), 100, 40);
  const t = await traceOf(page);
  expect(t.x - before.x).toBeCloseTo(100 / k, 0);
  expect(t.y - before.y).toBeCloseTo(40 / k, 0);
  expect(Math.abs(t.x - before.x)).toBeGreaterThan(1); // asymmetric and non-trivial: 100 px is more than a centimetre here
  expect([t.w, t.rot, t.src]).toEqual([before.w, before.rot, before.src]);
  expect(await hist(page)).toBe(h0 + 1);
  expect(await selOf(page)).toBeNull(); // the room under the press was not selected
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ControlOrMeta+z");
  const back = await traceOf(page);
  expect([back.x, back.y]).toEqual([before.x, before.y]);
});

test("S40.2: a drag that ends where it started adds no undo step", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  const before = await layoutOf(page), h0 = await hist(page), from = await roomSpot(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 4 });
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.up();
  expect(await layoutOf(page)).toEqual(before);
  expect(await hist(page)).toBe(h0);
});

test("S40.2: with Move off, a press on a room still selects it and the image stays", async ({ page }) => {
  await load(page);
  const before = await traceOf(page), from = await roomSpot(page);
  await page.mouse.click(from.x, from.y);
  expect(await selOf(page)).not.toBeNull();
  expect(await traceOf(page)).toEqual(before);
});

test("S40.2: Move on, arrows nudge 1 cm and Shift 10 cm, one undo step each; the selection and the view stay", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  const t0 = await traceOf(page), h0 = await hist(page), v0 = await viewOf(page);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ArrowRight");
  expect((await traceOf(page)).x).toBe(t0.x + 1);
  await page.keyboard.press("Shift+ArrowRight");
  expect((await traceOf(page)).x).toBe(t0.x + 11);
  await page.keyboard.press("ArrowUp");
  expect((await traceOf(page)).y).toBe(t0.y - 1);
  await page.keyboard.press("Shift+ArrowDown");
  expect((await traceOf(page)).y).toBe(t0.y + 9);
  expect(await hist(page)).toBe(h0 + 4);
  expect(await selOf(page)).toBeNull();
  expect(await viewOf(page)).toEqual(v0);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await traceOf(page)).y).toBe(t0.y - 1); // one press, one step
});

test("S40.2: with Move off the arrows pan the view as before and the image stays", async ({ page }) => {
  await load(page);
  const before = await traceOf(page), v0 = await viewOf(page), h0 = await hist(page);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ArrowRight");
  expect((await viewOf(page)).x).not.toBe(v0.x);
  expect(await traceOf(page)).toEqual(before);
  expect(await hist(page)).toBe(h0);
});

test("S40.2: the Rotation field sets rot (-180..180 shown, 0..360 stored), the image turns, the same value is no undo step", async ({ page }) => {
  await load(page);
  const h0 = await hist(page);
  await rot(page, "30");
  expect((await traceOf(page)).rot).toBe(30);
  expect(await hist(page)).toBe(h0 + 1);
  const m = await page.locator(IMG).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform));
  expect(m.a).toBeCloseTo(Math.cos(Math.PI / 6), 3);
  expect(m.b).toBeCloseTo(Math.sin(Math.PI / 6), 3);
  await rot(page, "30");
  expect(await hist(page)).toBe(h0 + 1); // the same value
  await rot(page, "-90");
  expect((await traceOf(page)).rot).toBe(270);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await expect(page.locator("#traceRot")).toHaveValue("-90");
  await rot(page, "12.3");
  expect((await traceOf(page)).rot).toBe(12.3);
  await rot(page, "999"); // out of range: refused
  expect((await traceOf(page)).rot).toBe(12.3);
  await expect(page.locator("#traceRot")).toHaveValue("12.3");
  await rot(page, ""); // a cleared box
  expect((await traceOf(page)).rot).toBe(12.3);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("S40.2: a turned image still follows the pointer", async ({ page }) => {
  await load(page);
  await rot(page, "90");
  await page.locator("#traceMove").click();
  const before = await traceOf(page);
  await dragBy(page, await roomSpot(page), 80, 0);
  const t = await traceOf(page);
  expect(t.x).toBeGreaterThan(before.x + 1);
  expect(t.y).toBe(before.y);
});

test("S40.2: Move turns off on Escape, Scale, Hide, closing the panel and Remove", async ({ page }) => {
  await load(page);
  const on = async () => { await page.locator("#traceMove").click(); expect(await moving(page)).toBe(true); };
  await on();
  await page.locator(EDITOR).focus();
  await page.keyboard.press("Escape");
  expect(await moving(page)).toBe(false);
  await expect(page.locator("#traceMove")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#tracePanel")).toBeVisible(); // that Escape only ended Move
  await expect(page.locator("#statusBar")).not.toContainText("Move:");
  await on();
  await page.locator("#traceScale").click();
  expect(await moving(page)).toBe(false);
  await page.keyboard.press("Escape");
  await on();
  await page.locator("#traceOn").uncheck();
  expect(await moving(page)).toBe(false);
  await page.locator("#traceOn").check();
  await expect(page.locator("#traceMove")).toHaveAttribute("aria-pressed", "false"); // showing it again does not resume Move
  await on();
  await page.locator("#traceClose").click();
  expect(await moving(page)).toBe(false);
  await openTrace(page);
  await on();
  await page.locator("#traceRemove").click();
  expect(await moving(page)).toBe(false);
});

test("S40.2: a second Escape, after Move is off, closes the panel as before", async ({ page }) => {
  await load(page);
  await page.locator("#traceMove").click();
  await page.locator(EDITOR).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tracePanel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tracePanel")).toHaveCount(0);
});
