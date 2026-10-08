import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S11.3 and S11.4 (docs/specs/room-sensors.md, criteria 5 and 6): tap a room in the card, read it in the left panel,
// open a device's details. Every click is a real page.mouse click at coordinates found with elementFromPoint, so a
// handler that is not on the real top element fails here (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// Living (room 0, 500 x 400 cm = 20 m2) owns two temperature sensors, a humidity sensor and a motion sensor.
const layout = structuredClone(demo);
Object.assign(layout.floors.ground.rooms[0], {
  temps: ["sensor.demo_living_temperature", "sensor.demo_living_temp2"], humidity: ["sensor.demo_living_humidity"], motion: ["binary_sensor.demo_living_motion"],
});
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-04T09:30:15Z") => ({ state, attributes, last_changed });
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light" }), "light.demo_kitchen": st("on"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21", { unit_of_measurement: "°C" }), "sensor.demo_living_temp2": st("22.4", { unit_of_measurement: "°C" }),
  "sensor.demo_living_humidity": st("48", { unit_of_measurement: "%" }), "binary_sensor.demo_living_motion": st("on"),
  "climate.demo_living": st("heat"), "camera.demo_hall": st("idle"), "binary_sensor.demo_patio_door": st("on"), "binary_sensor.demo_front_door": st("off"),
});
// The shapes of Home Assistant's own hass.entities / hass.devices / hass.areas (frontend src/types.ts, read 2026-10-04):
// entities[id].device_id, devices[id].manufacturer / model / sw_version / area_id, areas[id].name. The first manufacturer
// is a payload: it must show as text.
const REGISTRY = {
  entities: { "light.demo_living": { entity_id: "light.demo_living", device_id: "dev_lamp" }, "switch.demo_hall": { entity_id: "switch.demo_hall", device_id: "dev_hall" } },
  devices: { dev_lamp: { id: "dev_lamp", manufacturer: 'Acme"><script>window.__pwned=1</script>', model: "Lamp 2", sw_version: "1.2.3", area_id: "living" }, dev_hall: { id: "dev_hall", manufacturer: "Shelly", model: null, sw_version: null, area_id: null } },
  areas: { living: { area_id: "living", name: "Living room" } },
};

async function boot(page: Page, width: number, opts: { registry?: boolean; states?: Record<string, unknown> } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states, registry]) => {
      const w = window as unknown as { __calls: string[]; __info: string[] };
      w.__calls = []; w.__info = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
      el.setConfig(config);
      el.hass = { states, ...(registry as object), callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
      return el.updateComplete;
    },
    [{ layout, floor: "ground" }, { ...STATES(), ...(opts.states ?? {}) }, opts.registry === false ? {} : REGISTRY] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);

/** A point on the bare floor of room `i`, at least `apart` px from `from`: the real top element there is that room's polygon. */
async function floorPoint(page: Page, i: number, from?: { x: number; y: number }, apart = 0) {
  const p = await card(page).evaluate((el, [i, from, apart]) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!;
    const r = poly.getBoundingClientRect();
    for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) {
      if (x > window.innerWidth || y > window.innerHeight) continue;
      if (from && Math.hypot(x - (from as { x: number }).x, y - (from as { y: number }).y) < (apart as number)) continue;
      if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    }
    return null;
  }, [i, from ?? null, apart] as const);
  expect(p, `room ${i} has bare floor to click`).not.toBeNull();
  return p!;
}
/** The centre of a device icon, checked to be the real top element there. */
async function iconPoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest(`g[data-x="${i}"]`) };
  }, i);
  expect(p.hit, `device ${i} is the top element at its centre`).toBe(true);
  return p;
}
/** A point of the plan's own svg that is no room, door or device: bare background. */
async function backgroundPoint(page: Page) {
  const p = await card(page).evaluate((el) => {
    const svg = el.shadowRoot!.querySelector("svg")!, r = svg.getBoundingClientRect();
    for (let y = r.bottom - 4; y > r.top; y -= 6) for (let x = r.left + 4; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === svg) return { x, y };
    return null;
  });
  expect(p, "the plan has bare background").not.toBeNull();
  return p!;
}
const picked = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll("svg polygon.room-picked")].map((p) => Number(p.getAttribute("data-picked"))));
const click = async (page: Page, p: { x: number; y: number }) => { await page.mouse.click(p.x, p.y); };
const room = (page: Page) => card(page).locator("css=.fp-room");
const factsOf = (page: Page) => room(page).locator("css=.fp-room-facts > div").evaluateAll((rows) => Object.fromEntries(rows.map((r) => [r.querySelector("dt")!.textContent!.trim(), r.querySelector("dd")!.textContent!.trim()])));

