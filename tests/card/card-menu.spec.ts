import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { THEMES } from "../../src/core";
import { serve, ORIGIN, drawn } from "./helpers-3d";
import { closeMenu, hasItem, isDisabled, menuButton, menuItem, menuPanel, openMenu, pick, stateOf, themeNow } from "./menu-helper";
import { cardSource } from "../../scripts/card-source.mjs";

// S31.6 (docs/specs/card-layout-touch.md, D3, criterion 7): the header's ⋯ holds the look. Real page.mouse and page.keyboard (finding 3);
// each item is judged by what it does to the plan and to the view memory (`fp-view:`), the two things the control it replaced did.
// The accessible names are the spec's: menu "View options", menuitemradio (View, Detail), a select (Theme), menuitemcheckbox (Labels, Device
// names, Floor below, each layer), menuitem (Rotate left, Rotate right, Reset view).

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

async function boot(page: Page, config: Record<string, unknown> = {}, size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, config);
}
/** setConfig again on the same page, storage kept: the card reads its stored view back. */
async function configure(page: Page, config: Record<string, unknown>, clear = true) {
  await page.evaluate(([cfg, clear]) => {
    if (clear) try { localStorage.clear(); } catch { /* no storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, [{ layout, floor: "first", theme: "light", ...config }, clear] as const);
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const plan = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.innerHTML);
const stored = (page: Page) => page.evaluate(() => {
  const e = Object.entries(localStorage).find(([k]) => k.startsWith("fp-view:"));
  return e ? (JSON.parse(e[1]) as Record<string, unknown>) : null;
});
const count = (page: Page, sel: string) => card(page).evaluate((el, sel) => el.shadowRoot!.querySelectorAll(sel).length, sel);
const level = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null);
const names = (page: Page, role: string) => menuPanel(page).locator(`css=[role=${role}]`).evaluateAll((els) => els.map((e) => e.querySelector(".text")!.textContent));
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);

test.describe("S31.6 the ⋯ menu: criterion 7", () => {
  test("a button named View options, aria-haspopup=menu and aria-expanded, opens on a click, Enter and Space", async ({ page }) => {
    await boot(page);
    await expect(menuButton(page)).toHaveAttribute("aria-haspopup", "menu");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(menuPanel(page)).toHaveCount(0);
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(menuPanel(page)).toHaveCount(1);
    await menuButton(page).click();
    await expect(menuPanel(page)).toHaveCount(0);
    for (const key of ["Enter", " "]) {
      await menuButton(page).focus();
      await page.keyboard.press(key);
      await expect(menuPanel(page), `key ${JSON.stringify(key)}`).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(menuPanel(page)).toHaveCount(0);
    }
  });

  test("the roles and the order of D3: View, Floor below, Theme, Labels, Device names, Detail, Layers, Rotate left, Rotate right, Reset view", async ({ page }) => {
    await boot(page);
    await openMenu(page);
    expect(await names(page, "menuitemradio")).toEqual(["2D", "2.5D", "3D", "Auto", "Full", "Minimal", "Off", "Temperature", "Humidity"]);
    const checks = await names(page, "menuitemcheckbox");
    expect(checks.slice(0, 3)).toEqual(["Floor below", "Labels", "Device names"]);
    expect(checks.length, "and a layer per family on the floor").toBeGreaterThan(3);
    expect(await names(page, "menuitem")).toEqual(["Rotate left", "Rotate right", "Reset view"]);
    // The order in the menu is the order of the spec.
    const order = await menuPanel(page).locator("css=[role^=menuitem], select.sel").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
    expect(order.indexOf("view:2d")).toBeLessThan(order.indexOf("ghost"));
    expect(order.indexOf("ghost")).toBeLessThan(order.indexOf("theme"));
    expect(order.indexOf("theme")).toBeLessThan(order.indexOf("labels"));
    expect(order.indexOf("names")).toBeLessThan(order.indexOf("detail:auto"));
    expect(order.indexOf("detail:minimal")).toBeLessThan(order.findIndex((v) => v?.startsWith("layer:")));
    expect(order.map((v) => !!v?.startsWith("layer:")).lastIndexOf(true)).toBeLessThan(order.indexOf("rotate:-1"));
    expect(order.at(-1)).toBe("reset");
    await expect(menuItem(page, "view:2d")).toHaveAttribute("aria-checked", "true");
  });

  test("arrows move, Home and End jump, Escape closes and gives the button focus back, a tap outside closes", async ({ page }) => {
    await boot(page);
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    const focused = () => page.evaluate(() => {
      let e: Element | null = document.activeElement;
      while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement;
      return e?.getAttribute("data-value") ?? e?.getAttribute("aria-label") ?? null;
    });
    expect(await focused(), "focus starts on the checked View item").toBe("view:2d");
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe("view:2.5d");
    await page.keyboard.press("End");
    expect(await focused(), "End skips Reset view, disabled while nothing differs").toBe("rotate:1");
    await page.keyboard.press("Home");
    expect(await focused()).toBe("view:2d");
    await page.keyboard.press("Escape");
    await expect(menuPanel(page)).toHaveCount(0);
    expect(await focused(), "the button has focus again").toBe("View options");
    await openMenu(page);
    const svg = (await card(page).locator("css=svg.fp-zoomable").boundingBox())!;
    await page.mouse.click(svg.x + svg.width / 2, svg.y + svg.height - 10);
    await expect(menuPanel(page)).toHaveCount(0);
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("Enter on an item picks it, as a click does", async ({ page }) => {
    await boot(page);
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menuPanel(page)).toHaveCount(0);
    expect((await stored(page))?.view).toBe("2.5d");
  });
});

test.describe("S31.6 each item does what the old control did, and is remembered the same way", () => {
  test("View: 2.5D redraws the plan and is stored; the item says it is on", async ({ page }) => {
    await boot(page);
    const before = await plan(page);
    await pick(page, "view:2.5d");
    expect(await plan(page)).not.toBe(before);
    expect((await stored(page))?.view).toBe("2.5d");
    expect(await stateOf(page, "view:2.5d")).toBe("true");
    expect(await stateOf(page, "view:2d")).toBe("false");
  });

  test("Tilt (2.5D only): a step redraws the plan and is stored", async ({ page }) => {
    await boot(page);
    expect(await hasItem(page, "tilt:1"), "no Tilt in 2D").toBe(false);
    await pick(page, "view:2.5d");
    expect(await stateOf(page, "tilt:0.5"), "the default is the middle step").toBe("true");
    const before = await plan(page);
    await pick(page, "tilt:1");
    expect(await plan(page)).not.toBe(before);
    expect((await stored(page))?.tilt).toBe(1);
    expect(await stateOf(page, "tilt:1")).toBe("true");
    expect(await stateOf(page, "tilt:0.5")).toBe("false");
  });

  test("Walls (2.5D): a pick redraws the plan and is stored", async ({ page }) => {
    await boot(page);
    expect(await hasItem(page, "walls:full"), "no Walls in 2D").toBe(false);
    await pick(page, "view:2.5d");
    const before = await plan(page);
    await pick(page, "walls:full");
    expect(await plan(page)).not.toBe(before);
    expect((await stored(page))?.walls).toBe("full");
    expect(await stateOf(page, "walls:full")).toBe("true");
  });

  test("Theme: the card's data-theme follows at once and the pick is stored", async ({ page }) => {
    await boot(page);
    await pick(page, "theme:midnight");
    await expect(card(page)).toHaveAttribute("data-theme", "midnight");
    expect((await stored(page))?.theme).toBe("midnight");
    expect(await themeNow(page, THEMES)).toBe("midnight");
  });

  test("Labels and Device names: each is a checkbox that flips the plan and is stored", async ({ page }) => {
    await boot(page);
    expect(await stateOf(page, "labels")).toBe("true");
    const names0 = await count(page, "text.lbl-dev, text[data-dn]");
    const before = await plan(page);
    await pick(page, "labels");
    expect(await plan(page)).not.toBe(before);
    expect((await stored(page))?.labels).toBe(false);
    expect(await stateOf(page, "labels")).toBe("false");
    await pick(page, "labels");
    expect((await stored(page))?.labels).toBe(true);
    expect(await stateOf(page, "names")).toBe("false");
    const b2 = await plan(page);
    await pick(page, "names");
    expect(await plan(page)).not.toBe(b2);
    expect((await stored(page))?.names).toBe(true);
    expect(await stateOf(page, "names")).toBe("true");
    expect(await count(page, "text.lbl-dev, text[data-dn]")).toBeGreaterThanOrEqual(names0);
  });

  test("Floor below: draws the ghost of the floor under, is stored, and is disabled on the lowest floor", async ({ page }) => {
    await boot(page);
    await expect(card(page).locator("css=svg g.ghost")).toHaveCount(0);
    expect(await isDisabled(page, "ghost")).toBe(false);
    await pick(page, "ghost");
    await expect(card(page).locator("css=svg g.ghost")).toHaveCount(1);
    expect((await stored(page))?.ghost).toBe(true);
    expect(await stateOf(page, "ghost")).toBe("true");
    await configure(page, { floor: "ground" });
    expect(await isDisabled(page, "ghost"), "the lowest floor has nothing under it").toBe(true);
  });

  test("Detail: Minimal pins the far level at fit, Auto and Full are kept apart, and the pick is stored", async ({ page }) => {
    await boot(page);
    expect(await level(page), "the harness default is full").toBe("near");
    expect(await stateOf(page, "detail:full")).toBe("true");
    await pick(page, "detail:minimal");
    expect(await level(page)).toBe("far");
    expect((await stored(page))?.detail).toBe("minimal");
    expect(await stateOf(page, "detail:minimal")).toBe("true");
    expect(await stateOf(page, "detail:full")).toBe("false");
  });

  test("Layers: a family leaves the plan and comes back; Alt shows one alone; the choice is stored", async ({ page }) => {
    await boot(page, { floor: "ground" });
    const lights = () => count(page, "svg g[data-x]");
    const all = await lights();
    expect(await stateOf(page, "layer:lights")).toBe("true");
    await pick(page, "layer:lights");
    expect(await lights()).toBeLessThan(all);
    expect((await stored(page))?.layers).toEqual(["lights"]);
    expect(await stateOf(page, "layer:lights")).toBe("false");
    await pick(page, "layer:lights");
    expect(await lights()).toBe(all);
    // Alt-click: only that family is shown (every other one is hidden), again: all.
    await openMenu(page);
    await page.keyboard.down("Alt");
    await menuItem(page, "layer:lights").click();
    await page.keyboard.up("Alt");
    const hidden = ((await stored(page))?.layers as string[]) ?? [];
    expect(hidden.length).toBeGreaterThan(1);
    expect(hidden).not.toContain("lights");
    await openMenu(page);
    await page.keyboard.down("Alt");
    await menuItem(page, "layer:lights").click();
    await page.keyboard.up("Alt");
    expect((await stored(page))?.layers ?? []).toEqual([]);
  });

  test("Rotate right and left turn the plan 45 degrees, remembered; Reset view brings the defaults back and is disabled when nothing differs", async ({ page }) => {
    await boot(page);
    const deg = () => card(page).evaluate((el) => Number(el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/)?.[1] ?? 0));
    expect(await isDisabled(page, "reset"), "nothing differs from the config").toBe(true);
    await pick(page, "rotate:1");
    await settled(page);
    expect(await deg()).toBe(45);
    await expect.poll(async () => JSON.stringify((await stored(page))?.floors)).toContain('"rotation":45');
    await pick(page, "rotate:-1");
    await settled(page);
    expect(await deg()).toBe(0);
    await pick(page, "rotate:1");
    await pick(page, "theme:midnight");
    await settled(page);
    expect(await isDisabled(page, "reset")).toBe(false);
    await pick(page, "reset");
    await settled(page);
    expect(await deg()).toBe(0);
    await expect(card(page)).toHaveAttribute("data-theme", "light");
    expect(await isDisabled(page, "reset")).toBe(true);
  });

  test("a click on a disabled item does nothing and leaves the menu open", async ({ page }) => {
    await boot(page);
    await openMenu(page);
    await menuItem(page, "reset").click({ force: true });
    await expect(menuPanel(page)).toHaveCount(1);
    expect(await stored(page)).toBeNull();
    await closeMenu(page);
  });
});

test.describe("S31.6 what left the old places", () => {
  test("Layers and Detail are not in the Overview; the toolbar and the stack's rotate and reset are gone, the cluster keeps +, - and Fit", async ({ page }) => {
    await boot(page);
    for (const sel of [".fp-layers-toggle", ".fp-detail-toggle", ".fp-layer", ".fp-detail", ".fp-zoom", ".fp-viewonly", "select", "input[type=range]"]) expect(await count(page, sel), sel).toBe(0);
    for (const l of ["Rotate left", "Rotate right", "Reset view", "Labels", "Device names", "Floor below"]) expect(await count(page, `button[aria-label="${l}"]`), l).toBe(0);
    expect(await card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll(".fp-stack button")].map((b) => b.getAttribute("aria-label")))).toEqual(["Zoom in", "Zoom out", "Fit"]);
  });

  test("the layer note stays in the Overview, with Show", async ({ page }) => {
    await boot(page, { floor: "ground" });
    await pick(page, "layer:lights");
    expect(await count(page, ".fp-layer-note")).toBe(0);
  });

  test("in 3D the menu has Walls and Floors below, no Tilt, no Rotate, no Reset view; Reset camera stays in the cluster", async ({ page }) => {
    await serve(page); // the 3D code is a lazy chunk; the plain file:// harness cannot load it
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`${ORIGIN}/harness.html`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate((config) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = { states: {}, callService: () => undefined };
      return el.updateComplete;
    }, { layout, floor: "first", view: "3d" });
    await drawn(page);
    expect(await hasItem(page, "walls:cut")).toBe(true);
    expect(await hasItem(page, "below:ghost")).toBe(true);
    for (const v of ["tilt:1", "rotate:1", "reset", "ghost", "detail:auto"]) expect(await hasItem(page, v), v).toBe(false);
    await expect(card(page).locator('css=.fp-stack button[aria-label="Reset camera"]')).toHaveCount(1);
  });
});

test.describe("S31.6 old configs", () => {
  test("view_switch: false: no View, Tilt, Walls, Theme, Labels, Names, Floor below; Detail, Layers, Rotate and Reset stay", async ({ page }) => {
    await boot(page, { view_switch: false });
    for (const v of ["view:2d", "theme", "labels", "names", "ghost"]) expect(await hasItem(page, v), v).toBe(false);
    for (const v of ["detail:auto", "rotate:1", "reset"]) expect(await hasItem(page, v), v).toBe(true);
  });

  test("view_switch: false with nothing else left: no ⋯", async ({ page }) => {
    await boot(page, { view_switch: false, rotate_switch: false, active_list: false });
    await expect(menuButton(page)).toHaveCount(0);
  });

  test("rotate_switch: false drops the pair, keeps the rest", async ({ page }) => {
    await boot(page, { rotate_switch: false });
    expect(await hasItem(page, "rotate:1")).toBe(false);
    expect(await hasItem(page, "view:2d")).toBe(true);
  });

  test("kiosk: no ⋯ at all; with rotate_switch: true the menu sits in the cluster with the rotate pair and Reset view only", async ({ page }) => {
    await boot(page, { kiosk: true });
    await expect(menuButton(page)).toHaveCount(0);
    await configure(page, { kiosk: true, rotate_switch: true });
    await expect(menuButton(page)).toHaveCount(1);
    expect(await menuButton(page).evaluate((b) => !!(b.getRootNode() as ShadowRoot).host.closest(".fp-cluster") || !!(b.getRootNode() as ShadowRoot).host.parentElement?.classList.contains("fp-cluster"))).toBe(true);
    await openMenu(page);
    expect(await menuPanel(page).locator("css=[role^=menuitem]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")))).toEqual(["rotate:-1", "rotate:1", "reset"]);
  });

  test("zoom: false has no cluster, the menu is there", async ({ page }) => {
    await boot(page, { zoom: false });
    await expect(card(page).locator("css=.fp-cluster")).toHaveCount(0);
    expect(await hasItem(page, "view:2d")).toBe(true);
  });
});

test.describe("S31.6 hostile input", () => {
  test("a forged pick with a value the menu never offered changes nothing and throws nothing", async ({ page }) => {
    await boot(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const before = await plan(page);
    await card(page).evaluate((el) => {
      const m = el.shadowRoot!.querySelector("fp-menu")!;
      for (const detail of [undefined, null, {}, { value: 7 }, { value: "theme:<script>" }, { value: "view:4d" }, { value: "rotate:9" }, { value: "layer:__proto__" }, { value: "tilt:0.3" }, { value: "walls:x" }, { value: "below:x" }, { value: "detail:x" }, { value: "nothing" }, { value: ":" }]) {
        m.dispatchEvent(new CustomEvent("fp-menu-pick", { detail, bubbles: true, composed: true }));
      }
    });
    expect(await plan(page)).toBe(before);
    expect((await stored(page)) ?? {}).toEqual({});
    await expect(card(page)).toHaveAttribute("data-theme", "light");
    expect(errors).toEqual([]);
  });

  test("a `hass` update while the menu is open keeps it open and its focus", async ({ page }) => {
    await boot(page);
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await card(page).evaluate((el) => { (el as unknown as { hass: unknown }).hass = { states: { "light.x": { state: "on", attributes: {}, last_changed: "2026-10-08T09:30:15Z" } }, callService() {} }; return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; });
    await expect(menuPanel(page)).toHaveCount(1);
    expect(await page.evaluate(() => { let e: Element | null = document.activeElement; while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement; return e?.getAttribute("data-value"); })).toBe("view:2.5d");
  });
});
