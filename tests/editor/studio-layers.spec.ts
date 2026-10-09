import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";
import { pickUnlinked } from "./menu-helpers";

// S24.6 (U6, U17): Layers replace Filter. One eye per family in the left column; one click hides, alt-click shows only
// that family. A line in the toolbar says what is hidden. Placing or finding something on a hidden layer says so and
// offers Show. Real page.mouse at real coordinates (finding 3); the demo's ground floor has two lights, a radiator,
// a switch, a plug, a temperature sensor, a motion sensor, a camera and two pieces of furniture.

const EDITOR = "floorplan-studio-editor";
const VIEW_KEY = "floorplan-studio:view";

async function clickAt(page: Page, sel: string, modifiers: ("Alt")[] = []) {
  const b = (await page.locator(sel).boundingBox())!;
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  for (const m of modifiers) await page.keyboard.up(m);
}
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement; // the plan, not an eye icon of the Layers tab
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);

/** A point on the Living floor clear of icons and furniture, and right of the left column at 1440 wide. */
const LIVING = [420, 260] as const;
const plan = (page: Page) => page.locator(`${EDITOR} .canvas > svg`);
const eye = (page: Page, id: string) => page.locator(`${EDITOR} #layersPanel [data-layer="${id}"]`);

async function load(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}
/** Unticks Fix plan and waits for its banner, which pushes the page down: measure nothing before it is in place. */
async function unfix(page: Page) {
  await page.locator(`${EDITOR} #fixPlan`).uncheck();
  await expect(page.locator(`${EDITOR} #status`)).toHaveText(/unlocked/i);
}
async function openLayers(page: Page) {
  await clickAt(page, `${EDITOR} #tabLayers`);
  await expect(page.locator(`${EDITOR} #layersPanel`)).toBeVisible();
}

test("the Filter menu is gone; a Layers tab sits beside Outline with one eye per family, all shown", async ({ page }) => {
  await load(page);
  await expect(page.locator(`${EDITOR} #filter`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} [data-filter]`)).toHaveCount(0);
  const tabs = await page.locator(`${EDITOR} [role="tablist"][aria-label="Left column"] [role="tab"]`).allInnerTexts();
  expect(tabs.map((t) => t.trim())).toEqual(["Outline", "Layers"]);
  await openLayers(page);
  await expect(page.locator(`${EDITOR} #tabLayers`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`${EDITOR} #tabOutline`)).toHaveAttribute("aria-selected", "false");
  const eyes = page.locator(`${EDITOR} #layersPanel button[data-layer]`);
  await expect(eyes).toHaveCount(11);
  for (const b of await eyes.all()) await expect(b).toHaveAttribute("aria-pressed", "true");
  // a count per family on this floor; a family with nothing here is listed, dimmed
  await expect(eye(page, "lights").locator(".lc")).toHaveText("2");
  await expect(eye(page, "furniture").locator(".lc")).toHaveText("2");
  await expect(eye(page, "media").locator(".lc")).toHaveText("0");
  await expect(eye(page, "media")).toHaveClass(/\bempty\b/);
  await expect(eye(page, "lights")).not.toHaveClass(/\bempty\b/);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveCount(0); // nothing hidden, nothing said
});

test("one click hides lights: no light icon drawn, the rest stay, and the toolbar says so", async ({ page }) => {
  await load(page);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(2);
  const others = await plan(page).locator("g.dev:not(.dev-light)").count();
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await expect(eye(page, "lights")).toHaveAttribute("aria-pressed", "false");
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  await expect(plan(page).locator("g.dev:not(.dev-light)")).toHaveCount(others);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: lights hidden");
  // a second family: the line counts
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="furniture"]`);
  await expect(plan(page).locator("g.furn")).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: 2 of 11 hidden");
  // the line opens the tab; one click there shows a family again
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(2);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: furniture hidden");
  await clickAt(page, `${EDITOR} #layersShowAll`);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveCount(0);
  await expect(plan(page).locator("g.furn")).toHaveCount(2);
});

