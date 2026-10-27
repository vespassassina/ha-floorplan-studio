// S38.0: the card's Edit-card form is a file of its own beside the card (floorplan-studio-form-<hash>.js), fetched by import() from
// getConfigElement(). A relative import cannot be made from a script injected into a file:// page (Chromium refuses a module fetch
// between two file:// URLs), so the specs that open the form serve dist/ over http, the way Home Assistant does.
// The path and the query copy HACS: the card is `/hacsfiles/floorplan_studio/floorplan-studio-card.js?hacstag=...`, and the form must be
// found beside it whatever the query is, because a relative specifier drops it.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const ORIGIN = "http://fp.test";
const BASE = "/hacsfiles/floorplan_studio/";

/** Opens the (empty) config-editor harness page on http and loads the built card from `/hacsfiles/floorplan_studio/`. Returns the URLs asked for. */
export async function loadCard(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith(ORIGIN)) seen.push(r.url()); });
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/harness.html") return route.fulfill({ body: readFileSync(resolve("tests/card/config-editor-harness.html")), contentType: "text/html" });
    const name = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : "";
    const file = resolve("dist", name);
    if (!/^[\w.-]+\.js$/.test(name) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ body: readFileSync(file), contentType: "text/javascript" });
  });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.addScriptTag({ url: `${ORIGIN}${BASE}floorplan-studio-card.js?hacstag=1234567890`, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  return seen;
}
