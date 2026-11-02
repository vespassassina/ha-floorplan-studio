import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S35.6, tap, hold and kiosk for the car (spec C8; criteria 12 to 15). Every click is a real page.mouse event at a point checked to
// be the real top element (finding 3). The hold is a real mouse.down held past HOLD_MS. The 3D tap on a car is held by card-3d-car.spec.ts.
// The state values are copied from what the integrations send (finding 21): the tracker is home / not_home / a zone name, Tesla's
// charging sensor is an enum with "charging" and "stopped", the battery is a `sensor` with device_class battery and unit %.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-18T09:30:15Z" });
const STATES = (o: Record<string, unknown> = {}) => ({
  "light.demo_living": st("on"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "media_player.demo_tv": st("playing", { friendly_name: "Living TV" }),
  "device_tracker.car": st("home", { friendly_name: "Car tracker" }),
  "sensor.car_charging": st("stopped", { friendly_name: "Charging state" }),
  "sensor.car_battery": st("78", { friendly_name: "Car battery", device_class: "battery", unit_of_measurement: "%" }),
  "lock.car": st("locked", { friendly_name: "Car lock" }),
  ...o,
});

// Living (500 x 400 cm). A small car at (120, 150) and a linked tv at (330, 230): clear of every demo device. The car's size is
// arbitrary here (a piece may be any size); it keeps the click target small and unambiguous.
const carPiece = (extra: Record<string, unknown> = {}) => ({
  id: "car-1", symbol: "car", x: 120, y: 150, rot: 0, w: 120, h: 50, name: "Family car", model: "sedan",
  entity: "device_tracker.car", attached: ["sensor.car_charging", "sensor.car_battery", "lock.car"], ...extra,
});
const layoutOf = (piece: Record<string, unknown>, devices: unknown[] = []) => {
  const layout = structuredClone(demo);
  layout.floors.ground.furniture.push(piece, { id: "tv-1", symbol: "tv", x: 330, y: 230, rot: 0, w: 120, h: 50, name: "Big screen", entity: "media_player.demo_tv" });
  layout.floors.ground.devices.push(...devices);
  return layout;
};
const indexOf = (layout: { floors: { ground: { furniture: { id: string }[] } } }, id: string) => layout.floors.ground.furniture.findIndex((f) => f.id === id);

async function boot(page: Page, layout: unknown, config: Record<string, unknown> = {}, states: Record<string, unknown> = STATES()) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states]) => {
      const w = window as unknown as { __calls: string[]; __info: string[] };
      w.__calls = []; w.__info = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
      el.setConfig(config);
      el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
      return el.updateComplete;
    },
    [{ layout, floor: "ground", ...config }, states] as const,
  );
}
async function setStates(page: Page, states: Record<string, unknown>) {
  await page.evaluate((states) => {
    const el = document.getElementById("card") as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
    el.hass = { ...el.hass, states };
    return el.updateComplete;
  }, states);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);

/** The centre of piece `i`, checked to be the real top element there (the piece's own group, not the room under it). */
async function piecePoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-f="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest(`g[data-f="${i}"]`) };
  }, i);
  expect(p.hit, `piece ${i} is the top element at its centre`).toBe(true);
  return p;
}
/** A real press. With `hold: "chooser"` the button stays down until the chooser shows (the hold timer is the clock, no sleep); with
 *  `hold: "quiet"` it stays down 600 ms, the one place a wait is the point: proving that nothing opens (kiosk). */
async function press(page: Page, p: { x: number; y: number }, hold?: "chooser" | "quiet") {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  if (hold === "chooser") await expect(chooser(page)).toBeVisible();
  if (hold === "quiet") await page.waitForTimeout(600);
  await page.mouse.up();
}
const chooser = (page: Page) => card(page).locator("css=.fp-chooser-dialog");
const rows = (page: Page) => card(page).locator("css=.fp-chooser-list button").evaluateAll((bs) => bs.map((b) => b.textContent!.replace(/\s+/g, " ").trim()));
const title = (page: Page) => card(page).locator("css=#fp-chooser-dialog-title").textContent();

