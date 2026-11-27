import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, drawn } from "./helpers-3d";

const hook = <T>(page: Page, fn: (h: any) => T) => page.evaluate(`(${fn.toString()})(window.__fp3d)`) as Promise<Awaited<T>>;

test("S82: 3D weather atmosphere switches between clear, rain, snow, and fog live", async ({ page }) => {
  const layout = structuredClone(demo);
  await serve(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));

  const setWeather = (cond: string) =>
    page.evaluate(([cfg, state]) => {
      const el = document.getElementById("card") as any;
      if (!el._cfgDone) { el.setConfig(cfg); el._cfgDone = true; }
      el.hass = {
        states: {
          "weather.home": { state, attributes: {}, last_changed: "2026-11-27T12:00:00Z" },
          "sun.sun": { state: "above_horizon", attributes: { azimuth: 180, elevation: 45 }, last_changed: "2026-11-27T12:00:00Z" },
        },
        themes: { darkMode: false },
        callService: () => undefined,
      };
      return el.updateComplete;
    }, [{ layout, floor: "ground", view: "3d", theme: "home", active_list: false }, cond] as const);

  await setWeather("sunny");
  await drawn(page);
  await expect.poll(() => hook(page, (h) => h.weather())).toEqual({ kind: "clear", particles: 0, fog: false });
  const sunnyLight = await hook(page, (h) => h.light().intensity);

  await setWeather("rainy");
  await expect.poll(() => hook(page, (h) => h.weather())).toMatchObject({ kind: "rain", fog: true });
  expect((await hook(page, (h) => h.weather())).particles).toBeGreaterThan(100);
  expect(await hook(page, (h) => h.light().intensity)).toBeLessThan(sunnyLight);

  await setWeather("snowy");
  await expect.poll(() => hook(page, (h) => h.weather())).toMatchObject({ kind: "snow", fog: true });
  expect((await hook(page, (h) => h.weather())).particles).toBeGreaterThan(100);

  await setWeather("fog");
  await expect.poll(() => hook(page, (h) => h.weather())).toEqual({ kind: "fog", particles: 0, fog: true });

  await setWeather("sunny");
  await expect.poll(() => hook(page, (h) => h.weather())).toEqual({ kind: "clear", particles: 0, fog: false });
});
