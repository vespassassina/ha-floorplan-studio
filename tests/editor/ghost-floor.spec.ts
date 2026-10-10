import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readGhostIn } from "../fixtures/ghost-contrast";

// S27.11: View > Floor below draws the floor under the shown one as faint lines (renderFloor's ghost). A viewer preference: kept in
// the browser, never an undo step. The first floor of the demo sits 200 cm east of the ground floor, so the ground floor's ghost is
// drawn 200 cm to the left of the first floor's own outline. Real clicks on the real top element (finding 3).

const EDITOR = "floorplan-studio-editor";
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const layout = structuredClone(demo);
layout.floors.first.offset = [200, 0];

async function boot(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await load(page);
}
async function load(page: Page) {
  await page.locator("#fixPlan").uncheck();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, layout] as const);
  await page.locator('.chip[data-f="first"]').click();
}
const ghosts = (page: Page) => page.locator(`${EDITOR} svg g.ghost`);
const depth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
async function toggle(page: Page) {
  if (!(await page.evaluate((tag) => (document.querySelector(tag) as any).shadowRoot.querySelector("#mOpt").open, EDITOR))) await page.locator("#mOpt > summary").click();
  await page.locator("#ghostFloor").click();
}

test("View > Floor below is off at start; a click draws g.ghost at the offset's shift, a second click removes it; no undo step", async ({ page }) => {
  await boot(page);
  await expect(ghosts(page)).toHaveCount(0);
  const d0 = await depth(page);
  await page.locator("#mOpt > summary").click();
  await expect(page.locator("#ghostFloor")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#ghostFloor").click();
  await expect(ghosts(page)).toHaveCount(1);
  await page.locator("#mOpt > summary").click();
  await expect(page.locator("#ghostFloor")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#mOpt > summary").click();
  // the ground outline starts at x 0; on the first floor's plan that is 0 + (ground.offset 0 - first.offset 200) = -200
  const box = await ghosts(page).evaluate((g) => { const b = (g as unknown as SVGGraphicsElement).getBBox(); return { x: b.x, w: b.width }; });
  expect(box.x).toBeCloseTo(-200, 0);
  expect(box.w).toBeGreaterThan(700);
  expect(await depth(page), "a view preference is no undo step").toBe(d0);
  await toggle(page); // a plain click closes the menu, so it opens again
  await expect(ghosts(page)).toHaveCount(0);
});

test("the lowest floor has none: the item is disabled and says why", async ({ page }) => {
  await boot(page);
  await toggle(page);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(ghosts(page)).toHaveCount(0);
  await page.locator("#mOpt > summary").click();
  await expect(page.locator("#ghostFloor")).toBeDisabled();
  await expect(page.locator("#ghostFloor")).toHaveAttribute("title", /lowest floor/);
});

test("the choice survives a reload; blocked storage does not break the toggle", async ({ page }) => {
  await boot(page);
  await toggle(page);
  await expect(ghosts(page)).toHaveCount(1);
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await load(page);
  await expect(ghosts(page)).toHaveCount(1);
});

test("blocked storage: the toggle still works until reload", async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = deny; Storage.prototype.getItem = deny;
  });
  await boot(page);
  await toggle(page);
  await expect(ghosts(page)).toHaveCount(1);
});

test("a real click where only the ghost is drawn selects nothing", async ({ page }) => {
  await boot(page);
  await toggle(page);
  const spot = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot, svg = root.querySelector("svg")!, r = svg.getBoundingClientRect();
    for (const path of root.querySelectorAll<SVGPathElement>("svg g.ghost path")) {
      const m = path.getScreenCTM()!, len = path.getTotalLength();
      for (let l = 0; l <= len; l += 4) {
        const p = path.getPointAtLength(l), x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
        if (x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8 && root.elementFromPoint(x, y) === svg) return { x, y };
      }
    }
    return null;
  }, EDITOR);
  expect(spot, "the ghost has a line over bare background").not.toBeNull();
  const d0 = await depth(page);
  await page.mouse.click(spot!.x, spot!.y);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR)).toBeNull();
  expect(await depth(page)).toBe(d0);
  await expect(ghosts(page)).toHaveCount(1);
});

// Review 27, finding 3: drawn first, the ghost sat under the opaque room fills. The pair below reads the real element in every theme:
// its place in the paint order, and the computed style that shows it (stroke set and different from the room fill under it).
for (const theme of ["blueprint", "light", "ha"]) {
  test(`the ghost paints over the room fills and under the walls (${theme})`, async ({ page }) => {
    await boot(page);
    await page.evaluate((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.reload();
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await load(page);
    await toggle(page);
    const r = await page.evaluate((tag) => {
      const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
      const g = svg.querySelector("g.ghost")!, p = g.querySelector("path")!, cs = getComputedStyle(p);
      const after = (n: Element) => !!(g.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
      const rooms = [...svg.querySelectorAll("polygon.room")], walls = [...svg.querySelectorAll("line.eh, line.door")], icons = [...svg.querySelectorAll("g[data-x]")];
      const fill = getComputedStyle(rooms[0]).fill;
      return { stroke: cs.stroke, fill: cs.fill, events: cs.pointerEvents, width: cs.strokeWidth, roomFill: fill,
        roomsBefore: rooms.every((n) => !after(n)), wallsAfter: walls.every(after) && walls.length > 0, iconsAfter: icons.every(after) && icons.length > 0 };
    }, EDITOR);
    expect(r).toMatchObject({ fill: "none", events: "none", width: "1.5px", roomsBefore: true, wallsAfter: true, iconsAfter: true });
    expect(r.stroke).not.toBe("none");
    expect(r.stroke).not.toBe(r.roomFill);
  });
}

// S28.2: Preview night veils every room, and the ghost lies under the veil: it dims with the floor it lies on. The Studio has no live
// lights, so every room is dark. Measured from the real elements in the real paint order; the old order (ghost over the veil) gave
// more than the day's contrast.
for (const theme of ["blueprint", "light"]) {
  test(`Preview night dims the ghost floor with the rooms (${theme})`, async ({ page }) => {
    await boot(page);
    await page.evaluate((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.reload();
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await load(page);
    await toggle(page);
    const read = (only: number | null) => readGhostIn(page, EDITOR, "unlit", only);
    const day = await read(null);
    expect(day, "a ghost line lies over a room by day").not.toBeNull();
    if (!(await page.evaluate((tag) => (document.querySelector(tag) as any).shadowRoot.querySelector("#mOpt").open, EDITOR))) await page.locator("#mOpt > summary").click();
    await page.locator("#night").click();
    await expect(page.locator(`${EDITOR} svg polygon[data-night]`).first()).toBeAttached();
    const night = await read(day!.room);
    expect(night, "the same room at night").not.toBeNull();
    expect(night!.veiled, "the veil is painted over the ghost").toBe(true);
    expect(night!.contrast).toBeLessThan(day!.contrast * 0.92);
    expect(night!.contrast).toBeGreaterThan(1.15);
  });
}
