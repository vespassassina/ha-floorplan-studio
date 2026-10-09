import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { layerOfType } from "../../src/core/layers";
import type { DeviceType, Layout } from "../../src/core/schema";

// S26.10 (U18): select many devices on the plan, on the stress house. Real page.mouse and page.keyboard at real
// coordinates (finding 3). The oracle for "what a rectangle should take" is the DOM: where each drawn icon really is on
// the screen (its own transform, the view's turn included), not the editor's own maths.

const EDITOR = "floorplan-studio-editor";
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8")) as Layout;

interface Box { i: number; x: number; y: number; type: DeviceType }

async function load(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, stress] as const);
  await expect(page.locator(`${EDITOR} .chip[data-f="ground"]`)).toHaveAttribute("aria-pressed", "true");
}

/** Frames the plan on device `i` at a fixed zoom. View state only. */
const frame = (page: Page, i: number) => page.evaluate(([tag, i]) => {
  const ed = document.querySelector(tag as string) as any, d = ed.st.f.devices[i as number];
  ed.st.views[ed.st.floor] = { x: d.x - 250, y: d.y - 250, w: 500, h: 500 };
  ed.requestUpdate();
}, [EDITOR, i] as const);

/** Every drawn point device whose centre is well inside the canvas, centre in screen pixels. */
const boxes = (page: Page): Promise<Box[]> => page.evaluate((tag) => {
  const ed = document.querySelector(tag) as any, root = ed.shadowRoot as ShadowRoot;
  const svg = root.querySelector(".canvas > svg") as SVGSVGElement, r = svg.getBoundingClientRect(), out: Box[] = [];
  for (const el of root.querySelectorAll<SVGGElement>(".canvas > svg g.dev[data-x]")) {
    if (getComputedStyle(el).display === "none" || !el.getAttribute("transform")) continue;
    const m = el.getScreenCTM(); if (!m) continue;
    const pt = svg.createSVGPoint(); pt.x = 12; pt.y = 12; // the icon's own centre
    const q = pt.matrixTransform(m), i = +el.getAttribute("data-x")!;
    if (q.x < r.x + 20 || q.x > r.right - 20 || q.y < r.y + 20 || q.y > r.bottom - 20) continue;
    out.push({ i, x: q.x, y: q.y, type: ed.st.f.devices[i].type });
  }
  return out;
}, EDITOR);

/** Is a press at (x, y) on the empty plan (a room, the background), where a Shift+drag starts a marquee? */
const emptyAt = (page: Page, x: number, y: number) => page.evaluate(([tag, x, y]) => {
  const ed = document.querySelector(tag as string) as any, top = (ed.shadowRoot as ShadowRoot).elementsFromPoint(x as number, y as number)[0];
  if (!top) return false;
  if (top.closest("g[data-x],[data-xbar],[data-h],[data-hp],[data-dh],[data-fh],[data-d],line.opening,g[data-u],[data-e],[data-w]")) return false;
  return !ed.edgeNear(ed.toSvg({ clientX: x, clientY: y }));
}, [EDITOR, x, y] as const);

interface Rect { x0: number; y0: number; x1: number; y1: number; inside: Box[]; start: { x: number; y: number }; end: { x: number; y: number } }
const within = (r: { x0: number; y0: number; x1: number; y1: number }, b: Box) => b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1;