test("alt-click shows only that family; alt-click again shows all", async ({ page }) => {
  await load(page);
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="security"]`, ["Alt"]);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: only security shown");
  await expect(eye(page, "security")).toHaveAttribute("aria-pressed", "true");
  await expect(eye(page, "lights")).toHaveAttribute("aria-pressed", "false");
  const types = await plan(page).locator("g.dev").evaluateAll((gs) => gs.map((g) => [...g.classList].find((c) => c.startsWith("dev-"))));
  expect(types.sort()).toEqual(["dev-camera", "dev-motion"]);
  await expect(plan(page).locator("g.furn")).toHaveCount(0);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="security"]`, ["Alt"]);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveCount(0);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(2);
});

test("the toolbar line opens the Layers tab, and hidden layers survive a reload", async ({ page }) => {
  await load(page);
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await clickAt(page, `${EDITOR} #tabOutline`);
  await expect(page.locator(`${EDITOR} #layersPanel`)).toHaveCount(0);
  await clickAt(page, `${EDITOR} #layersNote`);
  await expect(page.locator(`${EDITOR} #layersPanel`)).toBeVisible();
  await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}").hidden, VIEW_KEY)).toEqual(["lights"]);
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: lights hidden");
});

test("search does not follow Layers: a hidden light is selected, drawn, and Show brings its family back", async ({ page }) => {
  await load(page);
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  await plan(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await page.keyboard.type("Kitchen light");
  await expect(page.locator(`${EDITOR} fp-search [role="option"]`).first()).toContainText("Kitchen light");
  await page.keyboard.press("Enter");
  const sel = await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR);
  const ground = (await layoutOf(page)).floors.ground;
  expect(sel).toEqual({ t: "dev", i: ground.devices.findIndex((d) => d.name === "Kitchen light") });
  await expect(plan(page).locator("g.dev-light.sel")).toHaveCount(1); // the pick is drawn though its family is hidden
  await expect(plan(page).locator("g.dev-light")).toHaveCount(1);
  await expect(page.locator(`${EDITOR} #status`)).toHaveText("Hidden by Layers: lights");
  await clickAt(page, `${EDITOR} #layersShow`);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(2);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveCount(0);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR)).toEqual(sel); // still selected
});

test("placing under a hidden layer says how many are hidden, and Show brings them back", async ({ page }) => {
  await load(page);
  await unfix(page);
  // three new lights and a temperature sensor in the Living area
  await setHa(page, { floors: [{ id: "gf", name: "Ground" }], areas: [{ id: "living", name: "Living" }],
    entities: [
      ...[0, 1, 2].map((k) => ({ id: `light.strip_${k}`, name: `Strip ${k}`, domain: "light", area: "living" })),
      { id: "sensor.living_t2", name: "Living second temperature", domain: "sensor", dc: "temperature", area: "living" },
    ] });
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: lights hidden");
  const c = await screenOf(page, LIVING[0], LIVING[1]);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator(`${EDITOR} #rplace`)).toBeVisible();
  await page.locator(`${EDITOR} #rplace`).scrollIntoViewIfNeeded();
  await clickAt(page, `${EDITOR} #rplace`);
  await clickAt(page, `${EDITOR} #placeAll`);
  await expect(page.locator(`${EDITOR} #placeGo`)).toHaveText("Place 4");
  await clickAt(page, `${EDITOR} #placeGo`);
  await expect(page.locator(`${EDITOR} #status`)).toHaveText("Placed 4 devices; 3 hidden by Layers");
  expect((await layoutOf(page)).floors.ground.devices.filter((d) => d.type === "light")).toHaveLength(5);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  await clickAt(page, `${EDITOR} #layersShow`);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(5);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveCount(0);
});

