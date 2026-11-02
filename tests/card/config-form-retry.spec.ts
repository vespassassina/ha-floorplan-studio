import { test, expect, type Page } from "@playwright/test";
import { loadCard } from "./form-harness";

// Review of Sprint 38, item 2: Chromium remembers a failed import() of one URL, so one failed request for the Edit-card form used to
// break Edit card until the page was reloaded. getConfigElement() now asks again under a new query (as loadLib3d does) and, when the
// file stays unreachable, resolves to a small element with the stale-page words instead of rejecting.
const STALE = "Floorplan Studio was updated. Reload this page.";
const FORM = /\/floorplan-studio-form-[\w-]+\.js(\?.*)?$/;

const ask = (page: Page) => page.evaluate(async () => {
  const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): Promise<HTMLElement> };
  try {
    const el = await Ctor.getConfigElement();
    return { tag: el.localName, text: el.textContent ?? "" };
  } catch (e) { return { rejected: String(e) }; }
});

test("one failed request for the form: a later call still gets the working form", async ({ page }) => {
  const unhandled: string[] = [];
  page.on("pageerror", (e) => unhandled.push(e.message));
  await loadCard(page);
  let failed = 0;
  await page.route(FORM, (route) => { if (failed++ === 0) return route.fulfill({ status: 404, body: "gone" }); return route.fallback(); });
  const first = await ask(page);
  expect(first).not.toHaveProperty("rejected");
  const second = await ask(page);
  expect(second).toEqual(expect.objectContaining({ tag: "floorplan-studio-card-editor" }));
  expect(unhandled).toEqual([]);
});

test("a form that never loads: the call resolves to the stale-page message, nothing is rejected", async ({ page }) => {
  const unhandled: string[] = [];
  page.on("pageerror", (e) => unhandled.push(e.message));
  await loadCard(page);
  await page.route(FORM, (route) => route.fulfill({ status: 404, body: "gone" }));
  for (let i = 0; i < 2; i++) {
    const r = await ask(page);
    expect(r, `call ${i}`).not.toHaveProperty("rejected");
    expect((r as { text: string }).text).toBe(STALE);
  }
  expect(unhandled).toEqual([]);
});