/** A screen rectangle round four neighbouring lights that takes `want(inside)`, with a corner a marquee can start from. */
async function findRect(page: Page, want: (inside: Box[]) => boolean): Promise<Rect> {
  const lights = (await boxes(page)).filter((b) => b.type === "light"), all = await boxes(page);
  const d = (a: Box, b: Box) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const a of lights) {
    const grp = [a, ...lights.filter((b) => b !== a).sort((p, q) => d(a, p) - d(a, q)).slice(0, 3)];
    const pad = 14, r = { x0: Math.min(...grp.map((b) => b.x)) - pad, y0: Math.min(...grp.map((b) => b.y)) - pad, x1: Math.max(...grp.map((b) => b.x)) + pad, y1: Math.max(...grp.map((b) => b.y)) + pad };
    const inside = all.filter((b) => within(r, b));
    if (!want(inside)) continue;
    const corners = [[r.x0, r.y0, r.x1, r.y1], [r.x1, r.y0, r.x0, r.y1], [r.x1, r.y1, r.x0, r.y0], [r.x0, r.y1, r.x1, r.y0]];
    for (const [sx, sy, ex, ey] of corners) if (await emptyAt(page, sx, sy)) return { ...r, inside, start: { x: sx, y: sy }, end: { x: ex, y: ey } };
  }
  throw new Error("no rectangle round four lights fits the frame");
}

/** Frames the plan on successive lights until `findRect` finds a rectangle. */
async function rectSomewhere(page: Page, want: (inside: Box[]) => boolean): Promise<Rect> {
  const lights = stress.floors.ground.devices.flatMap((d, i) => (d.type === "light" ? [i] : [])).slice(0, 30);
  for (const i of lights) {
    await frame(page, i);
    await page.waitForTimeout(50);
    try { return await findRect(page, want); } catch { /* next frame */ }
  }
  throw new Error("no frame offers a rectangle");
}

const state = (page: Page) => page.evaluate((tag) => {
  const st = (document.querySelector(tag) as any).st;
  return { sel: st.sel as { t: string; i?: number; is?: number[] } | null, undo: st.canUndo as boolean, view: { ...st.view } as { x: number; y: number } };
}, EDITOR);

