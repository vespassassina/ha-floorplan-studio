import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S14.7 (docs/specs/card-polish-and-light.md, item 19): the Room section lists scene buttons. Each click is a real
// page.mouse click on the real top element (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// Living (room 0, area "living") gets two custom scenes: Movie (a light at 20 %) and Fan off (turns a switch off, so it asks).
// A payload name proves names are text. Kitchen (room 1) has a light and no scene. Hall (room 2) has no light at all.
const layout = structuredClone(demo);
Object.assign(layout.floors.ground.rooms[0], {
  scenes: [
    { id: "s1", name: "Movie", items: [{ entity: "light.demo_living", on: true, brightness: 20, kelvin: 2400 }] },
    { id: "s2", name: "Fan off", items: [{ entity: "switch.demo_hall", on: false }, { entity: "light.demo_living", on: true }] },
    { id: "s3", name: '"><script>window.__pwned=1</script>', items: [] },
  ],
});
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-06T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on"), "light.demo_kitchen": st("on"), "switch.demo_hall": st("on"), "switch.demo_tv_plug": st("on"),
  "scene.living_relax": st("unknown", { friendly_name: "Relax" }), "scene.hue_nightlight": st("unknown", { friendly_name: "Nightlight" }),
  "scene.kitchen_cook": st("unknown", { friendly_name: "Cook" }),
});
// Home Assistant's hass.entities / hass.devices shapes (frontend src/types.ts): a scene's area on the entity, or through its device (Hue).
const REGISTRY = {
  entities: { "scene.living_relax": { entity_id: "scene.living_relax", area_id: "living" }, "scene.hue_nightlight": { entity_id: "scene.hue_nightlight", device_id: "hue_room", area_id: null }, "scene.kitchen_cook": { entity_id: "scene.kitchen_cook", area_id: "kitchen" } },
  devices: { hue_room: { id: "hue_room", area_id: "living" } },
};

