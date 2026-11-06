import { test, expect } from "@playwright/test";

// B53.12, spec item 19e: a wall mirror snaps to the nearest wall and turns with it, when it is dropped from Add > Furniture and when it
// is dragged with the real mouse (finding 3: real coordinates, not events on the inner element).
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
});

const mirrors = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const lay = (document.querySelector("floorplan-studio-editor") as any).layout;
  return Object.values(lay.floors).flatMap((f: any) => (f.furniture ?? []).filter((m: any) => m.symbol === "mirror").map((m: any) => ({ x: m.x, y: m.y, rot: m.rot, w: m.w, h: m.h, floor: f })));
});
/** Distance from (x, y) to the nearest room or outline edge of the piece's own floor, and whether that edge is vertical. */
const nearest = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const lay = (document.querySelector("floorplan-studio-editor") as any).layout;
  const f: any = Object.values(lay.floors).find((fl: any) => (fl.furniture ?? []).some((m: any) => m.symbol === "mirror"));
  const m = f.furniture.find((q: any) => q.symbol === "mirror");
  let best = { d: Infinity, vertical: false };
  for (const P of [f.outline, ...f.rooms.map((r: any) => r.pts)] as number[][][]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((m.x - a[0]) * dx + (m.y - a[1]) * dy) / l2));
    const d = Math.hypot(m.x - (a[0] + t * dx), m.y - (a[1] + t * dy));
    if (d < best.d) best = { d, vertical: Math.abs(dx) < Math.abs(dy) };
  }
  return { ...best, rot: m.rot, h: m.h };
});

test("dragging a mirror to a wall seats it against the wall, turned with it", async ({ page }) => {
  await page.locator("#mAdd > summary").click();
  await page.locator("#addFurn > summary").click();
  const btn = page.locator("#addFurn-mirror");
  await btn.scrollIntoViewIfNeeded();
  const b = (await btn.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const before = (await mirrors(page))[0];
  const piece = page.locator("floorplan-studio-editor svg [data-f]").last();
  await expect(piece).toBeVisible();
  const pb = (await piece.boundingBox())!;
  // The room under the piece: drag toward its left wall, ending 30 px inside it.
  const roomBox = (await page.locator("floorplan-studio-editor svg polygon[data-r]").first().boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(roomBox.x + 30, roomBox.y + roomBox.height / 2, { steps: 12 });
  await page.mouse.up();
  const after = (await mirrors(page))[0];
  expect(after.x !== before.x || after.y !== before.y, "it moved").toBe(true);
  const n = await nearest(page);
  expect([90, 270]).toContain(n.rot % 360); expect(n.vertical, "against a vertical wall").toBe(true);
  expect(n.d, "its middle is half a wall and half its depth off the wall line").toBeLessThan(15);
  expect(n.d).toBeGreaterThan(n.h / 2 - 0.01);
});
