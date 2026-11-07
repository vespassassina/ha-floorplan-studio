import { test, expect, type Page } from "@playwright/test";

// B54.3: drawing and editing a worktop with the real pointer (finding 3: page.mouse at real coordinates, never an event
// dispatched on the inner element). Undo steps are counted on the editor's own history; points are checked in plan cm.

const EDITOR = "floorplan-studio-editor";
type Pt = [number, number];
/** An L, in cm from the middle of the view. Every point sits on a 50 cm multiple and every edge is axis-aligned, so grid and 15 degree ray snaps leave it as drawn. */
const L: Pt[] = [[-100, -50], [100, -50], [100, 0], [-50, 0], [-50, 100], [-100, 100]];

async function load(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  // A blank plan is not a valid layout to load, so go through Reset (the confirm is answered yes), which is what a user does.
  await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; window.confirm = () => true; ed.st.planLocked = false; ed.reset(); }, EDITOR);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`)).toHaveCount(0);
}
/** The plan point `p`, offset from the middle of the view and snapped to 50 cm, on the screen. */
const screen = (page: Page, p: Pt) => page.evaluate(([tag, q]) => {
  const ed = document.querySelector(tag as string) as any, v = ed.st.view, svg = ed.svgEl as SVGSVGElement;
  const pt = svg.createSVGPoint();
  pt.x = Math.round((v.x + v.w / 2) / 50) * 50 + (q as Pt)[0]; pt.y = Math.round((v.y + v.h / 2) / 50) * 50 + (q as Pt)[1];
  const r = pt.matrixTransform(svg.getScreenCTM()!);
  return { x: r.x, y: r.y };
}, [EDITOR, p] as const);
const state = (page: Page) => page.evaluate((tag) => {
  const ed = document.querySelector(tag) as any, f = ed.st.f;
  return { hist: ed.st.hist.length as number, n: f.furniture.length as number, w: f.furniture.filter((m: any) => m.symbol === "worktop").map((m: any) => ({ pts: m.pts as Pt[], x: m.x as number, y: m.y as number, w: m.w as number, h: m.h as number, rot: m.rot as number })), sel: ed.st.sel, drawing: !!ed.draw };
}, EDITOR);
/** The middle of the view, in plan cm, to turn the L's relative points into the stored ones. */
const origin = (page: Page) => page.evaluate((tag) => { const v = (document.querySelector(tag) as any).st.view; return [Math.round((v.x + v.w / 2) / 50) * 50, Math.round((v.y + v.h / 2) / 50) * 50] as Pt; }, EDITOR);
const abs = (o: Pt, pts: Pt[]) => pts.map((p): Pt => [p[0] + o[0], p[1] + o[1]]);

async function drawL(page: Page, end: "dblclick" | "enter") {
  await page.evaluate((tag) => (document.querySelector(tag) as any).addFurniture("worktop"), EDITOR);
  expect((await state(page)).drawing).toBe(true);
  for (const p of L.slice(0, -1)) { const s = await screen(page, p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
  const last = await screen(page, L[L.length - 1]);
  await page.mouse.move(last.x, last.y);
  if (end === "dblclick") await page.mouse.dblclick(last.x, last.y);
  else { await page.mouse.click(last.x, last.y); await page.keyboard.press("Enter"); }
}
/** The box invariant every writer keeps: x, y, w, h are the points' bounding box and rot is 0. */
function kept(m: { pts: Pt[]; x: number; y: number; w: number; h: number; rot: number }) {
  const xs = m.pts.map((p) => p[0]), ys = m.pts.map((p) => p[1]);
  expect([m.x, m.y, m.w, m.h, m.rot]).toEqual([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0]);
}
async function drawn(page: Page, end: "dblclick" | "enter" = "dblclick") {
  await load(page);
  const before = await state(page);
  await drawL(page, end);
  const after = await state(page), o = await origin(page);
  return { before, after, o };
}

for (const end of ["dblclick", "enter"] as const) {
  test(`a worktop is drawn by clicking points and ended with ${end}: one piece, one undo step, selected`, async ({ page }) => {
    const { before, after, o } = await drawn(page, end);
    expect(after.drawing).toBe(false);
    expect(after.n).toBe(before.n + 1);
    expect(after.hist).toBe(before.hist + 1);
    expect(after.w).toHaveLength(1);
    expect(after.w[0].pts).toEqual(abs(o, L));
    kept(after.w[0]);
    expect(after.sel).toEqual({ t: "furn", i: before.n });
    // the drawn piece paints on the plan (one draw path), as a path in a piece group
    await expect(page.locator(`${EDITOR} .canvas > svg g[data-f="${before.n}"] path`)).toHaveCount(1);
    // and one Undo takes it away whole
    await page.evaluate((tag) => (document.querySelector(tag) as any).st.undo(), EDITOR);
    expect((await state(page)).n).toBe(before.n);
  });
}

test("Escape cancels a worktop in progress and writes nothing; fewer than 3 points writes nothing", async ({ page }) => {
  await load(page);
  const before = await state(page);
  await page.evaluate((tag) => (document.querySelector(tag) as any).addFurniture("worktop"), EDITOR);
  for (const p of L.slice(0, 2)) { const s = await screen(page, p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
  await page.keyboard.press("Enter"); // two points: too few
  let st = await state(page);
  expect(st.n).toBe(before.n);
  expect(st.hist).toBe(before.hist);
  await page.evaluate((tag) => (document.querySelector(tag) as any).addFurniture("worktop"), EDITOR);
  for (const p of L.slice(0, 4)) { const s = await screen(page, p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
  await page.keyboard.press("Escape");
  st = await state(page);
  expect(st.drawing).toBe(false);
  expect(st.n).toBe(before.n);
  expect(st.hist).toBe(before.hist);
});

test("a shape that crosses itself is refused with a reason and writes nothing", async ({ page }) => {
  await load(page);
  const before = await state(page);
  await page.evaluate((tag) => (document.querySelector(tag) as any).addFurniture("worktop"), EDITOR);
  for (const p of [[-100, -50], [100, 50], [100, -50], [-100, 50]] as Pt[]) { const s = await screen(page, p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
  await page.keyboard.press("Enter");
  const st = await state(page);
  expect(st.n).toBe(before.n);
  expect(st.hist).toBe(before.hist);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).status as string, EDITOR)).toMatch(/worktop/i);
});

test("dragging a corner moves that corner only: one undo step, the box follows; a press without a move is no step", async ({ page }) => {
  const { after, o } = await drawn(page);
  const i = after.sel && (after.sel as any).i;
  const h = await screen(page, L[2]); // (100, 0): an outer corner
  await page.mouse.move(h.x, h.y);
  await page.mouse.down(); await page.mouse.up(); // a click, no move
  let st = await state(page);
  expect(st.hist).toBe(after.hist);
  expect(st.w[0].pts).toEqual(abs(o, L));
  const to = await screen(page, [150, 50]);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move((h.x + to.x) / 2, (h.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  st = await state(page);
  expect(st.hist).toBe(after.hist + 1);
  const want = abs(o, L); want[2] = [o[0] + 150, o[1] + 50];
  expect(st.w[0].pts).toEqual(want);
  kept(st.w[0]);
  expect(st.n).toBe(after.n);
  expect(i).toBe(after.n - 1);
});

test("a click on an edge adds a corner there, one undo step, and dragging on carries it in the same step", async ({ page }) => {
  const { after, o } = await drawn(page);
  const mid = await screen(page, [0, -50]); // the middle of the top edge, away from every corner
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down(); await page.mouse.up();
  const st = await state(page);
  expect(st.hist).toBe(after.hist + 1);
  expect(st.w[0].pts).toHaveLength(7);
  expect(st.w[0].pts[1]).toEqual([o[0], o[1] - 50]);
  kept(st.w[0]);
  // another press on the left part of the same (now shorter) edge, dragged up: still one step for the whole gesture
  const edge = await screen(page, [-50, -50]);
  const up = await screen(page, [-50, -100]);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(up.x, up.y, { steps: 6 });
  await page.mouse.up();
  const st2 = await state(page);
  expect(st2.hist).toBe(st.hist + 1);
  expect(st2.w[0].pts).toHaveLength(8);
  kept(st2.w[0]);
});

test("Delete on a selected corner removes it; never below 3 corners; a refused Delete is no step", async ({ page }) => {
  const { after, o } = await drawn(page);
  let want = abs(o, L), hist = after.hist;
  // remove the corners that keep the shape simple until 3 are left; the order is fixed so the test is the same on every run
  for (const j of [5, 4, 3]) {
    const p = await screen(page, [want[j][0] - o[0], want[j][1] - o[1]]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down(); await page.mouse.up(); // selects the corner
    await page.keyboard.press("Delete");
    want = want.filter((_, k) => k !== j); hist += 1;
    const st = await state(page);
    expect(st.w[0].pts, `after removing ${j}`).toEqual(want);
    expect(st.hist).toBe(hist);
    kept(st.w[0]);
    expect(st.sel).toEqual({ t: "furn", i: after.n - 1 }); // the piece stays selected, so its other corners can go on being edited
  }
  expect(want).toHaveLength(3);
  const p = await screen(page, [want[1][0] - o[0], want[1][1] - o[1]]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await page.mouse.up();
  await page.keyboard.press("Delete");
  const st = await state(page);
  expect(st.w[0].pts).toEqual(want); // the third corner stays
  expect(st.hist).toBe(hist);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).status as string, EDITOR)).toMatch(/3 corners/i); // a refusal says why (Opus S54, nit 3)
});

test("dragging the body moves every corner by the same step, one undo step", async ({ page }) => {
  const { after, o } = await drawn(page);
  const body = await screen(page, [-75, -25]); // inside the long arm of the L
  const to = { x: body.x + 90, y: body.y + 60 };
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const st = await state(page);
  expect(st.hist).toBe(after.hist + 1);
  const dx = st.w[0].pts[0][0] - (o[0] + L[0][0]), dy = st.w[0].pts[0][1] - (o[1] + L[0][1]);
  expect(Math.hypot(dx, dy)).toBeGreaterThan(20); // it moved
  expect(st.w[0].pts).toEqual(abs(o, L).map((p): Pt => [p[0] + dx, p[1] + dy]));
  kept(st.w[0]);
});

test("the edge hit line is invisible but takes the pointer (computed style pair), and a selected worktop has no scale corners", async ({ page }) => {
  await drawn(page);
  const we = page.locator(`${EDITOR} .canvas > svg line.we`).first();
  await expect(we).toHaveCount(1);
  const cs = await we.evaluate((el) => { const s = getComputedStyle(el); return { pe: s.pointerEvents, stroke: s.stroke, w: s.strokeWidth }; });
  expect(cs.pe).toBe("stroke");
  expect(cs.stroke).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(parseFloat(cs.w)).toBeGreaterThanOrEqual(10);
  await expect(page.locator(`${EDITOR} .canvas > svg [data-fh]`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} .canvas > svg circle.h[data-h^="w"]`)).toHaveCount(L.length);
});

