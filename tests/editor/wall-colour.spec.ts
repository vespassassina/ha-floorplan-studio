import { test, expect, type Page } from "@playwright/test";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import { validate, type Floor, type Layout } from "../../src/core";

// B53.9: wall colours. Part one drives FLOORPLAN_CSS and `renderFloor` in a bare page and reads getComputedStyle, never the CSS
// text (finding 10): the layout default beats the theme, a wall's own colour beats the default, in two themes, with the theme
// set explicitly (finding 19). Part two drives the Studio with real mouse clicks (finding 3).

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const box = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: number[][], extra: object = {}) => ({ id, name: id, area: id, label: "", kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const floorOf = (over: object = {}): Floor => ({
  title: "Ground", outline: box(0, 0, 1000, 800), owk: ["external", "external", "external", "external"],
  rooms: [room("a", box(0, 0, 500, 800)), room("b", box(500, 0, 1000, 800))],
  walls: [{ id: "wall-ground-1", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "wall-ground-2", a: [100, 200], b: [300, 200], kind: "fence" }],
  stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...over,
}) as unknown as Floor;

const THEME_WALL = { light: "#2b2a27", midnight: "#8fb4f0" } as const;
const THEME_EXTERNAL = { light: "#1a1917" } as const; // the light theme's external wall (editor.spec.ts "wall kinds have their colour")
const page2d = (f: Floor, o: Record<string, unknown>) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><div class="fp"><svg width="600" height="500" viewBox="0 0 1000 800">${renderFloor(f, { scale: 1, ...o })}</svg></div></body></html>`;
const strokeOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).stroke);
const fillOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fill);
const PLAIN = "svg line.e.top:not(.external):not(.fence):not(.edge):not(.none), svg line.e:not(.external):not(.fence):not(.edge):not(.none):not(.top)";

for (const theme of ["light", "midnight"] as const) {
  test.describe(`CSS pair, ${theme}`, () => {
    test("no colour: the theme's wall; the layout default replaces it for walls, external walls and fences", async ({ page }) => {
      await page.setContent(page2d(floorOf(), { theme }));
      expect(await strokeOf(page, "svg line.e[data-w='0']")).toBe(rgb(THEME_WALL[theme]));
      await page.setContent(page2d(floorOf(), { theme, wallColors: { wall: "#cc0000", external: "#00cc00", fence: "#0000cc" } }));
      expect(await strokeOf(page, "svg line.e[data-w='0']")).toBe(rgb("#cc0000"));
      expect(await strokeOf(page, "svg line.e.external")).toBe(rgb("#00cc00"));
      expect(await strokeOf(page, "svg line.e.fence")).toBe(rgb("#0000cc"));
    });
    test("a key left out keeps the theme's own colour for that kind", async ({ page }) => {
      await page.setContent(page2d(floorOf(), { theme, wallColors: { fence: "#0000cc" } }));
      expect(await strokeOf(page, "svg line.e[data-w='0']")).toBe(rgb(THEME_WALL[theme]));
      expect(await strokeOf(page, "svg line.e.fence")).toBe(rgb("#0000cc"));
    });
    test("a wall's own colour beats the layout default, and its neighbours keep the default", async ({ page }) => {
      const f = floorOf();
      (f.rooms[0] as unknown as { wc: unknown }).wc = [null, null, null, "#ff8800"]; // a's west edge, which lies on the outline
      (f.walls[0] as unknown as { color: string }).color = "#aa00aa";
      await page.setContent(page2d(f, { theme, wallColors: { wall: "#cc0000", external: "#00cc00", fence: "#0000cc" } }));
      expect(await strokeOf(page, "svg line.e[data-w='0']")).toBe(rgb("#aa00aa"));
      expect(await strokeOf(page, "svg line.e.fence")).toBe(rgb("#0000cc"));
      expect(await strokeOf(page, "svg line.e[data-e='r0:3']")).toBe(rgb("#ff8800"));
      expect(await strokeOf(page, "svg line.e[data-e='r0:1']")).toBe(rgb("#cc0000"));
      // and without the layout default it beats the theme
      await page.setContent(page2d(f, { theme }));
      expect(await strokeOf(page, "svg line.e[data-w='0']")).toBe(rgb("#aa00aa"));
      expect(await strokeOf(page, "svg line.e[data-e='r0:1']")).toBe(rgb(THEME_WALL[theme]));
    });
    test("2.5D: a wall's own colour reaches its faces, its cap and a fence's fill; the default reaches the others", async ({ page }) => {
      const f = floorOf();
      (f.walls[0] as unknown as { color: string }).color = "#aa00aa";
      (f.walls[1] as unknown as { color: string }).color = "#00aaaa";
      await page.setContent(page2d(f, { theme, view: "2.5d", tilt: 40, wallColors: { wall: "#cc0000", external: "#00cc00" } }));
      // the faces of a coloured wall stroke in its colour; a plain one in the default
      const strokes = await page.locator("svg polygon.ws").evaluateAll((els) => els.map((e) => ({ cls: e.getAttribute("class") ?? "", stroke: getComputedStyle(e).stroke, fill: getComputedStyle(e).fill })));
      expect(strokes.some((s) => s.cls.includes("wc") && !s.cls.includes("fence") && s.stroke === rgb("#aa00aa"))).toBe(true);
      expect(strokes.some((s) => s.cls.includes("fence") && s.cls.includes("wc") && s.stroke === rgb("#00aaaa") && s.fill === rgb("#00aaaa"))).toBe(true);
      expect(strokes.some((s) => !s.cls.includes("wc") && !s.cls.includes("external") && !s.cls.includes("fence") && s.stroke === rgb("#cc0000"))).toBe(true);
      expect(strokes.some((s) => s.cls.includes("external") && s.stroke === rgb("#00cc00"))).toBe(true);
      const caps = await page.locator("svg line.e.top.wc").evaluateAll((els) => els.map((e) => getComputedStyle(e).stroke));
      expect(caps).toContain(rgb("#aa00aa"));
    });
    test("2.5D: the side face of a coloured wall is its colour softened toward the background, not the theme's", async ({ page }) => {
      const f = floorOf({ walls: [{ id: "wall-ground-1", a: [100, 100], b: [300, 100], kind: "wall" }, { id: "wall-ground-3", a: [100, 400], b: [300, 400], kind: "wall", color: "#ff0000" }], rooms: [], outline: box(0, 0, 1000, 800) });
      await page.setContent(page2d(f, { theme, view: "2.5d", tilt: 40 }));
      const fills = await page.locator("svg polygon.ws").evaluateAll((els) => els.map((e) => ({ wc: (e.getAttribute("class") ?? "").includes("wc"), fill: getComputedStyle(e).fill })));
      const own = fills.filter((x) => x.wc).map((x) => x.fill), plain = fills.filter((x) => !x.wc).map((x) => x.fill);
      expect(own.length).toBeGreaterThan(0);
      expect(plain.length).toBeGreaterThan(0);
      expect(own.every((v) => !plain.includes(v))).toBe(true);
    });
  });
}

test("CSS pair: the external default also paints a parapet, and the light theme's external wall is its own colour without it", async ({ page }) => {
  const f = floorOf({ owk: ["parapet", "external", "external", "external"] });
  await page.setContent(page2d(f, { theme: "light" }));
  expect(await strokeOf(page, "svg line.e.external")).toBe(rgb(THEME_EXTERNAL.light));
  await page.setContent(page2d(f, { theme: "light", wallColors: { external: "#00cc00" } }));
  expect(await strokeOf(page, "svg line.e.external")).toBe(rgb("#00cc00"));
  expect(await strokeOf(page, "svg line.e[data-e='o:0']")).toBe(rgb("#00cc00"));
});

// ---- the Studio ----
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page) => (await layoutOf(page)).floors.ground;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const centre = async (page: Page, sel: string) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const b = (await page.locator(sel).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const click = async (page: Page, sel: string) => { const c = await centre(page, sel); await page.mouse.click(c.x, c.y); };
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
const valid = async (page: Page, what: string) => { const r = validate(await layoutOf(page)); expect(r.ok, `${what}: ${r.ok ? "" : r.errors.join("; ")}`).toBe(true); };
const setColourInput = (page: Page, sel: string, hex: string) => page.locator(sel).first().evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, hex);
const planStroke = (page: Page, sel: string) => page.locator(`${EDITOR} ${sel}`).first().evaluate((e) => getComputedStyle(e).stroke);

test.describe("the Studio", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/standalone.html");
    await page.locator("#fixPlan").uncheck();
    await expect(page.locator(`${EDITOR} svg`).first()).toBeVisible();
    await page.evaluate(([tag, f]) => {
      const el = document.querySelector(tag as string) as any;
      el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: f } };
    }, [EDITOR, floorOf()] as const);
    await page.locator("details.menu > summary", { hasText: /^View$/ }).click(); // the theme, set with real clicks (finding 19)
    await page.locator("#thSub > summary").click();
    await page.locator('[data-th="light"]').click();
    await page.locator("details.menu > summary", { hasText: /^View$/ }).click();
  });

  test("a free wall: a real click selects it, a swatch paints it on the plan in one undo step, Default takes it back", async ({ page }) => {
    await clickCm(page, 200, 100);
    await expect(page.locator("#wcol")).toBeVisible();
    const before = JSON.stringify(await layoutOf(page));
    await click(page, "#panel .swatches .sw");
    const g = await groundOf(page);
    const hex = (g.walls[0] as unknown as { color?: string }).color!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(rgb(hex));
    expect((g.walls[1] as unknown as { color?: string }).color).toBeUndefined(); // the other wall is untouched
    await valid(page, "painted");
    await undo(page);
    expect(JSON.stringify(await layoutOf(page))).toBe(before);
    await valid(page, "undone");
    await clickCm(page, 200, 100);
    await click(page, "#panel .swatches .sw");
    await click(page, "#wcolx");
    expect(JSON.stringify(await layoutOf(page))).toBe(before);
  });

  test("a shared edge: a custom colour lands on both rooms and the palette, once; one undo takes all three back", async ({ page }) => {
    await clickCm(page, 500, 400);
    await expect(page.locator("#ecol")).toBeVisible();
    const before = JSON.stringify(await layoutOf(page));
    await setColourInput(page, "#ecol", "#12ab34");
    const l = await layoutOf(page), g = l.floors.ground;
    expect(g.rooms.map((r) => (r as unknown as { wc?: (string | null)[] }).wc?.filter(Boolean))).toEqual([["#12ab34"], ["#12ab34"]]);
    expect(l.palette).toEqual(["#12ab34"]);
    expect(await planStroke(page, "svg line.e[data-e='r0:1']")).toBe(rgb("#12ab34"));
    expect(await planStroke(page, "svg line.e[data-e='r1:3']")).toBe(rgb("#12ab34"));
    await valid(page, "painted");
    await undo(page);
    expect(JSON.stringify(await layoutOf(page))).toBe(before);
    await valid(page, "undone");
  });

  test("an unchanged pick is no step", async ({ page }) => {
    await clickCm(page, 500, 400);
    await setColourInput(page, "#ecol", "#12ab34");
    const after = JSON.stringify(await layoutOf(page));
    await setColourInput(page, "#ecol", "#12ab34");
    expect(JSON.stringify(await layoutOf(page))).toBe(after);
    await undo(page);
    expect((await groundOf(page)).rooms.every((r) => (r as unknown as { wc?: unknown }).wc === undefined)).toBe(true); // one undo was enough
  });

  test("View, Device colours > Wall colours: a swatch sets the layout default on the plan; Theme default takes it off", async ({ page }) => {
    await page.locator("details.menu > summary", { hasText: /^Edit$/ }).click();
    await page.locator(`${EDITOR} #devcols`).click();
    const row = page.locator(`${EDITOR} .devcols-panel [data-wall="wall"]`);
    await expect(row).toBeVisible();
    await expect(page.locator(`${EDITOR} .devcols-panel [data-wall]`)).toHaveCount(3);
    const themeStroke = await planStroke(page, "svg line.e[data-w='0']");
    expect(themeStroke).toBe(rgb(THEME_WALL.light));
    await click(page, `${EDITOR} .devcols-panel [aria-label="Colours for walls"] .sw`);
    const hex = (await layoutOf(page)).wallColors!.wall!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(rgb(hex));
    await valid(page, "default set");
    await click(page, `${EDITOR} .devcols-panel [data-wall="wall"] button`);
    expect((await layoutOf(page)).wallColors).toBeUndefined();
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(themeStroke);
    await valid(page, "default removed");
  });

  test("a wall's own colour wins over the layout default on the plan", async ({ page }) => {
    await page.evaluate(([tag]) => { const el = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.wallColors = { wall: "#cc0000" }; el.layout = l; }, [EDITOR] as const);
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(rgb("#cc0000"));
    await clickCm(page, 200, 100);
    await setColourInput(page, "#wcol", "#00aa00");
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(rgb("#00aa00"));
    await undo(page);
    expect(await planStroke(page, "svg line.e[data-w='0']")).toBe(rgb("#cc0000"));
  });
});
