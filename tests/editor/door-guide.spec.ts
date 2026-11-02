import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// 2026-10-12 (Diego: "in studio doors are not visible"). CSS pair, finding 10/18: the guide rule must reach the pixel in the Studio, and the
// same door must stay a transparent hole in the card. Computed style, not the stylesheet text.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const HARNESS = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const EDITOR = "floorplan-studio-editor";
const paint = (l: import("@playwright/test").Locator) => l.evaluate((e) => { const c = getComputedStyle(e); return { stroke: c.stroke, width: c.strokeWidth, dash: c.strokeDasharray, op: Number(c.strokeOpacity) }; });

async function cardLine(page: Page, idx: string) {
  await page.goto(HARNESS);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((layout) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout }); el.hass = { states: {}, callService() {} }; return el.updateComplete;
  }, demo);
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
  return page.locator(`floorplan-studio-card svg line.door[data-d="${idx}"]`);
}

test("CSS pair: a sensorless door is a visible dashed guide in the Studio and a transparent hole in the card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const g = page.locator(`${EDITOR} svg line.door.guide.door-door`).first();
  await expect(g).toBeAttached();
  const idx = await g.getAttribute("data-d");
  const a = await paint(g);
  expect(a.stroke).not.toBe("none");
  expect(a.stroke).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(a.dash).not.toBe("none");
  expect(a.width).toBe("1.5px"); // thin, whatever the wall's width
  expect(a.op).toBeLessThan(1); expect(a.op).toBeGreaterThan(0.3);
  // --fp-glass and --fp-door are the same role colour in blueprint, so the glass rule is compared to the variable it names, not to the door.
  const glass = page.locator(`${EDITOR} svg line.door.guide.door-glass`).first();
  if (await glass.count()) expect((await paint(glass)).stroke).not.toMatch(/rgba\(0, 0, 0, 0\)|none/);
  // the hit line still takes the click: the real top element at the door's middle is the door's hit line
  const b = (await g.boundingBox())!;
  const top = await page.evaluate(([x, y]) => { const e = (document.querySelector("floorplan-studio-editor") as any).shadowRoot.elementFromPoint(x, y); return e?.getAttribute("data-d") ?? null; }, [b.x + b.width / 2, b.y + b.height / 2]);
  expect(top).toBe(idx);

  const c = await cardLine(page, idx!);
  await expect(c.first()).toBeAttached();
  expect(await c.first().getAttribute("class")).not.toContain("guide");
  expect((await paint(c.first())).stroke).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});