for (const view of ["2d", "2.5d"] as const) {
  test.describe(`a car piece in ${view}`, () => {
    test("a real tap opens the card's popup, whatever tap_action says: name, car text, More info and no switch; no service, no room pick", async ({ page }) => {
      for (const tap_action of [undefined, "toggle", "none"]) {
        const layout = layoutOf(carPiece());
        await boot(page, layout, { view, ...(tap_action ? { tap_action } : {}) });
        await press(page, await piecePoint(page, indexOf(layout, "car-1")));
        const pop = card(page).locator("css=.fp-pop");
        await expect(pop, `tap_action ${tap_action}`).toBeVisible();
        await expect(pop.locator("css=.fp-pop-name")).toHaveText("Family car");
        await expect(pop.locator("css=.fp-pop-state")).toHaveText("Home · 78 %");
        await expect(pop.locator("css=.fp-pop-do")).toHaveCount(0);
        expect(await infos(page)).toEqual([]);
        expect(await calls(page)).toEqual([]);
        await expect(chooser(page)).toHaveCount(0);
        expect(await card(page).locator("css=svg polygon.room-picked").count()).toBe(0);
      }
    });

    test("the popup's More info opens the chooser with the car's entities, main first; a car with one entity opens its more-info", async ({ page }) => {
      const layout = layoutOf(carPiece());
      await boot(page, layout, { view });
      await press(page, await piecePoint(page, indexOf(layout, "car-1")));
      await card(page).locator("css=.fp-pop-more").click();
      await expect(chooser(page)).toBeVisible();
      expect(await rows(page)).toEqual(["Car trackerhome", "Charging statestopped", "Car battery78 %", "Car locklocked"]);
      const solo = layoutOf(carPiece({ attached: undefined }));
      await boot(page, solo, { view });
      await press(page, await piecePoint(page, indexOf(solo, "car-1")));
      await card(page).locator("css=.fp-pop-more").click();
      expect(await infos(page)).toEqual(["device_tracker.car"]);
    });

    test("with no entity the first attached one is the main entity", async ({ page }) => {
      const layout = layoutOf(carPiece({ entity: undefined }));
      await boot(page, layout, { view });
      await press(page, await piecePoint(page, indexOf(layout, "car-1")));
      await expect(card(page).locator("css=.fp-pop")).toBeVisible();
      await card(page).locator("css=.fp-pop-more").click();
      expect((await rows(page))[0]).toBe("Charging statestopped");
    });

    test("a real 600 ms hold opens the chooser: name and car text, main first then attached in order with their states; the release is no tap", async ({ page }) => {
      const layout = layoutOf(carPiece());
      await boot(page, layout, { view }, STATES({ "sensor.car_charging": st("charging", { friendly_name: "Charging state" }) }));
      await press(page, await piecePoint(page, indexOf(layout, "car-1")), "chooser");
      await expect(chooser(page)).toBeVisible();
      expect(await title(page)).toBe("Family car · Home · Charging · 78 %");
      expect(await rows(page)).toEqual(["Car trackerhome", "Charging statecharging", "Car battery78 %", "Car locklocked"]);
      expect(await infos(page)).toEqual([]);
      await card(page).locator("css=.fp-chooser-list button", { hasText: "Car battery" }).click();
      expect(await infos(page)).toEqual(["sensor.car_battery"]);
      await expect(chooser(page)).toHaveCount(0);
    });

    test("a hass update with the chooser open keeps it open and refreshes its title and states", async ({ page }) => {
      const layout = layoutOf(carPiece());
      await boot(page, layout, { view });
      await press(page, await piecePoint(page, indexOf(layout, "car-1")), "chooser");
      await expect(chooser(page)).toBeVisible();
      expect(await title(page)).toBe("Family car · Home · 78 %");
      await setStates(page, STATES({ "device_tracker.car": st("not_home", { friendly_name: "Car tracker" }), "sensor.car_battery": st("64", { friendly_name: "Car battery", device_class: "battery", unit_of_measurement: "%" }) }));
      await expect(chooser(page)).toBeVisible();
      expect(await title(page)).toBe("Family car · Away · 64 %");
      expect(await rows(page)).toEqual(["Car trackernot_home", "Charging statestopped", "Car battery64 %", "Car locklocked"]);
    });

    test('a name and a zone of "><script> are text: no element, nothing run', async ({ page }) => {
      const layout = layoutOf(carPiece({ name: '"><script>window.__x=1</script>' }));
      await boot(page, layout, { view }, STATES({ "device_tracker.car": st('"><script>window.__x=2</script>') }));
      await press(page, await piecePoint(page, indexOf(layout, "car-1")), "chooser");
      await expect(chooser(page)).toBeVisible();
      expect(await title(page)).toBe('"><script>window.__x=1</script> · Away · "><script>window.__x=2</script> · 78 %');
      expect(await card(page).locator("css=.fp-chooser-dialog script").count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    });
  });
}

test.describe("kiosk", () => {
  test("a real tap or hold on a car piece and on a linked tv piece does nothing at all", async ({ page }) => {
    const layout = layoutOf(carPiece());
    await boot(page, layout, { kiosk: true });
    for (const id of ["car-1", "tv-1"]) {
      const p = await piecePoint(page, indexOf(layout, id));
      await press(page, p);
      await press(page, p, "quiet");
    }
    expect(await infos(page)).toEqual([]);
    expect(await calls(page)).toEqual([]);
    await expect(chooser(page)).toHaveCount(0);
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
  });

  test("review finding 4: tap_action more-info from YAML, and a media_player icon, never reach more-info in kiosk", async ({ page }) => {
    const layout = layoutOf(carPiece(), [{ id: "tv-icon", type: "tv", entity: "media_player.demo_tv", name: "TV icon", x: 200, y: 330 }]);
    const iconAt = async (sel: string) => {
      const p = await card(page).evaluate((el, sel) => {
        const g = el.shadowRoot!.querySelector<SVGGElement>(sel)!, r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest("g[data-x]") };
      }, sel);
      expect(p.hit, sel).toBe(true);
      return p;
    };
    await boot(page, layout, { kiosk: true, tap_action: "more-info" });
    await press(page, await iconAt('svg g[data-x][class*="dev-tv"]'));
    await press(page, await iconAt('svg g[data-x][class*="dev-light"]'));
    expect(await infos(page)).toEqual([]);
    await boot(page, layout, { tap_action: "more-info" });
    await press(page, await iconAt('svg g[data-x][class*="dev-light"]'));
    expect(await infos(page)).toHaveLength(1);
  });

  test("outside kiosk the same tv tap is more-info (the rule is kiosk's, not the piece's)", async ({ page }) => {
    const layout = layoutOf(carPiece());
    await boot(page, layout);
    await press(page, await piecePoint(page, indexOf(layout, "tv-1")));
    expect(await infos(page)).toEqual(["media_player.demo_tv"]);
  });
});

