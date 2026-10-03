import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S7.7: the card config form. Same file:// injection trick as tests/card/card.spec.ts — a plain <script src>
// fails under file:// (Chromium refuses a cross-origin module fetch between two file:// URLs), so the built
// module's own source is injected as inline content. config-editor.ts is imported for its side effect (defining
// floorplan-studio-card-editor) from src/card/floorplan-studio-card.ts, so it ships in the same dist file the vite
// config already builds (vite.config.ts: the card's entry is src/card/floorplan-studio-card.ts) — no second file.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

const URL_ = pathToFileURL(resolve("tests/card/config-editor-harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

/** Loads the harness fresh, injects the built module, and waits for both custom elements to upgrade. */
async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => Promise.all([customElements.whenDefined("floorplan-studio-card"), customElements.whenDefined("floorplan-studio-card-editor")]));
}

/** Calls FloorplanStudioCard.getConfigElement(), appends the result to the body, calls setConfig, and returns
 * a handle to it. Collects every config-changed event fired after this point into window.__events. */
async function mount(page: Page, config: Record<string, unknown> = {}) {
  await page.evaluate((config) => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): HTMLElement };
    const el = Ctor.getConfigElement();
    (window as unknown as { __events: unknown[] }).__events = [];
    el.addEventListener("config-changed", (e) => {
      (window as unknown as { __events: unknown[] }).__events.push((e as CustomEvent).detail);
    });
    el.id = "editor";
    document.body.appendChild(el);
    (el as unknown as { setConfig(c: unknown): void }).setConfig(config);
  }, config);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card-editor"));
}

function events(page: Page) {
  return page.evaluate(() => (window as unknown as { __events: unknown[] }).__events);
}

test("getConfigElement returns an element tagged floorplan-studio-card-editor", async ({ page }) => {
  await open(page);
  const tag = await page.evaluate(() => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): HTMLElement };
    return Ctor.getConfigElement().tagName.toLowerCase();
  });
  expect(tag).toBe("floorplan-studio-card-editor");
});

test("setConfig fills the fields", async ({ page }) => {
  await open(page);
  await mount(page, { theme: "midnight", fade: 45, room_glow: true, layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("select#theme")).toHaveValue("midnight");
  await expect(editor.locator("#fade")).toHaveValue("45");
  await expect(editor.locator("#room_glow")).toBeChecked();
});

test("ticking a floor fires config-changed with detail.config.floors", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  // Floors come from the loaded layout, in its own order: ground, first, test.
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(3);
  await editor.locator('input[type="checkbox"][data-floor="first"]').check();
  const detail = (await events(page)).at(-1) as { config: { floors?: string[] } };
  expect(detail.config.floors).toEqual(["first"]);
});

test("changing the theme fires config-changed with detail.config.theme", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("select#theme").selectOption("terminal");
  const detail = (await events(page)).at(-1) as { config: { theme?: string } };
  expect(detail.config.theme).toBe("terminal");
});

test("a key set back to its default is absent from the emitted config", async ({ page }) => {
  await open(page);
  await mount(page, { theme: "midnight", layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("select#theme").selectOption("blueprint");
  const detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("theme" in detail.config).toBe(false);
});

test("room_glow, kiosk and fade also drop from the payload at their default", async ({ page }) => {
  await open(page);
  await mount(page, { room_glow: true, kiosk: true, fade: 45, layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#room_glow").uncheck();
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("room_glow" in detail.config).toBe(false);

  await editor.locator("#kiosk").uncheck();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("kiosk" in detail.config).toBe(false);

  await editor.locator("#fade").fill("300");
  await editor.locator("#fade").blur();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("fade" in detail.config).toBe(false);
});

test("an unknown theme shows the select on blueprint and fires no event", async ({ page }) => {
  await open(page);
  await mount(page, { theme: "nonexistent", layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("select#theme")).toHaveValue("blueprint");
  expect(await events(page)).toEqual([]);
});

test("floors come from the layout the card loaded, in layout order", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  const ids = await editor.locator('input[type="checkbox"][data-floor]').evaluateAll((els) => els.map((e) => e.getAttribute("data-floor")));
  expect(ids).toEqual(["ground", "first", "test"]);
});

test("view and view_switch fields: defaults shown, defaults dropped from the payload, picks written", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("select#view")).toHaveValue("2d");
  await expect(editor.locator("#view_switch")).toBeChecked();
  expect(await editor.locator("select#view option").evaluateAll((os) => os.map((o) => [o.getAttribute("value"), o.textContent!.trim()]))).toEqual([["2d", "2D"], ["2.5d", "2.5D"]]);

  await editor.locator("select#view").selectOption("2.5d");
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.view).toBe("2.5d");
  await editor.locator("select#view").selectOption("2d");
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("view" in detail.config).toBe(false);

  await editor.locator("#view_switch").uncheck();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.view_switch).toBe(false);
  await editor.locator("#view_switch").check();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("view_switch" in detail.config).toBe(false);
});

