import { test, expect, type Page } from "@playwright/test";

// S26.12 (U7 and the review's "draw to a length"): while drawing, the segment from the last point snaps to a 15 degree ray
// (Alt turns it off) and digits typed show in a small field at the rubber band; Enter places the point that far along the
// pointer's direction; Escape clears the typed value first, a second Escape cancels the drawing. Real page.mouse and
// page.keyboard (finding 3), on a blank floor so nothing else attracts the points.

const EDITOR = "floorplan-studio-editor";

async function load(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  // A blank plan is not a valid layout to load, so go through Reset (the confirm is answered yes), which is what a user does.
  await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; window.confirm = () => true; ed.st.planLocked = false; ed.reset(); ed.startDraw("wall"); }, EDITOR);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} .canvas > svg.drawing`)).toHaveCount(1);
}
const canvas = async (page: Page) => (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
const draw = (page: Page) => page.evaluate((tag) => { const d = (document.querySelector(tag) as any).draw; return d ? { n: d.points.length as number, typed: d.typed as string } : null; }, EDITOR);
const walls = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.f.walls.map((w: any) => ({ a: w.a, b: w.b })) as { a: [number, number]; b: [number, number] }[], EDITOR);
const angle = (w: { a: number[]; b: number[] }) => (Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI;
const length = (w: { a: number[]; b: number[] }) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** First point at the middle of the canvas; the pointer then goes `px` pixels away at `deg` degrees on the screen. */
async function aim(page: Page, deg: number, px: number) {
  const c = await canvas(page), ax = c.x + c.width / 2 - 150, ay = c.y + c.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.click(ax, ay);
  const bx = ax + px * Math.cos((deg * Math.PI) / 180), by = ay + px * Math.sin((deg * Math.PI) / 180);
  await page.mouse.move(bx, by, { steps: 5 });
  return { ax, ay, bx, by };
}

test("the pointer at 17 degrees draws the wall at 15 degrees", async ({ page }) => {
  await load(page);
  const { bx, by } = await aim(page, 17, 300);
  await page.mouse.click(bx, by);
  await page.keyboard.press("Enter");
  const w = await walls(page);
  expect(w).toHaveLength(1);
  expect(Math.abs(angle(w[0]) - 15)).toBeLessThan(0.1); // whole cm over a 300 px run
  expect(w[0].b.every(Number.isInteger)).toBe(true);
});

test("a pointer at 34 degrees draws it at 30, and the rubber band already shows the snapped end", async ({ page }) => {
  await load(page);
  const { bx, by } = await aim(page, 34, 300);
  const pts = await page.locator(`${EDITOR} .canvas > svg polyline[data-draw="path"]`).getAttribute("points");
  const [a, b] = pts!.trim().split(/\s+/).map((p) => p.split(",").map(Number));
  expect(Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI - 30)).toBeLessThan(0.05);
  await page.mouse.click(bx, by);
  await page.keyboard.press("Enter");
  const w2 = (await walls(page))[0];
  expect(Math.abs(angle(w2) - 30)).toBeLessThan(0.1);
  expect(w2.b.every(Number.isInteger)).toBe(true);
});

test("with Alt held the segment is not put on a ray", async ({ page }) => {
  await load(page);
  const c = await canvas(page), ax = c.x + c.width / 2 - 150, ay = c.y + c.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.click(ax, ay);
  await page.keyboard.down("Alt");
  const bx = ax + 400 * Math.cos((17 * Math.PI) / 180), by = ay + 400 * Math.sin((17 * Math.PI) / 180);
  await page.mouse.move(bx, by, { steps: 5 });
  await page.mouse.click(bx, by);
  await page.keyboard.up("Alt");
  await page.keyboard.press("Enter");
  const a = angle((await walls(page))[0]);
  expect(Math.abs(a - 15)).toBeGreaterThan(1);
  expect(Math.abs(a - 17)).toBeLessThan(2);
});

test("typing 350 and Enter places the point 350 cm away along the pointer's direction", async ({ page }) => {
  await load(page);
  await aim(page, 0, 200);
  await page.keyboard.type("350");
  await expect(page.locator(`${EDITOR} .canvas > svg .dr-typed`)).toContainText("350");
  expect((await draw(page))?.typed).toBe("350");
  await page.keyboard.press("Enter");
  expect(await draw(page)).toEqual({ n: 2, typed: "" }); // placed, and the drawing goes on
  await expect(page.locator(`${EDITOR} .canvas > svg .dr-typed`)).toHaveCount(0);
  await page.keyboard.press("Enter"); // nothing typed: finishes
  const w = await walls(page);
  expect(w).toHaveLength(1);
  expect(Math.abs(length(w[0]) - 350)).toBeLessThan(0.01);
  expect(Math.abs(angle(w[0]))).toBeLessThan(0.01);
});

test("3.5m is metres, and the direction is the snapped 15 degree ray", async ({ page }) => {
  await load(page);
  await aim(page, 31, 200);
  await page.keyboard.type("3.5m");
  await expect(page.locator(`${EDITOR} .canvas > svg .dr-typed`)).toContainText("3.5m");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const w = await walls(page);
  expect(Math.abs(length(w[0]) - 350)).toBeLessThan(0.01);
  // The direction is the aim, a whole-cm point (R1a), so it is off the exact ray by under half a cm over its run.
  expect(Math.abs(angle(w[0]) - 30)).toBeLessThan(0.3);
});

test("Backspace takes back a typed digit first; a second Escape cancels, the first only clears the typed value", async ({ page }) => {
  await load(page);
  await aim(page, 0, 200);
  await page.keyboard.type("35");
  await page.keyboard.press("Backspace");
  expect(await draw(page)).toEqual({ n: 1, typed: "3" }); // the point stays
  await page.keyboard.press("Escape");
  expect(await draw(page)).toEqual({ n: 1, typed: "" }); // cleared, still drawing
  await page.keyboard.press("Escape");
  expect(await draw(page)).toBeNull(); // cancelled
  expect(await walls(page)).toHaveLength(0);
});

test("a typed 0 or 20000 places nothing and keeps the field; letters and digits with no point yet type nothing", async ({ page }) => {
  await load(page);
  await page.keyboard.type("12");
  await expect(page.locator(`${EDITOR} .canvas > svg .dr-typed`)).toHaveCount(0); // no point yet
  await aim(page, 0, 200);
  for (const bad of ["0", "20000"]) {
    await page.keyboard.type(bad);
    await page.keyboard.press("Enter");
    expect(await draw(page)).toEqual({ n: 1, typed: bad });
    await page.keyboard.press("Escape");
  }
  await page.keyboard.type("ab");
  expect((await draw(page))?.typed).toBe("");
});

test("CSS pair: the typed field is readable text that never takes a click", async ({ page }) => {
  await load(page);
  await aim(page, 0, 200);
  await page.keyboard.type("350");
  const t = page.locator(`${EDITOR} .canvas > svg .dr-typed`);
  await expect(t).toHaveCount(1);
  const css = await t.evaluate((el) => { const c = getComputedStyle(el); return { pe: c.pointerEvents, fill: c.fill, size: parseFloat(c.fontSize), stroke: c.stroke }; });
  expect(css.pe).toBe("none");
  expect(css.fill).not.toBe("none");
  expect(css.stroke).not.toBe("none"); // a halo, so it reads over a room fill
  expect(css.size).toBeGreaterThan(0);
});

// Opus review R1b: a corner catches the pointer before the 15 degree ray does, even when the corner is off every ray.
// The old test compared the corner snap with the plain grid point; a corner that sits on a grid point read as "nothing caught it".
test("a click exactly on a wall's corner joins it, though the corner is 18 degrees off the ray from the last point", async ({ page }) => {
  await load(page);
  await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; ed.st.edit((f: any) => { f.walls.push({ id: "w-corner", a: [500, 300], b: [500, 500], kind: "wall" }); }); ed.requestUpdate(); }, EDITOR);
  const at = (x: number, y: number) => page.evaluate(([tag, x, y]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const m = svg.getScreenCTM()!, p = new DOMPoint(x as number, y as number).matrixTransform(m);
    return [p.x, p.y];
  }, [EDITOR, x, y] as const);
  const c = await canvas(page);
  const [sx, sy] = await at(200, 200), [bx, by] = await at(500, 300);
  for (const [x, y] of [[sx, sy], [bx, by]]) { expect(x).toBeGreaterThan(c.x); expect(x).toBeLessThan(c.x + c.width); expect(y).toBeGreaterThan(c.y); expect(y).toBeLessThan(c.y + c.height); }
  await page.mouse.move(sx, sy); await page.mouse.click(sx, sy);
  await page.mouse.move(bx, by, { steps: 5 });
  await page.mouse.click(bx, by);
  await page.keyboard.press("Enter");
  const w = (await walls(page)).filter((x) => x.a[0] === 200 && x.a[1] === 200);
  expect(w).toHaveLength(1);
  expect(w[0].b).toEqual([500, 300]);
});