async function shiftDrag(page: Page, r: Rect, midDrag?: () => Promise<void>) {
  await page.keyboard.down("Shift");
  await page.mouse.move(r.start.x, r.start.y);
  await page.mouse.down();
  await page.mouse.move((r.start.x + r.end.x) / 2, (r.start.y + r.end.y) / 2, { steps: 4 });
  await page.mouse.move(r.end.x, r.end.y, { steps: 4 });
  if (midDrag) await midDrag();
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

const sorted = (a: number[]) => [...a].sort((p, q) => p - q);

test("a Shift+drag marquee over four lights selects exactly those four, and the marquee is gone after", async ({ page }) => {
  await load(page);
  const r = await rectSomewhere(page, (ins) => ins.length === 4 && ins.every((b) => b.type === "light"));
  await shiftDrag(page, r, async () => { await expect(page.locator(`${EDITOR} .canvas > svg .marquee`)).toHaveCount(1); });
  const s = await state(page);
  expect(s.sel?.t).toBe("devs");
  expect(sorted(s.sel!.is!)).toEqual(sorted(r.inside.map((b) => b.i)));
  expect(s.sel!.is).toHaveLength(4);
  expect(s.undo).toBe(false); // selecting is not an edit
  await expect(page.locator(`${EDITOR} .canvas > svg .marquee`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} .canvas > svg g.dev.sel`)).toHaveCount(4);
});

test("the same marquee with the view turned 45 degrees takes what the rectangle covers on the screen", async ({ page }) => {
  await load(page);
  await frame(page, stress.floors.ground.devices.findIndex((d) => d.type === "light"));
  await page.locator(`${EDITOR} #vrotr`).click();
  await expect.poll(() => page.evaluate((tag) => { const st = (document.querySelector(tag) as any).st; return st.turning == null && st.viewRot === 45; }, EDITOR)).toBe(true);
  const r = await rectSomewhere(page, (ins) => ins.length === 4 && ins.every((b) => b.type === "light"));
  await shiftDrag(page, r);
  const s = await state(page);
  expect(s.sel?.t).toBe("devs");
  expect(sorted(s.sel!.is!)).toEqual(sorted(r.inside.map((b) => b.i)));
});

test("a device of a hidden layer inside the rectangle is not taken", async ({ page }) => {
  await load(page);
  const r = await rectSomewhere(page, (ins) => ins.filter((b) => b.type === "light").length === 4 && ins.length <= 7 && ins.some((b) => b.type !== "light"));
  const other = r.inside.find((b) => b.type !== "light")!;
  // Hide that device's family through the real Layers control would move the pointer; the state is the same list.
  await page.evaluate(([tag, layer]) => { const ed = document.querySelector(tag as string) as any; ed.st.hidden = [layer]; ed.requestUpdate(); }, [EDITOR, layerOfType(other.type)] as const);
  await expect(page.locator(`${EDITOR} .canvas > svg g.dev[data-x="${other.i}"]`)).toHaveCount(0);
  await shiftDrag(page, r);
  const s = await state(page);
  const lights = r.inside.filter((b) => layerOfType(b.type) !== layerOfType(other.type)).map((b) => b.i);
  expect(sorted(s.sel!.is!)).toEqual(sorted(lights));
  expect(s.sel!.is).not.toContain(other.i);
});

test("Shift+click adds a switch to a light selection and keeps both; Shift+click again takes it out", async ({ page }) => {
  await load(page);
  await frame(page, stress.floors.ground.devices.findIndex((d) => d.type === "switch"));
  await page.waitForTimeout(50);
  const bs = await boxes(page);
  // two icons with nothing on top of them at their centre
  const onTop = (b: Box) => page.evaluate(([tag, x, y]) => ((document.querySelector(tag as string) as any).shadowRoot as ShadowRoot).elementsFromPoint(x as number, y as number)[0]?.closest("g[data-x]")?.getAttribute("data-x") ?? null, [EDITOR, b.x, b.y] as const);
  let light: Box | undefined, sw: Box | undefined;
  for (const b of bs) {
    if ((await onTop(b)) !== String(b.i)) continue;
    if (b.type === "light" && !light) light = b;
    if (b.type === "switch" && !sw) sw = b;
  }
  expect(light && sw).toBeTruthy();
  await page.mouse.click(light!.x, light!.y);
  expect((await state(page)).sel).toEqual({ t: "dev", i: light!.i });
  await page.keyboard.down("Shift");
  await page.mouse.click(sw!.x, sw!.y);
  await page.keyboard.up("Shift");
  let s = await state(page);
  expect(s.sel?.t).toBe("devs");
  expect(sorted(s.sel!.is!)).toEqual(sorted([light!.i, sw!.i]));
  expect(s.undo).toBe(false);
  await page.keyboard.down("Shift");
  await page.mouse.click(sw!.x, sw!.y);
  await page.keyboard.up("Shift");
  s = await state(page);
  expect(s.sel).toEqual({ t: "dev", i: light!.i });
});

test("Ctrl+A selects every drawn device on the floor; a hidden layer is left out; Escape clears", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } }); // focus in the editor
  await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; ed.st.hidden = ["climate"]; ed.requestUpdate(); }, EDITOR);
  const drawn = await page.evaluate((tag) => [...(document.querySelector(tag) as any).shadowRoot.querySelectorAll(".canvas > svg g.dev[data-x]")].filter((el: Element) => getComputedStyle(el).display !== "none").map((el: Element) => +el.getAttribute("data-x")!), EDITOR);
  const climateDevs = stress.floors.ground.devices.filter((d) => layerOfType(d.type) === "climate").length;
  expect(climateDevs).toBeGreaterThan(0);
  expect(drawn.length).toBe(stress.floors.ground.devices.length - climateDevs);
  await page.keyboard.press("Control+a");
  const s = await state(page);
  expect(s.sel?.t).toBe("devs");
  expect(sorted(s.sel!.is!)).toEqual(sorted([...new Set(drawn)]));
  expect(s.undo).toBe(false);
  await page.keyboard.press("Escape");
  expect((await state(page)).sel).toBeNull();
});

