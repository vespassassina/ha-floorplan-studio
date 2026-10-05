import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn } from "./helpers-3d";

// 3D fixes: device icons floated over the walls. Every icon anchor stays at most ICON_MARGIN (10 cm) under the top of the floor's
// walls, and a low device keeps its own height. Real card, the demo's ground floor (walls 250 cm) plus a TV mounted high.

interface Hook { anchors(): { index: number; type: string; z: number }[] }
const anchors = (page: Page) => page.evaluate(`window.__fp3d.anchors()`) as Promise<ReturnType<Hook["anchors"]>>;

test("every icon anchor is under the wall top; a low device keeps its height", async ({ page }) => {
  const layout = structuredClone(demo);
  const devices = layout.floors.ground.devices;
  // A free-standing TV whose own z (230) puts its top at 290 cm, over the 250 cm walls.
  devices.push({ id: "tv-high", type: "tv", entity: "media_player.high_tv", name: "High TV", x: 250, y: 380, z: 230 });
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor: "ground", view: "3d", active_list: false });
  await drawn(page);
  const a = await anchors(page);
  const byType = (t: string) => a.filter((x) => x.type === t);
  expect(a.length).toBe(devices.length);
  for (const x of a) expect(x.z, `${x.type} #${x.index}`).toBeLessThanOrEqual(250 - 10);
  expect(byType("light").map((x) => x.z)).toEqual([240, 240]); // ceiling lights: 250 by default, held to 240, not lower
  expect(byType("camera")[0].z).toBe(230); // under the cap: its own height
  expect(byType("plug")[0].z).toBe(30); // a socket stays low
  expect(byType("tv")[0].z).toBe(240); // a body's anchor (its top plus 6) is held too: 296 would float
  expect(byType("heater")[0].z).toBe(76); // the radiator's top, 70, plus 6: untouched
});
