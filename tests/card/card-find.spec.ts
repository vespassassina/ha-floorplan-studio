import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S24.8 (F1, C2): the card's search and "Turn off on this floor…", on the stress house (three floors, 437 devices). Real
// page.mouse and page.keyboard only (finding 3). The hass stub has the shape Home Assistant's frontend gives a card: `states`
// keyed by entity id, and `callService(domain, service, data)`, the call the card already makes for All off (finding 21).

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
// Ground: two lamps on (one lit only by its relay), a wall switch, the kettle plug, the TV and the kitchen speaker on; the
// Apple TV in standby (off for this list) and a spot unavailable (neither on nor off: not listed).
const STATES = () => ({
  "light.kitchen_spot_1": st("on"),
  "light.living_floor_lamp": st("off", { friendly_name: "Living floor lamp" }), "switch.living_relay_1": st("on", { friendly_name: "Living relay 1" }),
  "switch.living_wall_switch": st("on"), "switch.kitchen_kettle_plug": st("on"),
  "media_player.living_tv": st("on"), "media_player.kitchen_echo": st("playing"), "media_player.living_apple_tv": st("standby"),
  "light.living_spot_1": st("unavailable"),
  "light.study_desk_lamp": st("on"), "light.guest_bedroom_bedside_left": st("off"),
});

async function boot(page: Page, config: Record<string, unknown> = {}, size = { width: 1280, height: 900 }, states: Record<string, unknown> = STATES()) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const w = window as unknown as { __calls: unknown[] };
      w.__calls = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, callService: (domain: string, service: string, data: unknown) => { w.__calls.push([domain, service, data]); } };
      return el.updateComplete;
    },
    [{ layout, theme: "light", ...config }, states] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const pills = (page: Page) => card(page).locator("css=.fp-floors button");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
/** What has focus inside the card: the element under its shadow root, and that element's own focused child. */
const focused = (page: Page) => card(page).evaluate((el) => {
  const a = el.shadowRoot!.activeElement;
  return a ? `${a.tagName.toLowerCase()}${a.shadowRoot?.activeElement ? `>${a.shadowRoot.activeElement.tagName.toLowerCase()}` : ""}` : null;
});

/** A point on `sel` (inside the card's shadow root, scrolled into view) where it, or a descendant, is the real top element. */
async function topPoint(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
      const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8, top = el.shadowRoot!.elementFromPoint(x, y);
      if (top && (top === t || t.contains(top) || top.getRootNode() === (t as Element).shadowRoot)) return { x, y };
    }
    return null;
  }, sel);
  expect(p, `${sel} is the top element somewhere on its box`).not.toBeNull();
  return p!;
}
const clickOn = async (page: Page, sel: string) => { const p = await topPoint(page, sel); await page.mouse.click(p.x, p.y); };
/** The pointer rests on the plan, so the card owns the keys (as in Home Assistant: hovered or focused). */
const hover = async (page: Page) => { const b = (await card(page).locator("css=svg.fp-zoomable").boundingBox())!; await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6); };