test("a plain drag on empty plan still pans and selects nothing", async ({ page }) => {
  await load(page);
  await frame(page, stress.floors.ground.devices.findIndex((d) => d.type === "light"));
  await page.waitForTimeout(50);
  const r = await rectSomewhere(page, (ins) => ins.length === 4);
  const before = await state(page);
  await page.mouse.move(r.start.x, r.start.y);
  await page.mouse.down();
  await page.mouse.move(r.start.x + 60, r.start.y + 40, { steps: 5 });
  await expect(page.locator(`${EDITOR} .canvas > svg .marquee`)).toHaveCount(0);
  await page.mouse.up();
  const after = await state(page);
  expect(after.view.x).not.toBe(before.view.x);
  expect(after.sel?.t).not.toBe("devs");
});

test("CSS pair: the marquee is a see-through dashed box that never takes a click", async ({ page }) => {
  await load(page);
  const r = await rectSomewhere(page, (ins) => ins.length === 4);
  await page.keyboard.down("Shift");
  await page.mouse.move(r.start.x, r.start.y);
  await page.mouse.down();
  await page.mouse.move(r.end.x, r.end.y, { steps: 6 });
  const m = page.locator(`${EDITOR} .canvas > svg .marquee`);
  await expect(m).toHaveCount(1);
  const css = await m.evaluate((el) => { const c = getComputedStyle(el); return { fill: c.fill, fillOpacity: c.fillOpacity, stroke: c.stroke, dash: c.strokeDasharray, pe: c.pointerEvents }; });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(css.stroke).not.toBe("none");
  expect(css.dash).not.toBe("none");
  expect(css.pe).toBe("none");
  expect(Number(css.fillOpacity)).toBeLessThan(0.5);
  expect(css.fill).not.toBe("none");
});

// ---- S26.11 (U18): a multi-selection moves and deletes as one ----------------------------------------------------

type Pos = { x: number; y: number; locked?: boolean };
const devices = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.f.devices.map((d: Pos) => ({ x: d.x, y: d.y, locked: d.locked })) as Pos[], EDITOR);
const steps = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);

/** Marquee over four lights, then Shift+click one off: three lights selected. Returns the three, as boxes, and the rectangle. */
async function pickThree(page: Page): Promise<{ three: Box[]; scale: number }> {
  const r = await rectSomewhere(page, (ins) => ins.length === 4 && ins.every((b) => b.type === "light"));
  await shiftDrag(page, r);
  const grab = r.inside[3]; // any one of the four
  await page.keyboard.down("Shift");
  await page.mouse.click(grab.x, grab.y);
  await page.keyboard.up("Shift");
  const s = await state(page);
  expect(s.sel?.t).toBe("devs");
  expect(s.sel!.is).toHaveLength(3);
  const three = r.inside.filter((b) => s.sel!.is!.includes(b.i));
  const scale = await page.evaluate((tag) => { const ed = document.querySelector(tag) as any; return ed.scale as number; }, EDITOR);
  return { three, scale };
}

test("dragging one of three selected lights moves all three by the same delta, in one undo step", async ({ page }) => {
  await load(page);
  const { three, scale } = await pickThree(page);
  const grabbed = three[0];
  const before = await devices(page), h0 = await steps(page);
  await page.mouse.move(grabbed.x, grabbed.y);
  await page.mouse.down();
  await page.mouse.move(grabbed.x + 20, grabbed.y + 10, { steps: 4 });
  await page.mouse.move(grabbed.x + 60, grabbed.y + 35, { steps: 4 });
  await page.mouse.up();
  const after = await devices(page);
  const idx = three.map((b) => b.i), d = idx.map((i) => [after[i].x - before[i].x, after[i].y - before[i].y]);
  expect(d[0][0]).not.toBe(0);
  for (const e of d) expect(e).toEqual(d[0]);
  expect(Math.abs(d[0][0] - 60 / scale)).toBeLessThan(11); // the pointer's distance in plan cm, to within the 10 cm grid
  expect(Math.abs(d[0][1] - 35 / scale)).toBeLessThan(11);
  // nothing else moved
  after.forEach((a, i) => { if (!idx.includes(i)) expect(a).toEqual(before[i]); });
  expect(await steps(page)).toBe(h0 + 1);
  expect((await state(page)).sel?.is).toHaveLength(3); // the group is still selected
  await page.keyboard.press("Control+z");
  expect(await devices(page)).toEqual(before);
});

