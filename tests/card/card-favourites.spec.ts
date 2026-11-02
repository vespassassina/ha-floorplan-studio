import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEVICE_TYPES } from "../../src/core/schema";
import { cardSource } from "../../scripts/card-source.mjs";

// S34.4 (spec F2, F3, F5, F9; criteria 2 to 7): the Favourites section of the card's Overview, on the stress house (three
// floors). Real page.mouse clicks at points checked to be the real top element (finding 3). The hass stub has the shape Home
// Assistant gives a card: `states` keyed by entity id, and `callService(domain, service, data)`, the call the card already makes
// for every popup button (finding 21); every call is recorded in `window.__calls`.

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
// Ground: the kitchen spot (a light, off), the living wall switch (on: its Turn off asks first), the garage temperature probe (a
// sensor: no button) and an alarm that makes Attention. First floor: the study desk lamp (on). The `"><script>` name is on the blind.
const STATES = (): Record<string, unknown> => ({
  "light.kitchen_spot_1": st("off"),
  "switch.living_wall_switch": st("on", { friendly_name: "Living wall switch" }),
  "sensor.garage_temperature_probe": st("17.5", { unit_of_measurement: "°C" }),
  "light.study_desk_lamp": st("on"),
  "cover.living_blind": st("closed", { friendly_name: '"><script>window.__xss=1</script>' }),
  "alarm_control_panel.home": st("triggered"),
  "light.library_reading_lamp": st("on"),
});
const FAV = ["light.kitchen_spot_1", "switch.living_wall_switch", "sensor.nope"];

async function boot(page: Page, config: Record<string, unknown> = {}, size = { width: 1280, height: 900 }, states: Record<string, unknown> = STATES(), lay: unknown = layout) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const w = window as unknown as { __calls: unknown[]; __hass: (s: unknown) => unknown };
      w.__calls = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      w.__hass = (states) => ({ states, callService: (domain: string, service: string, data: unknown) => { w.__calls.push([domain, service, data]); } });
      el.setConfig(cfg);
      el.hass = w.__hass(s);
      return el.updateComplete;
    },
    [{ layout: lay, theme: "light", ...config }, states] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const pills = (page: Page) => card(page).locator("css=.fp-floors button");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
const favRows = (page: Page) => card(page).locator("css=.fp-ov-fav .fp-fav-row");
const rowOf = (page: Page, entity: string) => card(page).locator(`css=.fp-ov-fav .fp-fav-row[data-entity="${entity}"]`);
/** Re-sends hass with fresh state objects, as Home Assistant does on every change. */
const rehass = (page: Page, states: Record<string, unknown> = STATES()) => card(page).evaluate((el, s) => { const w = window as unknown as { __hass: (s: unknown) => unknown }; (el as unknown as { hass: unknown }).hass = w.__hass(s); return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; }, states);

// Playwright's click is a real mouse press at the element's centre; it waits for the box to stop moving (the phone's sheet animates
// between stops) and for the element to be the real hit target, which a point read once from `topPoint` could not (finding 13).
const clickOn = async (page: Page, sel: string) => { await card(page).locator(`css=${sel}`).click(); };
/** Playwright waits for the handle to stop moving and be the real hit target before it presses (the sheet is laid out after the first frame). */
async function openSheetFull(page: Page) {
  await card(page).locator("css=.fp-handle").click(); // peek to half
  await page.keyboard.press("ArrowUp"); // the handle has focus: half to full
  await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "full");
}
const BTN = (e: string) => `.fp-ov-fav .fp-fav-row[data-entity="${e}"] .fp-fav-act`;
const MAIN = (e: string) => `.fp-ov-fav .fp-fav-row[data-entity="${e}"] .fp-active-row`;