test.describe("S24.8 search in the card", () => {
  test("on the stress house: /, letters, Enter opens the popup of the right device on its floor", async ({ page }) => {
    await boot(page);
    await expect(pills(page).nth(0)).toHaveAttribute("aria-pressed", "true");
    await hover(page);
    await page.keyboard.press("/");
    expect(await focused(page)).toBe("fp-search>input");
    await page.keyboard.type("bedside guest");
    await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Guest bedroom bedside left");
    await page.keyboard.press("Enter");
    await expect(pills(page).nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(pop(page)).toHaveAttribute("aria-label", "Guest bedroom bedside left");
    // Located like a row tap: zoomed, the lamp near the middle, the ring on its icon.
    await expect(card(page).locator("css=svg.fp-zoomed")).toHaveCount(1);
    const at = await card(page).evaluate((el) => {
      const svg = el.shadowRoot!.querySelector("svg.fp-zoomable")!.getBoundingClientRect();
      const g = el.shadowRoot!.querySelector('svg g[data-x="3"]')!.getBoundingClientRect();
      const ring = el.shadowRoot!.querySelector<HTMLElement>(".fp-pulse");
      const r = ring && !ring.hidden ? ring.getBoundingClientRect() : null;
      return { dx: (g.x + g.width / 2 - (svg.x + svg.width / 2)) / svg.width, dy: (g.y + g.height / 2 - (svg.y + svg.height / 2)) / svg.height, ring: r && Math.hypot(r.x + r.width / 2 - (g.x + g.width / 2), r.y + r.height / 2 - (g.y + g.height / 2)) };
    });
    expect(Math.abs(at.dx)).toBeLessThan(0.1);
    expect(Math.abs(at.dy)).toBeLessThan(0.1);
    expect(at.ring).not.toBeNull();
    expect(at.ring!).toBeLessThan(4);
    // The popup stands beside the sheet, not over the search box or the rows.
    const boxes = await card(page).evaluate((el) => {
      const p = el.shadowRoot!.querySelector(".fp-pop")!.getBoundingClientRect(), s = el.shadowRoot!.querySelector(".fp-active")!.getBoundingClientRect();
      return { popLeft: p.left, sheetRight: s.right };
    });
    expect(boxes.popLeft).toBeGreaterThanOrEqual(boxes.sheetRight);
  });

  test("Ctrl+K on a folded phone sheet unfolds it and focuses the search; Enter on a linked TV piece opens it too", async ({ page }) => {
    await boot(page, {}, { width: 390, height: 844 });
    await expect(card(page).locator("css=.fp-active-collapse")).toHaveAttribute("aria-expanded", "false");
    await hover(page);
    await page.keyboard.press("Control+k");
    await expect(card(page).locator("css=.fp-active-collapse")).toHaveAttribute("aria-expanded", "true");
    expect(await focused(page)).toBe("fp-search>input");
    await page.keyboard.type("kitchen echo");
    await page.keyboard.press("Enter");
    await expect(pop(page)).toHaveAttribute("aria-label", "Kitchen Echo");
  });

  test("/ typed in a text field elsewhere is a slash, not the search", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "other"; document.body.prepend(i); i.focus(); });
    await hover(page);
    await page.keyboard.press("/");
    expect(await page.inputValue("#other")).toBe("/");
    expect(await focused(page)).toBeNull();
    await page.evaluate(() => (document.getElementById("other") as HTMLInputElement).blur());
    await page.keyboard.press("/"); // out of the field, the same key is the search
    expect(await focused(page)).toBe("fp-search>input");
    expect(await page.inputValue("#other")).toBe("/");
  });

  test("a card that is neither focused nor hovered leaves / alone", async ({ page }) => {
    await boot(page);
    await page.mouse.move(2, 2); // the page's margin, outside the card
    await page.keyboard.press("/");
    expect(await focused(page)).toBeNull();
    await hover(page);
    await page.keyboard.press("/");
    expect(await focused(page)).toBe("fp-search>input");
  });

  test("Enter on a room shows its floor and opens the room; on a floor, switches to it", async ({ page }) => {
    await boot(page);
    await hover(page);
    await page.keyboard.press("/");
    await page.keyboard.type("library");
    await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Library");
    await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Second · Room");
    await page.keyboard.press("Enter");
    await expect(pills(page).nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(card(page).locator("css=.fp-room-name")).toHaveText("Library");
    expect(await focused(page)).toBe("button"); // the room's clear button: the keyboard is still in the card
    await page.keyboard.press("Escape"); // clears the room
    await expect(card(page).locator("css=.fp-room-name")).toHaveCount(0);
    await page.keyboard.press("/");
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await expect(pills(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("S24.8 Turn off on this floor", () => {
  test("the checklist lists what is on by group, all ticked, and sends exactly the calls ticked", async ({ page }) => {
    await boot(page);
    await clickOn(page, ".fp-floor-off");
    const dialog = card(page).locator("css=.fp-off-dialog");
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog.locator("css=#fp-off-title")).toHaveText("Turn off on Ground");
    await expect(dialog.locator("css=legend")).toHaveText(["Lights · 2", "Switches · 1", "Plugs · 1", "Media · 2"]);
    const names = await dialog.locator("css=.fp-off-row").evaluateAll((els) => els.map((e) => e.textContent!.replace(/\s+/g, " ").trim()));
    expect(names).toEqual(["Living floor lamp with Living relay 1", "Kitchen spot 1", "Living wall switch", "Kitchen kettle plug", "Living TV", "Kitchen Echo"]);
    expect(await dialog.locator("css=input[type=checkbox]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked))).toEqual([true, true, true, true, true, true]);
    await expect(dialog.locator("css=button.confirm")).toHaveText("Turn off 6");
    // Untick the kettle and the TV.
    await clickOn(page, '.fp-off-row[data-entity="switch.kitchen_kettle_plug"] input');
    await clickOn(page, '.fp-off-row[data-entity="media_player.living_tv"] input');
    await expect(dialog.locator("css=button.confirm")).toHaveText("Turn off 4");
    expect(await calls(page)).toEqual([]);
    await clickOn(page, ".fp-off-dialog button.confirm");
    await expect(dialog).toHaveCount(0);
    expect(await calls(page)).toEqual([
      ["light", "turn_off", { entity_id: ["light.kitchen_spot_1"] }],
      ["switch", "turn_off", { entity_id: ["switch.living_relay_1", "switch.living_wall_switch"] }],
      ["media_player", "turn_off", { entity_id: ["media_player.kitchen_echo"] }],
    ]);
  });

  test("Cancel and Escape send nothing; nothing ticked cannot confirm", async ({ page }) => {
    await boot(page);
    await clickOn(page, ".fp-floor-off");
    expect(await focused(page)).toBe("button"); // Cancel, as the other dialogs
    await page.keyboard.press("Escape");
    await expect(card(page).locator("css=.fp-off-dialog")).toHaveCount(0);
    await clickOn(page, ".fp-floor-off");
    for (const e of ["light.kitchen_spot_1", "light.living_floor_lamp", "switch.living_wall_switch", "switch.kitchen_kettle_plug", "media_player.living_tv", "media_player.kitchen_echo"]) {
      await clickOn(page, `.fp-off-row[data-entity="${e}"] input`);
    }
    await expect(card(page).locator("css=.fp-off-dialog button.confirm")).toBeDisabled();
    await clickOn(page, ".fp-off-dialog button.cancel");
    await expect(card(page).locator("css=.fp-off-dialog")).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("a floor with nothing on offers the entry disabled and says why", async ({ page }) => {
    await boot(page, {}, undefined, { "light.kitchen_spot_1": st("off"), "media_player.living_tv": st("standby") });
    const b = card(page).locator("css=.fp-floor-off");
    await expect(b).toBeDisabled();
    await expect(b).toHaveAttribute("title", "Nothing is on on this floor");
  });

  test("the floor's panel has the entry too, beside Lights off", async ({ page }) => {
    await boot(page);
    await clickOn(page, ".fp-floors button");
    await expect(card(page).locator("css=.fp-room .fp-alloff")).toHaveText("Lights off");
    await clickOn(page, ".fp-room .fp-floor-off");
    await expect(card(page).locator("css=.fp-off-dialog #fp-off-title")).toHaveText("Turn off on Ground");
  });
});