test("rotate_switch and names fields: ticked and unticked as on the card, defaults dropped from the payload", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#rotate_switch")).toBeChecked();
  await expect(editor.locator("#names")).not.toBeChecked();
  await editor.locator("#rotate_switch").uncheck();
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.rotate_switch).toBe(false);
  await editor.locator("#rotate_switch").check();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("rotate_switch" in detail.config).toBe(false);
  await editor.locator("#names").check();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.names).toBe(true);
  await editor.locator("#names").uncheck();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("names" in detail.config).toBe(false);
  await mount(page, { rotate_switch: false, names: true, layout: demo });
  await expect(page.locator("#editor #rotate_switch").last()).not.toBeChecked();
  await expect(page.locator("#editor #names").last()).toBeChecked();
});

test("a config with view 2.5d and view_switch false shows both, and a junk view shows 2D without an event", async ({ page }) => {
  await open(page);
  await mount(page, { view: "2.5d", view_switch: false, layout: demo });
  await expect(page.locator("#editor select#view")).toHaveValue("2.5d");
  await expect(page.locator("#editor #view_switch")).not.toBeChecked();
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { view: "3d", layout: demo });
  await expect(page.locator("#editor select#view")).toHaveValue("2d");
  expect(await events(page)).toEqual([]);
});

test("kiosk, night and sun fields exist with their S7.5/S7.6 defaults", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#kiosk")).not.toBeChecked();
  await expect(editor.locator("select#night")).toHaveValue("auto");
  await expect(editor.locator("#sun")).toHaveValue("sun.sun");
});

// Opus review, 2026-09-25 (m2): an emptied fade field became 0 (no fade at all) and a negative number was written
// through. Both now fall back to the default, which is then left out of the payload like any default.
test("an empty or negative fade falls back to the default and drops from the payload", async ({ page }) => {
  await open(page);
  await mount(page, { fade: 45, layout: demo });
  const editor = page.locator("#editor");
  for (const bad of ["", "-5"]) {
    await editor.locator("#fade").fill(bad);
    await editor.locator("#fade").blur();
    const all = await events(page) as { config: Record<string, unknown> }[];
    const detail = all[all.length - 1];
    expect("fade" in detail.config, JSON.stringify(bad)).toBe(false);
    await editor.locator("#fade").fill("45");
    await editor.locator("#fade").blur();
  }
});

// S8.12: the Floor selector, added alongside the maintainer-reported "I cannot switch floor" fix in the card
// itself — the Edit-card form had a Floors checkbox list (writes `floors`) but nothing for `floor`.
test("the Floor select lists All floors plus every layout floor, in layout order", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  const labels = await editor.locator("select#floor option").evaluateAll((els) => els.map((e) => e.textContent));
  expect(labels).toEqual(["All floors (switcher)", "Ground", "First", "Test"]);
});

test("before a layout has loaded, the Floor select shows only All floors", async ({ page }) => {
  await open(page);
  await mount(page, {});
  const editor = page.locator("#editor");
  await expect(editor.locator("select#floor option")).toHaveCount(1);
  await expect(editor.locator("select#floor")).toHaveValue("");
});

test("choosing a floor emits config.floor without config.floors, and hides the Switcher-shows checkboxes", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo, floors: ["ground", "first"] });
  const editor = page.locator("#editor");
  // One checkbox per layout floor (3), before picking a single floor collapses the row away.
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(3);

  await editor.locator("select#floor").selectOption("first");
  const detail = (await events(page)).at(-1) as { config: { floor?: string; floors?: string[] } };
  expect(detail.config.floor).toBe("first");
  expect("floors" in detail.config).toBe(false);
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(0);
});

test("choosing All floors after a single floor was picked removes config.floor and shows the checkboxes again", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo, floor: "first" });
  const editor = page.locator("#editor");
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(0);

  await editor.locator("select#floor").selectOption("");
  const detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("floor" in detail.config).toBe(false);
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(3);
});

test("a starting config of floor: \"all\" shows All floors selected", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo, floor: "all" });
  const editor = page.locator("#editor");
  await expect(editor.locator("select#floor")).toHaveValue("");
  await expect(editor.locator('input[type="checkbox"][data-floor]')).toHaveCount(3);
});

