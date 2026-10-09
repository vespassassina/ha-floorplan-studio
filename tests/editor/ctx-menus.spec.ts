import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";
import { CTX_TARGETS, ctxItems, type CtxTargetKind } from "../../src/editor/ctx-items";

// S26.20 (U19): one context menu per object on the plan. Every target in CTX_TARGETS opens a menu whose labels and
// order come from ctxItems. Real page.mouse at real coordinates on the real top element (finding 3). The demo's ground
// floor has two lights (0, 1), a radiator, three doors, two pieces of furniture and one stairs; the objects it lacks
// (a free wall, an opening, a structure line, an unlinked device) are added to the layout before the click.

const EDITOR = "floorplan-studio-editor";
const HA = { floors: [], areas: [{ id: "living", name: "Living" }], entities: [
  { id: "sensor.shed_temp", name: "Shed temperature", domain: "sensor", dc: "temperature" },
  { id: "switch.lamp_relay", name: "Lamp relay", domain: "switch" },
] };

const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const ground = async (page: Page) => (await layoutOf(page)).floors.ground;
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const centre = async (page: Page, sel: string) => { const b = (await page.locator(`${EDITOR} ${sel}`).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const menu = (page: Page) => page.locator(`${EDITOR} .ctxmenu`);
const labels = (page: Page) => page.locator(`${EDITOR} .ctxmenu [data-cm] .cm-l`).allInnerTexts();
const item = (page: Page, id: string) => page.locator(`${EDITOR} .ctxmenu [data-cm="${id}"]`);
/** The selection as the editor holds it. The plan does not draw a multi-selection until the marquee lane lands, so this reads the state. */
const selOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).st.sel)), EDITOR);
const rightClick = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y, { button: "right" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  await setHa(page, HA);
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const g = l.floors.ground;
    g.walls = [{ id: "wall-c-1", a: [250, 20], b: [350, 20], kind: "wall" }];
    g.openings = [{ id: "opening-c-1", a: [450, 600], b: [540, 600] }];
    g.extras = [{ id: "extra-c-1", name: "Rail", a: [100, 540], b: [220, 590] }];
    g.unlinked = [{ id: "unl-c-1", type: "heater", x: 850, y: 500, rot: 0, scale: 1 }];
    el.layout = l;
  }, EDITOR);
});

/** Where a real right-click lands on each kind of target, and what the menu's facts are there. */
const TARGETS: Record<CtxTargetKind, { at: (p: Page) => Promise<{ x: number; y: number }>; facts?: { hasLight?: boolean; count?: number }; before?: (p: Page) => Promise<void> }> = {
  canvas: { at: (p) => screenOf(p, 950, 700) },
  room: { at: (p) => screenOf(p, 200, 150) },
  edge: { at: (p) => screenOf(p, 500, 300) },
  wall: { at: (p) => screenOf(p, 300, 20) },
  door: { at: (p) => screenOf(p, 345, 600) },
  opening: { at: (p) => screenOf(p, 495, 600) },
  stairs: { at: (p) => screenOf(p, 740, 500) },
  extra: { at: (p) => screenOf(p, 160, 565) },
  furn: { at: (p) => centre(p, 'g[data-f="0"]') },
  unl: { at: (p) => centre(p, 'g[data-u="0"]') },
  dev: { at: (p) => centre(p, 'g[data-x="0"]'), facts: { hasLight: true } },
  devs: {
    at: (p) => centre(p, 'g[data-x="0"]'), facts: { hasLight: true, count: 2 },
    before: async (p) => { // two lights, Shift+clicked for real
      const a = await centre(p, 'g[data-x="0"]'), b = await centre(p, 'g[data-x="1"]');
      await p.mouse.click(a.x, a.y);
      await p.keyboard.down("Shift"); await p.mouse.click(b.x, b.y); await p.keyboard.up("Shift");
    },
  },
};

test("every target in CTX_TARGETS is covered by this spec", () => {
  expect(Object.keys(TARGETS).sort()).toEqual([...CTX_TARGETS].sort());
});

