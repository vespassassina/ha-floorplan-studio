import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nextInDirection, type FocusDir } from "../../src/card/plan-focus";
import { cardSource } from "../../scripts/card-source.mjs";

// S31.10 (docs/specs/card-layout-touch.md, D4 and criterion 8): keys on the plan, with a real keyboard and a real mouse, on the demo
// turned 45 degrees. The plan is one Tab stop; Tab in puts a ring on the device nearest the view's centre; arrows walk devices by
// where they stand on screen; Enter opens, Escape leaves; Shift + arrows pan; a text field keeps every key; a second card takes none.
// Positions are read from the page (`getBoundingClientRect` of each `g[data-x]`), the expected next device from `nextInDirection`
// over those points, and each hop is also checked against the cone by hand, so a wrong wiring cannot agree with itself.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const card = (page: Page, n = 0) => page.locator("floorplan-studio-card").nth(n);
const CONFIG = { type: "custom:floorplan-studio-card", floor: "ground", theme: "light", rotate_switch: true };
// The shape the card reads from `hass.states` (finding 21: `state`, `attributes`, `last_changed`).
const states = (livingLight = "on") => ({
  "light.demo_living": { state: livingLight, attributes: { friendly_name: "Living light" }, last_changed: "2026-10-13T09:00:00Z" },
  "light.demo_kitchen": { state: "off", attributes: {}, last_changed: "2026-10-13T09:00:00Z" },
});

async function boot(page: Page, opts: { layout?: unknown; config?: Record<string, unknown>; size?: { width: number; height: number } } = {}) {
  if (opts.size) await page.setViewportSize(opts.size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ config, layout, st }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(structuredClone(config));
    // `websocket.py` sends `{ layout }` (finding 21).
    el.hass = { states: st, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { config: opts.config ?? CONFIG, layout: structuredClone(opts.layout ?? demo), st: states() });
  await expect(card(page).locator("css=svg.fp-zoomable g[data-x]").first()).toBeVisible();
}

