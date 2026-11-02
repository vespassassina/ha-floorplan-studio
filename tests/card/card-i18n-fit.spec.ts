import { test, expect, type Page } from "@playwright/test";
import { card, demo, serve, ORIGIN } from "./helpers-3d";

// S37 review fix 4: a translated button text may be longer than the English one ("Turn off on this floor…" is "Auf diesem Stockwerk
// ausschalten…" in German). On a phone the button wraps to a second line and never cuts the text off. The review saw it cut off in
// de-4-menu.png and pl-2-overview.png; measured here at 390 to 200 px it is not (the "…" is part of the text), so this is a guard, not a fix. Measured, not matched: a button
// whose content is wider or taller than its box is clipped. Real touch taps open the sheet (finding 3).

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-08T09:30:15Z" });
const STATES = { "light.living_lamp": st("on"), "light.kitchen_spot": st("on"), "switch.living_relay": st("on") };

async function boot(page: Page, language: string, width: number) {
  await serve(page);
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate((w) => {
    const m = document.createElement("meta"); m.name = "viewport"; m.content = "width=device-width, initial-scale=1"; document.head.append(m);
    const wrap = document.getElementById("wrap")!; wrap.style.width = `${w}px`;
  }, width);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, lang, states]) => {
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states, language: lang, callService: () => undefined };
      return el.updateComplete;
    },
    [{ layout: structuredClone(demo), floor: "ground" }, language, STATES] as const,
  );
  await page.waitForTimeout(400);
}

/** Every button in the open sheet whose text does not fit its box: `scrollWidth > clientWidth` is a cut line, `scrollHeight > clientHeight` a cut row. */
const clipped = (page: Page) =>
  page.evaluate(() => {
    const root = document.getElementById("card")!.shadowRoot!;
    return [...root.querySelectorAll<HTMLElement>(".fp-active button")]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 || getComputedStyle(b).textOverflow === "ellipsis"
        || b.getBoundingClientRect().right > root.querySelector(".fp-active")!.getBoundingClientRect().right + 1)
      .map((b) => `${(b.textContent ?? "").trim()} (${b.scrollWidth}x${b.scrollHeight} in ${b.clientWidth}x${b.clientHeight})`);
  });

for (const [language, width] of [["de", 390], ["de", 320], ["de", 240], ["de", 200], ["pl", 390], ["pl", 320], ["pl", 240]] as const) {
  test(`${language} at ${width} px: no button in the overview sheet is clipped, and the long text wraps`, async ({ page }) => {
    await boot(page, language, width);
    await card(page).locator(".fp-handle").tap();
    await page.waitForTimeout(500);
    const off = card(page).locator("button.fp-floor-off");
    await expect(off).toBeVisible();
    expect(await clipped(page)).toEqual([]);
    if (width <= 240 && language === "de") {
      // Narrow enough that the long German text cannot stay on one line: it wraps to a second line instead of being cut.
      const lines = await off.evaluate((b) => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; });
      expect(lines, "the text wrapped to a second line").toBeGreaterThanOrEqual(2);
    }
  });
}

// The catalogues are written by hand and no native speaker has read them: a long word with no break must still stay inside the sheet.
test("a long unbroken word on the button stays inside the sheet", async ({ page }) => {
  await boot(page, "de", 320);
  await card(page).locator(".fp-handle").tap();
  await page.waitForTimeout(500);
  const off = card(page).locator("button.fp-floor-off");
  await expect(off).toBeVisible();
  await off.evaluate((b) => { b.textContent = "Stockwerkausschaltenbestätigungsdialog…"; });
  expect(await clipped(page)).toEqual([]);
});
