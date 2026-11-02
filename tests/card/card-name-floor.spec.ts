import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// Opus review of Sprint 31, finding 2: `qpx` snaps the drawn scale DOWN so a room name never falls under its 11 px floor
// (NAME_MIN_PX). Nothing measured the pixel. This does: the real on-screen font size of every room name, across card widths,
// a wide plan and a tall one. Round-to-nearest in `qpx` would put some of these up to 0.5 % under 11 px.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const frames = (page: Page, n: number) => page.evaluate((n) => new Promise<void>((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r()); f(n); }), n);

/** Every room name's drawn size on screen: its font-size times the scale of its own screen transform (a turned plan too). */
const nameSizes = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => {
  const out: { name: string; px: number }[] = [];
  for (const t of el.shadowRoot!.querySelectorAll<SVGTextElement>("text[data-rl]")) {
    const m = t.getScreenCTM();
    if (!m || getComputedStyle(t).display === "none") continue;
    out.push({ name: t.textContent ?? "", px: parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b) });
  }
  return out;
});

for (const [name, layout] of Object.entries({ demo, stress })) {
  test(`${name}: no room name is drawn under 11 px at any card width from 300 to 1400`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1700 });
    await page.goto(URL_);
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(() => { document.getElementById("card")!.style.cssText = "display:block;width:300px;height:1500px"; });
    await page.evaluate((layout) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig({ layout, floor: "ground", rotation: 45, kiosk: true });
      el.hass = { states: {}, callService: () => {} };
      return el.updateComplete;
    }, layout);
    let seen = 0;
    for (let w = 300; w <= 1400; w += 37) {
      await page.evaluate((w) => { document.getElementById("card")!.style.width = `${w}px`; }, w);
      await frames(page, 8);
      for (const s of await nameSizes(page)) { seen++; expect(s.px, `"${s.name}" at ${w} px wide`).toBeGreaterThanOrEqual(11 - 0.01); }
    }
    expect(seen, "names were measured").toBeGreaterThan(100);
  });
}
