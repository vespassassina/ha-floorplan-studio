import { test, expect } from "@playwright/test";

// S55 follow-up: end-to-end test of the Studio live-view hover bubble on room badges.
// Studio badges take no click (`cb-ed`), so `bindBadgeBubble` finds them by pointer position over the live SVG.

const EDITOR = "floorplan-studio-editor";

test("hovering a room badge in Studio live view opens the bubble with live state and closes on mouse leave", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();

  // Enable badges on the first room that owns a light, and feed live light states.
  const target = await page.evaluate((tag) => {
    const ed = document.querySelector(tag) as any;
    const f = ed.st.f;
    const ri = f.rooms.findIndex((r: any, idx: number) => r && Array.isArray(r.pts) && r.pts.length >= 3 && idx >= 0);
    if (ri < 0) return null;
    const lights = (f.devices ?? []).filter((d: any) => d.type === "light");
    const states: Record<string, unknown> = {};
    for (const d of lights) states[d.entity] = { state: "on", attributes: { brightness: 200 }, last_changed: new Date().toISOString() };
    // Turn on badges on every room so whichever room owns a light draws a lights badge.
    for (const r of f.rooms) if (r && r.kind === "room") r.badges = { corner: "nw" };
    ed.hassState = states;
    ed.requestUpdate();
    return true;
  }, EDITOR);
  expect(target).toBe(true);

  const badge = page.locator(`${EDITOR} svg g.cb-lights`).first();
  await expect(badge).toBeVisible();
  const box = await badge.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const bubble = page.locator(`${EDITOR} .fp-bubble`);
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Lights");
  await expect(bubble).toContainText("on");

  await page.mouse.move(2, 2);
  await expect(bubble).toBeHidden();
});
