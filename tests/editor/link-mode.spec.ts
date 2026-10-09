import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S26.23: Edit, Link lights to switches opens the Link mode of the Inspector: the pairs (light, suggested switch) with
// ticks, scoped to the selection, else the selected room, else the floor. Apply binds the ticked ones in one undo step.
// Three unbound lights: Alpha and Beta in Living, Gamma in Kitchen; each has a same-area switch with a name of its own.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const devs = async (page: Page) => (await layoutOf(page)).floors.ground.devices;
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const setSel = (page: Page, sel: unknown) => page.evaluate(([tag, s]) => { const el = document.querySelector(tag as string) as any; el.st.sel = s; el.requestUpdate(); }, [EDITOR, sel] as const);
const HA = {
  floors: [], areas: [{ id: "living", name: "Living", floor_id: "floor_ground" }, { id: "kitchen", name: "Kitchen", floor_id: "floor_ground" }],
  entities: [
    { id: "light.alpha", name: "Alpha lamp", domain: "light", area: "living" },
    { id: "light.beta", name: "Beta lamp", domain: "light", area: "living" },
    { id: "light.gamma", name: "Gamma lamp", domain: "light", area: "kitchen" },
    { id: "switch.alpha_sw", name: "Alpha switch", domain: "switch", area: "living" },
    { id: "switch.beta_sw", name: "Beta switch", domain: "switch", area: "living" },
    { id: "switch.gamma_sw", name: "Gamma switch", domain: "switch", area: "kitchen" },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, ha]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const f = l.floors.ground, bounds = (name: string) => { const r = f.rooms.find((x: any) => x.name === name); const xs = r.pts.map((p: number[]) => p[0]), ys = r.pts.map((p: number[]) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
    const [lx, ly] = bounds("Living"), [kx, ky] = bounds("Kitchen");
    f.devices = [
      { id: "la", type: "light", name: "Alpha lamp", entity: "light.alpha", x: lx - 20, y: ly },
      { id: "lb", type: "light", name: "Beta lamp", entity: "light.beta", x: lx + 20, y: ly },
      { id: "lg", type: "light", name: "Gamma lamp", entity: "light.gamma", x: kx, y: ky },
    ];
    el.layout = l;
    el.ha = ha;
  }, [EDITOR, HA] as const);
});

const openLink = async (page: Page) => { await page.locator("#mEdit > summary").click(); await page.locator("#linkLights").click(); };
const rows = (page: Page) => page.locator("#linkPanel .prow");

test("Link mode lists the floor's pairs, nothing selected; untick one, Apply binds two, one Undo clears both", async ({ page }) => {
  const depth = await undoDepth(page);
  await openLink(page);
  await expect(page.locator('aside [role=tab][data-mode="link"]')).toHaveAttribute("aria-selected", "true");
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText("Alpha lamp");
  await expect(rows(page).nth(0)).toContainText("Alpha switch");
  await expect(rows(page).locator("input:checked")).toHaveCount(3);
  expect(await undoDepth(page)).toBe(depth); // a preview changes nothing
  expect((await devs(page)).some((d) => "bound" in d)).toBe(false);
  await rows(page).nth(1).locator("input").click(); // Beta
  await expect(page.locator("#linkApply")).toHaveText("Link 2");
  await page.locator("#linkApply").click();
  const d = await devs(page);
  expect(d.map((x) => x.bound)).toEqual(["switch.alpha_sw", undefined, "switch.gamma_sw"]);
  expect(await undoDepth(page)).toBe(depth + 1);
  await expect(page.locator("#status")).toContainText("Linked 2 lights");
  await expect(page.locator('aside [role=tab][data-mode="selection"]')).toHaveAttribute("aria-selected", "true");
  await page.locator("#undo").click();
  expect((await devs(page)).some((x) => "bound" in x)).toBe(false); // one Undo took both back
});

test("scope: a selected room shows its lights only; a selection shows the selected ones only", async ({ page }) => {
  const living = (await layoutOf(page)).floors.ground.rooms.findIndex((r) => r.name === "Living");
  await setSel(page, { t: "room", i: living });
  await openLink(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator("#linkPanel")).toContainText("Living");
  await page.locator('aside [role=tab][data-mode="selection"]').click();
  await setSel(page, { t: "devs", is: [2] });
  await openLink(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Gamma lamp");
  await setSel(page, { t: "dev", i: 0 });
  await page.locator('aside [role=tab][data-mode="selection"]').click();
  await openLink(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Alpha lamp");
});

test("leaving the mode without Apply binds nothing; Escape and the tab both leave it; no clear match says so", async ({ page }) => {
  const depth = await undoDepth(page);
  await openLink(page);
  await page.keyboard.press("Escape");
  await expect(page.locator('aside [role=tab][data-mode="selection"]')).toHaveAttribute("aria-selected", "true");
  expect(await undoDepth(page)).toBe(depth);
  expect((await devs(page)).some((d) => "bound" in d)).toBe(false);
  await openLink(page);
  await page.locator('aside [role=tab][data-mode="selection"]').click(); // the Selection tab leaves it too
  await expect(page.locator("#linkPanel")).toHaveCount(0);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.ha = { ...el.ha, entities: el.ha.entities.filter((e: any) => e.domain !== "switch") }; }, EDITOR);
  await openLink(page);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#linkNone")).toBeVisible();
  await expect(page.locator("#linkApply")).toBeDisabled();
});

// Opus review R2: the scope is device indices, so a Delete or an Undo under an open Link mode moved the indices onto other
// lights, and Apply would have bound lights nobody chose. Any edit, Undo or Redo closes the mode.
const focusEditor = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as HTMLElement).focus(), EDITOR);

test("Delete under an open Link mode closes it: Gamma, which slides into the old indices, is never offered", async ({ page }) => {
  await setSel(page, { t: "devs", is: [0, 1] }); // Alpha and Beta
  await openLink(page);
  await expect(rows(page)).toHaveCount(2);
  await focusEditor(page);
  await page.keyboard.press("Delete");
  await expect(page.locator("#linkPanel")).toHaveCount(0);
  await expect(page.locator('aside [role=tab][data-mode="link"]')).toHaveCount(0);
  expect((await devs(page)).map((d) => d.id)).toEqual(["lg"]);
  expect((await devs(page)).some((d) => "bound" in d)).toBe(false);
});

test("Undo and Redo under an open Link mode close it", async ({ page }) => {
  await setSel(page, { t: "dev", i: 0 });
  await focusEditor(page);
  await page.keyboard.press("Delete"); // Alpha gone; Beta is index 0
  expect((await devs(page)).map((d) => d.id)).toEqual(["lb", "lg"]);
  await setSel(page, { t: "dev", i: 0 }); // Beta
  await openLink(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Beta lamp");
  await page.locator("#undo").click(); // Alpha is index 0 again
  await expect(page.locator("#linkPanel")).toHaveCount(0);
  await openLink(page); // nothing selected after Undo: the floor
  await expect(rows(page)).toHaveCount(3);
  await page.locator("#redo").click(); // the mode is open again and Redo must close it too
  await expect(page.locator("#linkPanel")).toHaveCount(0);
});