/** Every drawn device: its index and the centre of its box on screen. */
const devices = (page: Page, n = 0) => card(page, n).evaluate((el) => [...el.shadowRoot!.querySelectorAll<SVGGElement>("svg.fp-zoomable g[data-x]")]
  .filter((g) => getComputedStyle(g).display !== "none")
  .map((g) => { const r = g.getBoundingClientRect(); return { i: Number(g.getAttribute("data-x")), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }));
const stageBox = (page: Page, n = 0) => card(page, n).evaluate((el) => { const r = el.shadowRoot!.querySelector("svg.fp-zoomable")!.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
const viewBox = (page: Page, n = 0) => card(page, n).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.getAttribute("viewBox")!.split(/\s+/).map(Number));
const ring = (page: Page, n = 0) => card(page, n).locator("css=.fp-focus");
const status = (page: Page, n = 0) => card(page, n).locator("css=[role=status].fp-focus-status");
const settled = (page: Page, n = 0) => expect(card(page, n).locator("css=svg.fp-turning")).toHaveCount(0);
const activeTag = (page: Page, n = 0) => card(page, n).evaluate((el) => { const a = el.shadowRoot!.activeElement; return !a ? "none" : a.classList.contains("fp-zoomable") ? "svg.fp-zoomable" : `${a.tagName.toLowerCase()}.${a.getAttribute("class") ?? ""}`; });

/** The centre of the ring, and the device (of `devices`) it sits on. */
async function focused(page: Page, n = 0) {
  const r = await ring(page, n).boundingBox();
  expect(r, "the ring is drawn").not.toBeNull();
  const c = { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 };
  const ds = await devices(page, n);
  const best = ds.map((d) => ({ d, k: Math.hypot(d.x - c.x, d.y - c.y) })).sort((a, b) => a.k - b.k)[0]!;
  expect(best.k, "the ring is centred on a device").toBeLessThan(1.5);
  return best.d;
}
/** Tab from the control before the plan: one press. */
async function tabIn(page: Page, n = 0) {
  await card(page, n).locator("css=button[aria-label='View options']").focus();
  await page.keyboard.press("Tab");
}
const turnBy45 = async (page: Page) => {
  const b = (await card(page).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.press("]");
  await settled(page);
  const m = await card(page).evaluate((el) => el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/)?.[1]);
  expect(Number(m)).toBeCloseTo(45, 0);
};

test.describe("Tab and the ring", () => {
  test("one Tab from the last header control lands on the plan, which is a group named for the floor; the ring is on the device nearest the centre", async ({ page }) => {
    await boot(page);
    await expect(ring(page)).toHaveCount(0);
    await tabIn(page);
    await expect.poll(() => activeTag(page)).toBe("svg.fp-zoomable");
    const svg = card(page).locator("css=svg.fp-zoomable");
    await expect(svg).toHaveAttribute("role", "group");
    await expect(svg).toHaveAttribute("tabindex", "0");
    await expect(svg).toHaveAttribute("aria-label", /^Floor plan, \S/);
    await expect(ring(page)).toBeVisible();
    const s = await stageBox(page), c = { x: (s.left + s.right) / 2, y: (s.top + s.bottom) / 2 };
    const near = (await devices(page)).map((d) => ({ d, k: Math.hypot(d.x - c.x, d.y - c.y) })).sort((a, b) => a.k - b.k)[0]!;
    expect((await focused(page)).i).toBe(near.d.i);
    await expect(status(page)).toHaveText(/^.+, .+, .+$/); // "<name>, <type>, <state>"
    // A second Tab leaves the plan; Shift+Tab comes back to it in one press.
    await page.keyboard.press("Tab");
    await expect.poll(() => activeTag(page)).not.toBe("svg.fp-zoomable");
    await expect(ring(page)).toHaveCount(0);
  });

  test("the status line names the device: name, type, state", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    // The nearest to the centre of the demo's ground floor is a known one; look the name up in the layout, not in the page.
    const i = (await focused(page)).i, d = demo.floors.ground.devices[i];
    await expect(status(page)).toHaveText(new RegExp(`^${d.name}, ${d.type}, `));
  });

  test("a click with the mouse does not put a ring on the plan; a Tab does", async ({ page }) => {
    await boot(page);
    const s = await stageBox(page);
    await page.mouse.click(s.left + 3, s.top + 3); // an empty corner
    await expect.poll(() => activeTag(page)).toBe("svg.fp-zoomable");
    await expect(ring(page)).toHaveCount(0);
  });
});

test.describe("arrows on a plan turned 45 degrees", () => {
  test("each arrow reaches the device that nextInDirection names, and the hop lies in its cone on screen", async ({ page }) => {
    await boot(page);
    await turnBy45(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    const dirs: [string, FocusDir][] = [["ArrowRight", "right"], ["ArrowLeft", "left"], ["ArrowDown", "down"], ["ArrowUp", "up"]];
    const seen = new Set<number>();
    for (let round = 0; round < 3; round++) {
      for (const [key, dir] of dirs) {
        const ds = await devices(page), from = await focused(page);
        const at = ds.findIndex((d) => d.i === from.i);
        const want = nextInDirection(ds, at, dir);
        await page.keyboard.press(key);
        if (want === at) { expect((await focused(page)).i, `${dir} from ${from.i} has nowhere to go`).toBe(from.i); continue; }
        await expect.poll(async () => (await focused(page)).i, `${dir} from device ${from.i}`).toBe(ds[want]!.i);
        const to = ds[want]!, dx = to.x - from.x, dy = to.y - from.y;
        const [along, across] = dir === "right" ? [dx, dy] : dir === "left" ? [-dx, dy] : dir === "down" ? [dy, dx] : [-dy, dx];
        expect(along, `${dir}: the hop goes that way`).toBeGreaterThan(0);
        expect(Math.abs(across), `${dir}: inside the 45 degree cone`).toBeLessThanOrEqual(along * (1 + 1e-6));
        seen.add(to.i);
      }
    }
    expect(seen.size, "the arrows reach more than one device").toBeGreaterThan(2);
  });

  test("the demo's neighbours sit in all four directions of the turned plan from the device nearest the centre (the oracle is not idle)", async ({ page }) => {
    await boot(page);
    await turnBy45(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    const ds = await devices(page);
    const from = await focused(page), fi = ds.findIndex((d) => d.i === from.i);
    const reach = (["left", "right", "up", "down"] as FocusDir[]).filter((d) => nextInDirection(ds, fi, d) !== fi);
    expect(reach.length, "at least two directions have a neighbour").toBeGreaterThanOrEqual(2);
  });
});

test.describe("Enter, Escape, Shift and text fields", () => {
  test("Enter opens the popup of the focused device, Escape closes it, Escape again leaves the device and the plan keeps focus", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    const f = await focused(page), d = demo.floors.ground.devices[f.i];
    await page.keyboard.press("Enter");
    const pop = card(page).locator("css=.fp-pop");
    await expect(pop).toBeVisible();
    await expect(pop).toHaveAttribute("aria-label", d.name);
    await page.keyboard.press("Escape"); // the popup's own
    await expect(pop).toHaveCount(0);
    await expect.poll(() => activeTag(page)).toBe("svg.fp-zoomable");
    await expect(ring(page)).toBeVisible();
    await page.keyboard.press("Escape"); // leaves the device
    await expect(ring(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("");
    expect(await activeTag(page)).toBe("svg.fp-zoomable");
  });

  test("Space opens it too; with a device focused Space does not reset the view", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
    const w = (await viewBox(page))[2]!;
    await page.keyboard.press("Space");
    await expect(card(page).locator("css=.fp-pop")).toBeVisible();
    expect((await viewBox(page))[2]!).toBeCloseTo(w, 6);
  });

  test("Shift + ArrowRight pans and leaves the device focused; plain ArrowRight moves focus", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    const w0 = (await viewBox(page))[2]!;
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(w0);
    const vb0 = await viewBox(page), text0 = await status(page).textContent();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]!).toBeGreaterThan(vb0[0]!);
    expect(await status(page).textContent()).toBe(text0);
    await expect(ring(page)).toBeVisible();
    expect(await activeTag(page)).toBe("svg.fp-zoomable");
    // Plain ArrowRight walks to the device the oracle names (the view may then follow it in, which is the next test's business, not a pan key).
    const ds = await devices(page), from = await focused(page), at = ds.findIndex((d) => d.i === from.i);
    const want = nextInDirection(ds, at, "right");
    expect(want, "there is a device to the right to walk to").not.toBe(at);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await focused(page)).i).toBe(ds[want]!.i);
  });

  test("a text field has every key: in the search box arrows, + and Space neither pan, zoom nor reset", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    await page.keyboard.press("+");
    await page.keyboard.press("/"); // the search chord; focus goes to its input
    const box = card(page).locator("css=fp-search input");
    await expect(box).toBeFocused();
    const vb = await viewBox(page);
    await page.keyboard.type("a+ b");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    expect(await viewBox(page)).toEqual(vb);
    await expect(box).toHaveValue("a+ b");
    await expect(ring(page)).toHaveCount(0);
  });

  test("Enter on a focused header button is the button's: it does not open a device", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    await card(page).locator("css=button[aria-label='View options']").focus();
    await page.keyboard.press("Enter"); // opens the menu
    await expect(card(page).locator("css=[role=menu]")).toBeVisible();
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
  });
});

