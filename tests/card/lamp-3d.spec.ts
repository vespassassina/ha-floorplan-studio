import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, cam, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T09:30:15Z" });

async function bootCard(page: Page, view: "2d" | "3d", layout: unknown, states: Record<string, unknown>) {
  const lampRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (req) => { if (req.url().includes("floorplan-studio-lamp-")) lampRequests.push(req.url()); });
  page.on("pageerror", (err) => errors.push(err.message));
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, stMap]) => {
    const el = document.getElementById("card") as any;
    el.setConfig(config);
    el.hass = { states: stMap, callService: () => {} };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view }, states] as const);
  if (view === "3d") {
    await drawn(page);
    await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(0);
  } else {
    await expect(page.locator("#card svg").first()).toBeVisible();
  }
  return { lampRequests, errors };
}

test("Lazy lamp chunk is not fetched when no device has d.lamp, and is fetched when d.lamp is set", async ({ page }) => {
  const plain = structuredClone(demo);
  for (const d of plain.floors.ground.devices) delete (d as any).lamp;
  const r1 = await bootCard(page, "2d", plain, { "light.living": st("on", { brightness: 255 }) });
  expect(r1.errors).toEqual([]);
  expect(r1.lampRequests).toEqual([]);

  const withLamp = structuredClone(demo);
  const firstLight = withLamp.floors.ground.devices.find((d: any) => d.type === "light") as any;
  firstLight.lamp = { kind: "flood", angle: 60, reach: 300 };
  const r2 = await bootCard(page, "2d", withLamp, { [firstLight.entity]: st("on", { brightness: 255, rgb_color: [255, 220, 160] }) });
  expect(r2.errors).toEqual([]);
  expect(r2.lampRequests.length).toBeGreaterThan(0);
  await expect(page.locator(`#card svg [data-x]`)).not.toHaveCount(0);
});

test("3D view renders lit lamp shapes and flood cone without errors", async ({ page }) => {
  const layout = structuredClone(demo);
  const lights = layout.floors.ground.devices.filter((d: any) => d.type === "light") as any[];
  lights[0].lamp = { kind: "flood", angle: 60, reach: 300 };
  if (lights[1]) lights[1].lamp = { kind: "floor" };
  const states = Object.fromEntries(lights.map((d) => [d.entity, st("on", { brightness: 255, rgb_color: [255, 210, 140] })]));

  const r = await bootCard(page, "3d", layout, states);
  expect(r.errors).toEqual([]);
  const rgb = meanRgb((await readCanvasRect(page, { x: 200, y: 150, width: 400, height: 300 })).data);
  expect(rgb[0] + rgb[1] + rgb[2]).toBeGreaterThan(30);
});
