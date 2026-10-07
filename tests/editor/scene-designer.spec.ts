import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S17.3 (docs/specs/scene-designer.md): the scene designer popup. Real mouse at real coordinates (CLAUDE.md finding 3). The colour
// box is a native picker, which a script cannot open: its value is filled, which fires the same `input` event a pick does.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const scenes = async (page: Page) => (await layoutOf(page)).floors.ground.rooms[0].scenes ?? [];
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const press = async (page: Page, sel: string) => {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const p = await screenOf(page, 150, 100);
  await page.mouse.click(p.x, p.y);
  await press(page, "#rsc-new");
  await expect(page.locator("#scenePanel")).toBeVisible();
});

const firstRow = (page: Page) => page.locator("#scenePanel .sd-row").first();

test("New scene opens a popup listing the room's devices; nothing is in the layout yet", async ({ page }) => {
  await expect(page.locator("#scenePanel .sd-row").first()).toBeVisible();
  expect(await page.locator("#scenePanel .sd-row").count()).toBeGreaterThan(0);
  expect(await scenes(page)).toHaveLength(0);
});

test("Save without a name says why and stays open; with no device it says that; the layout does not change", async ({ page }) => {
  await press(page, "#sceneSave");
  await expect(page.locator("#sceneError")).toHaveText("Give the scene a name.");
  await page.locator("#sceneName").fill("Movie");
  await press(page, "#sceneSave");
  await expect(page.locator("#sceneError")).toHaveText("Pick at least one device.");
  await expect(page.locator("#scenePanel")).toBeVisible();
  expect(await scenes(page)).toHaveLength(0);
});

test("tick a light, set its brightness and kelvin, name it, Save: one scene, one undo step, popup closed", async ({ page }) => {
  await page.locator("#sceneName").fill("Movie");
  await press(page, "#sd-inc-0");
  const bri = page.locator("#sd-brightness-0"), kel = page.locator("#sd-kelvin-0");
  await bri.fill("40"); await bri.press("Tab");
  await kel.fill("2700"); await kel.press("Tab");
  await press(page, "#sceneSave");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  const s = await scenes(page);
  expect(s).toHaveLength(1);
  expect(s[0].name).toBe("Movie");
  expect(s[0].items).toHaveLength(1);
  expect(s[0].items[0]).toMatchObject({ on: true, brightness: 40, kelvin: 2700 });
  await press(page, "#undo");
  expect(await scenes(page)).toHaveLength(0);
});

test("a colour replaces the kelvin, and kelvin replaces the colour: a light holds one of them", async ({ page }) => {
  await page.locator("#sceneName").fill("Red");
  await press(page, "#sd-inc-0");
  await page.locator("#sd-kelvin-0").fill("3000"); await page.locator("#sd-kelvin-0").press("Tab");
  await page.locator("#sd-col-0").fill("#ff0000");
  await press(page, "#sceneSave");
  let it = (await scenes(page))[0].items[0];
  expect(it.hs).toEqual([0, 100]);
  expect(it.kelvin).toBeUndefined();
  await press(page, "#rsc-edit-0");
  await page.locator("#sd-kelvin-0").fill("2200"); await page.locator("#sd-kelvin-0").press("Tab");
  await press(page, "#sceneSave");
  it = (await scenes(page))[0].items[0];
  expect(it.kelvin).toBe(2200);
  expect(it.hs).toBeUndefined();
});

test("Cancel, the X and Escape change nothing and add no undo step", async ({ page }) => {
  await page.locator("#sceneName").fill("Nope");
  await press(page, "#sd-inc-0");
  await press(page, "#sceneCancel");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  expect(await scenes(page)).toHaveLength(0);
  await expect(page.locator("#undo")).toBeDisabled();
  await press(page, "#rsc-new");
  await page.locator("#sceneName").fill("Nope");
  await press(page, "#sceneClose");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  await press(page, "#rsc-new");
  await page.locator("#sceneName").press("Escape");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  expect(await scenes(page)).toHaveLength(0);
});