test("Opus review CSS pair: an empty family is dimmed, a hidden one struck through, by computed style", async ({ page }) => {
  await load(page);
  await openLayers(page);
  const op = (id: string) => eye(page, id).evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(await op("media")).toBeLessThan(0.7); // empty
  expect(await op("lights")).toBe(1);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  const deco = await eye(page, "lights").locator(".ll").evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(deco).toContain("line-through");
  expect(await eye(page, "climate").locator(".ll").evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("none");
});

// U16: room-scoped lists. The noise Place leaves out stays out of the right-click too, a name shows with its id small,
// and an area that HA sends twice, or two areas of one name, are told apart in the room's area select.
const NOISY_HA = { floors: [{ id: "gf", name: "Ground" }, { id: "up", name: "Upstairs" }],
  areas: [{ id: "living", name: "Living" }, { id: "hall_g", name: "Stair hall", floor_id: "gf" }, { id: "hall_u", name: "Stair hall", floor_id: "up" }, { id: "hall_u", name: "Stair hall", floor_id: "up" }],
  entities: [
    { id: "sensor.living_t2", name: "Living second temperature", domain: "sensor", dc: "temperature", area: "living" },
    { id: "scene.living_bright", name: "Living bright", domain: "scene", area: "living" },
    { id: "sensor.living_remote_battery", name: "Living remote battery", domain: "sensor", dc: "battery", area: "living" },
  ] };

test("U16: the room's right-click lists what Place lists, each by name with its id in small type", async ({ page }) => {
  await load(page);
  await unfix(page);
  await setHa(page, NOISY_HA);
  const c = await screenOf(page, LIVING[0], LIVING[1]);
  await page.mouse.click(c.x, c.y, { button: "right" });
  const menu = page.locator(`${EDITOR} .ctxmenu`);
  await expect(menu).toContainText("Living second temperature");
  await expect(menu.locator("button", { hasText: "Living second temperature" }).locator("small")).toHaveText("sensor.living_t2");
  await expect(menu).not.toContainText("Living bright");
  await expect(menu).not.toContainText("Living remote battery");
});

test("U16: the area select lists an area once, and two of one name with their floor", async ({ page }) => {
  await load(page);
  await unfix(page);
  await setHa(page, NOISY_HA);
  const c = await screenOf(page, LIVING[0], LIVING[1]);
  await page.mouse.click(c.x, c.y);
  const labels = await page.locator(`${EDITOR} #ra option`).allInnerTexts();
  const halls = labels.map((t) => t.trim()).filter((t) => t.startsWith("Stair hall"));
  expect(halls).toEqual(["Stair hall - Ground", "Stair hall - Upstairs"]);
  const values = await page.locator(`${EDITOR} #ra option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => v.startsWith("hall")));
  expect(values).toEqual(["hall_g", "hall_u"]);
});

test("U16: a room's sensor shows its Home Assistant name, the id in small type, not the raw id alone", async ({ page }) => {
  await load(page);
  await unfix(page);
  await page.evaluate((tag) => {
    const ed = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(ed.layout));
    l.floors.ground.rooms.find((r: any) => r.name === "Living").temps = ["sensor.kitchen_temperature"];
    ed.layout = l;
  }, EDITOR);
  await setHa(page, { ...NOISY_HA, entities: [...NOISY_HA.entities, { id: "sensor.kitchen_temperature", name: "Kitchen temperature", domain: "sensor", dc: "temperature" }] });
  const c = await screenOf(page, LIVING[0], LIVING[1]);
  await page.mouse.click(c.x, c.y);
  const row = page.locator(`${EDITOR} .attach-row`, { hasText: "sensor.kitchen_temperature" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Kitchen temperature");
  await expect(row.locator("small.eid")).toHaveText("sensor.kitchen_temperature");
});

test("S24.R8: a click never picks what Layers hides: a small tv piece under hidden Furniture, nor a light", async ({ page }) => {
  // A small tv, speaker or computer is picked from a padded box (S18.10), computed, not hit by the element under the
  // pointer. It used to ignore Layers: a click on the empty floor over a hidden tv selected it and it came back.
  await load(page);
  await page.evaluate((tag) => {
    const ed = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(ed.layout));
    l.floors.ground.furniture.push({ id: "tv-r8", symbol: "tv", x: 420, y: 200, rot: 0, w: 100, h: 8, entity: "media_player.r8", name: "Proof TV" });
    ed.layout = l;
  }, EDITOR);
  const furn = plan(page).locator("g.furn");
  await expect(furn).toHaveCount(3);
  const sel = () => page.evaluate((tag) => (document.querySelector(tag) as any).st.sel as { t: string; i: number } | null, EDITOR);
  const tvAt = await screenOf(page, 420, 209); // in the padded box, 5 cm below the tv's 8 cm body: only the computed pick reaches it
  const away = await screenOf(page, LIVING[0], LIVING[1] + 40);
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="furniture"]`);
  await expect(furn).toHaveCount(0);
  await page.mouse.click(tvAt.x, tvAt.y);
  expect((await sel())?.t).not.toBe("furn");
  await expect(furn).toHaveCount(0);
  // shown again, the same click picks it: the point is right
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="furniture"]`);
  await expect(furn).toHaveCount(3);
  await page.mouse.click(tvAt.x, tvAt.y);
  expect(await sel()).toEqual({ t: "furn", i: 2 });
  // found by search while hidden: the plan keeps it drawn, so it stays pickable; let go, it is gone and not pickable
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="furniture"]`);
  await expect(furn).toHaveCount(0);
  await page.mouse.click(away.x, away.y);
  await page.keyboard.press("/");
  await page.keyboard.type("Proof TV");
  await expect(page.locator(`${EDITOR} fp-search [role="option"]`).first()).toContainText("Proof TV");
  await page.keyboard.press("Enter");
  await expect(furn).toHaveCount(1);
  const kept = await screenOf(page, 420, 209); // search centred the plan on it; again below the body
  await page.mouse.click(kept.x, kept.y);
  expect(await sel()).toEqual({ t: "furn", i: 2 });
  await expect(furn).toHaveCount(1);
  const away2 = await screenOf(page, LIVING[0], LIVING[1] + 40);
  await page.mouse.click(away2.x, away2.y);
  await expect(furn).toHaveCount(0);
  await page.mouse.click(kept.x, kept.y);
  expect((await sel())?.t).not.toBe("furn");
  await expect(furn).toHaveCount(0);
  // a hidden light is not picked either
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="furniture"]`);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  const lamp = await screenOf(page, 650, 200); // Kitchen light, wherever the view now is
  await page.mouse.click(lamp.x, lamp.y);
  expect((await sel())?.t).not.toBe("dev");
  await expect(plan(page).locator("g.dev-light")).toHaveCount(0);
  // shown, the same click picks it: the point is right (a guard: a hidden device has no element to hit)
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="lights"]`);
  await page.mouse.click(lamp.x, lamp.y);
  expect((await sel())?.t).toBe("dev");
});

test("S24.R10a: adding an appliance under a hidden layer names its type as people read it, not its id", async ({ page }) => {
  // The line used the raw type id: "Added ups; hidden by Layers". Now the type's label, lower case unless it is an
  // initialism: "Added UPS", "Added server".
  await load(page);
  await openLayers(page);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="power"]`);
  await clickAt(page, `${EDITOR} #layersPanel [data-layer="computing"]`);
  for (const [type, text] of [["ups", "Added UPS; hidden by Layers"], ["server", "Added server; hidden by Layers"]] as const) {
    await clickAt(page, `${EDITOR} #mAdd > summary`);
    await pickUnlinked(page, type);
    await expect(page.locator(`${EDITOR} #status`)).toHaveText(text);
  }
});
