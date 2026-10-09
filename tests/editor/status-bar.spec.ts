import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { DeviceType, Layout } from "../../src/core/schema";

// S26.22: the status bar under the canvas. Real mouse and keyboard at real coordinates (finding 3). The helpers that find
// a rectangle round four lights are copied from multi-select.spec.ts (a spec file cannot be imported without running it).

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


const bar = (page: Page) => page.locator(`${EDITOR} #statusBar`);
const barText = (page: Page) => page.locator(`${EDITOR} #statusBar .sb-text`).innerText();
const zoomOf = async (page: Page) => +(/(\d+) %/.exec(await barText(page))?.[1] ?? NaN);

test("a marquee over four lights reads '4 selected' in the bar", async ({ page }) => {
  await load(page);
  await expect(bar(page)).toBeVisible();
  expect(await barText(page)).not.toContain("selected");
  const r = await rectSomewhere(page, (ins) => ins.length === 4 && ins.every((b) => b.type === "light"));
  await shiftDrag(page, r);
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).toContainText("4 selected");
  await page.keyboard.press("Escape");
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).not.toContainText("selected");
});

test("a real click on Zoom in raises the percentage, Zoom out lowers it", async ({ page }) => {
  await load(page);
  const z0 = await zoomOf(page);
  expect(z0).toBeGreaterThan(0);
  await page.locator(`${EDITOR} #zin`).click();
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(z0);
  const z1 = await zoomOf(page);
  await page.locator(`${EDITOR} #zout`).click();
  await page.locator(`${EDITOR} #zout`).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(z1);
});

test("holding Alt reads 'Snap off'; releasing it brings the grid back", async ({ page }) => {
  await load(page);
  await page.mouse.click(5, 5); // nothing: gives the editor the keys
  await page.locator(EDITOR).focus();
  expect(await barText(page)).toMatch(/Snap \d+ cm/);
  await page.keyboard.down("Alt");
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).toContainText("Snap off");
  await page.keyboard.up("Alt");
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).toContainText(/Snap \d+ cm/);
});

test("a locked plan shows 'Plan locked' and Unlock; a real click on Unlock unlocks it", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} #fixPlan`).uncheck(); // a loaded plan starts locked
  await expect(page.locator(`${EDITOR} #statusUnlock`)).toHaveCount(0);
  await page.locator(`${EDITOR} label.lockplan`).click();
  await expect(page.locator(`${EDITOR} #fixPlan`)).toBeChecked();
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).toContainText("Plan locked");
  await page.locator(`${EDITOR} #statusUnlock`).click();
  await expect(page.locator(`${EDITOR} #fixPlan`)).not.toBeChecked();
  await expect(page.locator(`${EDITOR} #statusUnlock`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #statusBar .sb-text`)).not.toContainText("Plan locked");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.planLocked, EDITOR)).toBe(false);
});

test("computed-style pair: the bar is a flex row along the foot of the canvas, in the panel colours, in every theme", async ({ page }) => {
  await load(page);
  for (const theme of ["light", "blueprint"]) {
    await page.evaluate(([tag, t]) => { const el = document.querySelector(tag as string) as any; el.st.setTheme(t); el.requestUpdate(); }, [EDITOR, theme] as const);
    await expect(bar(page)).toBeVisible();
    const m = await page.evaluate((tag) => {
      const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot, b = root.querySelector("#statusBar") as HTMLElement, c = root.querySelector(".canvas") as HTMLElement;
      const probe = document.createElement("span"); probe.style.cssText = "background:var(--fp-room);color:var(--fp-ink);border-color:var(--fp-idle)";
      b.appendChild(probe);
      const p = getComputedStyle(probe), s = getComputedStyle(b), out = {
        display: s.display, fontSize: parseFloat(s.fontSize), bg: s.backgroundColor, wantBg: p.backgroundColor, ink: s.color, wantInk: p.color,
        border: s.borderTopWidth, below: b.parentElement === c && Math.abs(b.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom) < 3,
      };
      probe.remove();
      return out;
    }, EDITOR);
    expect(m.display, theme).toBe("flex");
    expect(m.fontSize, theme).toBeLessThan(14);
    expect(m.bg, theme).toBe(m.wantBg);
    expect(m.ink, theme).toBe(m.wantInk);
    expect(m.border, theme).toBe("1px");
    expect(m.below, theme).toBe(true);
  }
});

test("a click on the bar's words reaches the plan under it (the bar holds nothing to click but Unlock)", async ({ page }) => {
  await load(page);
  const b = (await page.locator(`${EDITOR} #statusBar .sb-text`).boundingBox())!;
  const top = await page.evaluate(([tag, x, y]) => { const r = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot; return r.elementsFromPoint(x as number, y as number)[0]?.tagName.toLowerCase(); }, [EDITOR, b.x + 4, b.y + b.height / 2] as const);
  expect(top).not.toBe("div"); // not the bar: the svg, or something drawn on it
});

test("computed-style pair: the bar lets clicks through, its Unlock button does not", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} #fixPlan`).check();
  const pe = await page.evaluate((tag) => { const r = (document.querySelector(tag) as any).shadowRoot as ShadowRoot; return [getComputedStyle(r.querySelector("#statusBar")!).pointerEvents, getComputedStyle(r.querySelector("#statusUnlock")!).pointerEvents]; }, EDITOR);
  expect(pe).toEqual(["none", "auto"]);
});

test("the bar adds no height: the editor ends where the canvas ends, so a click below it is still outside the editor", async ({ page }) => {
  await load(page);
  const m = await page.evaluate((tag) => { const h = document.querySelector(tag as string) as HTMLElement, c = h.shadowRoot!.querySelector(".canvas")!; return { host: h.getBoundingClientRect().bottom, canvas: c.getBoundingClientRect().bottom }; }, EDITOR);
  expect(m.host - m.canvas).toBeLessThan(4);
});