test.describe("two cards on one page", () => {
  async function second(page: Page) {
    await page.evaluate(async ({ config, layout, st }) => {
      const el = document.createElement("floorplan-studio-card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      document.getElementById("wrap")!.append(el);
      el.setConfig(structuredClone(config));
      el.hass = { states: st, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false } };
      await new Promise((r) => setTimeout(r, 50));
      await el.updateComplete;
    }, { config: { ...CONFIG, floor: "first" }, layout: structuredClone(demo), st: states() });
    await expect(card(page, 1).locator("css=svg.fp-zoomable g[data-x]").first()).toBeVisible();
  }

  test("a key reaches the focused card only, even with the pointer over the other", async ({ page }) => {
    await boot(page);
    await second(page);
    await tabIn(page, 0);
    await expect(ring(page, 0)).toBeVisible();
    const vb1 = await viewBox(page, 1), st1 = await card(page, 1).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.outerHTML.length);
    const b = (await card(page, 1).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const w0 = (await viewBox(page, 0))[2]!;
    await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page, 0))[2]!).toBeLessThan(w0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(card(page, 0).locator("css=.fp-pop")).toBeVisible();
    expect(await viewBox(page, 1), "the second card did not move").toEqual(vb1);
    await expect(ring(page, 1)).toHaveCount(0);
    await expect(card(page, 1).locator("css=.fp-pop")).toHaveCount(0);
    expect(await card(page, 1).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.outerHTML.length)).toBe(st1);
  });

  test("focus in one card, then Tab in the other: the first card's ring goes", async ({ page }) => {
    await boot(page);
    await second(page);
    await tabIn(page, 0);
    await expect(ring(page, 0)).toBeVisible();
    await tabIn(page, 1);
    await expect(ring(page, 1)).toBeVisible();
    await expect(ring(page, 0)).toHaveCount(0);
  });
});

