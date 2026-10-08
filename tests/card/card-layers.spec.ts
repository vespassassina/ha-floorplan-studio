import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S24.8 (layers): the card's layer chips on the stress house (ground: 182 devices, 75 of them lights, 39 pieces). Real
// page.mouse and page.keyboard only (finding 3); the memory goes through the real localStorage and a real reload.

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const GROUND_LIGHTS = 75, GROUND_DEVICES = 182, GROUND_PIECES = 39;

async function open(page: Page, size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}
async function configure(page: Page, config: Record<string, unknown> = {}, clear = true) {
  await page.evaluate(
    ([cfg, clear]) => {
      if (clear) try { localStorage.clear(); } catch { /* no storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: {}, callService: () => {} };
      return el.updateComplete;
    },
    [{ layout, theme: "light", ...config }, clear] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const chip = (page: Page, id: string) => card(page).locator(`css=.fp-ov-layers button.fp-layer[data-layer="${id}"]`);
const count = (page: Page, sel: string) => card(page).evaluate((el, sel) => el.shadowRoot!.querySelectorAll(sel).length, sel);
const pills = (page: Page) => card(page).locator("css=.fp-floors button");

/** Clicks `sel` where it is the real top element. */
async function clickOn(page: Page, sel: string, alt = false) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return top && (top === t || t.contains(top)) ? { x, y } : null;
  }, sel);
  expect(p, `${sel} is the top element at its centre`).not.toBeNull();
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.click(p!.x, p!.y);
  if (alt) await page.keyboard.up("Alt");
}
const layerChip = (id: string) => `.fp-ov-layers button.fp-layer[data-layer="${id}"]`;
/** The chips fold under the Layers button; a real click on it unfolds them. */
const toggle = (page: Page) => card(page).locator("css=.fp-ov-scopes button.fp-layers-toggle");
async function openLayers(page: Page) {
  await clickOn(page, ".fp-ov-scopes button.fp-layers-toggle");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
}

test.describe("S24.8 layer chips in the card", () => {
  test("one chip per family on the floor on show; a click hides that family's icons and only them", async ({ page }) => {
    await open(page);
    const noCovers = structuredClone(layout);
    noCovers.floors.ground.devices = noCovers.floors.ground.devices.filter((d: { type: string }) => d.type !== "cover");
    await configure(page, { layout: noCovers });
    // Folded by default: the sheet covers no more of the plan; the summary says nothing is hidden.
    await expect(toggle(page)).toHaveText("Layers");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(chip(page, "lights")).toHaveCount(0);
    await openLayers(page);
    const ids = await card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll(".fp-ov-layers button.fp-layer")].map((b) => b.getAttribute("data-layer")));
    expect(ids).toEqual(["lights", "climate", "security", "media", "power", "computing", "sensors", "people", "other", "furniture"]);
    await expect(chip(page, "lights")).toHaveText("Lights");
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "true");
    const all = await count(page, "svg g[data-x]");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(GROUND_LIGHTS);
    await clickOn(page, layerChip("lights"));
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page)).toHaveText("Layers · 1 hidden");
    await expect(toggle(page)).toHaveAttribute("title", "Layers: lights hidden");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(0);
    await expect.poll(() => count(page, "svg g[data-x]")).toBe(all - GROUND_LIGHTS);
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(GROUND_PIECES);
    await clickOn(page, layerChip("furniture"));
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(0);
    await clickOn(page, layerChip("lights"));
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(GROUND_LIGHTS);
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(0);
  });

  test("Alt-click shows one family alone; Alt-click on it again shows all", async ({ page }) => {
    await open(page);
    await configure(page);
    await openLayers(page);
    await expect.poll(() => count(page, "svg g[data-x]")).toBe(GROUND_DEVICES);
    await clickOn(page, layerChip("lights"), true);
    await expect.poll(() => count(page, "svg g[data-x]")).toBe(GROUND_LIGHTS);
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(GROUND_LIGHTS);
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(0);
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "power")).toHaveAttribute("aria-pressed", "false");
    await clickOn(page, layerChip("lights"), true);
    await expect.poll(() => count(page, "svg g[data-x]")).toBe(GROUND_DEVICES);
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(GROUND_PIECES);
  });

  test("the hidden families are this viewer's: they survive a reload and hold on every floor", async ({ page }) => {
    await open(page);
    await configure(page);
    await openLayers(page);
    await clickOn(page, layerChip("lights"));
    await clickOn(page, layerChip("furniture"));
    await page.reload();
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, {}, false);
    await expect(toggle(page)).toHaveText("Layers · 2 hidden");
    await openLayers(page);
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "furniture")).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "power")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(0);
    await expect.poll(() => count(page, "svg g[data-f]")).toBe(0);
    await pills(page).nth(1).click();
    await expect(pills(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(0);
    await expect.poll(() => count(page, "svg g[data-x]")).toBeGreaterThan(0);
  });

  test("search does not follow layers: a located hidden lamp is drawn alone, with a note and Show", async ({ page }) => {
    await open(page);
    await configure(page);
    await openLayers(page);
    await clickOn(page, layerChip("lights"));
    const b = (await card(page).locator("css=svg.fp-zoomable").boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6);
    await page.keyboard.press("/");
    await page.keyboard.type("bedside guest");
    await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Guest bedroom bedside left");
    await page.keyboard.press("Enter");
    await expect(pills(page).nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, 'svg g.dev-light[data-x="3"]')).toBe(1);
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(1);
    const note = card(page).locator("css=.fp-layer-note");
    await expect(note).toContainText("Hidden by Layers: lights");
    await page.keyboard.press("Escape"); // the popup goes; the note stays with the kept lamp
    await clickOn(page, ".fp-layer-note button");
    await expect(note).toHaveCount(0);
    await expect(chip(page, "lights")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, "svg g.dev-light")).toBeGreaterThan(1);
  });

  test("a kept lamp goes when another floor is shown or the layers change", async ({ page }) => {
    await open(page);
    await configure(page);
    await openLayers(page);
    await clickOn(page, layerChip("lights"));
    const find = async () => {
      const b = (await card(page).locator("css=svg.fp-zoomable").boundingBox())!;
      await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6);
      await page.keyboard.press("/");
      await page.keyboard.type("bedside guest");
      await expect(card(page).locator("css=fp-search").locator('css=[role="option"]').first()).toContainText("Guest bedroom bedside left");
      await page.keyboard.press("Enter");
      await expect(pills(page).nth(2)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => count(page, "svg g.dev-light")).toBe(1);
      await page.keyboard.press("Escape");
    };
    await find();
    await pills(page).nth(0).click();
    await pills(page).nth(2).click();
    await expect(pills(page).nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(0);
    await expect(card(page).locator("css=.fp-layer-note")).toHaveCount(0);
    await find();
    await clickOn(page, layerChip("power"));
    await expect.poll(() => count(page, "svg g.dev-light")).toBe(0);
    await expect(card(page).locator("css=.fp-layer-note")).toHaveCount(0);
  });
});
