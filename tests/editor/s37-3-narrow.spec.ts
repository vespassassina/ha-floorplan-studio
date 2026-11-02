import { test, expect, type Page } from "@playwright/test";

// S37.3: under 700 px wide the Studio shows a short message instead of a stacked layout. It measures its own width (not
// the window's: in Home Assistant the panel sits beside the sidebar). The editor stays in the DOM underneath, so widening
// shows the same plan, selection, zoom and undo history. Pointer and keys go through page.mouse / page.keyboard at real
// coordinates (CLAUDE.md finding 3); every bound is tested on both sides (finding 4).

const EDITOR = "floorplan-studio-editor";
const st = <T>(page: Page, fn: (s: any) => T) => page.evaluate(([tag, src]) => new Function("s", `return (${src})(s)`)((document.querySelector(tag as string) as any).st) as T, [EDITOR, fn.toString()] as const);
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);
const inShadow = <T>(page: Page, fn: (root: ShadowRoot, host: HTMLElement) => T) => page.evaluate(([tag, src]) => new Function("r", "h", `return (${src})(r, h)`)((document.querySelector(tag as string) as HTMLElement).shadowRoot, document.querySelector(tag as string)) as T, [EDITOR, fn.toString()] as const);
const note = (page: Page) => page.locator(`${EDITOR} #narrowNote`);

async function boot(page: Page, width: number, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeAttached();
}
const resize = async (page: Page, width: number) => { await page.setViewportSize({ width, height: 800 }); };
const barShown = (page: Page) => inShadow(page, (r) => (r.querySelector(".bar") as HTMLElement).checkVisibility());
const screenOf = (page: Page, x: number, y: number) => page.evaluate(([tag, px, py]) => {
  const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
  const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
  const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
  return { x: q.x, y: q.y };
}, [EDITOR, x, y] as const);

/** Gives the Studio host exactly this width (the standalone page pads its body, so the window's width is not the host's). */
const hostWidth = (page: Page, w: number | null) => page.evaluate(([tag, px]) => { (document.querySelector(tag as string) as HTMLElement).style.width = px === null ? "" : `${px}px`; }, [EDITOR, w] as const);

for (const [w, narrow] of [[380, true], [699, true], [700, false], [1280, false]] as const) {
  test(`the notice shows when the Studio is ${w} px wide: ${narrow}`, async ({ page }) => {
    await boot(page, 1400);
    await hostWidth(page, w);
    if (narrow) {
      await expect(note(page)).toBeVisible();
      await expect(note(page)).toContainText("The Studio needs a wider screen.");
      expect(await barShown(page), "toolbar hidden").toBe(false);
      expect(await inShadow(page, (r) => (r.querySelector(".ed") as HTMLElement).checkVisibility()), "editor hidden").toBe(false);
    } else {
      await expect(note(page)).toBeHidden();
      expect(await barShown(page), "toolbar shown").toBe(true);
      expect(await inShadow(page, (r) => (r.querySelector(".canvas") as HTMLElement).checkVisibility())).toBe(true);
    }
    expect(await inShadow(page, (_r, h) => Math.round(h.getBoundingClientRect().width))).toBe(w);
  });
}

test("a 380 px window shows the notice, a 1280 px window does not", async ({ page }) => {
  await boot(page, 380);
  await expect(note(page)).toBeVisible();
  await resize(page, 1280);
  await expect(note(page)).toBeHidden();
});

test("the standalone page has no link, only the message", async ({ page }) => {
  await boot(page, 380);
  await expect(note(page)).toBeVisible();
  await expect(note(page).locator("a")).toHaveCount(0);
});

test("in the panel (dashboard-href set) the message links to the dashboard root", async ({ page }) => {
  await boot(page, 380);
  await page.evaluate((tag) => (document.querySelector(tag) as any).setAttribute("dashboard-href", "/"), EDITOR);
  const link = note(page).locator("a");
  await expect(link).toHaveText("Open the dashboard");
  await expect(link).toHaveAttribute("href", "/");
  await expect(link).toBeVisible();
  await resize(page, 1280);
  await expect(link).toBeHidden();
});

test("it measures the Studio's own width, not the window's", async ({ page }) => {
  await boot(page, 1280);
  await expect(note(page)).toBeHidden();
  await page.evaluate((tag) => { (document.querySelector(tag) as HTMLElement).style.width = "500px"; }, EDITOR);
  await expect(note(page)).toBeVisible();
  await page.evaluate((tag) => { (document.querySelector(tag) as HTMLElement).style.width = "700px"; }, EDITOR);
  await expect(note(page)).toBeHidden();
});