test("the panel of a worktop turns its points by the buttons and has no width, depth or slider", async ({ page }) => {
  const { after } = await drawn(page);
  await expect(page.locator(`${EDITOR} #fw`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #fh`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #frotsl`)).toHaveCount(0);
  await page.locator(`${EDITOR} #fr90`).click();
  const st = await state(page);
  expect(st.hist).toBe(after.hist + 1);
  expect(st.w[0].rot).toBe(0);
  expect([st.w[0].w, st.w[0].h]).toEqual([after.w[0].h, after.w[0].w]); // a quarter turn swaps the box
  kept(st.w[0]);
});

test("a corner drag that every move refuses leaves no undo step and says why", async ({ page }) => {
  const { after, o } = await drawn(page);
  const h = await screen(page, L[3]); // (-50, 0), the inner corner
  const to = await screen(page, [-150, 50]); // one jump: the edges from there to (-50, 100) and (100, 0) cut the arm on the left, so the move is refused
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.move(to.x - 2, to.y + 2, { steps: 1 });
  await page.mouse.up();
  const st = await state(page);
  expect(st.w[0].pts).toEqual(abs(o, L)); // nothing moved
  expect(st.hist).toBe(after.hist); // so no step to undo
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).status as string, EDITOR)).toMatch(/cross/i);
});

test("Add > Furniture > Worktop by real clicks on the menu, then three points and Enter: one worktop, one undo step", async ({ page }) => {
  await load(page);
  const before = await state(page);
  await page.locator("#mAdd > summary").click();
  await page.locator("#addFurn > summary").click();
  const btn = page.locator("#addFurn-worktop");
  await btn.scrollIntoViewIfNeeded();
  const b = (await btn.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  expect((await state(page)).drawing).toBe(true);
  for (const p of [[-100, -50], [100, -50], [-100, 50]] as Pt[]) { const s = await screen(page, p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
  await page.keyboard.press("Enter");
  const st = await state(page);
  expect(st.drawing).toBe(false);
  expect(st.w).toHaveLength(1);
  expect(st.n).toBe(before.n + 1);
  expect(st.hist).toBe(before.hist + 1);
});
