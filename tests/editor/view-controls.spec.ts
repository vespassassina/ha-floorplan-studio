import { test, expect, type Page } from "@playwright/test";
import { openLabels } from "./menu-helpers";

// The editor's view controls: Rotate view left and right beside the zoom buttons, the keyboard (arrows, Space,
// Cmd/Ctrl-S) and the view that survives a reload. Pointer and keys go through page.mouse and page.keyboard at
// real coordinates and focus (CLAUDE.md finding 3).

const EDITOR = "floorplan-studio-editor";
const st = <T>(page: Page, fn: (s: any) => T) => page.evaluate(([tag, src]) => new Function("s", `return (${src})(s)`)((document.querySelector(tag as string) as any).st) as T, [EDITOR, fn.toString()] as const);
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);
const viewBox = async (page: Page) => (await page.locator(`${EDITOR} .canvas > svg`).getAttribute("viewBox"))!.split(" ").map(Number);
/** The plan's turn in degrees, read from the DOM: the first turned group. */
const planDeg = (page: Page) => page.evaluate((tag) => {
  const g = document.querySelector(tag)!.shadowRoot!.querySelector("svg g.plan-turn");
  const m = g?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
}, EDITOR);
const settled = (page: Page) => expect.poll(() => st(page, (s) => s.turning)).toBeNull();
const focusEditor = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as HTMLElement).focus(), EDITOR);
/** Screen position of a plan point (cm). Reads through the turned group, as the editor's own specs do. */
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.click(c.x, c.y); };
/** The demo's living room, away from any device (the editor's own specs click it at 60, 200). */
const clickRoom = (page: Page) => clickCm(page, 60, 200);
/** Device 0 by the middle of its icon, the way the editor's own specs click it. */
const clickDevice = async (page: Page) => {
  const b = (await page.locator('svg g[data-x="0"]').boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test.describe("rotate view buttons", () => {
  test("sit in the zoom group, beside the zoom buttons", async ({ page }) => {
    const zoom = page.locator(".zoom");
    for (const id of ["zin", "zout", "zreset", "vrotl", "vrotr"]) await expect(zoom.locator(`#${id}`)).toHaveCount(1);
    await expect(page.locator("#vrotl")).toHaveAttribute("aria-label", "Rotate view left");
    await expect(page.locator("#vrotr")).toHaveAttribute("aria-label", "Rotate view right");
    const z = (await page.locator("#zin").boundingBox())!, r = (await page.locator("#vrotr").boundingBox())!;
    expect(Math.abs(r.x - z.x)).toBeLessThan(60); // the same column or the next one, not across the canvas
  });

  test("a click turns the plan 45 degrees in steps, ends exactly there, and is no edit", async ({ page }) => {
    const before = await layoutJson(page);
    await page.evaluate((tag) => {
      const seen: number[] = [];
      (window as any).__seen = seen;
      const el = document.querySelector(tag)!;
      const loop = () => {
        const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
        seen.push(m ? Number(m[1]) : 0);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, EDITOR);
    await page.locator("#vrotr").click();
    await settled(page);
    const seen: number[] = await page.evaluate(() => (window as any).__seen);
    expect(seen.filter((d) => d > 0.5 && d < 44.5).length, seen.join(",")).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-9);
    expect(await planDeg(page)).toBe(45);
    expect(await layoutJson(page)).toBe(before);
    await expect(page.locator("#undo")).toBeDisabled();
  });

  test("left is -45 and the steps wrap: 0 -> 315 -> 0", async ({ page }) => {
    await page.locator("#vrotl").click();
    await settled(page);
    expect(await planDeg(page)).toBe(315);
    await page.locator("#vrotr").click();
    await settled(page);
    expect(await planDeg(page)).toBe(0);
  });

  test("a layout whose rotate is set keeps it: the user's turn adds to it and never writes it", async ({ page }) => {
    await page.evaluate((tag) => { const e = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(e.layout)); l.rotate = 90; e.layout = l; }, EDITOR);
    await expect.poll(() => planDeg(page)).toBe(90);
    await page.locator("#vrotr").click();
    await settled(page);
    expect(await planDeg(page)).toBe(135);
    expect(await page.evaluate((tag) => (document.querySelector(tag) as any).layout.rotate, EDITOR)).toBe(90);
  });

  test("a device still takes a click at its real position after a turn (hit-test follows the turn)", async ({ page }) => {
    await page.locator("#vrotr").click();
    await settled(page);
    await clickDevice(page);
    expect(await st(page, (s) => s.sel?.t)).toBe("dev");
  });

  test("a zoomed view keeps its centre across a turn", async ({ page }) => {
    await page.locator("#zin").click();
    await page.locator("#zin").click();
    const c = await st(page, (s) => ({ x: s.view.x + s.view.w / 2, y: s.view.y + s.view.h / 2, w: s.view.w }));
    await page.locator("#vrotr").click();
    await settled(page);
    const d = await st(page, (s) => ({ x: s.view.x + s.view.w / 2, y: s.view.y + s.view.h / 2, w: s.view.w }));
    expect(d.x).toBeCloseTo(c.x, 3);
    expect(d.y).toBeCloseTo(c.y, 3);
    expect(d.w).toBeCloseTo(c.w, 3);
  });

  test("a view that shows the whole floor still shows all of it after a turn", async ({ page }) => {
    await page.locator("#vrotr").click();
    await settled(page);
    const ok = await st(page, (s) => {
      const f = s.f, v = s.view;
      const rot = s.rotation;
      const cos = Math.cos((rot.deg * Math.PI) / 180), sin = Math.sin((rot.deg * Math.PI) / 180);
      const pv = rot.pivot;
      const pts = f.outline.map((p: number[]) => [pv[0] + (p[0] - pv[0]) * cos - (p[1] - pv[1]) * sin, pv[1] + (p[0] - pv[0]) * sin + (p[1] - pv[1]) * cos]);
      const c = [(v.x + v.w / 2), (v.y + v.h / 2)];
      const cr = [pv[0] + (c[0] - pv[0]) * cos - (c[1] - pv[1]) * sin, pv[1] + (c[0] - pv[0]) * sin + (c[1] - pv[1]) * cos];
      return pts.every((p: number[]) => Math.abs(p[0] - cr[0]) <= v.w / 2 + 1 && Math.abs(p[1] - cr[1]) <= v.h / 2 + 1);
    });
    expect(ok).toBe(true);
  });
});

test.describe("keys", () => {
  test("+ zooms in, - zooms out, the arrows pan, Space resets, Space resets (editor focused, nothing selected)", async ({ page }) => {
    await focusEditor(page);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeGreaterThan(w0);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
    const v0 = await viewBox(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]!).toBeGreaterThan(v0[0]!);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await viewBox(page))[0]!).toBeLessThan(v0[0]!);
    expect(await planDeg(page)).toBe(0);
    await page.keyboard.press("Space");
    await settled(page);
    expect(await planDeg(page)).toBe(0);
    const w1 = (await viewBox(page))[2]!;
    expect(Math.abs(w1 - w0)).toBeLessThan(1);
    await expect(page.locator("#undo")).toBeDisabled(); // none of it is an edit
  });

  test("Up and Down pan vertically, [ and ] turn the plan 45 degrees, and neither touches the layout", async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    const v0 = await viewBox(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await viewBox(page))[1]!).toBeGreaterThan(v0[1]!);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await viewBox(page))[1]!).toBeLessThan(v0[1]!);
    expect((await viewBox(page))[2]!).toBeCloseTo(v0[2]!, 3);
    await page.keyboard.press("]");
    await settled(page);
    expect(await planDeg(page)).toBe(45);
    await page.keyboard.press("[");
    await page.keyboard.press("[");
    await settled(page);
    expect(await planDeg(page)).toBe(315);
    await expect(page.locator("#undo")).toBeDisabled();
  });

  test("with a device selected the arrows still act on the view and never nudge the device", async ({ page }) => {
    await clickDevice(page);
    expect(await st(page, (s) => s.sel?.t)).toBe("dev");
    const before = await layoutJson(page);
    const x0 = (await viewBox(page))[0]!;
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    await settled(page);
    expect(await layoutJson(page)).toBe(before);
    expect((await viewBox(page))[0]!).toBeGreaterThan(x0);
    expect(await st(page, (s) => s.sel?.t)).toBe("dev"); // selection survives a view key
  });

  test("Alt+arrows are the view keys too", async ({ page }) => {
    await focusEditor(page);
    const x0 = (await viewBox(page))[0]!;
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]!).toBeGreaterThan(x0);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("Alt+Equal");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
  });

  test("Delete and Ctrl+Z keep working", async ({ page }) => {
    await clickDevice(page);
    const n0 = await st(page, (s) => s.f.devices.length);
    await page.keyboard.press("Delete");
    expect(await st(page, (s) => s.f.devices.length)).toBe(n0 - 1);
    await page.keyboard.press("Control+z");
    expect(await st(page, (s) => s.f.devices.length)).toBe(n0);
  });

  test("keys typed into a text box (a room's name) do not move the view", async ({ page }) => {
    await clickRoom(page);
    const input = page.locator("#panel #rn").first();
    await input.click();
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type(" a b");
    await page.waitForTimeout(100);
    expect((await viewBox(page))[2]!).toBe(w0);
    expect(await planDeg(page)).toBe(0);
    expect(await input.inputValue()).toContain(" a b");
  });

  test("Space on a focused button activates that button and does not reset the view", async ({ page }) => {
    await page.locator("#zin").focus();
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("Space");
    // The button zoomed in; a reset would have gone back to the whole floor, which is wider.
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
  });

  test("keys pressed outside the editor do nothing to it", async ({ page }) => {
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "outside"; document.body.appendChild(i); (i as HTMLElement).blur(); });
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("+");
    await page.waitForTimeout(100);
    expect((await viewBox(page))[2]!).toBe(w0);
  });
});