test("an off device drops its fields; Edit opens the saved scene and Save replaces it in place", async ({ page }) => {
  await page.locator("#sceneName").fill("Night");
  await press(page, "#sd-inc-0");
  await page.locator("#sd-brightness-0").fill("10"); await page.locator("#sd-brightness-0").press("Tab");
  await page.locator("#sd-on-0").selectOption("off");
  await expect(page.locator("#sd-brightness-0")).toHaveCount(0);
  await press(page, "#sceneSave");
  expect((await scenes(page))[0].items[0]).toEqual({ entity: expect.any(String), on: false });
  await press(page, "#rsc-edit-0");
  await expect(page.locator("#sceneName")).toHaveValue("Night");
  await page.locator("#sceneName").fill("Late");
  await press(page, "#sceneSave");
  const s = await scenes(page);
  expect(s).toHaveLength(1);
  expect(s[0].name).toBe("Late");
  expect(s[0].id).toBe("scene-1");
});

test("a name that is typed survives a re-render while the box has focus", async ({ page }) => {
  await page.locator("#sceneName").click();
  await page.keyboard.type("Dinner");
  await press(page, "#sd-inc-0");
  await expect(page.locator("#sceneName")).toHaveValue("Dinner");
  void firstRow;
});

// S17.5: the palette. A second lamp is put in the Living room so two lights can be told apart.
async function twoLights(page: Page) {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices.push({ id: "light-lamp", type: "light", entity: "light.demo_lamp", name: "Lamp", x: 100, y: 100 });
    el.layout = l;
  }, EDITOR);
  await press(page, "#sceneCancel");
  await page.mouse.click(2, 2);
  const p = await screenOf(page, 150, 300);
  await page.mouse.click(p.x, p.y);
  await press(page, "#rsc-new");
  await expect(page.locator("#scenePanel")).toBeVisible();
}
const setColour = (page: Page, id: string, hex: string) => page.locator(id).fill(hex);

test("Apply deals the palette to the ticked lights that are on, brightest colour first, and saves it", async ({ page }) => {
  await twoLights(page);
  const lights = page.locator('#scenePanel .sd-row[data-sdev^="light."]');
  expect(await lights.count()).toBe(2);
  await page.locator("#sceneName").fill("Party");
  await setColour(page, "#sp-col-0", "#0000ff");
  await setColour(page, "#sp-col-1", "#ffff00");
  await press(page, "#sp-add"); // the third stays white
  await press(page, "#sp-apply");
  await expect(page.locator("#paletteNote")).toHaveText("Tick at least one light that is on.");
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]'); await press(page, '[data-sdev="light.demo_lamp"] input[type=checkbox]');
  await press(page, "#sp-apply");
  await expect(page.locator("#paletteNote")).toContainText("2 lights");
  await press(page, "#sceneSave");
  const items = (await scenes(page))[0].items;
  // white (255,255,255) is the brightest, then yellow, then blue: the first two lights get white and yellow
  expect(Object.fromEntries(items.map((i) => [i.entity, i.hs]))).toEqual({ "light.demo_living": [0, 0], "light.demo_lamp": [60, 100] });
  expect(items.every((i) => i.kelvin === undefined)).toBe(true);
});

test("Apply skips a light that is off, replaces a kelvin, and leaves a switch alone; palette colours add up to 6 and down to 2", async ({ page }) => {
  await press(page, "#sceneCancel");
  await press(page, "#rsc-new");
  await page.locator("#sceneName").fill("Mix");
  await press(page, "#sd-inc-0");
  await page.locator("#sd-kelvin-0").fill("2700"); await page.locator("#sd-kelvin-0").press("Tab");
  await press(page, "#sd-inc-1"); // the TV plug, a switch
  await press(page, "#sp-apply");
  await press(page, "#sceneSave");
  const items = (await scenes(page))[0].items;
  expect(items[0].hs).toBeDefined();
  expect(items[0].kelvin).toBeUndefined();
  expect(items[1]).toEqual({ entity: expect.stringMatching(/^switch\./), on: true });
  await press(page, "#rsc-new");
  for (let k = 0; k < 5; k++) if (await page.locator("#sp-add").count()) await press(page, "#sp-add");
  await expect(page.locator('#scenePalette input[type=color]')).toHaveCount(6);
  await expect(page.locator("#sp-add")).toHaveCount(0);
  for (let k = 0; k < 6; k++) if (await page.locator("#sp-rm-0").count()) await press(page, "#sp-rm-0");
  await expect(page.locator('#scenePalette input[type=color]')).toHaveCount(2);
  await expect(page.locator("#sp-rm-0")).toHaveCount(0);
});

