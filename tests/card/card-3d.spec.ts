import { test, expect, type Page } from "@playwright/test";
import { demo, open, serve, configure, card, viewSelect, canvas, holder, cam, drawn, ORIGIN } from "./helpers-3d";

// S12.3: the card's 3D view in real Chromium, loaded the way Home Assistant loads the card (a module under
// /floorplan_studio_static/ with a ?v= query, from the built www/ folder), so the chunk delivery is tested as shipped
// (spec gate K, criterion 3). Real mouse coordinates (finding 3), pixels read back from the canvas (finding 16).

const chunkRequests = (seen: string[]) => seen.filter((u) => /floorplan-studio-3d-[\w-]+\.js/.test(u));
const renderers = (page: Page) => page.evaluate(() => (customElements.get("floorplan-studio-card") as unknown as { liveRenderers: number }).liveRenderers);

/** Distinct colours in a PNG of the canvas, counted in the page (Playwright has no image decoder). */
async function colours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return set.size;
  }, png.toString("base64"));
}

test.describe("3D view: delivery (spec gate K, criterion 3)", () => {
  test("no 3D request before the user picks 3D, exactly one chunk request after, and nothing leaves the origin", async ({ page }) => {
    const seen = await open(page);
    await expect(card(page).locator("css=svg").first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(chunkRequests(seen), "the chunk is not fetched with the card").toEqual([]);
    expect(seen.some((u) => u.includes("floorplan-studio-card.js?v=9.9.9"))).toBe(true); // the card itself, as HA loads it
    await viewSelect(page).selectOption("3d");
    await expect(canvas(page)).toHaveCount(1);
    await drawn(page);
    const chunks = chunkRequests(seen);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatch(/^http:\/\/fp\.test\/floorplan_studio_static\/floorplan-studio-3d-[\w-]{6,}\.js$/); // beside the card, content-hashed
    // back to 2D and to 3D again: the module is cached, no second request
    await viewSelect(page).selectOption("2d");
    await viewSelect(page).selectOption("3d");
    await drawn(page);
    expect(chunkRequests(seen)).toHaveLength(1);
    expect(seen.filter((u) => !u.startsWith(`${ORIGIN}/`)), "no request leaves the page's own origin").toEqual([]);
  });
});

test.describe("3D view: the canvas", () => {
  test("it has a size and is not blank: the house is drawn in many colours, in a different light theme and a dark one", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", theme: "light" });
    await drawn(page);
    const box = (await canvas(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    expect(box.height).toBeGreaterThan(200);
    const light = await canvas(page).screenshot();
    expect(await colours(page, light)).toBeGreaterThan(12);
    await card(page).locator('css=select[aria-label="Theme"]').selectOption("midnight");
    await expect.poll(() => card(page).evaluate((el) => el.getAttribute("data-theme"))).toBe("midnight");
    await expect.poll(async () => (await cam(page)).drawn).toBeGreaterThan(1);
    const dark = await canvas(page).screenshot();
    expect(await colours(page, dark)).toBeGreaterThan(12);
    expect(dark.equals(light)).toBe(false); // the theme reached the pixels
  });

  test("a real mouse drag orbits; the wheel zooms; a right drag pans; the polar angle is clamped; none of it is a tap", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    const b = (await canvas(page).boundingBox())!, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const c0 = await cam(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await cam(page)).az).not.toBeCloseTo(c0.az, 2);
    const c1 = await cam(page);
    expect(c1.polar).toBeCloseTo(c0.polar, 3); // a sideways drag leaves the angle above the floor alone
    expect(await holder(page).evaluate((el) => (el.querySelector("canvas") as HTMLElement & { dataset: DOMStringMap }).dataset.dragged ?? "")).toBeDefined();

    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await cam(page)).dist).toBeLessThan(c1.dist);
    const closer = (await cam(page)).dist;
    await page.mouse.wheel(0, 2000);
    await expect.poll(async () => (await cam(page)).dist).toBeGreaterThan(closer);

    // down: the camera lifts to its limit and no further; up: it sinks to its limit, which is above the floor
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 900, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await cam(page)).polar).toBeCloseTo(0.1, 3);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy - 1800, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await cam(page)).polar).toBeCloseTo(1.45, 3);
    expect((await cam(page)).polar).toBeLessThan(Math.PI / 2);

    const t0 = (await cam(page)).target;
    await page.mouse.move(cx, cy); await page.mouse.down({ button: "right" }); await page.mouse.move(cx + 80, cy + 40, { steps: 6 }); await page.mouse.up({ button: "right" });
    await expect.poll(async () => (await cam(page)).target).not.toBe(t0);
  });

  test("a drag is reported as a drag and a click is not (S12.4 reads this)", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    const b = (await canvas(page).boundingBox())!, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.click(cx, cy);
    expect(await holder(page).getAttribute("data-dragged")).toBe("false");
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 4 }); await page.mouse.up();
    expect(await holder(page).getAttribute("data-dragged")).toBe("true");
  });

  test("3D, then back to 2D: the plan's svg is back, the canvas and its renderer are gone", async ({ page }) => {
    await open(page);
    expect(await renderers(page)).toBe(0);
    await viewSelect(page).selectOption("3d");
    await drawn(page);
    expect(await renderers(page)).toBe(1);
    await expect(card(page).locator("css=svg g[data-x]").first()).toHaveCount(0); // the plan is not drawn under the canvas
    await viewSelect(page).selectOption("2d");
    await expect(canvas(page)).toHaveCount(0);
    await expect(card(page).locator("css=svg g[data-x]").first()).toBeVisible();
    expect(await renderers(page)).toBe(0);
    // the tilt and walls controls belong to 2.5D alone
    await viewSelect(page).selectOption("3d");
    await expect(card(page).locator('css=input[aria-label="Tilt"]')).toHaveCount(0);
    await viewSelect(page).selectOption("2.5d");
    await expect(card(page).locator('css=input[aria-label="Tilt"]')).toHaveCount(1);
  });

  test("the view is remembered across a reload, and `view: 3d` in the config opens it", async ({ page }) => {
    await open(page);
    await viewSelect(page).selectOption("3d");
    await drawn(page);
    await page.reload();
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, { layout: structuredClone(demo), floor: "ground" });
    await expect(canvas(page)).toHaveCount(1);
    expect(await viewSelect(page).inputValue()).toBe("3d");
  });
});