test.describe("Cmd/Ctrl+S saves", () => {
  for (const chord of ["Control+s", "Meta+s"]) {
    test(`${chord} is the Save button: one save-request, the browser's own dialog suppressed`, async ({ page }) => {
      await page.evaluate((tag) => {
        const e = document.querySelector(tag)!;
        (window as any).__saves = 0;
        e.addEventListener("save-request", () => { (window as any).__saves++; });
        (window as any).__prevented = [];
        window.addEventListener("keydown", (k) => { if (k.key.toLowerCase() === "s") (window as any).__prevented.push(k.defaultPrevented); });
      }, EDITOR);
      await focusEditor(page);
      await page.keyboard.press(chord);
      expect(await page.evaluate(() => (window as any).__saves)).toBe(1);
      expect(await page.evaluate(() => (window as any).__prevented)).toEqual([true]);
      await expect(page.locator(`${EDITOR} .status, #status`).first()).toContainText(/Saved/);
    });
  }

  test("works with focus inside a text box, where Space and the arrows do not", async ({ page }) => {
    await page.evaluate((tag) => { (window as any).__saves = 0; document.querySelector(tag)!.addEventListener("save-request", () => { (window as any).__saves++; }); }, EDITOR);
    await clickRoom(page);
    await page.locator("#panel #rn").first().click();
    await page.keyboard.press("Control+s");
    expect(await page.evaluate(() => (window as any).__saves)).toBe(1);
  });

  test("an invalid plan is not saved and the error box says why (never a silent nothing)", async ({ page }) => {
    await page.evaluate((tag) => {
      const e = document.querySelector(tag) as any;
      (window as any).__saves = 0;
      e.addEventListener("save-request", () => { (window as any).__saves++; });
      e.st.layout.floors[e.st.floor].rooms[0].pts = [[0, 0]]; // a room with one corner: validate refuses it
      e.requestUpdate();
    }, EDITOR);
    await focusEditor(page);
    await page.keyboard.press("Control+s");
    expect(await page.evaluate(() => (window as any).__saves)).toBe(0);
    await expect(page.locator("#errors")).toBeVisible();
  });

  test("Shift+Ctrl+S is left to the browser", async ({ page }) => {
    await page.evaluate((tag) => { (window as any).__saves = 0; document.querySelector(tag)!.addEventListener("save-request", () => { (window as any).__saves++; }); }, EDITOR);
    await focusEditor(page);
    await page.keyboard.press("Control+Shift+s");
    expect(await page.evaluate(() => (window as any).__saves)).toBe(0);
  });
});

