import { test, expect } from "@playwright/test";

const EDITOR = "floorplan-studio-editor";

test("GitHub Issue #1: window.floorplanStudioActions renders escaped menu actions and fires floorplan-studio-action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();

  // Hidden by default when nothing is registered
  await expect(page.locator(`${EDITOR} #mActions`)).toHaveCount(0);

  // Register a normal action + a hostile XSS label action
  await page.evaluate(() => {
    const w = window as unknown as {
      __events: unknown[];
      __xss?: number;
      floorplanStudioActions: { register(a: { id: string; label: string; icon?: string; title?: string }): () => void };
    };
    w.__events = [];
    document.addEventListener("floorplan-studio-action", (e) => {
      w.__events.push((e as CustomEvent).detail);
    });
    w.floorplanStudioActions.register({
      id: "ramses.seed-devices",
      label: "Add devices",
      icon: "access_point",
      title: "Seed missing devices",
    });
    w.floorplanStudioActions.register({
      id: "evil",
      label: '"><script>window.__xss=1</script>',
    });
  });

  const menu = page.locator(`${EDITOR} #mActions`);
  await expect(menu).toBeVisible();
  await menu.locator("summary").click();
  const btn = menu.locator('button[data-custom-action="ramses.seed-devices"]');
  await expect(btn).toBeVisible();
  await btn.click();

  const res = await page.evaluate(() => ({
    events: (window as unknown as { __events: unknown[] }).__events,
    xss: (window as unknown as { __xss?: number }).__xss,
  }));
  expect(res.xss).toBeUndefined();
  expect(res.events).toHaveLength(1);
  expect(res.events[0]).toMatchObject({ id: "ramses.seed-devices", floor: "ground" });

  // Unregistering hides the Actions menu again
  await page.evaluate(() => {
    const reg = (window as unknown as { floorplanStudioActions: { unregister(id: string): void } }).floorplanStudioActions;
    reg.unregister("ramses.seed-devices");
    reg.unregister("evil");
  });
  await expect(page.locator(`${EDITOR} #mActions`)).toHaveCount(0);
});