test.describe("S34.4 the Favourites section", () => {
  test("criterion 2: above Attention, rows in the list's order, an entity not on the plan has none", async ({ page }) => {
    await boot(page, { favourites: FAV });
    const order = await card(page).locator("css=.fp-active-body .fp-ov-section").evaluateAll((els) => els.map((e) => e.getAttribute("class")!.split(" ").find((c) => /^fp-ov-(fav|attn|act)$/.test(c))));
    expect(order).toEqual(["fp-ov-fav", "fp-ov-attn", "fp-ov-act"]);
    expect(await favRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-entity")))).toEqual(["light.kitchen_spot_1", "switch.living_wall_switch"]);
    await expect(card(page).locator("css=.fp-ov-fav .fp-cat-name")).toHaveText("Favourites");
    await expect(card(page).locator("css=.fp-ov-fav .fp-active-count")).toHaveText("2");
  });

  test("F5: a favourite that is on also stays in Active", async ({ page }) => {
    await boot(page, { favourites: ["switch.kitchen_kettle_plug"] }, undefined, { ...STATES(), "switch.kitchen_kettle_plug": st("on") });
    await expect(rowOf(page, "switch.kitchen_kettle_plug")).toHaveCount(1);
    await expect(card(page).locator('css=.fp-ov-act .fp-active-row[data-entity="switch.kitchen_kettle_plug"]')).toHaveCount(1);
  });

  test("no favourite on the plan, no section; the alias favorites works; a floor the card leaves out drops its favourite, with a badge when it shows several", async ({ page }) => {
    await boot(page, { favourites: ["sensor.nope"] });
    await expect(card(page).locator("css=.fp-ov-fav")).toHaveCount(0);
    await boot(page, { favorites: ["light.study_desk_lamp", "light.kitchen_spot_1"], floor: "ground" });
    expect(await favRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-entity")))).toEqual(["light.kitchen_spot_1"]);
    await expect(card(page).locator("css=.fp-ov-fav .fp-row-floor")).toHaveCount(0); // one floor on show: no badge
    await boot(page, { favorites: ["light.study_desk_lamp", "light.kitchen_spot_1"] });
    await expect(rowOf(page, "light.study_desk_lamp").locator("css=.fp-row-floor")).toHaveText("First");
    await expect(rowOf(page, "light.kitchen_spot_1").locator("css=.fp-row-floor")).toHaveText("Ground");
  });

  test("criterion 3: Turn on acts once; Turn off asks, then Confirm acts once; a sensor row has no button", async ({ page }) => {
    await boot(page, { favourites: [...FAV, "sensor.garage_temperature_probe"] });
    await expect(card(page).locator(BTN("light.kitchen_spot_1"))).toHaveText("Turn on");
    await clickOn(page, BTN("light.kitchen_spot_1"));
    expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.kitchen_spot_1" }]]);
    // The plug is on: Turn off asks first.
    await expect(card(page).locator(BTN("switch.living_wall_switch"))).toHaveText("Turn off");
    await clickOn(page, BTN("switch.living_wall_switch"));
    expect(await calls(page)).toHaveLength(1);
    const confirm = rowOf(page, "switch.living_wall_switch").locator("css=.fp-fav-act");
    await expect(confirm).toHaveText("Confirm turn off");
    await expect(rowOf(page, "switch.living_wall_switch").locator("css=.fp-fav-cancel")).toHaveText("Cancel");
    // Cancel puts the button back and calls nothing.
    await clickOn(page, ".fp-ov-fav .fp-fav-cancel");
    await expect(confirm).toHaveText("Turn off");
    expect(await calls(page)).toHaveLength(1);
    await clickOn(page, BTN("switch.living_wall_switch"));
    await clickOn(page, BTN("switch.living_wall_switch"));
    expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.kitchen_spot_1" }], ["switch", "turn_off", { entity_id: "switch.living_wall_switch" }]]);
    // A sensor has no button; the row still names its state.
    await expect(rowOf(page, "sensor.garage_temperature_probe").locator("css=.fp-fav-act")).toHaveCount(0);
    await expect(rowOf(page, "sensor.garage_temperature_probe").locator("css=.fp-row-state")).toContainText("17.5");
  });

  test("D1: a lock or a cover favourite asks before it acts, one tap never unlocks or opens", async ({ page }) => {
    const favs = ["lock.cloakroom_cabinet", "cover.living_blind"];
    await boot(page, { favourites: favs }, undefined, { ...STATES(), "lock.cloakroom_cabinet": st("locked"), "cover.living_blind": st("closed") });
    await expect(card(page).locator(BTN("lock.cloakroom_cabinet"))).toHaveText("Unlock");
    await clickOn(page, BTN("lock.cloakroom_cabinet"));
    expect(await calls(page)).toEqual([]);
    await expect(card(page).locator(BTN("lock.cloakroom_cabinet"))).toHaveText("Confirm unlock");
    await clickOn(page, BTN("lock.cloakroom_cabinet"));
    expect(await calls(page)).toEqual([["lock", "unlock", { entity_id: "lock.cloakroom_cabinet" }]]);
    await expect(card(page).locator(BTN("cover.living_blind"))).toHaveText("Open");
    await clickOn(page, BTN("cover.living_blind"));
    expect(await calls(page)).toHaveLength(1);
    await expect(card(page).locator(BTN("cover.living_blind"))).toHaveText("Confirm open");
    await clickOn(page, ".fp-ov-fav .fp-fav-cancel");
    expect(await calls(page)).toHaveLength(1);
    await clickOn(page, BTN("cover.living_blind"));
    await clickOn(page, BTN("cover.living_blind"));
    expect(await calls(page)).toEqual([["lock", "unlock", { entity_id: "lock.cloakroom_cabinet" }], ["cover", "open_cover", { entity_id: "cover.living_blind" }]]);
  });

  test("an unavailable favourite is dimmed and has no button", async ({ page }) => {
    await boot(page, { favourites: ["light.kitchen_spot_1"] }, undefined, { ...STATES(), "light.kitchen_spot_1": st("unavailable") });
    await expect(rowOf(page, "light.kitchen_spot_1").locator("css=.fp-fav-act")).toHaveCount(0);
    expect(await rowOf(page, "light.kitchen_spot_1").evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(1);
  });

  test("criterion 4: a real click on the row switches to its floor, centres on it and opens its popup", async ({ page }) => {
    await boot(page, { favourites: ["light.study_desk_lamp"] });
    await expect(pills(page).nth(0)).toHaveAttribute("aria-pressed", "true");
    await clickOn(page, MAIN("light.study_desk_lamp"));
    await expect(pills(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(pop(page)).toHaveAttribute("aria-label", "Study desk lamp");
    await expect(card(page).locator("css=svg.fp-zoomed")).toHaveCount(1);
    expect(await calls(page)).toEqual([]); // the row is not its button
  });

  test("criterion 5: a hostile name is text; a hass update keeps the section, the confirm step and the scroll", async ({ page }) => {
    const lay = structuredClone(layout);
    for (const d of lay.floors.ground.devices) if (d.entity === "cover.living_blind") d.name = '"><script>window.__xss=1</script>';
    await boot(page, { favourites: ["cover.living_blind", "light.kitchen_spot_1", "switch.living_wall_switch"] }, { width: 1280, height: 420 }, STATES(), lay);
    await expect(rowOf(page, "cover.living_blind").locator("css=.fp-ov-name")).toHaveText('"><script>window.__xss=1</script>');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await clickOn(page, BTN("switch.living_wall_switch"));
    await expect(rowOf(page, "switch.living_wall_switch").locator("css=.fp-fav-act")).toHaveText("Confirm turn off");
    const body = card(page).locator("css=.fp-active-body");
    const room = await body.evaluate((b) => { b.scrollTop = 40; return b.scrollHeight - b.clientHeight; });
    expect(room, "the body scrolls, so the scroll check is not vacuous").toBeGreaterThan(40);
    await rehass(page);
    await expect(favRows(page)).toHaveCount(3);
    await expect(rowOf(page, "switch.living_wall_switch").locator("css=.fp-fav-act")).toHaveText("Confirm turn off");
    expect(await body.evaluate((b) => b.scrollTop)).toBe(40);
  });

  test("criterion 6: no section under kiosk or active_list: false, nor at the Floor or Room level", async ({ page }) => {
    await boot(page, { favourites: FAV, kiosk: true });
    await expect(card(page).locator("css=.fp-ov-fav")).toHaveCount(0);
    await boot(page, { favourites: FAV, active_list: false });
    await expect(card(page).locator("css=.fp-ov-fav")).toHaveCount(0);
    await boot(page, { favourites: FAV });
    await expect(card(page).locator("css=.fp-ov-fav")).toHaveCount(1);
    // Room level: a real click on a room's bare floor.
    const p = await card(page).evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!;
      const r = poly.getBoundingClientRect();
      for (let a = 1; a < 12; a++) for (let b = 1; b < 12; b++) {
        const x = r.x + (r.width * a) / 12, y = r.y + (r.height * b) / 12;
        if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      }
      return null;
    });
    expect(p).not.toBeNull();
    await page.mouse.click(p!.x, p!.y);
    await expect(card(page).locator("css=.fp-room")).toHaveCount(1);
    await expect(card(page).locator("css=.fp-ov-fav")).toHaveCount(0);
  });

  test("the fold keeps Attention in view at 390 x 844, and is kept across a reload of the card", async ({ page }) => {
    const many = Object.keys(STATES()).filter((k) => !k.startsWith("alarm"));
    await boot(page, { favourites: [...many, "light.living_spot_1", "light.master_bedroom_spot_1"] }, { width: 390, height: 844 });
    // The phone's sheet at full: Attention is below the open section, out of view.
    await openSheetFull(page); // peek to half to full
    const attn = card(page).locator("css=.fp-ov-attn .fp-ov-head");
    const inView = () => attn.evaluate((e) => { const r = e.getBoundingClientRect(), b = e.closest(".fp-active-body")!.getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom; });
    const head = card(page).locator("css=.fp-ov-fav .fp-cat");
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await clickOn(page, ".fp-ov-fav .fp-cat");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(favRows(page)).toHaveCount(0);
    expect(await inView()).toBe(true);
    // Kept with the other folds: a new setConfig with the same config reads it back.
    await card(page).evaluate((el) => { const e = el as unknown as { setConfig(c: unknown): void; _config: unknown }; e.setConfig(e._config); });
    await expect(card(page).locator("css=.fp-ov-fav .fp-cat")).toHaveAttribute("aria-expanded", "false");
  });

  // Judgement (S34.4): where the inline confirm sits in a row on a phone. CSS pair (finding 10): a row that is not unavailable is opaque.
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    test(`the confirm step stays inside the sheet, under its row, with both buttons at ${size.width} px`, async ({ page }) => {
      await boot(page, { favourites: ["switch.living_wall_switch", "light.kitchen_spot_1"] }, size);
      if (size.width < 640) await openSheetFull(page);
      expect(await rowOf(page, "switch.living_wall_switch").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
      await clickOn(page, BTN("switch.living_wall_switch"));
      await expect(rowOf(page, "switch.living_wall_switch").locator("css=.fp-fav-cancel")).toBeVisible();
      const g = await rowOf(page, "switch.living_wall_switch").evaluate((row) => {
        const box = (e: Element | null) => { const r = e!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        return { body: box(row.closest(".fp-active-body")), main: box(row.querySelector(".fp-active-row")), act: box(row.querySelector(".fp-fav-act")), cancel: box(row.querySelector(".fp-fav-cancel")) };
      });
      expect(g.act.t).toBeGreaterThanOrEqual(g.main.b - 1); // on its own line, under the row
      expect(g.cancel.r).toBeLessThanOrEqual(g.body.r);
      expect(g.act.l).toBeGreaterThanOrEqual(g.body.l);
      expect(g.act.r).toBeLessThanOrEqual(g.cancel.l); // side by side, not stacked
      expect(g.cancel.l - g.act.r).toBeLessThan(40);
    });
  }

  test("criterion 7 end to end: Search ranks the favourite first within its tier", async ({ page }) => {
    const first = async (config: Record<string, unknown>) => {
      await boot(page, config);
      await clickOn(page, "fp-search");
      await page.keyboard.type("li");
      return card(page).locator("css=fp-search").locator('css=[role="option"]').first().textContent();
    };
    const without = await first({});
    expect(without).not.toContain("Library reading lamp");
    expect(await first({ favourites: ["light.library_reading_lamp"] })).toContain("Library reading lamp");
  });

  test("one console.warn per card when favourites had junk; none when clean or absent", async ({ page }) => {
    const warns: string[] = [];
    page.on("console", (m) => { if (m.type() === "warning" && m.text().includes("favourites")) warns.push(m.text()); });
    await boot(page, { favourites: ["light.Kitchen", 5, "light.kitchen_spot_1"] });
    await card(page).evaluate((el) => { const e = el as unknown as { setConfig(c: unknown): void; _config: unknown }; e.setConfig(e._config); });
    await expect.poll(() => warns.length).toBe(1);
    expect(warns[0]).toMatch(/favourites/);
    warns.length = 0;
    await boot(page, { favourites: FAV });
    await boot(page, {});
    expect(warns).toEqual([]);
  });

  // F3: the row's button is the popup's, per type and state. Every type is a decision (finding 20): this walks the union.
  const DOMAIN: Record<string, string> = { light: "light", lock: "lock", cover: "cover", ac: "climate", heater: "climate", climate: "climate", tv: "media_player", media: "media_player", speaker: "media_player", siren: "siren", fan: "fan", camera: "camera", person: "person", vacuum: "vacuum", alarm: "alarm_control_panel", temp: "sensor", humidity: "sensor", battery: "sensor", inverter: "sensor", server: "sensor", access_point: "sensor", motion: "binary_sensor", contact: "binary_sensor", vibration: "binary_sensor", radar: "binary_sensor" };
  const typeEntity = (t: string, i: number) => `${DOMAIN[t] ?? "switch"}.t${i}`;
  for (const state of ["on", "off", "unavailable"]) {
    for (const [from, to] of [[0, 17], [17, 40]] as const) {
      test(`the row button matches the popup's, ${state}, types ${from} to ${to}`, async ({ page }) => {
        const types = DEVICE_TYPES.slice(from, to);
        const lay = structuredClone(layout);
        for (const f of Object.values<{ devices: unknown[] }>(lay.floors)) f.devices = [];
        lay.floors.ground.devices = types.map((type, i) => ({ id: `d${i}`, type, entity: typeEntity(type, from + i), name: `Dev ${type}`, x: 60 + (i % 8) * 50, y: 60 + Math.floor(i / 8) * 40 }));
        const states: Record<string, unknown> = {};
        types.forEach((t, i) => { states[typeEntity(t, from + i)] = st(state === "on" && DOMAIN[t] === "lock" ? "locked" : state === "on" && DOMAIN[t] === "cover" ? "open" : state); });
        await boot(page, { favourites: types.map((t, i) => typeEntity(t, from + i)), floor: "ground" }, { width: 1280, height: 900 }, states, lay);
        expect(await favRows(page).count()).toBe(types.length);
        let withButton = 0;
        for (const [i, t] of types.entries()) {
          const e = typeEntity(t, from + i);
          const row = rowOf(page, e).locator("css=.fp-fav-act");
          const label = (await row.count()) ? await row.textContent() : null;
          await clickOn(page, MAIN(e));
          await expect(pop(page)).toHaveCount(1);
          const doBtn = pop(page).locator("css=.fp-pop-do");
          const popLabel = (await doBtn.count()) ? await doBtn.textContent() : null;
          expect(label, `${t} (${e}) ${state}`).toBe(popLabel);
          if (label) withButton++;
          await page.keyboard.press("Escape");
          await expect(pop(page)).toHaveCount(0);
        }
        if (state !== "unavailable" && from === 0) expect(withButton).toBeGreaterThan(5);
        if (state === "unavailable") expect(withButton).toBe(0);
      });
    }
  }
});
