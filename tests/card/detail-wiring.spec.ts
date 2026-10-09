import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S25.2: the card and the Studio both ask `detailFor` for the level and pass it to `renderFloor`, so the plan root says
// the same thing in both. Real clicks on the real zoom buttons (finding 3); the level is read off the live plan root.

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const EDITOR = "floorplan-studio-editor";

test("the card: by default the plan is whole at every zoom; with auto, fit is far, zooming in with the + button goes mid then near, - and Fit go back", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg]) => {
    try { localStorage.clear(); } catch { /* no storage */ }
    const el = document.getElementById("card") as any;
    el.setConfig(cfg);
    el.hass = { states: {}, callService: () => {} };
    return el.updateComplete;
  }, [{ layout, theme: "light" }] as const);
  const level = () => page.evaluate(() => (document.getElementById("card") as any).shadowRoot.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null);
  const click = async (label: string) => {
    const p = await page.evaluate((label) => {
      const b = (document.getElementById("card") as any).shadowRoot.querySelector(`button[aria-label="${label}"]`) as HTMLElement;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    await page.mouse.click(p.x, p.y);
  };
  expect(await level(), "default mode is full").toBe("near");
  await page.evaluate(() => { const el = document.getElementById("card") as any; el.detailMode = "auto"; el.requestUpdate(); return el.updateComplete; }); // until the menu and the YAML key exist (S25.7, S25.8)
  expect(await level()).toBe("far");
  const seen: (string | null)[] = [];
  for (let i = 0; i < 12; i++) { await click("Zoom in"); seen.push(await level()); }
  expect(seen).toContain("mid");
  expect(seen.at(-1)).toBe("near");
  // the order is far -> mid -> near and never back while zooming in
  const rank = { far: 0, mid: 1, near: 2 } as Record<string, number>;
  expect(seen.map((s) => rank[s!])).toEqual([...seen.map((s) => rank[s!])].sort());
  for (let i = 0; i < 12; i++) await click("Zoom out");
  expect(await level()).toBe("far");
});

test("the Studio: fit is far, + goes mid then near, - goes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const level = () => page.evaluate((tag) => (document.querySelector(tag) as any).shadowRoot.querySelector("svg g[data-detail]")?.getAttribute("data-detail") ?? null, EDITOR);
  const click = async (sel: string) => { const b = (await page.locator(sel).boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  expect(await level(), "default mode is full").toBe("near");
  await page.evaluate((tag) => { const e = document.querySelector(tag) as any; e.detailMode = "auto"; e.requestUpdate(); return e.updateComplete; }, EDITOR);
  expect(await level()).toBe("far");
  const seen: (string | null)[] = [];
  for (let i = 0; i < 12; i++) { await click("#zin"); seen.push(await level()); }
  expect(seen).toContain("mid");
  expect(seen.at(-1)).toBe("near");
  const rank = { far: 0, mid: 1, near: 2 } as Record<string, number>;
  expect(seen.map((s) => rank[s!])).toEqual([...seen.map((s) => rank[s!])].sort());
  for (let i = 0; i < 12; i++) await click("#zout");
  expect(await level()).toBe("far");
});
