import { test, expect, type Page } from "@playwright/test";
import type { Floor, Layout } from "../../src/core/schema";

// S14.7: the Room panel's Scenes section. Buttons are pressed with real page.mouse clicks at real coordinates
// (CLAUDE.md finding 3); a native <select> takes selectOption. One gesture is one undo step (finding 6).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const roomOf = async (page: Page) => ((await layoutOf(page)).floors.ground as Floor).rooms[0];
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const press = async (page: Page, sel: string) => {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
// The shape of the editor's `ha` (src/core/ha.ts HaData): entities carry domain and area.
const HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
  { id: "scene.living_relax", name: "Relax", domain: "scene", area: "living" }, { id: "scene.kitchen_cook", name: "Cook", domain: "scene", area: "kitchen" }, { id: "scene.hall_dim", name: "Hall dim", domain: "scene", area: null },
] };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await clickCm(page, 150, 100); // Living, bare floor
  await expect(page.locator("#rsc-new")).toBeVisible();
});

// S17.4: the list. Adding and editing happen in the designer (scene-designer.spec.ts); here the list itself.
async function saveOne(page: Page, name: string) {
  await press(page, "#rsc-new");
  await page.locator("#sceneName").fill(name);
  await press(page, "#sd-inc-0");
  await press(page, "#sceneSave");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
}

test("custom scenes are listed by name with their device count, each with Edit and Delete", async ({ page }) => {
  await saveOne(page, "Movie");
  await saveOne(page, "Dinner");
  const rows = page.locator("[data-scene]");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Movie");
  await expect(rows.nth(0)).toContainText("1 device");
  await expect(page.locator("#rsc-edit-1")).toBeVisible();
  await expect(page.locator("#rsc-del-1")).toBeVisible();
});

test("Delete removes that scene in one undo step, Undo brings it back, the last one removes the key", async ({ page }) => {
  await saveOne(page, "Movie");
  await saveOne(page, "Dinner");
  await press(page, "#rsc-del-0");
  expect((await roomOf(page)).scenes!.map((s) => s.name)).toEqual(["Dinner"]);
  await undo(page);
  expect((await roomOf(page)).scenes!.map((s) => s.name)).toEqual(["Movie", "Dinner"]);
  await clickCm(page, 150, 100); // undo clears the selection
  await press(page, "#rsc-del-1");
  await press(page, "#rsc-del-0");
  expect((await roomOf(page)).scenes).toBeUndefined();
});

test("with Home Assistant: the room's area scenes are named, the others can be offered, and Remove stops offering", async ({ page }) => {
  await page.evaluate(([tag, ha]) => { (document.querySelector(tag as string) as any).ha = ha; }, [EDITOR, HA] as const);
  await page.locator("#ra").selectOption("living");
  await expect(page.locator("#rsc-new")).toBeVisible();
  await expect(page.locator("[data-ha-scene=\"scene.living_relax\"]")).toContainText("Relax");
  await expect(page.locator("[data-ha-scene=\"scene.living_relax\"]")).toContainText("Home Assistant");
  await expect(page.locator("[data-ha-scene=\"scene.living_relax\"] button")).toHaveCount(0); // not edited here
  const opts = await page.locator("#rsc-ha-add option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(opts).toEqual(["", "scene.kitchen_cook", "scene.hall_dim"]); // not the area's own, not offered twice
  await page.locator("#rsc-ha-add").selectOption("scene.hall_dim");
  expect((await roomOf(page)).haScenes).toEqual(["scene.hall_dim"]);
  await press(page, "#rsc-ha-rm-0");
  expect((await roomOf(page)).haScenes).toBeUndefined();
  await undo(page);
  expect((await roomOf(page)).haScenes).toEqual(["scene.hall_dim"]);
});

test("a zone has no Scenes section (nothing on the card would show it)", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[0].kind = "zone"; l.floors.ground.rooms[0].wk = l.floors.ground.rooms[0].pts.map(() => "boundary");
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("#rsc-new")).toHaveCount(0);
});

// S18.5, S18.6: the offer control says what it does; New scene is the highlighted button; the area's Home Assistant rows are a section of their own that folds.
test("New scene is the primary button, the offer control is explained, and the area's rows sit in their own foldable section", async ({ page }) => {
  await page.evaluate(([tag, ha]) => { (document.querySelector(tag as string) as any).ha = ha; }, [EDITOR, HA] as const);
  await page.locator("#ra").selectOption("living");
  await expect(page.locator("#rsc-new")).toHaveClass(/primary/);
  await expect(page.locator('label[for="rsc-ha-add"]')).toHaveText("Offer another scene");
  await expect(page.locator('details[data-sec="room:scenes"] .hint').filter({ hasText: "from another area" })).toBeVisible();
  const sec = page.locator('details[data-sec="room:ha"]');
  await expect(sec.locator(".habox")).toBeVisible();
  await expect(page.locator('details[data-sec="room:scenes"] .habox')).toHaveCount(0); // not inside Scenes
  await sec.locator("summary.pnl-h").click();
  await expect(sec.locator(".habox")).toBeHidden();
});
