import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { menuItem, openMenu, pick, stateOf } from "./menu-helper";
import { cardSource } from "../../scripts/card-source.mjs";

// S16.3: the camera thumbnail in the 2D and 2.5D card. Real clicks (finding 3). The hass stub has Home Assistant's shape (finding 21):
// `states` keyed by entity id, each { state, attributes, last_changed }; a camera's `entity_picture` is a path on HA, `/api/camera_proxy/...?token=`.
// Demo ground floor: the Hall camera `camera.demo_hall` (device camera-hall). The harness is a file:// page, so a relative path never
// loads: that is the "failed load" case for free, and a request to it is what the tests count. A `data:` picture is the one that shows.

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const PIC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"; // one valid pixel: a truncated gif fires `error` and is hidden
const PATH = "/api/camera_proxy/camera.demo_hall?token=abc";
const cam = (pic: string, state = "idle") => ({ "camera.demo_hall": { state, attributes: { entity_picture: pic }, last_changed: "2026-10-21T09:30:15Z" } });

async function boot(page: Page, config: Record<string, unknown>, states: Record<string, unknown> = cam(PIC), size = { width: 1100, height: 800 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg, s]) => {
    try { localStorage.clear(); } catch { /* no storage */ }
    const w = window as unknown as { __info: string[] };
    w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(cfg);
    el.hass = { states: s, callService() {} };
    return el.updateComplete;
  }, [{ layout, floor: "ground", theme: "light", ...config }, states] as const);
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const thumbs = (page: Page) => card(page).locator("css=svg g.fp-cam-thumb");
const images = (page: Page) => card(page).locator("css=svg image.fp-cam-img");
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const stored = (page: Page) => page.evaluate(() => {
  const e = Object.entries(localStorage).find(([k]) => k.startsWith("fp-view:"));
  return e ? (JSON.parse(e[1]) as Record<string, unknown>) : null;
});
/** The thumbnail's box on the screen, and the svg's, both from the real layout. */
const boxes = (page: Page) => card(page).evaluate((host) => {
  const svg = host.shadowRoot!.querySelector("svg")!, t = svg.querySelector("g.fp-cam-thumb image")!.getBoundingClientRect(), s = svg.getBoundingClientRect();
  return { t: { l: t.left, t: t.top, r: t.right, b: t.bottom }, s: { l: s.left, t: s.top, r: s.right, b: s.bottom } };
});
const requests = (page: Page, needle: string) => { const seen: string[] = []; page.on("request", (r) => { if (r.url().includes(needle)) seen.push(r.url()); }); return seen; };

for (const view of ["2d", "2.5d"] as const) {
  test.describe(`S16.3 camera thumbnail, ${view}`, () => {
    test("draws one picture beside the camera, inside the card, and a real tap on it opens more-info for the camera", async ({ page }) => {
      await boot(page, { view, camera_thumb: "on" });
      await expect(images(page)).toHaveCount(1);
      await expect(images(page)).toHaveAttribute("href", PIC);
      const b = await boxes(page);
      expect(b.t.l).toBeGreaterThanOrEqual(b.s.l);
      expect(b.t.t).toBeGreaterThanOrEqual(b.s.t);
      expect(b.t.r).toBeLessThanOrEqual(b.s.r);
      expect(b.t.b).toBeLessThanOrEqual(b.s.b);
      await page.mouse.click((b.t.l + b.t.r) / 2, (b.t.t + b.t.b) / 2);
      await expect.poll(() => infos(page)).toEqual(["camera.demo_hall"]);
    });
  });
}

