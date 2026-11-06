import { test, expect } from "@playwright/test";

// B53.1: the four new pieces can be picked from Add > Furniture with a real click, and arrive at their default size.
const PIECES = [
  { symbol: "sofa-l", w: 280, h: 180 },
  { symbol: "coffee-table", w: 110, h: 60 },
  { symbol: "bookcase", w: 100, h: 35 },
  { symbol: "buffet", w: 180, h: 50 },
];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
});

for (const p of PIECES) {
  test(`Add > Furniture places a ${p.symbol} at ${p.w} x ${p.h} cm`, async ({ page }) => {
    await page.locator("#mAdd > summary").click();
    await page.locator("#addFurn > summary").click();
    const btn = page.locator(`#addFurn-${p.symbol}`);
    await btn.scrollIntoViewIfNeeded();
    const b = (await btn.boundingBox())!;
    expect(b.y + b.height, "inside the viewport").toBeLessThanOrEqual(768);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const placed = await page.evaluate((s) => {
      const lay = (document.querySelector("floorplan-studio-editor") as any).layout;
      return Object.values(lay.floors).flatMap((f: any) => f.furniture ?? []).filter((m: any) => m.symbol === s).map((m: any) => ({ w: m.w, h: m.h }));
    }, p.symbol);
    expect(placed).toEqual([{ w: p.w, h: p.h }]);
  });
}

// Opus review of B53.10-B53.13 (finding 3): a rug added after a sofa lay over it in plain 2D and took the click. A real mouse click at the
// sofa's centre, rug listed second and larger, must select the sofa.
test("a click at the centre of a sofa with a rug under it (listed after it) selects the sofa", async ({ page }) => {
  await page.evaluate(() => {
    const el = document.querySelector("floorplan-studio-editor") as any;
    const furniture = [
      { id: "furniture-ground-1", symbol: "sofa", x: 500, y: 450, rot: 0, w: 160, h: 80 },
      { id: "furniture-ground-2", symbol: "rug", x: 500, y: 450, rot: 0, w: 300, h: 220 },
    ];
    el.layout = { version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { ground: { title: "Ground", outline: [[0, 0], [1200, 0], [1200, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [] } } };
  });
  const at = await page.evaluate(() => {
    const svg = (document.querySelector("floorplan-studio-editor") as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(500, 450).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#fs")).toHaveValue("sofa");
});

// Diego, 2026-11-06: Add > Furniture is grouped by area of the house, each area A to Z by name. Read off the real
// rendered menu, in DOM order, so a template that ignored `furnitureMenu` fails.
test("Add > Furniture lists the pieces under house areas, each A to Z, with readable headings", async ({ page }) => {
  await page.locator("#mAdd > summary").click();
  await page.locator("#addFurn > summary").click();
  const rows = await page.locator("floorplan-studio-editor #addFurn > .mh, floorplan-studio-editor #addFurn > button").evaluateAll((els) =>
    els.map((e) => ({ head: e.classList.contains("mh"), text: (e.textContent ?? "").trim() })));
  const areas: [string, string[]][] = [];
  for (const r of rows) { if (r.head) areas.push([r.text, []]); else areas[areas.length - 1][1].push(r.text); }
  expect(areas.map(([a]) => a)).toEqual(["Living", "Kitchen and dining", "Bedroom", "Bathroom", "Office", "Gym", "Laundry and cleaning", "Outdoor"]);
  for (const [a, names] of areas) expect(names, a).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  expect(areas[0][1].slice(0, 3)).toEqual(["Armchair", "Bookcase", "Chaise longue"]);
  // The heading is drawn: a visible size and an ink colour, not the button look (computed style, finding 10).
  const h = await page.locator("floorplan-studio-editor #addFurn > .mh").first().evaluate((e) => {
    const s = getComputedStyle(e); return { size: s.fontSize, transform: s.textTransform, opacity: s.opacity, height: e.getBoundingClientRect().height };
  });
  expect(h).toMatchObject({ size: "11px", transform: "uppercase", opacity: "0.6" });
  expect(h.height).toBeGreaterThan(10);
});
