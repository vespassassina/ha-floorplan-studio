import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Shared by the 3D card specs: the built card served the way Home Assistant serves it, and a few locators.

export const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
// dist-test/ is the card built with the 3D test hook (scripts/build.mjs, FP_TEST_BUILD=1); the shipped www/ has none. The files are the same otherwise.
export const WWW = resolve("dist-test");
export const ORIGIN = "http://fp.test";
const MIME: Record<string, string> = { ".js": "text/javascript", ".html": "text/html" };

/** Everything the page asked for, so a test can say what was and was not fetched. */
export async function serve(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith("data:") && !r.url().startsWith("blob:")) seen.push(r.url()); });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort(); // a request to any other origin is recorded above, then refused
    if (url.pathname === "/harness.html") return route.fulfill({ body: readFileSync(resolve("tests/card/harness-static.html")), contentType: "text/html" });
    const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname);
    const file = m && resolve(WWW, m[1]);
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ body: readFileSync(file), contentType: MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
  });
  return seen;
}

export async function open(page: Page, config: Record<string, unknown> = { layout: structuredClone(demo), floor: "ground" }) {
  const seen = await serve(page);
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, config);
  return seen;
}
export async function configure(page: Page, config: Record<string, unknown>) {
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, config);
}


export const card = (page: Page) => page.locator("floorplan-studio-card");
export const viewSelect = (page: Page) => card(page).locator('css=select[aria-label="View"]');
export const canvas = (page: Page) => card(page).locator("css=canvas");
export const holder = (page: Page) => card(page).locator("css=.fp-3d");
export const cam = (page: Page) => holder(page).evaluate((el) => ({ az: +el.dataset.az!, polar: +el.dataset.polar!, dist: +el.dataset.dist!, target: el.dataset.target!, drawn: +(el.dataset.drawn ?? 0) }));
/** Waits until the canvas has drawn at least `n` frames. */
export const drawn = (page: Page, n = 1) => expect.poll(async () => (await cam(page)).drawn, { timeout: 15000 }).toBeGreaterThanOrEqual(n);
