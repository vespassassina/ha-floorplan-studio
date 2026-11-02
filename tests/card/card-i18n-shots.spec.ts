import { test, type Page } from "@playwright/test";
import { card, demo, serve, ORIGIN } from "./helpers-3d";

// S37.5: screenshots of the card in four languages, to be looked at (finding 16: a green suite does not say a long word fits).
// Not a check: it runs only with I18N_SHOTS=<dir> and writes PNGs there. Phone size, the bottom sheet, the room panel and the View menu.

const DIR = process.env.I18N_SHOTS;
test.skip(!DIR, "set I18N_SHOTS=<dir> to write the screenshots");
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-08T09:30:15Z" });
const STATES = { "light.living_lamp": st("on"), "light.kitchen_spot": st("on"), "switch.living_relay": st("on") };

async function boot(page: Page, language: string) {
  await serve(page);
  await page.goto(`${ORIGIN}/harness.html`);
  // A mobile browser lays a page out 980 px wide unless it has a viewport meta (touch-helpers.ts does the same).
  await page.evaluate(() => { const m = document.createElement("meta"); m.name = "viewport"; m.content = "width=device-width, initial-scale=1"; document.head.append(m); document.getElementById("wrap")!.style.width = "100%"; });
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

for (const language of ["it", "de", "zh-Hans", "pl"]) {
  test(`shots ${language}`, async ({ page }) => {
    await boot(page, language);
    await page.screenshot({ path: `${DIR}/${language}-1-peek.png` });
    await card(page).locator(".fp-handle").tap();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/${language}-2-overview.png` });
    const at = await page.evaluate(() => {
      const root = document.getElementById("card")!.shadowRoot!, room = root.querySelector('svg polygon[data-r="0"]')!, r = room.getBoundingClientRect();
      for (let a = 1; a < 20; a++) for (let b = 1; b < 20; b++) { const x = r.x + (r.width * a) / 20, y = r.y + (r.height * b) / 20; if (y < innerHeight * 0.45 && root.elementFromPoint(x, y) === room) return { x, y }; }
      return null;
    });
    if (at) { await page.touchscreen.tap(at.x, at.y); await page.waitForTimeout(600); }
    await page.screenshot({ path: `${DIR}/${language}-3-room.png` });
    await card(page).locator('button[aria-haspopup], button[aria-label]').first().tap();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/${language}-4-menu.png` });
  });
}