test.describe("S16.3 camera thumbnail, options", () => {
  test("off is the default: no thumbnail, and no request for the picture", async ({ page }) => {
    const seen = requests(page, "camera_proxy");
    await boot(page, {}, cam(PATH));
    await expect(thumbs(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(seen).toEqual([]);
  });

  test("off in YAML (a boolean false too) draws nothing; on as a YAML boolean true draws it", async ({ page }) => {
    await boot(page, { camera_thumb: false });
    await expect(thumbs(page)).toHaveCount(0);
    await boot(page, { camera_thumb: true });
    await expect(thumbs(page)).toHaveCount(1);
  });

  test("on asks for the picture with a cache buster", async ({ page }) => {
    const seen = requests(page, "camera_proxy");
    await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/camera_proxy\/camera\.demo_hall\?token=abc&fp_t=\d+$/);
  });

  test("an unavailable camera draws no thumbnail", async ({ page }) => {
    await boot(page, { camera_thumb: "on" }, cam(PIC, "unavailable"));
    await expect(thumbs(page)).toHaveCount(0);
  });

  test("a picture that fails to load is drawn as nothing, not as a broken image", async ({ page }) => {
    await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect(thumbs(page)).toHaveCount(0);
    await expect(images(page)).toHaveCount(0);
  });

  test("a hostile entity_picture is escaped, not run", async ({ page }) => {
    await boot(page, { camera_thumb: "on" }, cam('/x"><script>window.__pwn=1</script>'));
    expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
    expect(await card(page).evaluate((h) => h.shadowRoot!.querySelectorAll("svg script").length)).toBe(0);
  });

  test("size and position change the box: large is wider than small, above sits higher than below", async ({ page }) => {
    await boot(page, { camera_thumb: "on", camera_thumb_size: "small", camera_thumb_pos: "below" });
    const small = await boxes(page);
    await boot(page, { camera_thumb: "on", camera_thumb_size: "large", camera_thumb_pos: "below" });
    const large = await boxes(page);
    expect(large.t.r - large.t.l).toBeGreaterThan(1.8 * (small.t.r - small.t.l));
    await boot(page, { camera_thumb: "on", camera_thumb_size: "small", camera_thumb_pos: "above" });
    const above = await boxes(page);
    expect(above.t.t).toBeLessThan(small.t.t);
  });
});

test.describe("S16.3 camera thumbnail, the View menu", () => {
  test("the menu turns it on, sets size and position, and remembers the pick", async ({ page }) => {
    await boot(page, {});
    await expect(thumbs(page)).toHaveCount(0);
    expect(await stateOf(page, "cam:off")).toBe("true");
    await pick(page, "cam:on");
    await expect(thumbs(page)).toHaveCount(1);
    const w0 = (await boxes(page)).t;
    await pick(page, "camsize:large");
    await expect.poll(async () => { const t = (await boxes(page)).t; return t.r - t.l; }).toBeGreaterThan(1.4 * (w0.r - w0.l)); // medium 96 to large 144: 1.5 times
    await pick(page, "campos:above");
    expect(await stateOf(page, "campos:above")).toBe("true");
    expect(await stateOf(page, "camsize:large")).toBe("true");
    await expect.poll(() => stored(page).then((s) => s?.cam)).toEqual({ on: true, size: "large", pos: "above" });
  });

  test("a camera-less floor has no thumbnail items", async ({ page }) => {
    await boot(page, { floor: "first", camera_thumb: "on" });
    await openMenu(page);
    await expect(menuItem(page, "cam:on")).toHaveCount(0);
  });
});

test.describe("S16.3 camera thumbnail, the refresh clock", () => {
  test("every 10 s a new request; a hidden tab asks for none; showing the tab again asks at once", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-21T09:00:00Z") });
    const seen = requests(page, "camera_proxy");
    await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.clock.runFor(1000); // let the first (failing) load settle
    const n0 = seen.length;
    await page.clock.runFor(10_000);
    await expect.poll(() => seen.length).toBeGreaterThan(n0);
    const stamps = seen.map((u) => +u.split("fp_t=")[1]!);
    expect(new Set(stamps).size).toBeGreaterThan(1);

    const hide = (hidden: boolean) => page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
    await hide(true);
    await page.clock.runFor(1000);
    const n1 = seen.length;
    await page.clock.runFor(60_000);
    await page.waitForTimeout(200);
    expect(seen.length).toBe(n1);
    await hide(false);
    await expect.poll(() => seen.length).toBeGreaterThan(n1);
  });

  test("a card taken off the page stops asking", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-21T09:00:00Z") });
    const seen = requests(page, "camera_proxy");
    await boot(page, { camera_thumb: "on" }, cam(PATH));
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.clock.runFor(1000);
    await page.evaluate(() => { const el = document.getElementById("card")!; (window as unknown as { __at: [Node, Node | null] }).__at = [el.parentNode!, el.nextSibling]; el.remove(); });
    const n = seen.length;
    await page.clock.runFor(60_000);
    await page.waitForTimeout(200);
    expect(seen.length).toBe(n);
  });
});

test.describe("S16.3 camera thumbnail, the CSS reaches the pixel (finding 10)", () => {
  test("the backing plate takes the room colour and the idle outline; the thumbnail is a pointer target", async ({ page }) => {
    await boot(page, { camera_thumb: "on" });
    const s = await card(page).evaluate((h) => {
      const root = h.shadowRoot!, bg = root.querySelector("rect.fp-cam-bg")!, g = root.querySelector("g.fp-cam-thumb")!;
      const probe = (v: string) => { const p = document.createElement("span"); p.style.color = `var(${v})`; root.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      return { fill: getComputedStyle(bg).fill, stroke: getComputedStyle(bg).stroke, room: probe("--fp-room"), idle: probe("--fp-idle"), cursor: getComputedStyle(g).cursor, events: getComputedStyle(g).pointerEvents };
    });
    expect(s.fill).toBe(s.room);
    expect(s.stroke).toBe(s.idle);
    expect(s.cursor).toBe("pointer");
    expect(s.events).not.toBe("none");
  });
});