test.describe("a car device icon", () => {
  const device = { id: "car-icon", type: "car", entity: "device_tracker.car2", name: "Second car", x: 200, y: 330 };
  const iconPoint = async (page: Page) => {
    const p = await card(page).evaluate((el) => {
      const g = el.shadowRoot!.querySelector<SVGGElement>('svg g[data-x][class*="car"]')!;
      const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest("g[data-x]") === true };
    });
    expect(p.hit, "the car icon is the top element at its centre").toBe(true);
    return p;
  };

  test("with tap_action toggle a tap opens the popup, which has no switch button; the tap switches nothing", async ({ page }) => {
    await boot(page, layoutOf(carPiece(), [device]), { tap_action: "toggle" }, STATES({ "device_tracker.car2": st("home") }));
    await press(page, await iconPoint(page));
    await expect(card(page).locator("css=.fp-pop")).toBeVisible();
    await expect(card(page).locator("css=.fp-pop-do")).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("a tracker at not_home is drawn at 35 %, at home it is not", async ({ page }) => {
    await boot(page, layoutOf(carPiece(), [device]), {}, STATES({ "device_tracker.car2": st("not_home") }));
    const opacity = () => card(page).evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector('svg g[data-x][class*="car"]')!).opacity);
    expect(await opacity()).toBe("0.35");
    await setStates(page, STATES({ "device_tracker.car2": st("home") }));
    expect(await opacity()).toBe("1");
  });
});

test.describe("a car's state line (review finding 2)", () => {
  const CHARGING = STATES({ "sensor.car_charging": st("charging", { friendly_name: "Charging state" }) });

  test("the hover text and the Active row read the car text: place, charging and level, not the main entity alone", async ({ page }) => {
    const layout = layoutOf(carPiece());
    await boot(page, layout, {}, CHARGING);
    const p = await piecePoint(page, indexOf(layout, "car-1"));
    await page.mouse.move(p.x - 3, p.y);
    await page.mouse.move(p.x, p.y);
    const tip = card(page).locator("css=.fp-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Family car");
    await expect(tip).toContainText("Charging");
    await expect(tip).toContainText("78");
    const row = card(page).locator("css=.fp-active-body .fp-active-row", { hasText: "Family car" });
    await expect(row.locator("css=.fp-row-state")).toHaveText("Home · Charging · 78 %");
  });
});

test.describe("the Active list", () => {
  test("a charging car piece is listed under its name and its row opens the car's popup; a parked one is not listed", async ({ page }) => {
    await boot(page, layoutOf(carPiece()), {}, STATES({ "sensor.car_charging": st("charging", { friendly_name: "Charging state" }) }));
    const row = card(page).locator("css=.fp-active-body .fp-active-row", { hasText: "Family car" });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(card(page).locator("css=.fp-pop .fp-pop-name")).toHaveText("Family car");
    expect(await infos(page)).toEqual([]);
    await setStates(page, STATES());
    await expect(card(page).locator("css=.fp-active-body .fp-active-row", { hasText: "Family car" })).toHaveCount(0);
  });
});
