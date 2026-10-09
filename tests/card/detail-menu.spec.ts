import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S25.8: the card's Detail button beside Layers, and `detail:` in the card YAML. Real page.mouse (finding 3); the level
// is read off the live plan root; the viewer's choice goes through the real localStorage and a real reload.
// The shared harness pins `detail: full` for every other card test (tests/card/harness.html); these tests opt out of
// that so they see the real default, which is `auto`.

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function boot(page: Page, config: Record<string, unknown> = {}) {
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ cfg }) => {
    const el = document.getElementById("card") as any;
    el.setConfig(cfg);
    el.hass = { states: {}, callService: () => {} };
    await el.updateComplete;
  }, { cfg: { layout, theme: "light", ...config } });
}
async function open(page: Page, config: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript(() => { (window as any).__realDetailDefault = true; });
  await page.goto(URL_);
  await boot(page, config);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const level = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null);
async function clickOn(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return top && (top === t || t.contains(top)) ? { x, y } : null;
  }, sel);
  expect(p, `${sel} is the top element at its centre`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
}
const zoom = async (page: Page, label: "Zoom in" | "Zoom out", n: number) => { for (let i = 0; i < n; i++) await clickOn(page, `button[aria-label="${label}"]`); };
async function pick(page: Page, mode: "auto" | "full" | "minimal") {
  if ((await card(page).locator('css=button.fp-detail-toggle').getAttribute("aria-expanded")) !== "true") await clickOn(page, "button.fp-detail-toggle");
  await clickOn(page, `button.fp-detail[data-detail="${mode}"]`);
}

test("a Detail button sits beside Layers and unfolds Auto, Full and Minimal; the active one is pressed", async ({ page }) => {
  await open(page);
  const scopes = card(page).locator("css=.fp-ov-scopes");
  expect(await scopes.evaluate((el) => [...el.querySelectorAll("button")].map((b) => b.className.split(" ")[0]))).toEqual(expect.arrayContaining(["fp-layers-toggle", "fp-detail-toggle"]));
  await expect(card(page).locator("css=button.fp-detail")).toHaveCount(0);
  await clickOn(page, "button.fp-detail-toggle");
  expect(await card(page).locator("css=button.fp-detail").evaluateAll((els) => els.map((e) => e.getAttribute("data-detail")))).toEqual(["auto", "full", "minimal"]);
  await expect(card(page).locator('css=button.fp-detail[data-detail="auto"]')).toHaveAttribute("aria-pressed", "true");
  await pick(page, "minimal");
  await expect(card(page).locator('css=button.fp-detail[data-detail="minimal"]')).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).locator('css=button.fp-detail[data-detail="auto"]')).toHaveAttribute("aria-pressed", "false");
});

test("no YAML key and no stored choice: auto. Fit is far; zooming in goes to near; the choices pin or free it", async ({ page }) => {
  await open(page);
  expect(await level(page)).toBe("far");
  await zoom(page, "Zoom in", 12);
  expect(await level(page)).toBe("near");
  await pick(page, "minimal");
  expect(await level(page), "minimal stays far when zoomed in").toBe("far");
  await zoom(page, "Zoom out", 12);
  await pick(page, "full");
  expect(await level(page), "full is near at fit").toBe("near");
  await pick(page, "auto");
  expect(await level(page)).toBe("far");
});

test("the viewer's choice survives a reload", async ({ page }) => {
  await open(page);
  await pick(page, "full");
  await page.reload();
  await boot(page);
  expect(await level(page)).toBe("near");
  await clickOn(page, "button.fp-detail-toggle");
  await expect(card(page).locator('css=button.fp-detail[data-detail="full"]')).toHaveAttribute("aria-pressed", "true");
});

test("YAML detail is the card's default; junk falls back to auto and does not throw", async ({ page }) => {
  await open(page, { detail: "full" });
  expect(await level(page)).toBe("near");
  await page.reload();
  await boot(page, { detail: "minimal" });
  await zoom(page, "Zoom in", 12);
  expect(await level(page), "minimal from YAML pins far").toBe("far");
  for (const junk of ["<b>", 7, null, {}, ["full"], "FULL"]) {
    await page.evaluate(() => { document.getElementById("card")!.remove(); localStorage.clear(); }); // the zoom above is remembered too, and a card writes its memory as it leaves
    await page.reload();
    await boot(page, { detail: junk as unknown });
    expect(await level(page), `junk ${JSON.stringify(junk)} reads as auto`).toBe("far");
  }
});

test("a stored viewer choice beats the YAML default", async ({ page }) => {
  await open(page, { detail: "full" });
  expect(await level(page)).toBe("near");
  await pick(page, "minimal");
  await page.reload();
  await boot(page, { detail: "full" });
  expect(await level(page)).toBe("far");
});

test("storage that throws: the card renders and the choice holds for the session", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  await open(page);
  expect(await level(page)).toBe("far");
  await pick(page, "full");
  expect(await level(page)).toBe("near");
});