// S9.1: the open_color field. A native <input type="color"> can only ever hold a valid #rrggbb, so it cannot
// represent "unset" — it shows the theme's own default (#d64545, --fp-dev-contact's value) until a colour is
// picked, and a separate Clear control removes the key rather than the input being set back to that same hex
// (which config-changed could never tell apart from the user actually choosing #d64545).
test("open_color: the colour field starts at the contact default, picking a colour emits it, and Clear removes the key", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#open_color")).toHaveValue("#d64545");

  await editor.locator("#open_color").evaluate((el) => {
    (el as HTMLInputElement).value = "#123abc";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  let detail = (await events(page)).at(-1) as { config: { open_color?: string } };
  expect(detail.config.open_color).toBe("#123abc");

  await editor.locator("#open_color_clear").click();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("open_color" in detail.config).toBe(false);
  await expect(editor.locator("#open_color")).toHaveValue("#d64545");
});

test("setConfig fills open_color into the colour field", async ({ page }) => {
  await open(page);
  await mount(page, { open_color: "#00ff88", layout: demo });
  await expect(page.locator("#editor").locator("#open_color")).toHaveValue("#00ff88");
});

// S9.2: the Edit-card form's icon_size field, same shape as fade (a number input, default value shown when the
// key is unset, dropped from the payload once it is set back to that default).
test("setConfig fills icon_size, default 1 when unset", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#icon_size")).toHaveValue("1");
});

test("setConfig fills icon_size from the config when set", async ({ page }) => {
  await open(page);
  await mount(page, { icon_size: 1.5, layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#icon_size")).toHaveValue("1.5");
});

test("changing icon_size fires config-changed with detail.config.icon_size, dropped again at the default", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#icon_size").fill("2");
  await editor.locator("#icon_size").blur();
  let detail = (await events(page)).at(-1) as { config: { icon_size?: number } };
  expect(detail.config.icon_size).toBe(2);

  await editor.locator("#icon_size").fill("1");
  await editor.locator("#icon_size").blur();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("icon_size" in detail.config).toBe(false);
});

// Opus-review-style case (CLAUDE.md finding 4): an emptied field is not 0 (out of range, would clamp to 0.5 and
// silently write a wrong value) — it must fall back to the default 1 and drop from the payload, same as fade.
test("clearing icon_size falls back to the default and drops from the payload", async ({ page }) => {
  await open(page);
  await mount(page, { icon_size: 2, layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#icon_size").fill("");
  await editor.locator("#icon_size").blur();
  const detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("icon_size" in detail.config).toBe(false);
  await expect(editor.locator("#icon_size")).toHaveValue("1");
});

test("an out-of-range icon_size clamps into 0.5..3 rather than being refused", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#icon_size").fill("0");
  await editor.locator("#icon_size").blur();
  let detail = (await events(page)).at(-1) as { config: { icon_size?: number } };
  expect(detail.config.icon_size).toBe(0.5);

  await editor.locator("#icon_size").fill("10");
  await editor.locator("#icon_size").blur();
  detail = (await events(page)).at(-1) as { config: { icon_size?: number } };
  expect(detail.config.icon_size).toBe(3);
});

// S9.6: the Center X/Y and Zoom level fields — same shape as icon_size above (a key dropped from the payload at
// its default, an emptied field falling back), but Center is a pair written from two boxes together.
test("Center X/Y and Zoom level are empty/1 by default", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#center_x")).toHaveValue("");
  await expect(editor.locator("#center_y")).toHaveValue("");
  await expect(editor.locator("#zoom_level")).toHaveValue("1");
});

test("setConfig fills Center X/Y and Zoom level from center/zoom_level", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo, center: [300, 725], zoom_level: 2.5 });
  const editor = page.locator("#editor");
  await expect(editor.locator("#center_x")).toHaveValue("300");
  await expect(editor.locator("#center_y")).toHaveValue("725");
  await expect(editor.locator("#zoom_level")).toHaveValue("2.5");
});

test("filling both Center fields emits config.center as a pair; a half-filled pair drafts without dispatching, and clearing both drops the key", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#center_x").fill("150");
  await editor.locator("#center_x").blur();
  // Only X filled so far: not a valid pair yet. Opus review 2026-09-27: firing a config-changed here used to drop
  // `center` mid-edit — now a half-filled pair fires nothing at all, so the dashboard's saved config is untouched.
  expect(await events(page)).toEqual([]);
  await expect(editor.locator("#center_x")).toHaveValue("150");

  await editor.locator("#center_y").fill("640");
  await editor.locator("#center_y").blur();
  let detail = (await events(page)).at(-1) as { config: { center?: [number, number] } };
  expect(detail.config.center).toEqual([150, 640]);

  // Clearing X to retype it must not wipe Y's box (the bug Opus found) nor drop `center` — only clearing both
  // boxes does that. No new event fires: there is nothing settled to report yet.
  await editor.locator("#center_x").fill("");
  await editor.locator("#center_x").blur();
  expect(await events(page)).toHaveLength(1);
  await expect(editor.locator("#center_y")).toHaveValue("640");

  // Retyping X completes the pair again — back to normal, config-driven display.
  await editor.locator("#center_x").fill("150");
  await editor.locator("#center_x").blur();
  detail = (await events(page)).at(-1) as { config: { center?: [number, number] } };
  expect(detail.config.center).toEqual([150, 640]);

  // Clearing Y alone is the same half-filled case, the other way round: no event, X's box untouched.
  await editor.locator("#center_y").fill("");
  await editor.locator("#center_y").blur();
  expect(await events(page)).toHaveLength(2);
  await expect(editor.locator("#center_x")).toHaveValue("150");

  await editor.locator("#center_x").fill("");
  await editor.locator("#center_x").blur();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("center" in detail.config).toBe(false);
});

