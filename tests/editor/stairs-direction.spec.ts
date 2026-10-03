import { test, expect, type Page } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";
import type { Layout } from "../../src/core/schema";

// The Direction select of a stair (S: stairs direction). Every pointer action goes through page.mouse at real
// coordinates (CLAUDE.md finding 3). The demo has three floors, ground, first and test; only ground has a flight.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.click(c.x, c.y); };
const flight = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).layout.floors.ground.stairs[0].direction as string | undefined, EDITOR);
const marks = (page: Page, cls: string) => page.locator(`${EDITOR} svg g[data-s] .${cls}`).count();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await clickCm(page, 740, 500); // the ground flight, by a real click
  await expect(page.locator("#sdir")).toBeVisible();
});

test("a ground flight reads Auto (up) and draws no direction mark", async ({ page }) => {
  await expect(page.locator("#sdir")).toHaveValue("auto");
  await expect(page.locator('#sdir option[value="auto"]')).toHaveText("Auto (up)");
  expect(await page.locator("#sdir option").allTextContents()).toEqual(["Auto (up)", "Up", "Down", "Up and down"]);
  expect(await marks(page, "stair-dir")).toBe(0);
});

test("choosing Down is one undo step, shows the arrow live, and undo returns to Auto with no field", async ({ page }) => {
  await expect(page.locator("#undo")).toBeDisabled();
  await page.locator("#sdir").selectOption("down");
  expect(await flight(page)).toBe("down");
  expect(await marks(page, "stair-dir")).toBe(1);
  expect(await marks(page, "stair-shade")).toBeGreaterThan(0);
  await page.locator("#undo").click();
  expect(await flight(page)).toBeUndefined();
  expect("direction" in (await layoutOf(page)).floors.ground.stairs[0]).toBe(false);
  expect(await marks(page, "stair-dir")).toBe(0);
  await expect(page.locator("#undo")).toBeDisabled(); // one gesture, one step
});

test("choosing the same value again records no step, and Auto removes the field", async ({ page }) => {
  await page.locator("#sdir").selectOption("both");
  await page.locator("#sdir").selectOption("both");
  expect(await flight(page)).toBe("both");
  expect(await marks(page, "stair-dir")).toBe(1);
  await page.locator("#undo").click(); // a single undo takes it back, so the second choice added nothing
  expect(await flight(page)).toBeUndefined();
  await clickCm(page, 740, 500); // undo clears the selection
  await page.locator("#sdir").selectOption("up");
  expect(await flight(page)).toBe("up");
  await page.locator("#sdir").selectOption("auto");
  expect("direction" in (await layoutOf(page)).floors.ground.stairs[0]).toBe(false);
});

test("an explicit Up stays up and Auto names what it resolves to on the top floor", async ({ page }) => {
  await page.locator("#sdir").selectOption("down");
  await page.locator('button.chip[data-f="test"]').click();
  await page.locator("details.menu > summary:text-is('Add')").click();
  await page.locator("#mAdd details.sub > summary:text-is('Areas')").click();
  await page.locator("#addStairs").click();
  await expect(page.locator("#sdir")).toHaveValue("auto");
  await expect(page.locator('#sdir option[value="auto"]')).toHaveText("Auto (down)");
  // The flight just added is drawn as a way down on the top floor, with no field written.
  expect(await marks(page, "stair-dir")).toBe(1);
  const l = await layoutOf(page);
  expect(l.floors.test.stairs.every((s) => !("direction" in s))).toBe(true);
});

test("hit-testing is unchanged: a down flight still selects by a click on its centre", async ({ page }) => {
  await page.locator("#sdir").selectOption("down");
  await page.mouse.click(5, 5);
  await clickCm(page, 740, 500);
  await expect(page.locator("#sdir")).toHaveValue("down");
});

test("CSS pair: the direction mark and shade resolve in every theme, take no clicks", async ({ page }) => {
  const body = `<g class="stair"><polygon class="stair-fill" points="0,0 1,0 1,1"/><rect class="stair-shade" x="0" y="0" width="1" height="1" opacity="0.5"/><path class="stair-dir" d="M0 0L1 1"/></g>`;
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const [, shade, dir] = [...g.firstElementChild!.children];
      return { dirStroke: c(dir, "stroke"), dirFill: c(dir, "fill"), dirPe: c(dir, "pointer-events"), shadeFill: c(shade, "fill"), shadePe: c(shade, "pointer-events") };
    });
    expect(r.dirStroke, t).toMatch(/^(rgba?|color)\(/);
    expect(r.dirFill, t).toBe("none");
    expect(r.shadeFill, t).toMatch(/^(rgba?|color)\(/);
    expect([r.dirPe, r.shadePe], t).toEqual(["none", "none"]);
  }
});
