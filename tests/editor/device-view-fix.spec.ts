import { test, expect, type Page } from "@playwright/test";

// S40 review 7: the refused text of the Dashboard view box must not outlive an undo.

const EDITOR = "floorplan-studio-editor";
const select = (page: Page, i: number) => page.evaluate(([tag, n]) => { const el = document.querySelector(tag as string) as any; el.st.sel = { t: "dev", i: n }; el.requestUpdate(); }, [EDITOR, i] as const);
async function type(page: Page, v: string) {
  const box = page.locator("#vview");
  await box.click();
  await box.press("ControlOrMeta+a");
  await page.keyboard.type(v);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await select(page, 0);
});

test("S40 review 7: after Undo the box shows the layout again, not the refused text and its message", async ({ page }) => {
  await type(page, "/lovelace/terrace");
  await type(page, "no-slash path");
  await expect(page.locator("#vview-err")).toBeVisible();
  await expect(page.locator("#vview")).toHaveValue("no-slash path");
  await page.locator("#undo").click(); // undoes the valid write
  await select(page, 0);
  await expect(page.locator("#vview")).toHaveValue("");
  await expect(page.locator("#vview-err")).toHaveCount(0);
});

test("S40 review 7: a refused text stays while nothing else changed", async ({ page }) => {
  await type(page, "/lovelace/terrace");
  await type(page, "bad path");
  await page.evaluate((tag) => (document.querySelector(tag) as any).requestUpdate(), EDITOR);
  await expect(page.locator("#vview")).toHaveValue("bad path");
  await expect(page.locator("#vview-err")).toBeVisible();
});