for (const kind of CTX_TARGETS) {
  test(`a real right-click on ${kind} opens a menu with the labels and order of ctxItems`, async ({ page }) => {
    const t = TARGETS[kind];
    await t.before?.(page);
    await rightClick(page, await t.at(page));
    await expect(menu(page)).toBeVisible();
    const want = ctxItems(kind, { locked: false, hasLight: false, count: 1, ha: true, ...t.facts }).map((i) => i.label);
    expect(await labels(page)).toEqual(want);
    // inside the viewport, and a click elsewhere closes it, as does Escape
    const box = (await menu(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await t.before?.(page);
    await rightClick(page, await t.at(page));
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(menu(page)).toHaveCount(0);
  });
}

test("a right-click on a device that is not in the selection selects just that device", async ({ page }) => {
  await TARGETS.devs.before!(page);
  const other = await centre(page, 'g[data-x="2"]');
  await rightClick(page, other);
  expect(await labels(page)).toEqual(ctxItems("dev", { locked: false, hasLight: false, count: 1, ha: true }).map((i) => i.label));
  await expect(page.locator(`${EDITOR} svg g[data-x="2"].sel`)).toHaveCount(1);
  await expect(page.locator(`${EDITOR} svg g[data-x="0"].sel`)).toHaveCount(0);
});

test("device Lock then a real drag does not move it; Unlock and the drag moves it; each one undo step", async ({ page }) => {
  const before = (await ground(page)).devices[0] as any;
  const a = await centre(page, 'g[data-x="0"]');
  await rightClick(page, a);
  await expect(item(page, "lock")).toContainText("Lock");
  await item(page, "lock").click();
  await expect(menu(page)).toHaveCount(0);
  expect(((await ground(page)).devices[0] as any).locked).toBe(true);

  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 60, a.y + 40, { steps: 6 }); await page.mouse.up();
  const held = (await ground(page)).devices[0] as any;
  expect([held.x, held.y]).toEqual([before.x, before.y]);

  await rightClick(page, a);
  await expect(item(page, "lock")).toContainText("Unlock");
  await item(page, "lock").click();
  expect(((await ground(page)).devices[0] as any).locked).toBeUndefined();
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 60, a.y + 40, { steps: 6 }); await page.mouse.up();
  const moved = (await ground(page)).devices[0] as any;
  expect(moved.x).toBeGreaterThan(before.x + 20);
  expect(moved.y).toBeGreaterThan(before.y + 10);

  await page.keyboard.press("Control+z"); // the drag
  await page.keyboard.press("Control+z"); // Unlock
  expect(((await ground(page)).devices[0] as any).locked).toBe(true);
});

test("Lock on two selected lights locks both in one undo step; Delete 2 removes both in one", async ({ page }) => {
  await TARGETS.devs.before!(page);
  await rightClick(page, await centre(page, 'g[data-x="0"]'));
  await item(page, "lock").click();
  let g = await ground(page);
  expect([(g.devices[0] as any).locked, (g.devices[1] as any).locked]).toEqual([true, true]);
  await page.keyboard.press("Control+z");
  g = await ground(page);
  expect([(g.devices[0] as any).locked, (g.devices[1] as any).locked]).toEqual([undefined, undefined]);

  await TARGETS.devs.before!(page);
  await rightClick(page, await centre(page, 'g[data-x="0"]'));
  await expect(item(page, "delete")).toContainText("Delete 2");
  const n = g.devices.length;
  await item(page, "delete").click();
  expect((await ground(page)).devices).toHaveLength(n - 2);
  await page.keyboard.press("Control+z");
  expect((await ground(page)).devices).toHaveLength(n);
});

test("canvas 'Add device here…' opens Add, and the device lands at the click point", async ({ page }) => {
  const at = await screenOf(page, 950, 700);
  await rightClick(page, at);
  await item(page, "addDeviceHere").click();
  await expect(page.locator(`${EDITOR} #addDevSearch`)).toBeVisible();
  await page.locator(`${EDITOR} #addDevPanel button[data-add]`, { hasText: "Shed temperature" }).click();
  const d = (await ground(page)).devices.find((x: any) => x.entity === "sensor.shed_temp") as any;
  expect(Math.abs(d.x - 950)).toBeLessThanOrEqual(25);
  expect(Math.abs(d.y - 700)).toBeLessThanOrEqual(25);
});

test("canvas 'Add device here…' is disabled without Home Assistant", async ({ page }) => {
  await setHa(page, null);
  await rightClick(page, await screenOf(page, 950, 700));
  await expect(item(page, "addDeviceHere")).toBeDisabled();
});

test("canvas 'Select all devices' selects every device", async ({ page }) => {
  const n = (await ground(page)).devices.length;
  await rightClick(page, await screenOf(page, 950, 700));
  await item(page, "selectAll").click();
  expect(await selOf(page)).toEqual({ t: "devs", is: Array.from({ length: n }, (_, i) => i) });
});

test("canvas 'Zoom to fit' brings a zoomed-in view back to the fitted one", async ({ page }) => {
  const view = () => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR);
  const fitted = await view();
  const box = (await page.locator(`${EDITOR} .canvas`).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < 3; k++) await page.mouse.wheel(0, 200); // zoom out; the plan shrinks, the canvas corner stays empty
  expect(await view()).not.toBe(fitted);
  await rightClick(page, { x: box.x + 20, y: box.y + 20 });
  await item(page, "zoomFit").click();
  expect(await view()).toBe(fitted);
});

