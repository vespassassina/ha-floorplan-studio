import { test, expect, type Page } from "@playwright/test";
import { card, demo, serve, ORIGIN } from "./helpers-3d";

// S37.5 (docs/DECISIONS.md, 2026-10-25): the card speaks `hass.language`. These tests drive the built card (dist-test/, served the way
// Home Assistant serves it, language chunks beside it) with real mouse clicks on real buttons. The unit tests cover the lookup
// (tests/card/i18n.test.ts) and the catalogues (tests/card/i18n-catalogue.test.ts); here the words must reach a pixel.

const STATES = { "light.living_lamp": { state: "on", attributes: {}, last_changed: "2026-10-08T09:30:15Z" } };

/** `routes` run after `serve`: a later route wins over an earlier one, so a test that fakes a language file must register it second. */
async function boot(page: Page, language: string | undefined, config: Record<string, unknown> = {}, routes?: () => Promise<unknown>) {
  const seen = await serve(page);
  await routes?.();
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, lang, states]) => {
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      // The hass fields the card reads: `language` is HA's own (a frontend's `hass.language`, "it", "pt-BR", "zh-Hans").
      el.hass = { states, language: lang, callService: () => undefined };
      return el.updateComplete;
    },
    [{ layout: structuredClone(demo), floor: "ground", ...config }, language, STATES] as const,
  );
  return seen;
}
/** A hass update, as Home Assistant makes one: a new object, the same states, maybe another language. */
const setHass = (page: Page, language: string | undefined) =>
  page.evaluate(
    ([lang, states]) => {
      const el = document.getElementById("card") as unknown as HTMLElement & { hass: unknown; updateComplete: Promise<unknown> };
      el.hass = { states, language: lang, callService: () => undefined };
      return el.updateComplete;
    },
    [language, STATES] as const,
  );
const zoomIn = (page: Page, name: string) => card(page).locator(`button[aria-label="${name}"]`);
const viewBox = (page: Page) => card(page).locator("svg.fp-zoomable").getAttribute("viewBox");
// The hash can hold a "-" (lang-zh-Hans-Bx-Ev8AR.js), so the code is one of the known shapes, not whatever precedes the hash.
const langRequests = (seen: string[]) => seen.filter((u) => /floorplan-studio-lang-[\w-]+\.js/.test(u)).map((u) => /lang-(pt-BR|zh-Hans|[a-z]{2})-[\w-]{6,}\.js/.exec(u)![1]);

