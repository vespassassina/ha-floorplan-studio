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