test("a click on a member without a drag leaves one device selected and no undo step", async ({ page }) => {
  await load(page);
  const { three } = await pickThree(page);
  const h0 = await steps(page);
  await page.mouse.click(three[0].x, three[0].y);
  expect(await steps(page)).toBe(h0);
  const s = await state(page);
  expect(s.sel?.t).toBe("dev");
});

test("Delete removes the three selected lights in one undo step; one Undo brings them back; Backspace does the same", async ({ page }) => {
  await load(page);
  const { three } = await pickThree(page);
  const n0 = (await devices(page)).length, before = await devices(page), h0 = await steps(page);
  await page.keyboard.press("Delete");
  expect((await devices(page)).length).toBe(n0 - 3);
  expect(await steps(page)).toBe(h0 + 1);
  expect((await state(page)).sel).toBeNull();
  await page.keyboard.press("Control+z");
  expect(await devices(page)).toEqual(before);
  // Backspace, from a fresh selection of the same three
  await page.mouse.move(0, 0);
  await page.evaluate(([tag, is]) => { const ed = document.querySelector(tag as string) as any; ed.st.sel = { t: "devs", is }; ed.requestUpdate(); }, [EDITOR, three.map((b) => b.i)] as const);
  await page.keyboard.press("Backspace");
  expect((await devices(page)).length).toBe(n0 - 3);
  await page.keyboard.press("Control+z");
  expect(await devices(page)).toEqual(before);
});

test("a locked member does not follow a group drag; a locked device alone does not move; an all-locked group leaves no step", async ({ page }) => {
  await load(page);
  const { three } = await pickThree(page);
  const lockedI = three[1].i;
  await page.evaluate(([tag, i]) => { const ed = document.querySelector(tag as string) as any; ed.st.f.devices[i as number].locked = true; ed.requestUpdate(); }, [EDITOR, lockedI] as const);
  const drag = async (b: Box) => { await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 30, b.y + 20, { steps: 4 }); await page.mouse.move(b.x + 70, b.y + 40, { steps: 4 }); await page.mouse.up(); };
  // group drag by an unlocked member
  let before = await devices(page), h0 = await steps(page);
  await drag(three[0]);
  let after = await devices(page);
  expect(after[lockedI]).toEqual(before[lockedI]);
  for (const b of three) if (b.i !== lockedI) expect(after[b.i].x).not.toBe(before[b.i].x);
  expect(await steps(page)).toBe(h0 + 1);
  await page.keyboard.press("Control+z");
  // the locked device alone: a press selects it, the drag moves nothing and leaves no step
  const lb = (await boxes(page)).find((b) => b.i === lockedI)!;
  await page.mouse.click(lb.x, lb.y);
  expect((await state(page)).sel).toEqual({ t: "dev", i: lockedI });
  before = await devices(page); h0 = await steps(page);
  await drag(lb);
  after = await devices(page);
  expect(after).toEqual(before);
  expect(await steps(page)).toBe(h0);
  // a group of locked members: nothing moves, no step
  await page.evaluate(([tag, is]) => { const ed = document.querySelector(tag as string) as any; for (const i of is as number[]) ed.st.f.devices[i].locked = true; ed.st.sel = { t: "devs", is }; ed.requestUpdate(); }, [EDITOR, three.map((b) => b.i)] as const);
  before = await devices(page); h0 = await steps(page);
  await drag((await boxes(page)).find((b) => b.i === three[0].i)!);
  expect(await devices(page)).toEqual(before);
  expect(await steps(page)).toBe(h0);
});

