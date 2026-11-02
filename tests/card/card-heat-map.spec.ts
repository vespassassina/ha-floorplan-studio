import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, ORIGIN, drawn } from "./helpers-3d";
import { hasItem, menuItem, openMenu, pick, stateOf, menuButton } from "./menu-helper";
import { cardSource } from "../../scripts/card-source.mjs";

// S34.8 (spec docs/specs/extras-s34.md, H7, H8, criterion 13): the heat map in the card. The ⋯ menu's Heat map section, the legend
// strip, the viewer's pick in view memory, the YAML key. Real clicks through the real menu (finding 3). The hass stub has the shape
// Home Assistant gives a card: `states` keyed by entity id, each `{ state, attributes, last_changed }` (finding 21). Demo layout:
// ground Living reads 23.5 °C from its sensor (t 0.75), first floor Bathroom 54 % (t 0.6).

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-08T09:30:15Z" });
const STATES = (): Record<string, unknown> => ({
  "sensor.demo_living_temperature": st("23.5"),
  "sensor.demo_bedroom_temperature": st("12,5"), // a comma decimal is no reading
  "sensor.demo_bathroom_humidity": st("54"),
});

async function boot(page: Page, config: Record<string, unknown> = {}, size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, config);
}
/** setConfig again on the same page, storage kept unless `clear`: the card reads its stored view back, as after a reload. */
async function configure(page: Page, config: Record<string, unknown>, clear = true) {
  await page.evaluate(([cfg, clear, s]) => {
    if (clear) try { localStorage.clear(); } catch { /* no storage */ }
    const w = window as unknown as { __hass: (s: unknown) => unknown };
    w.__hass = (states) => ({ states, callService() {} });
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = w.__hass(s);
    return el.updateComplete;
  }, [{ layout, floor: "ground", theme: "light", ...config }, clear, STATES()] as const);
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const rehass = (page: Page) => card(page).evaluate((el, s) => { const w = window as unknown as { __hass: (s: unknown) => unknown }; (el as unknown as { hass: unknown }).hass = w.__hass(s); return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; }, STATES());
const heated = (page: Page) => card(page).locator("css=svg polygon.room.heat");
const legend = (page: Page) => card(page).locator("css=.fp-heat-legend");
const stored = (page: Page) => page.evaluate(() => {
  const e = Object.entries(localStorage).find(([k]) => k.startsWith("fp-view:"));
  return e ? { key: e[0], value: JSON.parse(e[1]) as Record<string, unknown> } : null;
});
const warnings = (page: Page) => { const w: string[] = []; page.on("console", (m) => { if (m.type() === "warning" && m.text().includes("heat_map")) w.push(m.text()); }); return w; };

test.describe("S34.8 the heat map in the card: criterion 13", () => {
  test("a real click on ⋯, Heat map, Temperature heats the plan and shows the legend; Off and the legend start hidden", async ({ page }) => {
    await boot(page);
    await expect(heated(page)).toHaveCount(0);
    await expect(legend(page)).toHaveCount(0);
    expect(await stateOf(page, "heat:off")).toBe("true");
    await pick(page, "heat:temperature");
    await expect(heated(page)).toHaveCount(1);
    await expect(card(page).locator('css=svg polygon.room.heat[style*="--fp-heat:0.75"]')).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    await expect(legend(page)).toContainText("16 °C");
    await expect(legend(page)).toContainText("26 °C");
    expect(await stateOf(page, "heat:temperature")).toBe("true");
    expect(await stateOf(page, "heat:off")).toBe("false");
    await pick(page, "heat:off");
    await expect(heated(page)).toHaveCount(0);
    await expect(legend(page)).toHaveCount(0);
  });

  test("Humidity heats the first floor's Bathroom, and the legend reads 30 % to 70 %", async ({ page }) => {
    await boot(page, { floor: "first" });
    await pick(page, "heat:humidity");
    await expect(card(page).locator('css=svg polygon.room.heat[style*="--fp-heat:0.6"]')).toHaveCount(1);
    await expect(legend(page)).toContainText("30 %");
    await expect(legend(page)).toContainText("70 %");
  });

  test("a reload keeps the pick; Reset view returns to heat_map", async ({ page }) => {
    await boot(page, { heat_map: "humidity", floor: "first" });
    await expect(card(page).locator("css=svg polygon.room.heat-humidity")).toHaveCount(1);
    await pick(page, "heat:temperature");
    await expect(card(page).locator("css=svg polygon.room.heat-temperature")).toHaveCount(0); // the first floor's Bedroom has a comma decimal: nothing to heat
    expect(await stateOf(page, "heat:temperature")).toBe("true");
    await configure(page, { floor: "first", heat_map: "humidity" }, false); // setConfig again over the same storage: what a reload does
    expect(await stateOf(page, "heat:temperature")).toBe("true");
    await pick(page, "reset");
    expect(await stateOf(page, "heat:humidity")).toBe("true");
    await expect(card(page).locator("css=svg polygon.room.heat-humidity")).toHaveCount(1);
    expect(await stored(page)).toBeNull();
  });

  test("a viewer's Off beats a YAML heat_map, and is kept", async ({ page }) => {
    await boot(page, { heat_map: "temperature" });
    await expect(heated(page)).toHaveCount(1);
    await pick(page, "heat:off");
    await expect(heated(page)).toHaveCount(0);
    expect((await stored(page))?.value.heat).toBe("off");
    await configure(page, { heat_map: "temperature" }, false);
    await expect(heated(page)).toHaveCount(0);
  });

  test("editing heat_map in the YAML starts a clean memory", async ({ page }) => {
    await boot(page, { heat_map: "humidity", floor: "first" });
    await pick(page, "heat:off");
    await expect(heated(page)).toHaveCount(0);
    await configure(page, { heat_map: "humidity", floor: "first" }, false);
    await expect(heated(page)).toHaveCount(0); // same YAML, same memory
    await configure(page, { heat_map: "temperature", floor: "first" }, false);
    expect(await stateOf(page, "heat:temperature")).toBe("true"); // another YAML: the Off pick is not carried over
  });

  test("a hass update keeps the mode", async ({ page }) => {
    await boot(page);
    await pick(page, "heat:temperature");
    await expect(heated(page)).toHaveCount(1);
    await rehass(page);
    await rehass(page);
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    expect(await stateOf(page, "heat:temperature")).toBe("true");
  });

  test("the legend sits at the plan's bottom left, in 2.5D too, and is text and a ramp", async ({ page }) => {
    await boot(page, { view: "2.5d", heat_map: "temperature" });
    await expect(legend(page)).toBeVisible();
    const [l, s] = await Promise.all([legend(page).boundingBox(), card(page).locator("css=svg.fp-zoomable").boundingBox()]);
    expect(l!.x - s!.x, "left edge of the stage").toBeLessThan(24);
    expect(s!.y + s!.height - (l!.y + l!.height), "bottom edge of the stage").toBeLessThan(24);
    expect(await legend(page).locator("css=.fp-heat-ramp").count()).toBe(1);
    expect(await card(page).locator("css=svg.fp-zoomable .fp-heat-legend").count(), "chrome, not drawn inside the plan").toBe(0);
  });

  test("labels: false still draws the heat, and the legend", async ({ page }) => {
    await boot(page, { heat_map: "temperature", labels: false });
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
  });

  test("view_switch: false keeps Heat map in the menu (it is data, like Detail)", async ({ page }) => {
    await boot(page, { view_switch: false });
    for (const v of ["heat:off", "heat:temperature", "heat:humidity"]) expect(await hasItem(page, v), v).toBe(true);
    expect(await hasItem(page, "view:2d")).toBe(false);
    await pick(page, "heat:humidity");
    await expect(legend(page)).toBeVisible();
  });

  test("a forged menu value changes nothing", async ({ page }) => {
    await boot(page);
    await card(page).locator("fp-menu").evaluate((m) => m.dispatchEvent(new CustomEvent("fp-menu-pick", { detail: { value: "heat:lava" } })));
    await expect(heated(page)).toHaveCount(0);
    expect(await stored(page)).toBeNull();
  });

  test("active_list: false has no Heat map items (as Detail), the YAML key still heats and draws the legend", async ({ page }) => {
    await boot(page, { active_list: false, heat_map: "temperature" });
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    expect(await hasItem(page, "heat:off")).toBe(false);
  });

  test("kiosk with heat_map: temperature heats the plan and shows the legend; there is no menu", async ({ page }) => {
    await boot(page, { kiosk: true, heat_map: "temperature" });
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    await expect(menuButton(page)).toHaveCount(0);
  });
});

test.describe("S34 review: legend and room panel", () => {
  test("m2: with no reading on the floor the legend says no readings, not a scale", async ({ page }) => {
    await boot(page, { heat_map: "temperature" });
    await expect(legend(page)).toContainText("16 °C");
    await card(page).evaluate((el) => { (el as unknown as { hass: unknown }).hass = { states: {}, callService() {} }; return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; });
    await expect(heated(page)).toHaveCount(0);
    await expect(legend(page)).toContainText("no readings");
    await expect(legend(page)).not.toContainText("16 °C");
    await expect(legend(page).locator("css=.fp-heat-ramp")).toHaveCount(0);
  });

  test("m5: the room panel shows the number the plan prints; one faulty sensor does not make them differ", async ({ page }) => {
    // Demo Living has one placed sensor; the room's own temps list gets a faulty 120 °C beside it (H3 bounds drop it).
    const lay = structuredClone(layout) as { floors: Record<string, { rooms: Record<string, unknown>[] }> };
    lay.floors.ground!.rooms[0]!.temps = ["sensor.bad_probe", "sensor.demo_living_temperature"];
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(URL_);
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([cfg, s]) => {
      try { localStorage.clear(); } catch { /* no storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, callService() {} };
      return el.updateComplete;
    }, [{ layout: lay, floor: "ground", theme: "light", heat_map: "temperature" }, { ...STATES(), "sensor.bad_probe": st("120") }] as const);
    await expect(heated(page)).toHaveCount(1);
    const plan = (await card(page).locator("css=svg text.heat-val").first().textContent())!.trim();
    expect(plan).toBe("23.5\u202F°C");
    const p = await card(page).evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!;
      const r = poly.getBoundingClientRect();
      for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      return null;
    });
    expect(p, "Living has bare floor to click").not.toBeNull();
    await page.mouse.click(p!.x, p!.y);
    const facts = card(page).locator("css=.fp-room-facts > div").filter({ hasText: "Temperature" }).locator("css=dd");
    await expect(facts).toHaveText(plan);
  });
});

test.describe("S34.8 the YAML key and the stored pick are untrusted", () => {
  for (const junk of ["Temperature", 1, "__proto__", ["temperature"], { a: 1 }, true, "lava"]) {
    test(`heat_map ${JSON.stringify(junk)} is off and warns once`, async ({ page }) => {
      const w = warnings(page);
      await boot(page, { heat_map: junk });
      await rehass(page);
      await rehass(page);
      await expect(heated(page)).toHaveCount(0);
      await expect(legend(page)).toHaveCount(0);
      expect(await stateOf(page, "heat:off")).toBe("true");
      expect(w).toHaveLength(1);
      expect(w[0]).toContain("temperature");
    });
  }

  test("absent, null and off do not warn", async ({ page }) => {
    const w = warnings(page);
    for (const v of [undefined, null, "off"]) await boot(page, { heat_map: v });
    expect(w).toHaveLength(0);
  });

  test("a stored heat: lava is dropped, the good fields beside it stay", async ({ page }) => {
    await boot(page);
    await pick(page, "labels"); // a stored entry with a field of its own
    await pick(page, "heat:temperature");
    const s = (await stored(page))!;
    await page.evaluate(([k, v]) => localStorage.setItem(k as string, JSON.stringify({ ...(v as object), heat: "lava" })), [s.key, s.value] as const);
    await configure(page, {}, false);
    await expect(heated(page)).toHaveCount(0);
    expect(await stateOf(page, "heat:off")).toBe("true");
    expect(await stateOf(page, "labels")).toBe("false"); // the pick of Labels off, stored beside the junk, stands
  });
});

test.describe("S34.8 3D", () => {
  test("in 3D the items and the legend are gone; the pick is kept and shows again in 2D", async ({ page }) => {
    await serve(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${ORIGIN}/harness.html`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, s]) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = { states: s, callService: () => undefined };
      return el.updateComplete;
    }, [{ layout, floor: "ground", view: "2d", theme: "light" }, STATES()] as const);
    await expect(heated(page)).toHaveCount(0);
    await pick(page, "heat:temperature");
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    await pick(page, "view:3d");
    await drawn(page);
    await expect(legend(page)).toHaveCount(0);
    for (const v of ["heat:off", "heat:temperature", "heat:humidity"]) expect(await hasItem(page, v), v).toBe(false);
    await pick(page, "view:2d");
    await expect(heated(page)).toHaveCount(1);
    await expect(legend(page)).toBeVisible();
    await openMenu(page);
    await expect(menuItem(page, "heat:temperature")).toHaveAttribute("aria-checked", "true");
  });
});

test("m4: when 3D falls back to 2D the note and the heat legend do not overlap", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return /webgl/.test(kind) ? null : (orig as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof orig;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg, s]) => {
    try { localStorage.clear(); } catch { /* no storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: s, callService() {} };
    return el.updateComplete;
  }, [{ layout, floor: "ground", theme: "light", view: "3d", heat_map: "temperature" }, STATES()] as const);
  const note = card(page).locator("css=.fp-3d-note");
  await expect(note).toBeVisible(); // under file:// the 3D chunk cannot load, which falls back with its own note
  await expect(legend(page)).toBeVisible();
  const [a, b] = [(await note.boundingBox())!, (await legend(page).boundingBox())!];
  const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  expect(apart, `note ${JSON.stringify(a)} legend ${JSON.stringify(b)}`).toBe(true);
});
