import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card } from "./helpers-3d";

// B52.2, Opus review CSS pairs (CLAUDE.md finding 10): the Overview's stylesheet travels with its chunk and is adopted onto the card's
// shadow root after the card's own sheets. A rule asserted as a string proves nothing about the cascade, so each pair here reads
// `getComputedStyle` in a real Chromium: the rule that must win, and the rule it must beat or the state it must not leak into.
// The first three are about specificity inside the chunk's sheet, the fourth about order against the card's touch rules (they sit
// before the chunk's sheet in the cascade only if the chunk's own touch block follows its base rules), the fifth about where the sheet is.

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({ "light.demo_living": st("on", { supported_color_modes: ["onoff"] }), "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }) });

async function boot(page: Page, width: number) {
  await serve(page);
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, width);
  await page.evaluate(([layout, states]) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout, floor: "ground", theme: "light" });
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [structuredClone(demo), STATES()] as const);
  await expect(card(page).locator("css=.fp-active")).toHaveCount(1);
}
/** Computed values of the first element matching `sel` in the card's shadow root. */
const css = (page: Page, sel: string, props: string[]) => page.evaluate(([sel, props]) => {
  const el = document.getElementById("card")!.shadowRoot!.querySelector(sel as string);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return Object.fromEntries((props as string[]).map((p) => [p, cs.getPropertyValue(p)]));
}, [sel, props] as const);

test("pair 1: .fp-active.fp-side beats the floating .fp-active (square, flat, behind), and the phone's .fp-bottom beats it the other way (round, raised)", async ({ page }) => {
  await boot(page, 900);
  expect(await css(page, ".fp-active.fp-side", ["border-top-left-radius", "box-shadow", "z-index", "border-right-width", "border-left-width", "position"])).toEqual({
    "border-top-left-radius": "0px", "box-shadow": "none", "z-index": "0", "border-right-width": "1px", "border-left-width": "0px", position: "absolute",
  });
  const phone = await page.context().newPage();
  await boot(phone, 400);
  const bottom = await css(phone, ".fp-active.fp-bottom", ["border-top-left-radius", "border-bottom-left-radius", "z-index", "border-top-width", "border-left-width", "height"]);
  expect(bottom).toEqual({ "border-top-left-radius": "12px", "border-bottom-left-radius": "0px", "z-index": "2", "border-top-width": "1px", "border-left-width": "0px", height: "64px" });
});

test("pair 2: a hovered row takes the grey wash, an unhovered one stays clear", async ({ page }) => {
  await boot(page, 900);
  const rows = card(page).locator("css=.fp-active-row");
  const clear = (await css(page, ".fp-active-row", ["background-color"]))!["background-color"];
  expect(clear).toBe("rgba(0, 0, 0, 0)");
  await rows.first().hover(); // a real mouse move to the row's centre
  const washed = (await css(page, ".fp-active-row:hover", ["background-color"]))!["background-color"];
  expect(washed).not.toBe(clear);
  expect(washed).not.toBe("rgba(0, 0, 0, 0)");
});

test("pair 3: the All floors chip is clear until pressed, then takes the ink as its fill", async ({ page }) => {
  await boot(page, 900);
  const before = (await css(page, ".fp-ov-scope", ["background-color", "color", "border-top-width"]))!;
  expect(before["background-color"]).toBe("rgba(0, 0, 0, 0)");
  expect(before["border-top-width"]).toBe("1px");
  await card(page).locator("css=.fp-ov-scope").click();
  await expect(card(page).locator('css=.fp-ov-scope[aria-pressed="true"]')).toHaveCount(1);
  const after = (await css(page, ".fp-ov-scope", ["background-color", "color"]))!;
  expect(after["background-color"], "pressed: the fill is the colour the text had").toBe(before.color);
  expect(after.color).not.toBe(before.color);
});

for (const touch of [false, true]) {
  test.describe(`pair 4: ${touch ? "coarse" : "fine"} pointer`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch });
    // Order against the card's touch rules: `.fp-sheet-top .fp-back` is 40 px in the Overview's base rules and 44 px under a coarse
    // pointer, both at the same specificity, so the touch block has to come after the base in the sheet that ends up last.
    test(`the sheet's Back button is ${touch ? 44 : 40} px high and a row has a minimum of ${touch ? 44 : 0} px`, async ({ page }) => {
      await boot(page, 390);
      const handle = card(page).locator("css=.fp-handle");
      if (touch) { const b = (await handle.boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } else await handle.click();
      await expect(card(page).locator('css=.fp-bottom[data-stop="half"]')).toHaveCount(1);
      const back = (await css(page, ".fp-sheet-top .fp-back", ["min-height", "min-width"]))!;
      expect(back).toEqual({ "min-height": touch ? "44px" : "40px", "min-width": touch ? "44px" : "40px" });
      const row = (await css(page, ".fp-active-row", ["min-height"]))!;
      expect(row["min-height"]).toBe(touch ? "44px" : "0px");
    });
  });
}

test("pair 5: the stylesheet is adopted after the card's own, and is not a <style> in the template", async ({ page }) => {
  await boot(page, 900);
  const sheets = await page.evaluate(() => {
    const root = document.getElementById("card")!.shadowRoot!;
    const text = (s: CSSStyleSheet) => [...s.cssRules].map((r) => r.cssText).join("\n");
    return {
      adopted: root.adoptedStyleSheets.map((s) => ({ overview: text(s).includes(".fp-active-row"), card: text(s).includes(".fp-head ") })),
      styleTags: [...root.querySelectorAll("style")].map((s) => s.textContent ?? ""),
    };
  });
  expect(sheets.adopted.length).toBeGreaterThan(1);
  const last = sheets.adopted[sheets.adopted.length - 1];
  expect(last.overview, "the last adopted sheet is the Overview's").toBe(true);
  expect(sheets.adopted.slice(0, -1).some((s) => s.overview), "no other sheet carries the Overview's rules").toBe(false);
  expect(sheets.adopted.some((s) => s.card), "the card's own rules are in an earlier sheet").toBe(true);
  expect(sheets.styleTags.filter((t) => t.includes(".fp-active-row")), "no <style> in the template").toEqual([]);
});
