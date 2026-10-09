import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";

// S26.25, the exit test of Sprint 26: on the stress house, 20 lights and a switch in one room. Bind all 20 in THREE user
// actions: (1) Shift+drag a marquee over the lights, (2) open Controlled by, (3) pick the switch. One Undo unbinds all 20.
// Real page.mouse and page.keyboard at real coordinates, real clicks on the aside (finding 3). Nothing here sets the
// selection or calls the editor: the layout is loaded, then only the pointer and keys act.

const EDITOR = "floorplan-studio-editor";
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8")) as Layout;
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);

test("20 lights bound to one switch in three actions, and one Undo unbinds all 20", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  // The stress house with its ground floor cut to the case: 20 lights in a grid in Living (0..700 x 0..600), whose
  // catalog already holds "Living wall switch". The house keeps its 21 rooms, its other floors and its 49 switches.
  const lay = JSON.parse(JSON.stringify(stress)) as Layout;
  lay.floors.ground.devices = Array.from({ length: 20 }, (_, k) => ({
    id: `exit-${k}`, type: "light", name: `Exit spot ${k}`, entity: `light.exit_spot_${k}`, x: 150 + (k % 5) * 100, y: 120 + Math.floor(k / 5) * 100,
  })) as any;
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, lay] as const);
  await expect(page.locator(`${EDITOR} .chip[data-f="ground"]`)).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fixPlan").uncheck();
  await page.evaluate((tag) => { // frame Living; view state only
    const ed = document.querySelector(tag) as any;
    ed.st.views[ed.st.floor] = { x: -20, y: -20, w: 740, h: 640 };
    ed.requestUpdate();
  }, EDITOR);
  await expect(page.locator(`${EDITOR} svg g.dev[data-x]`)).toHaveCount(20);
  const depth = await undoDepth(page);
  const actions: string[] = [];

  // (1) Shift+drag over the lights, from empty room floor to empty room floor
  const a = await screenOf(page, 60, 60), b = await screenOf(page, 640, 480);
  await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  actions.push("marquee");
  await expect(page.locator(`${EDITOR} svg g.dev.sel`)).toHaveCount(20);
  await expect(page.locator(`${EDITOR} .statusbar`)).toContainText("20 selected");
  expect(await undoDepth(page)).toBe(depth); // selecting writes nothing

  // (2) Controlled by
  await page.locator("#vbound input").click();
  actions.push("controlled-by");
  // (3) the switch
  await page.locator("#vbound li[role='option'][data-value='switch.living_wall_switch']").click();
  actions.push("switch");

  expect(actions).toHaveLength(3);
  const bound = async () => (await layoutOf(page)).floors.ground.devices.filter((d) => d.type === "light" && d.bound === "switch.living_wall_switch").length;
  expect(await bound()).toBe(20);
  await expect(page.locator("#status")).toHaveText("Bound 20 lights");
  expect(await undoDepth(page)).toBe(depth + 1);

  // one Undo, one real click, unbinds all 20
  await page.locator("#undo").click();
  expect(await bound()).toBe(0);
  expect((await layoutOf(page)).floors.ground.devices.filter((d) => "bound" in d)).toHaveLength(0);
  expect(await undoDepth(page)).toBe(depth);
});