test.describe("3D view: fallback (criterion 7)", () => {
  test("no WebGL: the card draws 2D and says why in one line, never a blank canvas", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        return /webgl/.test(kind) ? null : (orig as (...a: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof orig;
    });
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    const note = card(page).locator("css=.fp-3d-note");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(/WebGL/i);
    expect((await note.innerText()).split("\n")).toHaveLength(1);
    await expect(canvas(page)).toHaveCount(0);
    await expect(card(page).locator("css=svg g[data-x]").first()).toBeVisible();
    expect(await renderers(page)).toBe(0);
    // picking 2D clears the line
    await viewSelect(page).selectOption("2d");
    await expect(note).toHaveCount(0);
  });

  test("the chunk fails to load: 2D and one line", async ({ page }) => {
    await open(page);
    await page.route(/floorplan-studio-3d-.*\.js/, (r) => r.fulfill({ status: 500, body: "boom" }));
    await viewSelect(page).selectOption("3d");
    const note = card(page).locator("css=.fp-3d-note");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(/did not load/i);
    await expect(card(page).locator("css=svg g[data-x]").first()).toBeVisible();
  });

  test("the graphics context is lost: 2D and one line", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    await canvas(page).evaluate((c: HTMLCanvasElement) => c.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    const note = card(page).locator("css=.fp-3d-note");
    await expect(note).toContainText(/lost/i);
    await expect(canvas(page)).toHaveCount(0);
    await expect(card(page).locator("css=svg g[data-x]").first()).toBeVisible();
    expect(await renderers(page)).toBe(0);
  });
});