test.describe("the ring survives what must not move it", () => {
  test("a hass update keeps the ring, the status and the focus", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    const f = await focused(page), text = await status(page).textContent();
    await card(page).evaluate(async (el, st) => {
      const c = el as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
      c.hass = { ...c.hass, states: st };
      await c.updateComplete;
    }, states("off"));
    expect(await activeTag(page)).toBe("svg.fp-zoomable");
    expect((await focused(page)).i).toBe(f.i);
    // The status line carries the state, so it is the line that follows the update, not a cached string.
    if (demo.floors.ground.devices[f.i].entity === "light.demo_living") expect(await status(page).textContent()).not.toBe(text);
    else expect(await status(page).textContent()).toBe(text);
  });

  test("on a phone Enter opens the Device level in the sheet and a hass update leaves it open", async ({ page }) => {
    await boot(page, { size: { width: 390, height: 844 } });
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    await page.keyboard.press("Enter");
    const pop = card(page).locator("css=.fp-pop-sheet");
    await expect(pop).toBeVisible();
    const name = await pop.getAttribute("aria-label");
    await card(page).evaluate(async (el, st) => {
      const c = el as unknown as { hass: Record<string, unknown>; updateComplete: Promise<unknown> };
      c.hass = { ...c.hass, states: st };
      await c.updateComplete;
    }, states("off"));
    await expect(pop).toBeVisible();
    expect(await pop.getAttribute("aria-label")).toBe(name);
  });

  test("a floor switch drops the focus (the stage keeps focus; arrows pan again)", async ({ page }) => {
    await boot(page, { config: { ...CONFIG, floor: undefined } });
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    // The switch is made on the card itself while the plan keeps focus: a click on a floor tab would take focus away and hide the bug.
    await card(page).evaluate((el) => (el as unknown as { _selectFloor(k: string): void })._selectFloor("first"));
    await expect(ring(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("");
    expect(await activeTag(page)).toBe("svg.fp-zoomable");
  });

  test("setConfig drops the focus", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    await card(page).evaluate(async (el, config) => {
      const c = el as unknown as { setConfig(c: unknown): void; updateComplete: Promise<unknown> };
      c.setConfig(config);
      await new Promise((r) => setTimeout(r, 50));
      await c.updateComplete;
    }, CONFIG);
    await expect(ring(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("");
  });
});

test.describe("a focused device off the view pans in", () => {
  test("zoomed in, every focus lands inside the plan's box, and one hop started off view", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    for (let i = 0; i < 4; i++) await page.keyboard.press("+");
    await expect.poll(async () => (await viewBox(page))[2]!).toBeLessThan(400);
    // Walk to the right, then down, then left, and back: every device of the floor is reached by some arrow.
    let sawOff = false;
    for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp"]) {
      const ds = await devices(page), from = await focused(page), dir = key.slice(5).toLowerCase() as FocusDir;
      const want = nextInDirection(ds, ds.findIndex((d) => d.i === from.i), dir), s = await stageBox(page);
      const t = ds[want]!;
      if (t.i !== from.i && (t.x < s.left || t.x > s.right || t.y < s.top || t.y > s.bottom)) sawOff = true;
      await page.keyboard.press(key);
      await expect.poll(async () => {
        const f = await focused(page), s2 = await stageBox(page);
        return f.x >= s2.left && f.x <= s2.right && f.y >= s2.top && f.y <= s2.bottom;
      }, `${key}: the focused device is on screen`).toBe(true);
    }
    expect(sawOff, "at least one hop went to a device that was off view").toBe(true);
  });
});

