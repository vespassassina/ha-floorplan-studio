import { test, expect, type Page } from "@playwright/test";
import { demo, open, card } from "./helpers-3d";

// S25.5: spiderfy. Two lamps 6 cm apart overlap into a stack. A real click on the stack fans them out in a ring, a real
// click on one member opens that lamp's popup, Escape (or a click elsewhere) folds the ring. Every click is page.mouse at
// coordinates checked to be the real top element there (CLAUDE.md finding 3).

const layout = () => {
  const l = structuredClone(demo);
  const g = l.floors.ground;
  g.devices = [
    { id: "a", type: "light", entity: "light.a", name: "Stack lamp A", x: 250, y: 200 },
    { id: "b", type: "light", entity: "light.b", name: "Stack lamp B", x: 256, y: 200 },
    { id: "c", type: "light", entity: "light.c", name: "Lone lamp", x: 650, y: 200 },
  ];
  return l;
};
const boot = async (page: Page) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page, { layout: layout(), floor: "ground" });
  await expect(card(page).locator("css=svg g[data-x]")).toHaveCount(3);
};
const ring = (page: Page) => card(page).locator("css=svg .spider-leader");
const pop = (page: Page) => card(page).locator("css=.fp-pop");

/** The centre of device i's icon, checked to be the real top element there. */
const at = async (page: Page, i: number, covered = false) => {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return { x, y, hit: !!top?.closest(`g[data-x="${i}"]`), top: top?.tagName ?? "none" };
  }, i);
  if (!covered) expect(p.hit, `device ${i} is the top element at its centre (${p.top})`).toBe(true);
  return p;
};

test("a click on a stack fans it out; a click on one member opens that lamp's popup; Escape folds", async ({ page }) => {
  await boot(page);
  await expect(ring(page)).toHaveCount(0);
  const top = await at(page, 1); // the later lamp is the top one of the stack
  await page.mouse.click(top.x, top.y);
  await expect(ring(page)).toHaveCount(2);
  await expect(pop(page)).toHaveCount(0); // a click on a stack opens the ring, not a popup
  await expect(card(page).locator("css=svg text.spider-lbl")).toHaveText(["Stack lamp A", "Stack lamp B"]);
  // The members now sit apart: at least a touch target between their centres.
  const a = await at(page, 0), b = await at(page, 1);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(43);
  await page.mouse.click(a.x, a.y);
  await expect(pop(page)).toHaveCount(1);
  await expect(pop(page).locator("css=.fp-pop-name")).toHaveText("Stack lamp A");
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  await expect(ring(page)).toHaveCount(2); // the first Escape closed the popup only
  await page.keyboard.press("Escape");
  await expect(ring(page)).toHaveCount(0);
  const back = await at(page, 0, true); // folded: both icons sit on the stack again, the lower one under the upper
  expect(Math.hypot(back.x - top.x, back.y - top.y)).toBeLessThan(12);
});

test("a click elsewhere folds the ring", async ({ page }) => {
  await boot(page);
  const top = await at(page, 1);
  await page.mouse.click(top.x, top.y);
  await expect(ring(page)).toHaveCount(2);
  const svg = (await card(page).locator("css=svg").first().boundingBox())!;
  await page.mouse.click(svg.x + 6, svg.y + svg.height - 6);
  await expect(ring(page)).toHaveCount(0);
});

test("a lone lamp opens its popup at once, with no ring", async ({ page }) => {
  await boot(page);
  const lone = await at(page, 2);
  await page.mouse.click(lone.x, lone.y);
  await expect(pop(page).locator("css=.fp-pop-name")).toHaveText("Lone lamp");
  await expect(ring(page)).toHaveCount(0);
});

test("the ring stays inside the view for a stack at its edge", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const l = layout();
  // A pinned card zoomed in 3x about the middle shows about 307 cm across; the stack sits 7 cm under its top edge, less than the ring's radius.
  const g = l.floors.ground.devices;
  g[0].x = 450; g[0].y = 182; g[1].x = 454; g[1].y = 182; g[2].x = 420; g[2].y = 300;
  await open(page, { layout: l, floor: "ground", center: [400, 300], zoom_level: 3 });
  await expect(card(page).locator("css=svg g[data-x]")).toHaveCount(3);
  const top = await at(page, 1);
  await page.mouse.click(top.x, top.y);
  await expect(ring(page)).toHaveCount(2);
  // The view box on screen: the svg keeps its aspect and centres it.
  const box = await card(page).locator("css=svg").first().evaluate((svg) => {
    const [, , w, h] = svg.getAttribute("viewBox")!.split(/\s+/).map(Number), r = svg.getBoundingClientRect(), s = Math.min(r.width / w, r.height / h);
    return { x: r.x + (r.width - w * s) / 2, y: r.y + (r.height - h * s) / 2, w: w * s, h: h * s };
  });
  for (const i of [0, 1]) {
    const p = await at(page, i);
    expect(p.x - 20).toBeGreaterThanOrEqual(box.x - 0.5); expect(p.x + 20).toBeLessThanOrEqual(box.x + box.w + 0.5);
    expect(p.y - 20).toBeGreaterThanOrEqual(box.y - 0.5); expect(p.y + 20).toBeLessThanOrEqual(box.y + box.h + 0.5);
  }
});