test.describe("3D view: lifecycle and hostile input", () => {
  test("20 connects and disconnects leave no renderer behind", async ({ page }) => {
    test.setTimeout(90_000); // 20 software-GL renderers: ~13 s alone, over 30 s when the whole suite shares the machine
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    for (let i = 0; i < 20; i++) {
      await page.evaluate(async () => {
        const el = document.getElementById("card")!, parent = el.parentElement!;
        el.remove();
        parent.appendChild(el);
        await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      });
      expect(await renderers(page), `after cycle ${i}`).toBeLessThanOrEqual(1);
    }
    await expect.poll(() => renderers(page)).toBe(1);
    await page.evaluate(() => document.getElementById("card")!.remove());
    expect(await renderers(page)).toBe(0);
  });

  test("5000 furniture pieces, a zero-height wall, a NaN size and a floor named __proto__ render or fall back, in a few seconds", async ({ page }) => {
    const bad = structuredClone(demo);
    const g = bad.floors.ground;
    g.furniture = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, symbol: "table", x: (i % 100) * 20, y: Math.floor(i / 100) * 20, rot: i % 360, w: 15, h: 15 }));
    g.walls.push({ id: "z", a: [0, 0], b: [300, 0], kind: "wall", height: 0 });
    // JSON.parse makes `__proto__` an own key, as a file a stranger wrote would; NaN and Infinity cannot be written in JSON, so they go in after the parse.
    const raw = JSON.stringify(bad).replace('"floors":{"ground":', '"floors":{"__proto__":');
    const errors: string[] = [];
    await serve(page);
    page.on("pageerror", (e) => errors.push(e.message));
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/harness.html`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(async (raw) => {
      const layout = JSON.parse(raw), f = Object.getOwnPropertyDescriptor(layout.floors, "__proto__")!.value;
      f.furniture.push({ id: "nan", symbol: "sofa", x: 10, y: 10, rot: 0, w: NaN, h: 50 }, { id: "inf", symbol: "table", x: Infinity, y: 0, rot: 0, w: 50, h: 50 });
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig({ layout, view: "3d" });
      el.hass = { states: {}, callService: () => undefined };
      await el.updateComplete;
    }, raw);
    await expect.poll(async () => (await canvas(page).count()) + (await card(page).locator("css=.fp-3d-note, p.msg").count()), { timeout: 8000 }).toBeGreaterThan(0);
    if (await canvas(page).count()) await drawn(page);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(errors).toEqual([]);
  });
});

const wallsSelect = (page: Page) => card(page).locator('css=select[aria-label="Walls"]');
const lowered = async (page: Page) => ((await holder(page).getAttribute("data-lowered")) ?? "").split(" ").filter(Boolean);

test.describe("3D view: walls mode (S12.4)", () => {
  test("Walls is a select in 3D, cut by default: walls facing the camera drop, the far ones stand; full none, low all", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    await expect(wallsSelect(page)).toHaveCount(1);
    expect(await wallsSelect(page).inputValue()).toBe("cut");
    await expect.poll(async () => (await lowered(page)).length).toBeGreaterThan(0);
    const cut = await lowered(page);
    await wallsSelect(page).selectOption("low");
    await expect.poll(async () => (await lowered(page)).length).toBeGreaterThan(cut.length);
    const all = await lowered(page);
    expect(all).toEqual(expect.arrayContaining(cut));
    await wallsSelect(page).selectOption("full");
    await expect.poll(async () => (await lowered(page)).length).toBe(0);
    await wallsSelect(page).selectOption("cut");
    await expect.poll(async () => (await lowered(page)).length).toBe(cut.length);
  });

  test("turning the house to the other side lowers the other walls, and a zoom does not change the set", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    await expect.poll(async () => (await lowered(page)).length).toBeGreaterThan(0);
    const south = await lowered(page);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await cam(page)).dist).toBeLessThan(1e9);
    expect(await lowered(page)).toEqual(south);
    const b = (await canvas(page).boundingBox())!, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 520, cy, { steps: 10 }); await page.mouse.up(); // about 180 degrees
    await expect.poll(async () => (await lowered(page)).join(" ")).not.toBe(south.join(" "));
  });

  test("the config's walls value is the 3D select's value, as in 2.5D", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", walls: "low" });
    await drawn(page);
    expect(await wallsSelect(page).inputValue()).toBe("low");
    await viewSelect(page).selectOption("2.5d");
    expect(await wallsSelect(page).inputValue()).toBe("low");
  });
});

test.describe("3D view: the Active list does not hide the model (S12.4)", () => {
  test("with the list open the camera frames the house in the free width", async ({ page }) => {
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    const h = (await holder(page).boundingBox())!, p = (await card(page).locator("css=.fp-active").boundingBox())!;
    await expect.poll(async () => +((await holder(page).getAttribute("data-inset")) ?? "0,0").split(",")[0]).toBeGreaterThan(0.05);
    const [l, r] = ((await holder(page).getAttribute("data-inset")) ?? "0,0").split(",").map(Number);
    expect(r).toBe(0);
    expect(l).toBeCloseTo((p.x + p.width - h.x) / h.width, 2); // the list's right edge, as a share of the view
    // a house centred in the free part: its pixels lie right of the list's edge, not under it
    await card(page).locator("css=.fp-active").evaluate((el: HTMLElement) => { el.style.visibility = "hidden"; }); // the list paints over the canvas: read the model alone
    const png = await canvas(page).screenshot();
    const edge = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let min = c.width, max = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (Math.abs(d[(y * c.width + x) * 4] - d[0]) + Math.abs(d[(y * c.width + x) * 4 + 1] - d[1]) + Math.abs(d[(y * c.width + x) * 4 + 2] - d[2]) > 24) { min = Math.min(min, x); max = Math.max(max, x); }
      return { min: min / c.width, max: max / c.width };
    }, png.toString("base64"));
    expect(edge.min).toBeGreaterThan((p.x + p.width - h.x) / h.width - 0.02); // nothing of the model under the list
    expect(edge.max).toBeLessThan(1.0);
  });
});