test.describe("the view survives a reload", () => {
  const reload = async (page: Page) => {
    await page.reload();
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  };

  test("turn, zoom and centre are back after page.reload; Reset view clears them", async ({ page }) => {
    await page.locator("#vrotr").click();
    await settled(page);
    await page.locator("#zin").click();
    await page.locator("#zin").click();
    await page.locator("#zin").click();
    await page.evaluate((tag) => { const e = document.querySelector(tag) as any; e.st.views[e.st.floor] = { ...e.st.view, x: e.st.view.x + 120, y: e.st.view.y + 40 }; e.requestUpdate(); }, EDITOR);
    const before = await st(page, (s) => ({ rot: s.viewRot, v: s.view, floor: s.floor }));
    await page.waitForTimeout(300); // the debounced save, no page event involved
    await reload(page);
    const after = await st(page, (s) => ({ rot: s.viewRot, v: s.view, floor: s.floor }));
    expect(after.rot).toBe(45);
    expect(after.floor).toBe(before.floor);
    for (const k of ["x", "y", "w", "h"] as const) expect(after.v[k]).toBeCloseTo(before.v[k], 3);
    expect(await planDeg(page)).toBe(45);

    await focusEditor(page);
    await page.keyboard.press("Space");
    await settled(page);
    await page.waitForTimeout(300);
    await reload(page);
    const reset = await st(page, (s) => ({ rot: s.viewRot, zoomed: Object.keys(s.views).length }));
    expect(reset.rot).toBe(0);
    expect(await planDeg(page)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("floorplan-studio:view") ?? "{}").zooms)).toBeUndefined();
  });

  test("the labels toggle and the floor are back too", async ({ page }) => {
    await page.locator('details.menu > summary:text-is("View")').click();
    await openLabels(page);
    await page.locator("#labels").click();
    await page.locator('details.menu > summary:text-is("View")').click();
    await page.locator("button.chip[data-f]").nth(1).click();
    const floor = await st(page, (s) => s.floor);
    await page.waitForTimeout(300);
    await reload(page);
    expect(await st(page, (s) => s.labels)).toBe(false);
    expect(await st(page, (s) => s.floor)).toBe(floor);
  });

  test("a turn in flight at reload time is saved at its settled step, never as a frame", async ({ page }) => {
    await page.locator("#vrotr").click();
    await page.locator("#vrotr").click();
    await settled(page);
    await page.waitForTimeout(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("floorplan-studio:view")!));
    expect(stored.rotation).toBe(90);
  });

  test("a stored view that is junk is ignored: the editor starts normal", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("floorplan-studio:view", '{"mode":"3d","tilt":"x","rotation":"x","zooms":[["ground",{"zoom":"big"}]],"floor":"nope"}'));
    await reload(page);
    expect(await page.locator("svg .ws").count()).toBe(0);
    expect(await planDeg(page)).toBe(0);
  });

  test("an edit does not forget the view: zoom survives a reload after a change to the plan", async ({ page }) => {
    await clickRoom(page); // selected first: after the zoom the room may be off screen, and the panel stays
    await page.locator("#zin").click();
    await page.locator("#zin").click();
    await page.locator("#panel #rn").first().fill("Renamed room");
    await page.keyboard.press("Tab");
    expect((await layoutJson(page))).toContain("Renamed room");
    await page.waitForTimeout(300);
    const w = (await viewBox(page))[2]!;
    await reload(page);
    expect((await viewBox(page))[2]!).toBeCloseTo(w, 1);
  });
});

test("the Help panel lists the view keys", async ({ page }) => {
  await page.locator("#help").click();
  await expect(page.locator("#panel")).toContainText("Space");
  await expect(page.locator("#panel")).toContainText("Cmd/Ctrl+S");
});

test("the ? menu has a controls table with the view keys, and no step still says the arrows zoom", async ({ page }) => {
  await expect(page.locator("#help")).toHaveText("? Help");
  await page.locator("#help").click();
  const rows = page.locator("#controls tr");
  await expect(rows.first()).toContainText("Arrow keys");
  await expect(page.locator("#controls")).toContainText("Zoom in and out");
  await expect(page.locator("#controls")).toContainText("Turn the plan 45 degrees");
  await expect(page.locator("#panel .guide")).not.toContainText("arrows zoom");
  expect(await page.locator("#controls").evaluate((t) => getComputedStyle(t).borderCollapse)).toBe("collapse");
});