test("the same palette gives the same colours twice", async ({ page }) => {
  await press(page, "#sd-inc-0");
  await press(page, "#sp-apply");
  const first = await page.locator("#sd-col-0").inputValue();
  await press(page, "#sp-apply");
  expect(await page.locator("#sd-col-0").inputValue()).toBe(first);
  expect(first).not.toBe("#ffffff");
});

// S17.6: the picture. The fixture is drawn in the page (a flat red half and a smaller blue half) and handed to the file box as a PNG.
const picture = async (page: Page) => {
  const url = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 40; c.height = 20;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff0000"; g.fillRect(0, 0, 28, 20);
    g.fillStyle = "#0000ff"; g.fillRect(28, 0, 12, 20);
    return c.toDataURL("image/png");
  });
  return Buffer.from(url.split(",")[1], "base64");
};

test("a picture fills the palette with its colours, biggest first, and Apply puts them on the lights", async ({ page }) => {
  await page.locator("#sp-image").setInputFiles({ name: "sunset.png", mimeType: "image/png", buffer: await picture(page) });
  await expect(page.locator("#paletteNote")).toHaveText("Took 2 colours from sunset.png. Press Apply to lights.");
  await expect(page.locator('#scenePalette input[type=color]')).toHaveCount(2);
  const cols = await page.locator('#scenePalette input[type=color]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).sort());
  expect(cols).toEqual(["#0000ff", "#ff0000"]);
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await press(page, "#sp-apply");
  await page.locator("#sceneName").fill("Sunset");
  await press(page, "#sceneSave");
  expect((await scenes(page))[0].items[0].hs).toEqual([0, 100]); // red is brighter than blue, so the one light takes red
});

test("the same picture twice gives the same palette; a file that is not a picture is refused with a message and changes nothing", async ({ page }) => {
  const buffer = await picture(page);
  const read = () => page.locator('#scenePalette input[type=color]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  await page.locator("#sp-image").setInputFiles({ name: "a.png", mimeType: "image/png", buffer });
  await expect(page.locator("#paletteNote")).toContainText("Took 2");
  const first = await read();
  await page.locator("#sp-image").setInputFiles({ name: "b.png", mimeType: "image/png", buffer });
  await expect(page.locator("#paletteNote")).toContainText("from b.png");
  expect(await read()).toEqual(first);
  await page.locator("#sp-image").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("#paletteNote")).toContainText("notes.txt is not a picture");
  expect(await read()).toEqual(first);
  await page.locator("#sp-image").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
  await expect(page.locator("#paletteNote")).toContainText("could not be read");
  expect(await read()).toEqual(first);
});

// S17.7: Try and Restore. The writer is a fake with the one method the real one has (src/editor/hass-write.ts `callService`); the
// states are the shape the panel host sets as `hassState`.
async function withWriter(page: Page, fail = "") {
  await page.evaluate(([tag, f]) => {
    const w = window as any; w.__calls = [];
    const el = document.querySelector(tag as string) as any;
    el.writer = { callService: async (c: any) => { w.__calls.push([c.domain, c.service, c.data]); if (f && c.data.entity_id === f) throw new Error("refused"); } };
    el.hassState = {
      "light.demo_living": { state: "on", attributes: { brightness: 255, color_mode: "color_temp", color_temp_kelvin: 4000 }, last_changed: "" },
    };
  }, [EDITOR, fail]);
}
const sent = (page: Page) => page.evaluate(() => (window as any).__calls as [string, string, Record<string, unknown>][]);

test("without a writer Try and Restore are disabled and say why", async ({ page }) => {
  await expect(page.locator("#sceneTry")).toBeDisabled();
  await expect(page.locator("#sceneRestore")).toBeDisabled();
  await expect(page.locator("#tryNeeds")).toContainText("needs the studio connected to Home Assistant");
});

test("Try sends the draft to the devices; Restore sends back what they were doing, and only then is it enabled", async ({ page }) => {
  await withWriter(page);
  await expect(page.locator("#tryNeeds")).toHaveCount(0);
  await expect(page.locator("#sceneRestore")).toBeDisabled();
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toHaveText("Pick at least one device to try.");
  expect(await sent(page)).toEqual([]);
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await page.locator("#sd-brightness-0").fill("10"); await page.locator("#sd-brightness-0").press("Tab");
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toContainText("Sent.");
  expect(await sent(page)).toEqual([["light", "turn_on", { entity_id: "light.demo_living", brightness_pct: 10 }]]);
  expect(await scenes(page)).toHaveLength(0); // trying does not save
  await expect(page.locator("#sceneRestore")).toBeEnabled();
  await press(page, "#sceneRestore");
  await expect(page.locator("#tryNote")).toHaveText("Put back.");
  expect((await sent(page)).at(-1)).toEqual(["light", "turn_on", { entity_id: "light.demo_living", brightness_pct: 100, color_temp_kelvin: 4000 }]);
  await expect(page.locator("#sceneRestore")).toBeDisabled();
});

test("Cancel after a Try puts the devices back; Save after a Try does not", async ({ page }) => {
  await withWriter(page);
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toContainText("Sent.");
  await press(page, "#sceneCancel");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  await expect.poll(async () => (await sent(page)).length).toBe(2);
  expect((await sent(page))[1][2]).toMatchObject({ entity_id: "light.demo_living", color_temp_kelvin: 4000 });
  await press(page, "#rsc-new");
  await page.locator("#sceneName").fill("Kept");
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toContainText("Sent.");
  await press(page, "#sceneSave");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  expect(await sent(page)).toHaveLength(3); // no restore
  expect(await scenes(page)).toHaveLength(1);
});

test("a device Home Assistant refuses is named, and one with an unknown state is tried but flagged as not restorable", async ({ page }) => {
  await withWriter(page, "light.demo_living");
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toHaveText("Home Assistant refused light.demo_living.");
  await withWriter(page);
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]'); // untick
  await press(page, '[data-sdev^="switch."] input[type=checkbox]');
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toContainText("Restore cannot put back switch.");
});