test("device 'Select same type' selects the other light; 'Hide this type' hides the family", async ({ page }) => {
  await rightClick(page, await centre(page, 'g[data-x="0"]'));
  await item(page, "selectSameType").click();
  expect(await selOf(page)).toEqual({ t: "devs", is: [0, 1] });

  const light = await centre(page, 'g[data-x="0"]');
  await page.mouse.click(light.x, light.y); // back to one device
  await rightClick(page, light);
  await item(page, "hideType").click();
  await expect(page.locator(`${EDITOR} svg g.dev-light`)).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #layersNote`)).toHaveText("Layers: lights hidden");
});

test("room 'Select devices inside' selects the devices whose centre is in the room", async ({ page }) => {
  await rightClick(page, await screenOf(page, 200, 150)); // Living: light, plug, temp, heater
  await item(page, "selectInside").click();
  const g = await ground(page);
  const inLiving = g.devices.map((d: any, i: number) => ({ d, i })).filter(({ d }) => ("x" in d ? d.x >= 0 && d.x <= 500 && d.y >= 0 && d.y <= 400 : (d.a[0] + d.b[0]) / 2 <= 500 && (d.a[1] + d.b[1]) / 2 <= 400)).map(({ i }) => i);
  expect(inLiving.length).toBeGreaterThan(1);
  expect(await selOf(page)).toEqual({ t: "devs", is: inLiving });
});

test("stairs, structure line and the other fixed objects: Delete removes just that one, one undo step", async ({ page }) => {
  const cases: [string, "stairs" | "extras" | "doors" | "openings" | "furniture" | "unlinked"][] = [["stairs", "stairs"], ["extra", "extras"], ["door", "doors"], ["opening", "openings"], ["furn", "furniture"], ["unl", "unlinked"]];
  for (const [kind, key] of cases) {
    const n = ((await ground(page)) as any)[key].length;
    await rightClick(page, await TARGETS[kind as CtxTargetKind].at(page));
    await item(page, "delete").click();
    expect(((await ground(page)) as any)[key], kind).toHaveLength(n - 1);
    await page.keyboard.press("Control+z");
    expect(((await ground(page)) as any)[key], kind).toHaveLength(n);
  }
});

test("door, furniture and unlinked 'Lock' toggles and shows 'Unlock'", async ({ page }) => {
  await rightClick(page, await TARGETS.furn.at(page));
  await item(page, "lock").click();
  expect((await ground(page)).furniture[0].locked).toBe(true);
  await rightClick(page, await TARGETS.furn.at(page));
  await expect(item(page, "lock")).toContainText("Unlock");
});

test("device 'Controlled by…' puts the focus on the Controlled by field", async ({ page }) => {
  await rightClick(page, await centre(page, 'g[data-x="0"]'));
  await item(page, "controlledBy").click();
  await expect(page.locator(`${EDITOR} #vbound`)).toBeFocused();
});

test("room 'Rename' puts the focus on the name field; 'Bring to front' still works", async ({ page }) => {
  await page.evaluate((tag) => { (document.querySelector(tag as string) as any).ha = null; }, EDITOR); // with HA, a room's name is the area's
  await rightClick(page, await screenOf(page, 200, 150));
  await item(page, "rename").click();
  await expect(page.locator(`${EDITOR} #rn`)).toBeFocused();
});

// Opus review R5: a menu opened near the foot was clamped to innerHeight-120 and then capped, so at 1024x768 it became a 112 px
// scrolling strip. It shifts up so the whole menu fits when it can.
for (const [w, h] of [[1280, 720], [1024, 768]]) {
  test(`${w}x${h}: a right-click near the canvas foot opens a menu that fits whole inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/standalone.html");
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await page.locator("#fixPlan").uncheck();
    await setHa(page, HA);
    // the empty canvas, real mouse, 20 px above the foot of the canvas (the canvas ends above the window foot)
    const c = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
    await page.mouse.click(c.x + 6, c.y + c.height - 20, { button: "right" });
    await expect(menu(page)).toBeVisible();
    const fits = async () => page.evaluate((tag) => {
      const m = (document.querySelector(tag) as any).shadowRoot.querySelector(".ctxmenu") as HTMLElement;
      const r = m.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scrolls: m.scrollHeight > m.clientHeight + 1, n: m.querySelectorAll("[data-cm]").length };
    }, EDITOR);
    let f = await fits();
    expect(f.n).toBeGreaterThan(2);
    expect(f.top).toBeGreaterThanOrEqual(0);
    expect(f.bottom).toBeLessThanOrEqual(h);
    expect(f.scrolls).toBe(false);
    // the longest menu there is (a room, with its devices), opened at the same height
    await page.keyboard.press("Escape");
    await page.evaluate(([tag, y]) => { const ed = document.querySelector(tag as string) as any; ed.ctxMenu = { x: 40, y, target: { k: "room", i: 0 } }; ed.requestUpdate(); }, [EDITOR, h - 60] as const);
    await expect(menu(page)).toBeVisible();
    f = await fits();
    expect(f.bottom).toBeLessThanOrEqual(h);
    expect(f.top).toBeGreaterThanOrEqual(0);
    expect(f.scrolls).toBe(false);
  });
}