test.describe("S37.5 the card in the user's language", () => {
  test("English loads no language file and reads English", async ({ page }) => {
    const seen = await boot(page, "en");
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    expect(langRequests(seen)).toEqual([]);
  });

  test("hass.language it: a real button reads Italian, and the click on it zooms", async ({ page }) => {
    const seen = await boot(page, "it");
    await expect(zoomIn(page, "Ingrandisci")).toBeVisible();
    await expect(zoomIn(page, "Zoom in")).toHaveCount(0);
    expect(langRequests(seen)).toEqual(["it"]);
    const before = await viewBox(page);
    await zoomIn(page, "Ingrandisci").click();
    expect(await viewBox(page), "the Italian button is the real zoom button").not.toBe(before);
    await expect(card(page).locator("button", { hasText: "Cerca" }).first()).toBeVisible();
  });

  test("a hass update that changes the language to German re-renders in German and keeps zoom, selection and the layout", async ({ page }) => {
    await boot(page, "it");
    await expect(zoomIn(page, "Ingrandisci")).toBeVisible();
    await zoomIn(page, "Ingrandisci").click();
    // A real click where the room is the top element (finding 3): a device icon or the header may cover its centre or corner.
    const at = await page.evaluate(() => {
      const root = document.getElementById("card")!.shadowRoot!, room = root.querySelector('svg polygon[data-r="0"]')!, r = room.getBoundingClientRect();
      for (let a = 1; a < 20; a++) for (let b = 1; b < 20; b++) {
        const x = r.x + (r.width * a) / 20, y = r.y + (r.height * b) / 20;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (root.elementFromPoint(x, y) === room) return { x, y };
      }
      return null;
    });
    expect(at, "a point on the room that is not covered").not.toBeNull();
    await page.mouse.click(at!.x, at!.y);
    await expect(card(page).locator("svg polygon.room-picked")).toHaveCount(1);
    const keep = await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { _layout: unknown };
      (window as unknown as { __layout: unknown }).__layout = el._layout;
      return null;
    });
    expect(keep).toBeNull();
    const view = await viewBox(page);
    await expect(card(page).locator(`button[aria-label="Indietro"]`)).toBeVisible();

    await setHass(page, "de");
    await expect(zoomIn(page, "Vergrößern")).toBeVisible();
    await expect(zoomIn(page, "Ingrandisci")).toHaveCount(0);
    await expect(card(page).locator(`button[aria-label="Zurück"]`)).toBeVisible();
    await expect(card(page).locator("button", { hasText: "Alle anzeigen" })).toBeVisible();
    expect(await viewBox(page), "zoom survives the language change").toBe(view);
    await expect(card(page).locator("svg polygon.room-picked"), "the room is still selected").toHaveCount(1);
    expect(await page.evaluate(() => (document.getElementById("card") as unknown as { _layout: unknown })._layout === (window as unknown as { __layout: unknown }).__layout), "the layout object was not replaced").toBe(true);

    // And back to English: no file, at once.
    await setHass(page, "en");
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    expect(await viewBox(page)).toBe(view);
  });

  test("the exact code before the base: pt-BR loads its own file, pt-PT the pt file", async ({ page }) => {
    const seen = await boot(page, "pt-BR");
    await expect(zoomIn(page, "Ampliar")).toBeVisible();
    await setHass(page, "pt-PT");
    await expect(zoomIn(page, "Ampliar")).toBeVisible();
    expect(langRequests(seen)).toEqual(["pt-BR", "pt"]);
  });

  test("zh-Hans is Chinese; zh-Hant has no file yet and reads English, and loads none", async ({ page }) => {
    const seen = await boot(page, "zh-Hans");
    await expect(zoomIn(page, "放大")).toBeVisible();
    await setHass(page, "zh-Hant");
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    expect(langRequests(seen)).toEqual(["zh-Hans"]);
  });

  test("a language with no file, and an unknown one, read English", async ({ page }) => {
    const seen = await boot(page, "sv");
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    await setHass(page, "xx-YY");
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    expect(langRequests(seen)).toEqual([]);
  });

  test("a failed language file leaves the card in English and working", async ({ page }) => {
    await boot(page, "it", {}, () => page.route(/floorplan-studio-lang-it-/, (r) => r.fulfill({ status: 503, body: "" })));
    await expect(zoomIn(page, "Zoom in")).toBeVisible();
    const before = await viewBox(page);
    await zoomIn(page, "Zoom in").click();
    expect(await viewBox(page)).not.toBe(before);
  });

  // Finding 2: a translation is text, never markup. A catalogue that carries a tag and a script must show them as letters.
  test("a translation holding <b> or a script renders as text, not as markup", async ({ page }) => {
    const hostile = { Search: "<b>Cerca</b>", "Zoom in": '"><script>window.__xss=1</script>', "Show all": "<img src=x onerror=window.__xss=2>" };
    await boot(page, "it", {}, () => page.route(/floorplan-studio-lang-it-/, (r) => r.fulfill({ contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: `export default ${JSON.stringify(hostile)};` })));
    const zoom = card(page).locator('button[title*="script"]');
    await expect(zoom).toHaveCount(1);
    expect(await zoom.getAttribute("aria-label")).toBe(hostile["Zoom in"]);
    const text = await card(page).evaluate((host) => host.shadowRoot!.textContent!);
    expect(text).toContain("<b>Cerca</b>");
    // (The card has an empty <b> of its own; what must not exist is one that holds the translation.)
    expect(await card(page).evaluate((host) => [...host.shadowRoot!.querySelectorAll("b, img[src='x'], script")].filter((e) => e.tagName !== "B" || e.textContent === "Cerca").length), "no element came out of a translation").toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});