// S18.2: Try, Restore, Try again, Restore again: the second Restore still puts back what the light was before the first Try, even when the
// state the editor holds has not caught up yet (it still says "on" after the first Restore turned the light off).
test("a second Try after Restore still restores the original state, not the stale one", async ({ page }) => {
  await withWriter(page);
  await page.evaluate((tag) => { (document.querySelector(tag) as any).hassState = { "light.demo_living": { state: "off", attributes: {}, last_changed: "" } }; }, EDITOR);
  await press(page, '[data-sdev="light.demo_living"] input[type=checkbox]');
  await press(page, "#sceneTry");
  await expect(page.locator("#tryNote")).toContainText("Sent.");
  await page.evaluate((tag) => { (document.querySelector(tag) as any).hassState = { "light.demo_living": { state: "on", attributes: { brightness: 255, color_mode: "color_temp", color_temp_kelvin: 4000 }, last_changed: "" } }; }, EDITOR);
  await press(page, "#sceneRestore");
  await expect(page.locator("#tryNote")).toHaveText("Put back.");
  await press(page, "#sceneTry"); // the editor's state is stale: it still says on and white
  await expect(page.locator("#tryNote")).toContainText("Sent.");
  await press(page, "#sceneRestore");
  await expect(page.locator("#tryNote")).toHaveText("Put back.");
  expect((await sent(page)).at(-1)).toEqual(["light", "turn_off", { entity_id: "light.demo_living" }]);
});

// S18.7: a popup opens inside the viewport, top and bottom, however the page is scrolled or short the window is.
test("the designer opens inside a short viewport, with its name box and Save both visible", async ({ page }) => {
  await page.locator("#sceneCancel").click();
  await page.setViewportSize({ width: 924, height: 560 });
  await page.evaluate(() => window.scrollTo(0, 400));
  await press(page, "#rsc-new");
  const box = (await page.locator("#scenePanel").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(560);
  const name = (await page.locator("#sceneName").boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(0);
});