test("the editor underneath survives: same node, selection, view, undo history, layout; nothing emitted or saved", async ({ page }) => {
  await boot(page, 1280);
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; this test edits it
  // Select a room with a real click, rename it (one undo step), zoom in once.
  const c = await screenOf(page, 60, 200);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rn")).toBeVisible();
  await page.locator("#rn").fill("Renamed by hand");
  await page.locator("#rn").press("Enter");
  await page.locator("#zin").click();
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.__mark = "same"; el.__events = 0; el.addEventListener("layout-changed", () => el.__events++); el.addEventListener("save-request", () => el.__events++); }, EDITOR);
  const snap = () => st(page, (s) => ({ sel: JSON.stringify(s.sel), view: JSON.stringify(s.view), hist: s.hist.length, floor: s.floor }));
  const before = await snap(), layoutBefore = await layoutJson(page);
  await expect.poll(() => page.evaluate(() => localStorage.length), { message: "the zoom's debounced view memory is written before the baseline" }).toBe(3);
  const storeBefore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(before.hist).toBeGreaterThan(0);
  expect(before.sel).not.toBe("null");
  await page.locator("#rn").focus(); // focus inside the part that is about to be hidden
  await resize(page, 380);
  await expect(note(page)).toBeVisible();
  await page.waitForTimeout(150); // let a queued focusout timer run, if there were one
  await resize(page, 1280);
  await expect(note(page)).toBeHidden();
  expect(await snap()).toEqual(before);
  expect(await layoutJson(page)).toBe(layoutBefore);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).toBe(storeBefore);
  expect(await page.evaluate((tag) => { const el = document.querySelector(tag) as any; return [el.__mark, el.__events]; }, EDITOR)).toEqual(["same", 0]);
  await expect(page.locator("#rn")).toHaveValue("Renamed by hand");
  // Undo still undoes the rename.
  expect(await layoutJson(page)).toContain("Renamed by hand");
  await page.locator("#undo").click();
  expect(await layoutJson(page)).not.toContain("Renamed by hand");
});

test("a layout open at 380 is not changed or saved by the notice", async ({ page }) => {
  await boot(page, 380);
  await expect(note(page)).toBeVisible();
  const before = await layoutJson(page);
  const store = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  await page.waitForTimeout(200);
  expect(await layoutJson(page)).toBe(before);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).toBe(store);
  expect(await st(page, (s) => s.hist.length)).toBe(0);
  await resize(page, 1280);
  await expect(note(page)).toBeHidden();
  expect(await layoutJson(page)).toBe(before);
  await expect(page.locator("#undo")).toBeDisabled();
  // The plan is fitted to the real canvas after widening, not to the zero box it had while hidden.
  const vb = (await page.locator(`${EDITOR} .canvas > svg`).getAttribute("viewBox"))!.split(" ").map(Number);
  expect(vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0).toBe(true);
});

test("keys do nothing to the hidden editor while the notice shows, and work again after", async ({ page }) => {
  await boot(page, 1280);
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; the control key below deletes
  const b = (await page.locator('svg g[data-x="0"]').boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  expect(await st(page, (s) => s.sel?.t)).toBe("dev");
  const before = await layoutJson(page);
  await resize(page, 380);
  await expect(note(page)).toBeVisible();
  await page.evaluate((tag) => (document.querySelector(tag) as HTMLElement).focus(), EDITOR);
  for (const k of ["Delete", "Backspace", "Control+z", "Control+a", "Meta+z", "ArrowRight", "r", "Escape", "Control+s", "Meta+s"]) await page.keyboard.press(k);
  expect(await layoutJson(page)).toBe(before);
  expect(await st(page, (s) => [s.hist.length, s.sel?.t])).toEqual([0, "dev"]);
  await resize(page, 1280);
  await expect(note(page)).toBeHidden();
  await page.evaluate((tag) => (document.querySelector(tag) as HTMLElement).focus(), EDITOR);
  await page.keyboard.press("Delete"); // the control: the same key acts on a visible editor
  expect(await layoutJson(page)).not.toBe(before);
});

test("Opus review CSS pair: what hides the editor is display:none on the toolbar and the editor, and the notice is a block", async ({ page }) => {
  const read = () => inShadow(page, (r, h) => {
    const d = (sel: string) => getComputedStyle(r.querySelector(sel)!).display;
    const n = getComputedStyle(r.querySelector("#narrowNote")!);
    return { bar: d(".bar"), ed: d(".ed"), note: n.display, host: getComputedStyle(h).display, bg: getComputedStyle(h).backgroundColor, ink: n.color };
  });
  await boot(page, 380);
  await expect(note(page)).toBeVisible();
  const narrow = await read();
  expect(narrow).toMatchObject({ bar: "none", ed: "none", note: "block", host: "block" });
  expect(narrow.ink, "text is not the background").not.toBe(narrow.bg);
  await resize(page, 1280);
  await expect(note(page)).toBeHidden();
  const wide = await read();
  expect(wide.bar).not.toBe("none");
  expect(wide.ed).toBe("grid");
  expect(wide.note).toBe("none");
});

test("no horizontal scroll at 380, and at 700 the editor is the single-column layout, with a wide plan", async ({ page }) => {
  await boot(page, 380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await resize(page, 748); // the standalone page pads 48 px, so the Studio is 700 wide
  await expect(note(page)).toBeHidden();
  // 700 to 900 px keeps the single column (DECISIONS 2026-10-25): the plan gets the full width, not 340 px between two columns.
  expect(await inShadow(page, (r) => r.querySelector(".canvas")!.getBoundingClientRect().width)).toBeGreaterThan(600);
});
