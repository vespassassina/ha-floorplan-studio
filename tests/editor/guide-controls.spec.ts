import { test, expect } from "@playwright/test";
import { GUIDE_STEPS, guideControls } from "../../src/editor/guide";

// S22.7 (review U23): the guide told people to click a "+" by the floor tabs, open "Devices" and draw stairs from Add,
// none of which the editor has. Every control the guide names, written [Label], must exist in the rendered editor by
// its button text, menu name, option, label, aria-label or title.

const EDITOR = "floorplan-studio-editor";
const norm = (s: string) => s.replace(/\p{Extended_Pictographic}/gu, "").replace(/(…|\.\.\.)$/, "").replace(/\s+/g, " ").trim();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("every control the guide names exists in the editor under that name", async ({ page }) => {
  const names = guideControls();
  expect(names.length).toBeGreaterThan(10);
  const collect = () => page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const out: string[] = [];
    root.querySelectorAll("button, summary, option, label").forEach((el) => out.push(el.textContent ?? ""));
    root.querySelectorAll("[aria-label], [title]").forEach((el) => { out.push(el.getAttribute("aria-label") ?? ""); out.push(el.getAttribute("title") ?? ""); });
    return out;
  }, EDITOR);
  const labels = await collect();
  // The device panel's own fields exist only with a device selected: a real click on one (finding 3).
  const dev = (await page.locator(`${EDITOR} svg g[data-x]`).first().boundingBox())!;
  await page.mouse.click(dev.x + dev.width / 2, dev.y + dev.height / 2);
  await expect(page.locator(`${EDITOR} #ve`)).toHaveCount(1);
  labels.push(...await collect());
  const have = new Set(labels.map(norm).filter(Boolean));
  const missing = names.filter((n) => !have.has(norm(n)));
  expect(missing).toEqual([]);
});

test("the guide tells a first-time user about Fix plan, since the plan opens fixed", async () => {
  expect(guideControls()).toContain("Fix plan");
});

test("the Help panel shows each named control in bold, without the brackets", async ({ page }) => {
  await page.locator(`${EDITOR} #help`).click();
  const guide = page.locator(`${EDITOR} ol.guide`);
  await expect(guide).toBeVisible();
  await expect(guide.locator("b.ctl")).toHaveCount(guideControls().length);
  expect(await guide.evaluate((el) => el.textContent)).not.toMatch(/[[\]]/);
  expect(GUIDE_STEPS.length).toBeGreaterThan(0);
});