test("changing zoom_level fires config-changed, dropped again at its default (1)", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#zoom_level").fill("3");
  await editor.locator("#zoom_level").blur();
  let detail = (await events(page)).at(-1) as { config: { zoom_level?: number } };
  expect(detail.config.zoom_level).toBe(3);

  await editor.locator("#zoom_level").fill("1");
  await editor.locator("#zoom_level").blur();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("zoom_level" in detail.config).toBe(false);
});

test("clearing zoom_level falls back to the default and drops from the payload", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo, zoom_level: 3 });
  const editor = page.locator("#editor");
  await editor.locator("#zoom_level").fill("");
  await editor.locator("#zoom_level").blur();
  const detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("zoom_level" in detail.config).toBe(false);
  await expect(editor.locator("#zoom_level")).toHaveValue("1");
});

test("an out-of-range zoom_level clamps into 1..8 rather than being refused", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await editor.locator("#zoom_level").fill("0");
  await editor.locator("#zoom_level").blur();
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("zoom_level" in detail.config).toBe(false); // clamps to 1, the default: dropped, not written as 1

  await editor.locator("#zoom_level").fill("50");
  await editor.locator("#zoom_level").blur();
  detail = (await events(page)).at(-1) as { config: { zoom_level?: number } };
  expect(detail.config.zoom_level).toBe(8);
});

test("labels and tilt fields: defaults shown and dropped from the payload, picks written, junk shows the default", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#labels")).toBeChecked();
  await expect(editor.locator("#tilt")).toHaveValue("0.5");

  await editor.locator("#labels").uncheck();
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.labels).toBe(false);
  await editor.locator("#labels").check();
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("labels" in detail.config).toBe(false);

  await editor.locator("#tilt").fill("0.8");
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.tilt).toBe(0.8);
  await editor.locator("#tilt").fill("0.5");
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("tilt" in detail.config).toBe(false);

  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { labels: "no", tilt: 7, layout: demo });
  await expect(page.locator("#editor #labels")).toBeChecked();
  await expect(page.locator("#editor #tilt")).toHaveValue("1");
});

test("rotation field: a 45 degree select, 0 dropped from the payload, junk shows 0, a note says the view is remembered", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#rotation")).toHaveValue("0");
  await expect(editor.locator("#rotation option")).toHaveCount(8);
  await expect(editor).toContainText("remembers");

  await editor.locator("#rotation").selectOption("135");
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.rotation).toBe(135);
  await editor.locator("#rotation").selectOption("0");
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("rotation" in detail.config).toBe(false);

  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { rotation: 100, layout: demo }); // 100 rounds to the nearest step, 90
  await expect(page.locator("#editor #rotation")).toHaveValue("90");
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { rotation: "x", layout: demo });
  await expect(page.locator("#editor #rotation")).toHaveValue("0");
});

// Plugs are active from `plug_watts` of measured power. The form shows the default 2 and drops it from the
// payload at the default, like fade. An empty or negative field is the default, not 0 W (0 would call any
// reading, even 0.0 W, "drawing power").
test("plug_watts: shows 2 by default, writes a changed value, and an empty or negative field is the default, dropped from the payload", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  await expect(editor.locator("#plug_watts")).toHaveValue("2");
  await editor.locator("#plug_watts").fill("7.5");
  await editor.locator("#plug_watts").blur();
  expect(((await events(page)).at(-1) as { config: Record<string, unknown> }).config.plug_watts).toBe(7.5);
  for (const bad of ["", "-1"]) {
    await editor.locator("#plug_watts").fill("7.5");
    await editor.locator("#plug_watts").blur();
    await editor.locator("#plug_watts").fill(bad);
    await editor.locator("#plug_watts").blur();
    expect("plug_watts" in ((await events(page)).at(-1) as { config: Record<string, unknown> }).config, JSON.stringify(bad)).toBe(false);
  }
});