for (const width of [1280, 375]) {
  test.describe(`room selection at ${width} px`, () => {
    test("a real tap on bare floor outlines the room and opens its section, with the facts from its own sensors and doors", async ({ page }) => {
      await boot(page, width);
      expect(await picked(page)).toEqual([]);
      await expect(room(page)).toHaveCount(0);
      await click(page, await floorPoint(page, 0));
      expect(await picked(page)).toEqual([0]);
      await expect(room(page).locator("css=.fp-room-name")).toHaveText("Living");
      // At 375 px the list is folded by default: a picked room must still be readable (top element at the section).
      const covered = await room(page).evaluate((el) => { const r = el.getBoundingClientRect(); return !(el.getRootNode() as ShadowRoot).elementFromPoint(r.x + 8, r.y + 8)?.closest(".fp-room"); });
      expect(covered, "the room section is not under anything").toBe(false);
      expect(await factsOf(page)).toMatchObject({
        Area: "20 m²", Temperature: "21.7\u202F°C", Humidity: "48\u202F%", Motion: expect.stringMatching(/^on since \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        "Open doors and windows": "Patio door", "Lights on": "Living light",
      });
    });

    test("tapping the same room again, off any room, or Escape clears it", async ({ page }) => {
      await boot(page, width);
      const a = await floorPoint(page, 0);
      await click(page, a);
      expect(await picked(page)).toEqual([0]);
      await click(page, await floorPoint(page, 0, a, 40)); // not a double tap: it lands 40 px away
      expect(await picked(page)).toEqual([]);
      await expect(room(page)).toHaveCount(0);

      await click(page, await floorPoint(page, 1));
      expect(await picked(page)).toEqual([1]);
      await click(page, await backgroundPoint(page));
      expect(await picked(page)).toEqual([]);

      await click(page, await floorPoint(page, 0));
      expect(await picked(page)).toEqual([0]);
      await page.keyboard.press("Escape"); // the pointer is still over the card, so it owns the key
      expect(await picked(page)).toEqual([]);
      await expect(room(page)).toHaveCount(0);
    });

    test("tapping another room moves the selection", async ({ page }) => {
      await boot(page, width);
      await click(page, await floorPoint(page, 0));
      await click(page, await floorPoint(page, 1));
      expect(await picked(page)).toEqual([1]);
      await expect(room(page).locator("css=.fp-room-name")).toHaveText("Kitchen");
    });

    test("a tap on a device in the room opens its popup, calls nothing and does not select the room", async ({ page }) => {
      await boot(page, width);
      await click(page, await iconPoint(page, 0));
      await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", "Living light");
      expect(await calls(page)).toEqual([]);
      expect(await picked(page)).toEqual([]);
      await expect(room(page)).toHaveCount(0);
    });

    test("a tap on a door does not select a room either", async ({ page }) => {
      await boot(page, width);
      const p = await card(page).evaluate((el) => { const l = el.shadowRoot!.querySelector("svg line[data-d='1']")!, r = l.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: !!el.shadowRoot!.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("line[data-d]") }; });
      expect(p.hit).toBe(true);
      await click(page, p);
      expect(await picked(page)).toEqual([]);
    });
  });
}

