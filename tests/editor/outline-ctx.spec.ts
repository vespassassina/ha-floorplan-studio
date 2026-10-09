import { test, expect, type Page } from "@playwright/test";

// S26.21 (U19): the Outline offers the plan's context menu. A real right-click, or the Menu key, on a device or room
// row opens the menu `ctxItems` gives for it; the labels equal those of a real right-click on the same object on the plan.

const EDITOR = "floorplan-studio-editor";
const HA = { floors: [], areas: [{ id: "living", name: "Living" }], entities: [{ id: "switch.lamp_relay", name: "Lamp relay", domain: "switch" }] };

const menu = (page: Page) => page.locator(`${EDITOR} .ctxmenu`);
const labels = (page: Page) => page.locator(`${EDITOR} .ctxmenu [data-cm] .cm-l`).allInnerTexts();
const centre = async (page: Page, sel: string) => { const b = (await page.locator(`${EDITOR} ${sel}`).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const ed = <T>(page: Page, fn: (el: any) => T) => page.evaluate(([tag, src]) => (new Function("el", `return (${src})(el)`))(document.querySelector(tag as string)), [EDITOR, fn.toString()] as const);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, HA] as const);
  await expect(page.locator(`${EDITOR} #outlineTree`)).toBeVisible();
});

async function row(page: Page, name: string) {
  await page.locator(`${EDITOR} #outlineFilter`).fill(name);
  const r = page.locator(`${EDITOR} #outlineTree [role="treeitem"]`, { hasText: name }).first();
  await expect(r).toBeVisible();
  return r;
}

test("a real right-click on a device row gives the labels of a right-click on that device on the plan", async ({ page }) => {
  const name = (await ed(page, (el) => el.st.f.devices[0].name)) as string;
  const p = await centre(page, 'g[data-x="0"]');
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  const onPlan = await labels(page);
  expect(onPlan.length).toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);

  await ed(page, (el) => { el.st.sel = null; el.requestUpdate(); });
  const r = await row(page, name);
  const b = (await r.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: "right" });
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(onPlan);
  expect(await ed(page, (el) => el.st.sel)).toEqual({ t: "dev", i: 0 });
  const mb = (await menu(page).boundingBox())!;
  expect(mb.x + mb.width).toBeLessThanOrEqual(1280);
  expect(mb.y + mb.height).toBeLessThanOrEqual(800);
  await page.mouse.click(700, 700);
  await expect(menu(page)).toHaveCount(0);
});

test("a real right-click on a room row gives the labels of a right-click on that room on the plan", async ({ page }) => {
  const q = await screenOf(page, 200, 150);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  const onPlan = await labels(page);
  const i = (await ed(page, (el) => el.st.sel.i)) as number;
  const name = (await ed(page, (el) => el.st.f.rooms[el.st.sel.i].name)) as string;
  await page.keyboard.press("Escape");
  await ed(page, (el) => { el.st.sel = null; el.requestUpdate(); });

  const r = await row(page, name);
  const b = (await r.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: "right" });
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(onPlan);
  expect(await ed(page, (el) => el.st.sel)).toEqual({ t: "room", i });
});

test("the Menu key on a focused device row opens the same menu, beside the row; Escape closes it", async ({ page }) => {
  const name = (await ed(page, (el) => el.st.f.devices[0].name)) as string;
  const p = await centre(page, 'g[data-x="0"]');
  await page.mouse.click(p.x, p.y, { button: "right" });
  const onPlan = await labels(page);
  await page.keyboard.press("Escape");

  const r = await row(page, name);
  await r.focus();
  await page.keyboard.press("ContextMenu");
  await expect(menu(page)).toBeVisible();
  expect(await labels(page)).toEqual(onPlan);
  const rb = (await r.boundingBox())!, mb = (await menu(page).boundingBox())!;
  expect(Math.abs(mb.y - (rb.y + rb.height))).toBeLessThan(rb.height * 2 + 8);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
});

test("a floor row opens no menu", async ({ page }) => {
  const f = page.locator(`${EDITOR} #outlineTree [role="treeitem"].k-floor`).first();
  const b = (await f.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: "right" });
  await expect(menu(page)).toHaveCount(0);
});