// Opus review (a): Escape in the middle of a group drag cleared the selection but the drag went on and committed.
test("Escape during a group drag puts the devices back, leaves no undo step, keeps the selection, and the rest of the drag does nothing", async ({ page }) => {
  await load(page);
  const { three } = await pickThree(page);
  const grabbed = three[0];
  const before = await devices(page), h0 = await steps(page);
  await page.mouse.move(grabbed.x, grabbed.y);
  await page.mouse.down();
  await page.mouse.move(grabbed.x + 20, grabbed.y + 10, { steps: 4 });
  expect(await devices(page)).not.toEqual(before); // the group follows the pointer live
  await page.keyboard.press("Escape");
  expect(await devices(page)).toEqual(before); // put back at once
  await page.mouse.move(grabbed.x + 60, grabbed.y + 35, { steps: 4 });
  await page.mouse.up();
  expect(await devices(page)).toEqual(before);
  expect(await steps(page)).toBe(h0);
  expect((await state(page)).sel?.is).toHaveLength(3);
  await page.keyboard.press("Escape"); // a second Escape, with nothing dragging, clears the selection as before
  expect((await state(page)).sel).toBeNull();
});

// Opus re-check 3: Escape went to Help or Place before it reached the drag, so the group kept dragging and committed.
for (const panel of ["help", "place"] as const) {
  test(`Escape during a group drag cancels the drag first while ${panel} is open`, async ({ page }) => {
    await load(page);
    const { three } = await pickThree(page);
    await page.evaluate(([tag, p]) => {
      const ed = document.querySelector(tag as string) as any;
      ed.ha = { floors: [], areas: [], entities: [] };
      if (p === "help") ed.toggleHelp(); else ed.openPlace(0);
    }, [EDITOR, panel] as const);
    await expect(page.locator(`${EDITOR} aside`)).toBeVisible();
    const sel = (await state(page)).sel;
    const now = (await boxes(page)).find((b) => b.i === three[0].i)!;
    const before = await devices(page), h0 = await steps(page);
    await page.mouse.move(now.x, now.y);
    await page.mouse.down();
    await page.mouse.move(now.x + 40, now.y, { steps: 4 });
    expect(await devices(page)).not.toEqual(before);
    await page.keyboard.press("Escape");
    expect(await devices(page)).toEqual(before);
    await page.mouse.move(now.x + 90, now.y + 20, { steps: 4 });
    await page.mouse.up();
    expect(await devices(page)).toEqual(before);
    expect(await steps(page)).toBe(h0);
    expect((await state(page)).sel).toEqual(sel);
    // the panel was not closed by that Escape: it is still there for the next one
    expect(await page.evaluate(([tag, p]) => { const ed = document.querySelector(tag as string) as any; return p === "help" ? ed.st.helpOpen : ed.asideMode === "place"; }, [EDITOR, panel] as const)).toBe(true);
  });
}

// Opus re-check 4: the single-device drag took a snapshot on its first move, and Escape only cleared the selection while the drag went on.
test("Escape during a single-device drag puts it back, leaves no undo step, keeps the selection, and the rest of the drag does nothing", async ({ page }) => {
  await load(page);
  const r = await rectSomewhere(page, (ins) => ins.length === 4 && ins.every((b) => b.type === "light"));
  const b = r.inside[0];
  await page.mouse.click(b.x, b.y);
  expect((await state(page)).sel).toEqual({ t: "dev", i: b.i });
  const before = await devices(page), h0 = await steps(page);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 10, { steps: 4 });
  expect(await devices(page)).not.toEqual(before);
  await page.keyboard.press("Escape");
  expect(await devices(page)).toEqual(before);
  await page.mouse.move(b.x + 80, b.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await devices(page)).toEqual(before);
  expect(await steps(page)).toBe(h0);
  expect((await state(page)).sel).toEqual({ t: "dev", i: b.i });
});
