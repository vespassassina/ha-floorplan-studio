import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// S37.7: small layout defects from the S36.6 walk (2026-10-24). Each test measures real geometry with getBoundingClientRect
// or getComputedStyle in the real standalone page, at the viewport the defect was seen at (finding 3: real clicks, real
// coordinates). The card's own defect (zoom buttons over the ghost) is in tests/card/card-ghost-stack.spec.ts.

const EDITOR = "floorplan-studio-editor";
const DEMO = JSON.parse(readFileSync("demo/layout.json", "utf8"));

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}
test("2: a wall's length label is painted over the handle dots at its two ends (a short wall puts them on the label)", async ({ page }) => {
  await boot(page, 1280, 800);
  await page.locator("#fixPlan").uncheck();
  const layout = structuredClone(DEMO);
  // 60 cm is about 36 px at the fit: the two end dots (5 px radius) land on a label 33 px wide. 100 cm and 300 cm are the control: dots clear of the label.
  layout.floors.ground.walls.push(
    { id: "w-short", a: [100, 100], b: [160, 100], kind: "wall" },
    { id: "w-mid", a: [100, 200], b: [200, 200], kind: "wall" },
    { id: "w-long", a: [100, 300], b: [400, 300], kind: "wall" },
  );
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, layout] as const);
  const seen = await page.evaluate((tag) => {
    const svg = (document.querySelector(tag as string) as HTMLElement).shadowRoot!.querySelector(".canvas > svg")!;
    const all = [...svg.querySelectorAll("*")];
    const hit = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const out: { label: string; dot: string; labelOnTop: boolean }[] = [];
    for (const t of svg.querySelectorAll("text.len")) for (const d of svg.querySelectorAll("circle.h")) {
      if (hit(t.getBoundingClientRect(), d.getBoundingClientRect())) out.push({ label: t.textContent!, dot: d.getAttribute("data-hp") ?? d.getAttribute("data-h") ?? "?", labelOnTop: all.indexOf(t) > all.indexOf(d) });
    }
    return out;
  }, EDITOR);
  expect(seen.filter((p) => p.dot.startsWith("walls:")).length, "the 60 cm wall's dots do sit on its label (else this proves nothing)").toBeGreaterThan(0);
  expect(seen.filter((p) => !p.labelOnTop), "a dot is painted over a label").toEqual([]);
});