test.describe("the room section and the filtered list", () => {
  test("the Active list keeps showing everything with no room picked, and only the room's entities with one", async ({ page }) => {
    await boot(page, 1280);
    const rows = () => card(page).locator("css=.fp-active-body .fp-active-row").allTextContents().then((t) => t.map((s) => s.trim()));
    const all = await rows();
    expect(all.join("|")).toContain("Kitchen light");
    await click(page, await floorPoint(page, 0));
    await expect(room(page)).toHaveCount(1);
    const inRoom = await card(page).locator("css=.fp-filtered .fp-active-row").allTextContents();
    const text = inRoom.join("|");
    expect(text).toContain("Living light");
    expect(text).not.toContain("Kitchen light");
    expect(text).not.toContain("Hall camera"); // a camera is always listed, but this one stands in the Hall
    await card(page).locator("css=.fp-show-all").click();
    expect(await picked(page)).toEqual([0]); // Show all drops the filter, not the selection
    expect((await card(page).locator("css=.fp-filtered .fp-active-row").allTextContents()).join("|")).toContain("Kitchen light");
  });

  test("the devices list holds the room's devices and its own sensors; a row opens the same popup; More info opens more-info", async ({ page }) => {
    await boot(page, 1280);
    await click(page, await floorPoint(page, 0));
    const names = (await room(page).locator("css=.fp-room-devices .fp-active-row").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
    expect(names.some((n) => n.startsWith("Living light"))).toBe(true);
    expect(names.some((n) => n.startsWith("TV plug"))).toBe(true);
    expect(names.some((n) => n.startsWith("Hall camera"))).toBe(false); // another room's
    expect(names.filter((n) => n.startsWith("Living temperature")).length, "a placed sensor that the room owns is listed once").toBe(1);
    expect(names.some((n) => n.includes("binary_sensor.demo_living_motion"))).toBe(true); // owned, never placed: listed by entity id
    await room(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living light" }).click();
    await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", "Living light");
    expect(await calls(page)).toEqual([]); // a tap on a row operates nothing
    await room(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living radiator" }).click(); // a type that never toggled: the same popup as its icon (S14 review), More info inside
    await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", "Living radiator");
    expect(await infos(page)).toEqual([]);
    await card(page).locator("css=.fp-pop .fp-pop-more").click();
    expect(await infos(page)).toContain("climate.demo_living");
    expect(await calls(page)).toEqual([]);
  });

  test("holding a row opens more-info instead of the popup", async ({ page }) => {
    await boot(page, 1280);
    await click(page, await floorPoint(page, 0));
    const b = (await room(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living light" }).boundingBox())!;
    await page.mouse.move(b.x + 20, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650); // HOLD_MS is 500: a real hold, there is no event to wait for
    await page.mouse.up();
    expect(await infos(page)).toEqual(["light.demo_living"]);
    expect(await calls(page)).toEqual([]);
  });

  test("the selection and the section survive a hass update", async ({ page }) => {
    await boot(page, 1280);
    await click(page, await floorPoint(page, 0));
    await card(page).locator("css=.fp-room-devices .fp-info-btn").first().click(); // an open details block must survive too
    await card(page).evaluate((el) => {
      const e = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
      e.hass = { ...e.hass, states: { ...e.hass.states, "sensor.demo_living_temperature": { state: "30", attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-04T10:00:00Z" } } };
      return e.updateComplete;
    });
    expect(await picked(page)).toEqual([0]);
    expect((await factsOf(page)).Temperature).toBe("26.2\u202F°C"); // (30 + 22.4) / 2: the section follows the state
    await expect(card(page).locator("css=.fp-room-devices .fp-info")).toHaveCount(1);
  });

  test("a room with nothing in it says so, with no NaN or undefined", async ({ page }) => {
    await boot(page, 1280, { states: {} });
    await card(page).evaluate((el) => { const e = el as unknown as { hass: object; updateComplete: Promise<unknown> }; e.hass = { states: {} }; return e.updateComplete; });
    await click(page, await floorPoint(page, 1)); // Kitchen: no sensors, a light with no state
    const text = await room(page).innerText();
    expect(text).toContain("Kitchen");
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(await factsOf(page)).toMatchObject({ Area: "12 m²" });
  });
});

test.describe("device details", () => {
  const info = (page: Page, where: string) => card(page).locator(`css=${where} .fp-item`, { hasText: "Living light" });

  test("the chevron on a room row shows manufacturer, model, firmware, area, entity, state and last changed, and does not toggle", async ({ page }) => {
    await boot(page, 1280);
    await click(page, await floorPoint(page, 0));
    const item = info(page, ".fp-room-devices");
    await expect(item.locator("css=.fp-info")).toHaveCount(0);
    await item.locator("css=.fp-info-btn").click();
    expect(await calls(page)).toEqual([]);
    const rows = await item.locator("css=.fp-info > div").evaluateAll((els) => Object.fromEntries(els.map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent])));
    expect(rows).toMatchObject({ Manufacturer: 'Acme"><script>window.__pwned=1</script>', Model: "Lamp 2", Firmware: "1.2.3", Area: "Living room", Entity: "light.demo_living", State: "on" });
    expect(rows["Last changed"]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll(".fp-info script").length)).toBe(0);
    await item.locator("css=.fp-info-btn").click();
    await expect(item.locator("css=.fp-info")).toHaveCount(0); // the second click folds it
  });

  test("the Active list rows have the chevron too, and the row's own tap opens the popup, whose More info opens the chooser (the lamp and its relay, S22.1)", async ({ page }) => {
    await boot(page, 1280);
    const item = info(page, ".fp-active-body");
    await item.locator("css=.fp-info-btn").click();
    await expect(item.locator("css=.fp-info")).toContainText("Lamp 2");
    expect(await infos(page)).toEqual([]);
    await item.locator("css=.fp-active-row").click();
    expect(await infos(page)).toEqual([]);
    await card(page).locator("css=.fp-pop-more").click();
    const choices = card(page).locator("css=.fp-chooser-dialog .fp-chooser-list button");
    await expect(choices).toHaveCount(2); // light.demo_living and its bound switch.demo_living_relay
    await choices.first().click();
    expect(await infos(page)).toEqual(["light.demo_living"]);
  });

  test("a device with no registry entry shows entity, state and last changed only", async ({ page }) => {
    await boot(page, 1280, { registry: false });
    await click(page, await floorPoint(page, 0));
    await info(page, ".fp-room-devices").locator("css=.fp-info-btn").click();
    const labels = await info(page, ".fp-room-devices").locator("css=.fp-info dt").allTextContents();
    expect(labels).toEqual(["Entity", "State", "Last changed"]);
  });
});

test.describe("CSS pairs (finding 10): the rule reaches the pixel", () => {
  test("the picked room's line is the ink colour, dashed, and never takes a click", async ({ page }) => {
    await boot(page, 1280);
    await click(page, await floorPoint(page, 0));
    const r = await card(page).evaluate((el) => {
      const sr = el.shadowRoot!, p = sr.querySelector<SVGPolygonElement>("svg polygon.room-picked")!;
      const a = getComputedStyle(p), ink = getComputedStyle(sr.querySelector(".fp-active")!).color;
      return { stroke: a.stroke, dash: a.strokeDasharray, events: a.pointerEvents, ink, fill: a.fill };
    });
    expect(r.stroke).toBe(r.ink);
    expect(r.dash).not.toBe("none");
    expect(r.events).toBe("none");
    expect(r.fill).toBe("none");
  });
  test("the panel is wider with a room section, and the info button is a real, clickable size", async ({ page }) => {
    await boot(page, 1280);
    const w0 = (await card(page).locator("css=.fp-active").boundingBox())!.width;
    await click(page, await floorPoint(page, 0));
    const w1 = (await card(page).locator("css=.fp-active").boundingBox())!.width;
    expect(w1).toBeGreaterThan(w0);
    const b = (await card(page).locator("css=.fp-room-devices .fp-info-btn").first().boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(24);
    expect(b.height).toBeGreaterThanOrEqual(24);
    const top = await card(page).locator("css=.fp-room-devices .fp-info-btn").first().evaluate((el) => { const r = el.getBoundingClientRect(), hit = (el.getRootNode() as ShadowRoot).elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && el.contains(hit); });
    expect(top).toBe(true);
  });
});
