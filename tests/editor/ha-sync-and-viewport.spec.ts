import { test, expect } from "@playwright/test";

const EDITOR = "floorplan-studio-editor";

test.describe("Sprint 46: HA sync & 1024x<800 Studio layout", () => {
  test("lists orphaned entities, area mismatches and floor links with one-click fixes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/standalone.html");
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();

    await page.evaluate((tag) => {
      const el = document.querySelector(tag) as unknown as {
        ha: unknown;
        writer: unknown;
        st: { layout: { floors: { ground: { devices: { entity: string }[]; rooms: { area?: string }[] } } } };
        requestUpdate(): void;
      };
      // Introduce an orphan entity and a room without area
      el.st.layout.floors.ground.devices[0].entity = "light.living_old";
      delete el.st.layout.floors.ground.rooms[0].area;
      el.ha = {
        floors: [{ id: "fl_ground", name: "Ground" }],
        areas: [{ id: "living", name: "Living" }],
        entities: [
          { id: "light.living_light", name: "Living light", domain: "light", area: "living" },
          { id: "light.kitchen_main", name: "Kitchen", domain: "light", area: "kitchen" },
        ],
      };
      (window as unknown as { __calls: unknown[] }).__calls = [];
      el.writer = {
        setDeviceArea: async () => {},
        setEntityArea: async () => {},
        createArea: async (name: string) => ({ id: "area_new", name }),
        createHelper: async () => ({ entity_id: "light.x" }),
        listLabelled: async () => [],
        removeLabelled: async () => {},
        createAutomation: async () => "auto_1",
        runScene: async () => {},
        callService: async () => {},
        createFloor: async (name: string, level?: number) => {
          (window as unknown as { __calls: unknown[] }).__calls.push(["createFloor", name, level]);
          return { id: "fl_new", name };
        },
        setAreaFloor: async (areaId: string, floorId: string | null) => {
          (window as unknown as { __calls: unknown[] }).__calls.push(["setAreaFloor", areaId, floorId]);
        },
      };
      el.requestUpdate();
    }, EDITOR);

    await page.locator(`${EDITOR} #mEdit > summary`).click();
    await page.locator(`${EDITOR} #mHaSync`).click();
    await expect(page.locator(`${EDITOR} #haSyncPanel`)).toBeVisible();

    // 1. Orphan suggestion -> 1-click replace
    await expect(page.locator(`${EDITOR} #haSyncPanel [data-orphan="light.living_old"]`)).toBeVisible();
    await page.locator(`${EDITOR} #haSyncPanel [data-orphan="light.living_old"] [data-sync="suggest"]`).click();
    await expect(page.locator(`${EDITOR} #haSyncPanel [data-orphan="light.living_old"]`)).toHaveCount(0);

    // 2. Link matching HA area
    await page.locator(`${EDITOR} #haSyncPanel [data-sync="link-area"]`).first().click();

    // 3. Link matching HA floor, then assign area to that floor
    await page.locator(`${EDITOR} #haSyncPanel [data-sync="link-floor"]`).first().click();
    await page.locator(`${EDITOR} #haSyncPanel [data-sync="assign-floor"]`).first().click();
    const calls = await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);
    expect(calls).toContainEqual(["setAreaFloor", "living", "fl_ground"]);
  });

  test("toolbar stays on one row at 1024px wide and Align panel fits under 800px high", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.goto("/standalone.html");
    await expect(page.locator(`${EDITOR} .bar`)).toBeVisible();

    // Toolbar must not wrap onto multiple rows at 1024 wide
    const barMetrics = await page.evaluate((tag) => {
      const root = document.querySelector(tag)!.shadowRoot!;
      const bar = root.querySelector(".bar")!;
      const items = [...bar.children].filter((el) => (el as HTMLElement).offsetParent !== null);
      const tops = items.map((el) => Math.round(el.getBoundingClientRect().top));
      const bottoms = items.map((el) => Math.round(el.getBoundingClientRect().bottom));
      const rightItems = [...(root.querySelector(".bar-right")?.children ?? [])].filter((el) => (el as HTMLElement).offsetParent !== null);
      const rightTops = rightItems.map((el) => Math.round(el.getBoundingClientRect().top));
      return {
        barHeight: Math.round(bar.getBoundingClientRect().height),
        topSpread: Math.max(...tops) - Math.min(...tops),
        bottomSpread: Math.max(...bottoms) - Math.min(...bottoms),
        rightTopSpread: Math.max(...rightTops) - Math.min(...rightTops),
      };
    }, EDITOR);
    expect(barMetrics.topSpread).toBeLessThanOrEqual(8);
    expect(barMetrics.rightTopSpread).toBeLessThanOrEqual(8);

    // Open Align to floor below on First floor and verify #alignPanel fits inside the 720px viewport
    await page.locator(`${EDITOR} button[data-f="first"]`).click();
    await page.locator(`${EDITOR} #mFloors > summary`).click();
    await page.locator(`${EDITOR} #alignFloor`).click();
    await expect(page.locator(`${EDITOR} #alignPanel`)).toBeVisible();

    const alignFits = await page.evaluate((tag) => {
      const root = document.querySelector(tag)!.shadowRoot!;
      const panel = root.querySelector("#alignPanel")!;
      const aside = panel.closest(".panel") ?? panel.parentElement!;
      const asideRect = aside.getBoundingClientRect();
      const applyBtn = root.querySelector("#alignApply")!.getBoundingClientRect();
      return {
        panelScrollH: panel.scrollHeight,
        asideClientH: aside.clientHeight,
        asideBottom: Math.round(asideRect.bottom),
        applyBottom: Math.round(applyBtn.bottom),
        viewportH: window.innerHeight,
      };
    }, EDITOR);
    expect(alignFits.applyBottom).toBeLessThanOrEqual(alignFits.viewportH);
    expect(alignFits.asideBottom).toBeLessThanOrEqual(alignFits.viewportH);
  });
});