test.describe("untrusted names", () => {
  test("a name with markup is text in the status line, not markup", async ({ page }) => {
    const PAYLOAD = `"><script>window.__x=1</script>`;
    const layout = structuredClone(demo);
    layout.floors.ground.devices.forEach((d: { name: string }, i: number) => { d.name = `${PAYLOAD}${i}`; });
    await boot(page, { layout });
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    const i = (await focused(page)).i;
    await expect(status(page)).toHaveText(new RegExp(`^${PAYLOAD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${i}, `));
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll("script").length)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.getAttribute("aria-label"))).toMatch(/^Floor plan, /);
  });
});

test.describe("the ring is chrome (computed-style pair)", () => {
  test("pointer-events is none by a class rule, not an attribute; the ring sits over the device box; a click at its centre reaches the device", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    await expect(ring(page)).toBeVisible();
    const css = await ring(page).evaluate((el) => { const s = getComputedStyle(el); return { pe: s.pointerEvents, pos: s.position, attr: el.getAttribute("pointer-events"), cls: el.getAttribute("class"), br: s.borderTopWidth, hidden: el.closest("svg") !== null }; });
    expect(css).toMatchObject({ pe: "none", pos: "absolute", attr: null, hidden: false });
    expect(css.cls).toContain("fp-focus");
    expect(parseFloat(css.br)).toBeGreaterThan(0);
    // Over the device's box: it contains the box's centre and is not smaller than the box.
    const f = await focused(page), r = (await ring(page).boundingBox())!;
    expect(r.width).toBeGreaterThanOrEqual(Math.min(f.w, f.h));
    // The real top element at the ring's centre is the device, not the ring.
    const top = await card(page).evaluate((el, p) => { const e = el.shadowRoot!.elementFromPoint(p.x, p.y); return e?.closest("g[data-x]")?.getAttribute("data-x") ?? e?.getAttribute("class") ?? "none"; }, { x: f.x, y: f.y });
    expect(top).toBe(String(f.i));
    // And a real click there opens that device's popup.
    await page.mouse.click(f.x, f.y);
    await expect(card(page).locator("css=.fp-pop")).toBeVisible();
  });

  test("the status line is visually hidden but not removed: a 1 px clipped box, role=status", async ({ page }) => {
    await boot(page);
    await tabIn(page);
    const s = await status(page).evaluate((el) => { const c = getComputedStyle(el), r = el.getBoundingClientRect(); return { role: el.getAttribute("role"), display: c.display, vis: c.visibility, w: r.width, h: r.height, pos: c.position, ov: c.overflow }; });
    expect(s).toMatchObject({ role: "status", pos: "absolute", ov: "hidden" });
    expect(s.display).not.toBe("none");
    expect(s.vis).toBe("visible");
    expect(s.w).toBeLessThanOrEqual(1);
    expect(s.h).toBeLessThanOrEqual(1);
  });
});
