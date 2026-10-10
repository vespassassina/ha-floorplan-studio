import { test, expect, type Page } from "@playwright/test";

// S26.24 (Studio review U3): one word. The editor says Lock and Unlock, never Fix, fixed, Unfix or "length locked".
// A sweep over every string the editor renders (text, title, aria-label, placeholder, in every shadow root) after opening
// every menu, panel, context menu and banner it has. Ids such as #fixPlan stay; only what a person reads is checked.

const EDITOR = "floorplan-studio-editor";
const BAD = /\b(fix|fixed|fixing|unfix|unfixed)\b|length locked/i;

/** Every rendered string under the editor, walking into shadow roots; style and script text are not read. */
const strings = (page: Page) => page.evaluate((tag) => {
  const out: string[] = [];
  const walk = (root: Document | ShadowRoot | Element) => {
    root.querySelectorAll("*").forEach((el) => {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") return;
      for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 && n.textContent?.trim()) out.push(n.textContent.trim());
      for (const a of ["title", "aria-label", "placeholder", "alt"]) { const v = el.getAttribute(a); if (v) out.push(v); }
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };
  const host = document.querySelector(tag)!;
  walk(host.shadowRoot ?? host);
  return out;
}, EDITOR);

const sweep = async (page: Page, where: string) => {
  const bad = (await strings(page)).filter((s) => BAD.test(s));
  expect(bad, where).toEqual([]);
};

const centre = async (page: Page, sel: string) => { const b = (await page.locator(`${EDITOR} ${sel}`).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector(".canvas > svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("the sanity check sees a bad word: a title with Fix fails the sweep", async ({ page }) => {
  await page.evaluate((tag) => { (document.querySelector(tag) as any).shadowRoot.querySelector("#help").setAttribute("title", "Fix plan"); }, EDITOR);
  expect((await strings(page)).filter((s) => BAD.test(s))).toEqual(["Fix plan"]);
});

test("no menu says Fix, locked or editable", async ({ page }) => {
  await sweep(page, "closed, plan locked");
  for (const id of ["mAdd", "mFloors", "mOpt", "mEdit", "mFile"]) {
    await page.locator(`#${id} > summary`).click();
    const n = await page.locator(`#${id} > .box > details.sub > summary`).count();
    for (let k = 0; k < n; k++) await page.locator(`#${id} > .box > details.sub > summary`).nth(k).click();
    await sweep(page, id);
    await page.locator(`#${id} > summary`).click();
  }
  await page.locator("#fixPlan").uncheck();
  await sweep(page, "plan editable");
});

test("Help, the guide and the command search say Lock", async ({ page }) => {
  await page.locator(`${EDITOR} #help`).click();
  await expect(page.locator(`${EDITOR} ol.guide`)).toBeVisible();
  await sweep(page, "help");
  await page.locator(`${EDITOR} #help`).click();
  const c = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
  await page.mouse.click(c.x + 4, c.y + c.height - 4);
  await page.keyboard.press("/");
  await page.keyboard.type("plan");
  const first = page.locator(`${EDITOR} fp-search [role="option"]`).first();
  await expect(first).toContainText("plan");
  await sweep(page, "search for plan");
  await page.keyboard.type(" ");
  await page.keyboard.press("Escape");
});

test("the banner after a refused edit says the plan is locked and offers Unlock", async ({ page }) => {
  await expect(page.locator("#fixPlan")).toBeChecked();
  const d = await centre(page, 'svg line.door[data-d="0"]');
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 40, d.y + 30, { steps: 6 });
  await page.mouse.up();
  const banner = page.locator(`${EDITOR} .banner`);
  await expect(banner).toContainText("The plan is locked.");
  await expect(banner.locator("#bannerUnfix")).toHaveText("Unlock");
  await sweep(page, "banner");
  await banner.locator("#bannerUnfix").click();
  await expect(page.locator("#fixPlan")).not.toBeChecked();
  await expect(page.locator(`${EDITOR} #status`)).toContainText("Plan unlocked");
  await page.locator("#fixPlan").check();
  await expect(page.locator(`${EDITOR} #status`)).toContainText("Plan locked");
  await sweep(page, "status after locking");
});

const TARGETS: Record<string, (p: Page) => Promise<{ x: number; y: number }>> = {
  canvas: (p) => screenOf(p, 950, 700),
  room: (p) => screenOf(p, 200, 150),
  door: (p) => screenOf(p, 345, 600),
  stairs: (p) => screenOf(p, 740, 500),
  furn: (p) => centre(p, 'g[data-f="0"]'),
  dev: (p) => centre(p, 'g[data-x="0"]'),
};

for (const locked of [true, false]) {
  test(`every context menu and every panel is free of Fix (plan ${locked ? "locked" : "editable"})`, async ({ page }) => {
    if (!locked) await page.locator("#fixPlan").uncheck();
    for (const [name, at] of Object.entries(TARGETS)) {
      const p = await at(page);
      await page.mouse.click(p.x, p.y, { button: "right" });
      await expect(page.locator(`${EDITOR} .ctxmenu`), name).toBeVisible();
      await sweep(page, `${name} context menu`);
      await page.keyboard.press("Escape");
      await expect(page.locator(`${EDITOR} .ctxmenu`)).toHaveCount(0);
      if (name !== "canvas") { await page.mouse.click(p.x, p.y); await sweep(page, `${name} panel`); }
    }
    // several devices selected: the group panel
    const a = await centre(page, 'g[data-x="0"]'), b = await centre(page, 'g[data-x="1"]');
    await page.mouse.click(a.x, a.y);
    await page.keyboard.down("Shift"); await page.mouse.click(b.x, b.y); await page.keyboard.up("Shift");
    await sweep(page, "two devices");
    await page.mouse.click(b.x, b.y, { button: "right" });
    await sweep(page, "two devices context menu");
  });
}