async function boot(page: Page, width = 1280, theme?: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states, registry]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, ...(registry as object), callService: (d: string, s: string, data: unknown) => { w.__calls.push(`${d}.${s} ${JSON.stringify(data)}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground", ...(theme ? { theme } : {}) }, STATES(), REGISTRY] as const);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
/** `unfold` (default) also opens the Scenes section, which starts folded; the tests of the fold itself pass false. */
async function pickRoom(page: Page, i: number, unfold = true) {
  const p = await card(page).evaluate((el, i) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!;
    const r = poly.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (x < innerWidth && y < innerHeight && el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    return null;
  }, i);
  expect(p, `room ${i} has bare floor to click`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
  await expect(card(page).locator("css=.fp-room")).toHaveCount(1);
  const head = card(page).locator("css=button.fp-scenes-head");
  if (unfold && (await head.count()) && (await head.getAttribute("aria-expanded")) === "false") await head.click();
}
/** A real click at the centre of the button, after checking it is the top element there. */
async function press(page: Page, label: string | RegExp) {
  const b = card(page).locator("css=.fp-scene").filter({ hasText: label });
  await expect(b).toHaveCount(1);
  await b.scrollIntoViewIfNeeded(); // the panel scrolls on a small card, as a finger would
  const p = await b.evaluate((el) => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return { x, y, hit: (el.getRootNode() as ShadowRoot).elementFromPoint(x, y) === el }; });
  expect(p.hit, `${label} is the top element at its centre`).toBe(true);
  await page.mouse.click(p.x, p.y);
}
const labels = (page: Page) => card(page).locator("css=.fp-scene").allTextContents();

test.describe("room menu layout", () => {
  test("Scenes starts folded and opens and folds on its header; its buttons are only there when it is open", async ({ page }) => {
    await boot(page);
    await pickRoom(page, 0, false);
    const head = card(page).locator("css=button.fp-scenes-head");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(card(page).locator("css=.fp-scene")).toHaveCount(0);
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    expect((await labels(page)).length).toBeGreaterThan(0);
    await head.click();
    await expect(card(page).locator("css=.fp-scene")).toHaveCount(0);
  });

  test("Active in this room sits between Scenes and Devices", async ({ page }) => {
    await boot(page);
    await pickRoom(page, 0, false);
    const y = (sel: string) => card(page).locator(sel).first().evaluate((el) => el.getBoundingClientRect().top);
    const scenes = await y("css=button.fp-scenes-head"), active = await y("css=.fp-filter"), devices = await y("css=.fp-room .fp-active-group-label >> text=Devices");
    expect(scenes).toBeLessThan(active);
    expect(active).toBeLessThan(devices);
    await expect(card(page).locator("css=.fp-filter")).toContainText("Active in this room");
  });
});

for (const width of [1280, 375]) {
  test.describe(`room scenes at ${width} px`, () => {
    test("lists the room's Home Assistant scenes (area on the entity, or on its device, as Hue does), its custom scenes and the presets; not another room's", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 0);
      expect(await labels(page)).toEqual(["Nightlight", "Relax", "Movie", "Fan off", '"><script>window.__pwned=1</script>', "All off", "All on"]);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      await expect(card(page).locator("css=.fp-scenes script")).toHaveCount(0);
    });

    test("a Home Assistant scene is one scene.turn_on, a custom scene one light.turn_on with only what it sets", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 0);
      await press(page, "Relax");
      await press(page, "Nightlight");
      await press(page, "Movie");
      expect(await calls(page)).toEqual([
        'scene.turn_on {"entity_id":"scene.living_relax"}', 'scene.turn_on {"entity_id":"scene.hue_nightlight"}',
        'light.turn_on {"entity_id":"light.demo_living","brightness_pct":20,"color_temp_kelvin":2400}',
      ]);
    });

    test("All off and All on act on the room's own lights in one call, with no confirm", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 0);
      await press(page, "All off");
      expect(await calls(page)).toEqual(['light.turn_off {"entity_id":["light.demo_living"]}']);
      await press(page, "All on");
      expect((await calls(page)).at(-1)).toBe('light.turn_on {"entity_id":["light.demo_living"]}');
      await expect(card(page).locator("css=.fp-scene-ask")).toHaveCount(0);
    });

    test("a scene that turns a switch off asks first; Cancel sends nothing, Confirm sends the calls", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 0);
      await press(page, "Fan off");
      expect(await calls(page)).toEqual([]);
      await expect(card(page).locator("css=.fp-scene-ask")).toHaveText("Confirm: Fan off");
      await press(page, "Cancel");
      expect(await calls(page)).toEqual([]);
      await expect(card(page).locator("css=.fp-scene-ask")).toHaveCount(0);
      await press(page, "Fan off");
      await press(page, /Confirm: Fan off/);
      expect(await calls(page)).toEqual(['switch.turn_off {"entity_id":"switch.demo_hall"}', 'light.turn_on {"entity_id":"light.demo_living"}']);
    });

    test("another room shows its own scenes only; a room with no scene and no light shows no Scenes section", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 1);
      expect(await labels(page)).toEqual(["Cook", "All off", "All on"]);
      await pickRoom(page, 2);
      await expect(card(page).locator("css=.fp-scenes")).toHaveCount(0);
    });

    test("a pending confirm is dropped when another room is picked", async ({ page }) => {
      await boot(page, width);
      await pickRoom(page, 0);
      await press(page, "Fan off");
      await pickRoom(page, 1);
      await pickRoom(page, 0);
      await expect(card(page).locator("css=.fp-scene-ask")).toHaveCount(0);
    });
  });
}

for (const theme of ["light", "blueprint"] as const) {
  test(`scene buttons are readable (${theme} theme): ink on the card colour at 4.5:1 or better`, async ({ page }) => {
    await boot(page, 1280, theme);
    await pickRoom(page, 0);
    await card(page).locator("css=.fp-scenes").screenshot({ path: `test-results/scenes-${theme}.png` });
    const ratio = await card(page).locator("css=.fp-scene").first().evaluate((el) => {
      const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const cs = getComputedStyle(el), a = lum(cs.color), b = lum(cs.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}
