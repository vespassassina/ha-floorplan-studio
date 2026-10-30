import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, configure, card, canvas, holder, cam, drawn, box, camState, visibleBox, fitted, why, settled } from "./helpers-3d";

// S32.1 (docs/specs/card-3d-framing.md, criteria 1 to 9): where the 3D camera frames the house. The house is measured on the screen:
// the test hook (`__fp3d.box`, dist-test only) projects the eight corners of the box through the real camera, and the visible box
// is read from the DOM (the `.fp-3d` rect less the bottom sheet's cover at its `data-stop`, from the card's `--fp-sheet-*`).
// Real `page.mouse` at real coordinates throughout (CLAUDE.md finding 3); no `waitForTimeout`, waits are on `data-easing`,
// `data-drawn` and the stage's own rect. Where the next step has no state to wait on (the double-tap window, 350 ms, that a canvas
// tap waits out before it moves the camera) the wait is on the page's own clock, as `card-bottom-sheet.spec.ts` waits on frames.
//
// S32.7 removed the last `test.fail()` marks: criteria 5 to 9 pass for the room focus. At 390x844 two cases (a glide draws three frames; a drag
// ends the glide) had already passed for the bottom sheet's glide (S32.6); they now run for the room's as well and must keep passing.

type Size = readonly [number, number];
const SIZES: readonly Size[] = [[768, 1024], [1024, 768], [390, 844], [844, 390]];
const PHONE: Size = [390, 844], WIDE: Size = [1024, 768];
const name = (s: Size) => `${s[0]}x${s[1]}`;

const GROUND = demo.floors.ground;
const KITCHEN: number = GROUND.rooms.findIndex((r: { name: string }) => r.name === "Kitchen");
const centreOf = (room: { pts: [number, number][] }) => [room.pts.reduce((a, q) => a + q[0], 0) / room.pts.length, room.pts.reduce((a, q) => a + q[1], 0) / room.pts.length] as const;

// ---- the card at a size ----------------------------------------------------------------------------------------------------------

async function fit(page: Page, size: Size) {
  await page.evaluate(([w]) => { document.body.style.margin = "0"; (document.getElementById("wrap") as HTMLElement).style.width = `${w}px`; }, size);
}
/** The demo house in 3D at `size`, drawn and at rest. The card is told its width before its config, so the first draw is at that size. */
async function boot(page: Page, size: Size, extra: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await serve(page);
  await page.goto(`${ORIGIN}/harness.html`);
  await fit(page, size);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, { layout: structuredClone(demo), floor: "ground", view: "3d", ...extra });
  await drawn(page);
  await settled(page);
}
const stage = async (page: Page) => JSON.stringify(await holder(page).boundingBox());
/** Resizes the window and the card's wrap, waits for the stage to change, then for the camera to rest. */
async function resize(page: Page, size: Size) {
  const before = await stage(page);
  await page.setViewportSize({ width: size[0], height: size[1] });
  await fit(page, size);
  await expect.poll(() => stage(page), { timeout: 10000 }).not.toBe(before);
  await settled(page);
}
const frames = (page: Page, n = 2) => page.evaluate((n) => new Promise<void>((done) => { let k = 0; const f = () => (++k >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const now = (page: Page) => page.evaluate(() => performance.now());
/** Waits until the page's own clock is `ms` past `t0`: the double-tap window (350 ms) closing is time passing, not a state to poll. */
const after = (page: Page, t0: number, ms: number) => page.evaluate(([t0, ms]) => new Promise<void>((done) => { const f = () => (performance.now() - t0 >= ms ? done() : requestAnimationFrame(f)); f(); }), [t0, ms]);
const ring = (page: Page) => holder(page).getAttribute("data-ring");

type Cam = Awaited<ReturnType<typeof cam>>;
const target = (c: Cam) => c.target.split(",").map(Number) as [number, number];
const sameCam = (a: Cam, b: Cam) => { expect(a.az).toBeCloseTo(b.az, 4); expect(a.polar).toBeCloseTo(b.polar, 4); expect(Math.abs(a.dist / b.dist - 1), "distance").toBeLessThan(0.01); const [ax, az] = target(a), [bx, bz] = target(b); expect(Math.abs(ax - bx), "target x").toBeLessThan(1); expect(Math.abs(az - bz), "target z").toBeLessThan(1); };

/** The floor's box is fitted in what the eye can see. */
async function expectFloorFitted(page: Page, what = "the house") {
  const vis = await visibleBox(page), b = await box(page, "floor");
  expect(fitted(b, vis), `${what} is fitted in the visible box ${why(b, vis)}`).toBe(true);
}
async function expectRoomFitted(page: Page, room: number, what = "the room") {
  const vis = await visibleBox(page), b = await box(page, room);
  expect(fitted(b, vis), `${what} is fitted in the visible box ${why(b, vis)}`).toBe(true);
}

// ---- driving the page -------------------------------------------------------------------------------------------------------------

const proj = (page: Page, x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as unknown as { __fp3d: { project(x: number, y: number, z: number): { x: number; y: number } } }).__fp3d.project(x, y, z), [x, y, z] as const);
const picks = (page: Page, p: { x: number; y: number }) => page.evaluate((p) => (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y), p);
const floorOf = async (page: Page, room: number) => { const [cx, cy] = centreOf(GROUND.rooms[room]); return proj(page, cx, cy, 1); };

/** The camera never moves for a room under a tap before the double-tap window closes: the tap is a real click on the Kitchen's floor, and the wait is the page's clock. */
async function tapKitchen(page: Page) {
  await settled(page);
  const p = await floorOf(page, KITCHEN);
  expect(await picks(page, p), `what the view finds at ${Math.round(p.x)},${Math.round(p.y)}`).toEqual({ type: "room", index: KITCHEN });
  const t0 = await now(page);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ring(page)).toBe(String(KITCHEN));
  await after(page, t0, 450);
}
/** The header's Search, the letters, and a real click on the Kitchen room's result. */
/** `armed` runs after the Search panel is open and the stage at rest, just before the click that picks: opening Search narrows the stage at 768 px (a resize, not the pick). */
async function searchKitchen(page: Page, armed?: () => Promise<void>) {
  await settled(page);
  await card(page).getByRole("button", { name: "Search" }).click();
  await page.keyboard.type("Kitchen");
  if (armed) { await settled(page); await armed(); }
  const opt = card(page).locator("css=fp-search").locator("css=[role=\"option\"]").filter({ has: page.locator("css=.name", { hasText: /^Kitchen$/ }) });
  const t0 = await now(page);
  await opt.first().click();
  await expect.poll(() => ring(page)).toBe(String(KITCHEN));
  await after(page, t0, 150);
}
type How = "tap" | "search";
const HOWS: readonly How[] = ["tap", "search"];
const focusKitchen = (page: Page, how: How) => (how === "tap" ? tapKitchen(page) : searchKitchen(page));

/** A left drag on the canvas (orbit), at real coordinates, from the middle of the visible box. */
async function orbitDrag(page: Page, dx: number, dy = 0) {
  const v = await visibleBox(page), x = (v.left + v.right) / 2, y = (v.top + v.bottom) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await frames(page);
}
/** Hover the plan so the card owns the keyboard, then Escape. */
async function escape(page: Page) {
  const v = await visibleBox(page);
  await page.mouse.move((v.left + v.right) / 2, (v.top + v.bottom) / 2);
  await page.keyboard.press("Escape");
}
const handle = (page: Page) => card(page).locator("css=.fp-bottom .fp-handle");
const sheet = (page: Page) => card(page).locator("css=.fp-bottom");

// ---- criterion 1: first draw -----------------------------------------------------------------------------------------------------

test.describe("S32.1 criterion 1: the first draw fits the house", () => {
  for (const size of SIZES) for (const rotation of [0, 45]) {
    test(`${name(size)}, plan turned ${rotation} degrees`, async ({ page }) => {
      await boot(page, size, { rotation });
      await expectFloorFitted(page);
    });
  }
});

// ---- criterion 2: a resize re-fits a camera nobody has moved ---------------------------------------------------------------------

test.describe("S32.1 criterion 2: a resize re-fits the house", () => {
  const PAIRS: readonly (readonly [Size, Size])[] = [[[1024, 768], [768, 1024]], [[768, 1024], [1024, 768]], [[390, 844], [844, 390]], [[844, 390], [390, 844]], [[390, 844], [360, 844]]];
  for (const [from, to] of PAIRS) {
    test(`${name(from)} to ${name(to)}`, async ({ page }) => {
      await boot(page, from);
      await resize(page, to);
      await expectFloorFitted(page);
    });
  }
  // Opus review: criterion 2 was only guarded at the start angles and for the floor. These two take the other branches of the orbit's refit.
  test("1024x768 to 768x1024: a room focused stays fitted to the room after a resize", async ({ page }) => {
    await boot(page, WIDE);
    await focusKitchen(page, "search");
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the Kitchen before the resize");
    await resize(page, [768, 1024]);
    await expectRoomFitted(page, KITCHEN, "the Kitchen after the resize");
  });
  test("1024x768 to 768x1024: a floor reframed at turned angles, then left alone, is fitted again exactly on a resize", async ({ page }) => {
    // The drag leaves the start angles; the floor tab reframes the new floor at those angles and marks it framed (nobody has moved it).
    await boot(page, WIDE, { floor: "all" });
    const start = await camState(page);
    await orbitDrag(page, 120, 40);
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await expect(card(page).locator("css=.fp-floors button", { hasText: "First" })).toHaveAttribute("aria-pressed", "true");
    await settled(page);
    const turned = await camState(page);
    expect(Math.abs(turned.az - start.az) > 0.1 && Math.abs(turned.polar - start.polar) > 0.01, "the angles are not the start angles").toBe(true);
    await expectFloorFitted(page, "the First floor before the resize");
    await resize(page, [768, 1024]);
    await expectFloorFitted(page, "the First floor after the resize");
  });
  test("1024x768: the side sheet folded and opened (a real click on its button)", async ({ page }) => {
    await boot(page, WIDE);
    const before = await stage(page);
    await card(page).getByRole("button", { name: "Fold overview" }).click();
    await expect.poll(() => stage(page)).not.toBe(before);
    await settled(page);
    await expectFloorFitted(page, "the house after the sheet folded");
    const folded = await stage(page);
    await card(page).getByRole("button", { name: "Open overview" }).click();
    await expect.poll(() => stage(page)).not.toBe(folded);
    await settled(page);
    await expectFloorFitted(page, "the house after the sheet opened");
  });
});

// ---- criterion 3: a resize keeps a camera the person has moved -------------------------------------------------------------------

test.describe("S32.1 criterion 3: a resize does not snap a moved camera", () => {
  /** The house's width over the visible width, from the hook's box. */
  const share = async (page: Page) => { const b = (await box(page, "floor"))!, v = await visibleBox(page); return (b.right - b.left) / (v.right - v.left); };
  async function moved(page: Page) {
    const v = await visibleBox(page), x = (v.left + v.right) / 2, y = (v.top + v.bottom) / 2;
    await orbitDrag(page, 120);
    await page.mouse.move(x, y);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
    await frames(page, 3);
    await settled(page);
  }
  for (const to of [[768, 1024], [390, 844]] as const) {
    test(`1024x768 to ${name(to)}: angles, target and zoom stay, the house keeps its share of the visible width`, async ({ page }) => {
      // 1024x768 to 768x1024 is the spec's pair; the stage is 704 px wide at the one and 716 at the other, so a camera that never
      // follows the box still keeps its width share within 3 % : the phone pair, 704 to 390, is the one that tells.
      await boot(page, WIDE);
      await moved(page);
      const a = await cam(page), z = (await camState(page)).zoom, s = await share(page);
      await resize(page, to);
      const b = await cam(page);
      expect(b.az).toBeCloseTo(a.az, 4);
      expect(b.polar).toBeCloseTo(a.polar, 4);
      expect((await camState(page)).zoom).toBeCloseTo(z, 3);
      expect(b.target).toBe(a.target);
      expect(Math.abs((await share(page)) / s - 1), "the house's width over the visible width").toBeLessThan(0.03);
    });
  }
});

// ---- criterion 4: the bottom sheet ---------------------------------------------------------------------------------------------

/** Handle to a stop: down, ten moves `dy` px, a rest, up (as card-bottom-sheet.spec.ts: a rest is not a fling). */
async function dragHandle(page: Page, dy: number) {
  // The sheet's height is a 0.2 s CSS transition: read the handle only once it has stopped (3 equal frames), or the drag starts short.
  let b = (await handle(page).boundingBox())!;
  for (let same = 0; same < 3; ) {
    await frames(page, 1);
    const n = (await handle(page).boundingBox())!;
    same = n.y === b.y ? same + 1 : 0;
    b = n;
  }
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + (dy * i) / 10);
  await frames(page, 10);
  await page.mouse.up();
}

test.describe("S32.1 criterion 4: the house above the bottom sheet", () => {
  test("390x844: a tap on the handle (half) frames the house above the sheet", async ({ page }) => {
    await boot(page, PHONE);
    await handle(page).click();
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "half");
    await settled(page);
    const vis = await visibleBox(page);
    expect(vis.cover, "the sheet covers the lower part of the stage at half").toBeGreaterThan(100);
    await expectFloorFitted(page, "the house above the half sheet");
  });
  test("390x844: half, then full leaves the camera alone, then back to peek frames the whole stage, as the first draw did", async ({ page }) => {
    await boot(page, PHONE);
    const first = (await box(page, "floor"))!;
    await handle(page).click();
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "half");
    await settled(page);
    await expectFloorFitted(page, "the house above the half sheet");
    const half = await cam(page);
    await dragHandle(page, -240);
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "full");
    await settled(page);
    sameCam(await cam(page), half);
    await handle(page).click(); // full goes to half
    await handle(page).click(); // half goes to peek
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "peek");
    await settled(page);
    const back = (await box(page, "floor"))!;
    for (const k of ["left", "top", "right", "bottom"] as const) expect(Math.abs(back[k] - first[k]), `${k} against the first draw`).toBeLessThan(2);
  });
  test("390x844, reduced motion: the camera goes from one framing to the other with no frame between", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, PHONE);
    await holder(page).evaluate((el) => {
      const w = window as unknown as { __seen: string[] };
      const read = () => `${el.dataset.dist}|${el.dataset.target}`;
      w.__seen = [read()];
      new MutationObserver(() => { const v = read(); if (w.__seen[w.__seen.length - 1] !== v) w.__seen.push(v); }).observe(el, { attributes: true, attributeFilter: ["data-dist", "data-target"] });
    });
    await handle(page).click();
    await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "half");
    await settled(page);
    await expectFloorFitted(page, "the house above the half sheet");
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen.length, `the camera values seen: ${seen.join(" ; ")}`).toBe(2);
  });
});

// ---- S32.6: the glide on a cover change ------------------------------------------------------------------------------------------
// F1: a cover change from a stop eases (data-easing, 400 ms); a canvas resize jumps; a drag of the handle moves nothing; a drag or
// wheel on the canvas ends a glide where it is; reduced motion jumps (the case above). The recorder samples on every animation frame.

test.describe("S32.6: the camera glides to the new framing when the sheet changes stop", () => {
  /** Records, from now on and on every animation frame, the camera values and whether `data-easing` is set. */
  const record = (page: Page) => holder(page).evaluate((el) => {
    const w = window as unknown as { __rec: { dist: number; target: string; ease: boolean; drawn: number }[]; __go: boolean };
    w.__rec = []; w.__go = true;
    const f = () => { if (!w.__go) return; w.__rec.push({ dist: +el.dataset.dist!, target: el.dataset.target!, ease: el.hasAttribute("data-easing"), drawn: +(el.dataset.drawn ?? 0) }); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const stopRec = (page: Page) => page.evaluate(() => { const w = window as unknown as { __rec: { dist: number; target: string; ease: boolean; drawn: number }[]; __go: boolean }; w.__go = false; return w.__rec; });

  test("390x844: peek to half eases through at least three distinct framings, one way, and ends fitted", async ({ page }) => {
    await boot(page, PHONE);
    const start = await cam(page);
    await record(page);
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute("data-stop", "half");
    await settled(page);
    const rec = await stopRec(page);
    const end = await cam(page);
    const eased = rec.filter((r) => r.ease);
    expect(eased.length, "frames with data-easing set").toBeGreaterThanOrEqual(3);
    const mid = new Set(eased.map((r) => `${r.dist}|${r.target}`));
    expect(mid.size, "distinct camera values while easing").toBeGreaterThanOrEqual(3);
    const lo = Math.min(start.dist, end.dist), hi = Math.max(start.dist, end.dist);
    for (const r of rec) expect(r.dist, "distance stays between the two framings").toBeGreaterThanOrEqual(lo - 0.2);
    for (const r of rec) expect(r.dist).toBeLessThanOrEqual(hi + 0.2);
    expect(end.dist, "half is not the full-stage framing").not.toBeCloseTo(start.dist, 0);
    await expectFloorFitted(page, "the house above the half sheet");
  });

  test("390x844: a half-way drag of the handle moves the camera not at all; the snap does", async ({ page }) => {
    await boot(page, PHONE);
    const before = await cam(page);
    const b = (await handle(page).boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - 20 * i);
    await frames(page, 12);
    const during = await cam(page);
    expect(during.dist, "no camera change while the handle is held").toBe(before.dist);
    expect(during.target).toBe(before.target);
    expect(await holder(page).getAttribute("data-easing"), "no glide while the handle is held").toBeNull();
    await page.mouse.up();
    await expect(sheet(page)).not.toHaveAttribute("data-stop", "peek");
    await settled(page);
    expect((await cam(page)).dist, "the snap framed the house above the sheet").not.toBe(before.dist);
    await expectFloorFitted(page, "the house above the sheet it snapped to");
  });

  for (const how of ["wheel", "drag"] as const) test(`390x844: a ${how} on the canvas during the glide ends it where it is`, async ({ page }) => {
    await boot(page, PHONE);
    await page.evaluate(() => (window as unknown as { __fp3d: { glideMs(ms: number): void } }).__fp3d.glideMs(20000)); // slow, so the touch lands while it runs
    await handle(page).click();
    await expect(holder(page)).toHaveAttribute("data-easing", "");
    const c = (await canvas(page).boundingBox())!, x = c.x + c.width / 2, y = c.y + 100;
    await page.mouse.move(x, y);
    if (how === "wheel") await page.mouse.wheel(0, 1);
    else { await page.mouse.down(); await page.mouse.move(x + 20, y + 8); await page.mouse.up(); }
    await frames(page, 3);
    expect(await holder(page).getAttribute("data-easing"), "the touch ended the glide").toBeNull();
    const a = await cam(page);
    await frames(page, 30);
    const b = await cam(page);
    expect(b.dist, "no frame after the touch changes the distance").toBe(a.dist);
    expect(b.target).toBe(a.target);
    expect(b.az).toBe(a.az);
  });

  test("1024x768 to 768x1024: a canvas resize jumps, with no glide", async ({ page }) => {
    await boot(page, WIDE);
    await holder(page).evaluate((el) => {
      const w = window as unknown as { __ease: number };
      w.__ease = 0;
      new MutationObserver(() => { if (el.hasAttribute("data-easing")) w.__ease++; }).observe(el, { attributes: true, attributeFilter: ["data-easing"] });
    });
    await resize(page, [768, 1024]);
    await expectFloorFitted(page, "the house after the resize");
    expect(await page.evaluate(() => (window as unknown as { __ease: number }).__ease), "data-easing set during a resize").toBe(0);
  });

  test("390x844: peek, half, full, peek, half: each end fitted, full leaves the camera, no value outside the two framings", async ({ page }) => {
    await boot(page, PHONE);
    const first = await cam(page);
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute("data-stop", "half");
    await settled(page);
    const half = await cam(page);
    await dragHandle(page, -240); // half to full
    await expect(sheet(page)).toHaveAttribute("data-stop", "full");
    await settled(page);
    expect((await cam(page)).dist, "full keeps the half framing").toBe(half.dist);
    await record(page);
    await handle(page).click(); // full to half: the same framing, nothing to glide
    await settled(page);
    await handle(page).click(); // half to peek
    await expect(sheet(page)).toHaveAttribute("data-stop", "peek");
    await settled(page);
    const back = await cam(page);
    expect(back.dist, "peek frames the whole stage as the first draw did").toBeCloseTo(first.dist, 0);
    for (const r of await stopRec(page)) { expect(r.dist).toBeGreaterThanOrEqual(Math.min(half.dist, first.dist) - 0.2); expect(r.dist).toBeLessThanOrEqual(Math.max(half.dist, first.dist) + 0.2); }
    await expectFloorFitted(page, "the whole stage at peek");
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute("data-stop", "half");
    await settled(page);
    expect((await cam(page)).dist, "half again").toBeCloseTo(half.dist, 0);
    await expectFloorFitted(page, "the house above the half sheet again");
  });

  test("390x844, a moved camera: fast taps peek, half, peek, half, peek leave the zoom where it was (Opus review)", async ({ page }) => {
    // A moved camera keeps its zoom multiple across a sheet change: its distance is scaled by the unit's ratio. A tap that lands while the last
    // glide runs used to scale from the mid-glide distance, so the zoom drifted a little with every quick tap.
    await boot(page, PHONE);
    const v = await visibleBox(page);
    await page.mouse.move((v.left + v.right) / 2, (v.top + v.bottom) / 2);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
    await frames(page, 3);
    await settled(page);
    const z0 = (await camState(page)).zoom;
    await page.evaluate(() => (window as unknown as { __fp3d: { glideMs(ms: number): void } }).__fp3d.glideMs(1500)); // slow enough that each tap lands mid-glide
    for (const stop of ["half", "peek", "half", "peek"]) {
      await handle(page).click();
      await expect(sheet(page)).toHaveAttribute("data-stop", stop);
      await frames(page, 8);
    }
    await settled(page);
    expect((await camState(page)).zoom, "the zoom after four quick taps, back at peek").toBeCloseTo(z0, 3);
  });
});

// ---- criterion 5: room focus -----------------------------------------------------------------------------------------------------

// The spec also names "its row": the sheet has no row that picks a room (rows are devices, and a device does not move the camera,
// Q4), so the paths are a tap on the room's floor and its Search result. The report says so.
test.describe("S32.1 criterion 5: a room pick frames the room", () => {
  for (const size of SIZES) for (const how of HOWS) {
    test(`${name(size)}, by ${how}`, async ({ page }) => {
      await boot(page, size);
      const pre = await cam(page);
      await focusKitchen(page, how);
      await settled(page);
      await expectRoomFitted(page, KITCHEN, "the Kitchen");
      const post = await cam(page);
      expect(post.az).toBeCloseTo(pre.az, 4);
      expect(post.polar).toBeCloseTo(pre.polar, 4);
      // The picture is what the pick sees: the room's projected centre picks the Kitchen, and a real click there lets it go again.
      const p = await floorOf(page, KITCHEN);
      expect(await picks(page, p), "what the view finds at the Kitchen's projected centre").toEqual({ type: "room", index: KITCHEN });
      await page.mouse.click(p.x, p.y);
      await expect.poll(() => ring(page)).toBe("");
    });
  }
});

// ---- criterion 6: unfocus --------------------------------------------------------------------------------------------------------

test.describe("S32.1 criterion 6: leaving the room goes back to the camera it had", () => {
  const WAYS = ["Escape", "Back", "a tap on the background"] as const;
  for (const size of SIZES) for (const way of WAYS) {
    test(`${name(size)}, ${way}`, async ({ page }) => {
      await boot(page, size);
      // Premise (S32.7): on a phone a pick opens the sheet to half and Back leaves it there, so the camera Back returns to is the floor framed
      // above the half sheet. The pre-focus camera is taken at that stop (the handle tapped first), not at peek: framed in a different box, 1.2 % apart.
      if (name(size) === name(PHONE)) {
        await handle(page).click();
        await expect(card(page).locator("css=.fp-bottom")).toHaveAttribute("data-stop", "half");
        await settled(page);
      }
      const pre = await cam(page);
      await focusKitchen(page, "search");
      await settled(page);
      await expectRoomFitted(page, KITCHEN, "the Kitchen (the camera is focused before it is left)");
      if (way === "Escape") await escape(page);
      else if (way === "Back") await card(page).getByRole("button", { name: "Back" }).click();
      else {
        const c = (await canvas(page).boundingBox())!, x = c.x + 6, y = c.y + 6;
        const hit = (await picks(page, { x, y })) as { type?: string } | null;
        expect(hit?.type, "the canvas corner is no room").not.toBe("room");
        const t0 = await now(page);
        await page.mouse.click(x, y);
        await after(page, t0, 450);
      }
      await expect.poll(() => ring(page)).toBe("");
      await settled(page);
      sameCam(await cam(page), pre);
    });
  }
  test("1024x768: a floor tab drops the focus and frames the new floor", async ({ page }) => {
    await boot(page, WIDE, { floor: "all" });
    await focusKitchen(page, "search");
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the Kitchen");
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await expect(card(page).locator("css=.fp-floors button", { hasText: "First" })).toHaveAttribute("aria-pressed", "true");
    await settled(page);
    expect(await ring(page)).toBe("");
    await expectFloorFitted(page, "the First floor");
  });

  test("1024x768: a floor tab pressed inside the canvas tap's hold never frames a room of the new floor (Opus review, blocker)", async ({ page }) => {
    // Premise: the Kitchen is focused; a canvas tap on Living starts the 350 ms hold, and the tab is pressed at once, inside it. The held index
    // (Kitchen, 1) used to reach the view as a pick on First, whose room 1 is the Bathroom: the camera jumped there for ~750 ms and glided back.
    const tab = (n: string) => card(page).locator("css=.fp-floors button", { hasText: n });
    await boot(page, WIDE, { floor: "all" });
    await tab("First").click();
    await settled(page);
    const [fx, fz] = target(await cam(page)); // the First floor's own fit, at rest
    await tab("Ground").click();
    await settled(page);
    await searchKitchen(page);
    await settled(page);
    const living = await floorOf(page, 0);
    expect(await picks(page, living)).toEqual({ type: "room", index: 0 });
    await holder(page).evaluate((el) => {
      const w = window as unknown as { __rec: { target: string }[]; __go: boolean };
      w.__rec = []; w.__go = true;
      const f = () => { if (!w.__go) return; w.__rec.push({ target: el.dataset.target! }); requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const t0 = await now(page);
    await page.mouse.click(living.x, living.y); // Living: the hold starts, the Kitchen's index is still the one held
    await tab("First").click();
    await expect(tab("First")).toHaveAttribute("aria-pressed", "true");
    await after(page, t0, 450); // the hold has closed (the page's clock), then the camera rests
    await settled(page);
    const rec = await page.evaluate(() => { const w = window as unknown as { __rec: { target: string }[]; __go: boolean }; w.__go = false; return w.__rec; });
    const [ex, ez] = target(await cam(page));
    expect(Math.hypot(ex - fx, ez - fz), "ends at the First floor's fit").toBeLessThan(1);
    const [bx, bz] = centreOf(demo.floors.first.rooms[1]); // the Bathroom
    const near = Math.min(...rec.map((r) => { const [tx, tz] = r.target.split(",").map(Number); return Math.hypot(tx - bx, tz - bz); }));
    // The Bathroom's fit looks at its centre (600,150); the Kitchen's own start is 70 cm off it, so only the fit itself is under 20.
    expect(near, "no frame looks at the Bathroom's centre").toBeGreaterThan(20);
  });
});

// ---- criterion 7: motion ----------------------------------------------------------------------------------------------------------

test.describe("S32.1 criterion 7: the glide", () => {
  for (const size of SIZES) {
    test(`${name(size)}: a glide draws at least three frames`, async ({ page }) => {
      await boot(page, size);
      await holder(page).evaluate((el) => {
        const w = window as unknown as { __ease: { began: number | null; ended: number | null } };
        w.__ease = { began: null, ended: null };
        new MutationObserver(() => {
          const on = el.dataset.easing !== undefined, d = +(el.dataset.drawn ?? 0);
          if (on && w.__ease.began === null) w.__ease.began = d;
          if (!on && w.__ease.began !== null && w.__ease.ended === null) w.__ease.ended = d;
        }).observe(el, { attributes: true, attributeFilter: ["data-easing", "data-drawn"] });
      });
      await searchKitchen(page);
      await settled(page);
      const e = await page.evaluate(() => (window as unknown as { __ease: { began: number | null; ended: number | null } }).__ease);
      expect(e.began, "data-easing appeared").not.toBeNull();
      expect(e.ended! - e.began!, `frames drawn while easing ${JSON.stringify(e)}`).toBeGreaterThanOrEqual(3);
    });
    test(`${name(size)}, reduced motion: the room is framed with no frame between`, async ({ page }) => {
      // Premise: the count starts when the Search panel is open (at 768 px opening it narrows the stage, a resize with its own step), so it
      // counts the pick's own steps: one.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await boot(page, size);
      await searchKitchen(page, () => holder(page).evaluate((el) => {
        const w = window as unknown as { __seen: string[] };
        const read = () => `${el.dataset.dist}|${el.dataset.target}`;
        w.__seen = [read()];
        new MutationObserver(() => { const v = read(); if (w.__seen[w.__seen.length - 1] !== v) w.__seen.push(v); }).observe(el, { attributes: true, attributeFilter: ["data-dist", "data-target"] });
      }));
      await settled(page);
      await expectRoomFitted(page, KITCHEN, "the Kitchen");
      const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
      expect(seen.length, `the camera values seen: ${seen.join(" ; ")}`).toBe(2);
    });
  }
  for (const size of [WIDE, PHONE]) {
    test(`${name(size)}: a double tap on a room moves the camera not at all`, async ({ page }) => {
      // A guard for S32.7's delay, not a red case. Premise (S32.5): on a phone the pick opens the sheet to half and the house is framed above
      // it (criterion 4), so the camera moves for that reason alone; what must not happen is a glide into the room, so the floor stays fitted.
      await boot(page, size);
      const pre = await cam(page);
      const p = await floorOf(page, KITCHEN);
      expect(await picks(page, p)).toEqual({ type: "room", index: KITCHEN });
      const t0 = await now(page);
      await page.mouse.dblclick(p.x, p.y);
      await after(page, t0, 700);
      await settled(page);
      if (size === PHONE) await expectFloorFitted(page, "the house above the half sheet, not zoomed into the room");
      else sameCam(await cam(page), pre);
    });
    if (size === WIDE) test(`${name(size)}: a double tap shows no frame with the camera anywhere else (the delay, not only the end state)`, async ({ page }) => {
      // The end state above would also hold if the camera glided into the room and the second tap's restore glided it back. This one records
      // every camera value drawn from before the pair to well after the window: one value, and `data-easing` never set.
      await boot(page, size);
      await holder(page).evaluate((el) => {
        const w = window as unknown as { __seen: string[]; __ease: boolean };
        const read = () => `${el.dataset.dist}|${el.dataset.target}|${el.dataset.az}|${el.dataset.polar}`;
        w.__seen = [read()]; w.__ease = false;
        new MutationObserver(() => { const v = read(); if (w.__seen[w.__seen.length - 1] !== v) w.__seen.push(v); if (el.hasAttribute("data-easing")) w.__ease = true; }).observe(el, { attributes: true, attributeFilter: ["data-dist", "data-target", "data-az", "data-polar", "data-easing"] });
      });
      const p = await floorOf(page, KITCHEN);
      expect(await picks(page, p)).toEqual({ type: "room", index: KITCHEN });
      const t0 = await now(page);
      await page.mouse.dblclick(p.x, p.y);
      await after(page, t0, 900);
      const seen = await page.evaluate(() => { const w = window as unknown as { __seen: string[]; __ease: boolean }; return { values: w.__seen, ease: w.__ease }; });
      expect(seen.values, "camera values drawn").toHaveLength(1);
      expect(seen.ease, "data-easing was set").toBe(false);
    });
    test(`${name(size)}: a real drag during the glide ends it`, async ({ page }) => {
      await boot(page, size);
      await page.evaluate(() => (window as unknown as { __fp3d: { glideMs(ms: number): void } }).__fp3d.glideMs(20000)); // slow, so the touch lands while it runs, however loaded the machine
      await card(page).getByRole("button", { name: "Search" }).click();
      await page.keyboard.type("Kitchen");
      const opt = card(page).locator("css=fp-search").locator("css=[role=\"option\"]").filter({ has: page.locator("css=.name", { hasText: /^Kitchen$/ }) });
      await opt.first().click();
      await expect.poll(() => holder(page).getAttribute("data-easing"), { timeout: 3000, message: "the glide shows data-easing" }).not.toBeNull();
      const v = await visibleBox(page), x = (v.left + v.right) / 2, y = v.top + 40;
      // The Search overlay can still lie over this point under load: hover waits until the canvas itself is the top element there (a real touch must reach it).
      const cb = (await canvas(page).boundingBox())!;
      await canvas(page).hover({ position: { x: x - cb.x, y: y - cb.y } });
      await page.mouse.down();
      const mid = await cam(page);
      expect(await holder(page).getAttribute("data-easing"), "a pointer down on the canvas stops the glide").toBeNull();
      await page.mouse.move(x + 30, y, { steps: 6 });
      await page.mouse.up();
      await frames(page, 6);
      await settled(page);
      const end = await cam(page);
      expect(end.dist, "no frame after the drag moves the camera's distance").toBe(mid.dist);
      expect(end.target, "nor its target").toBe(mid.target);
    });
  }
});

// ---- criterion 8: memory ---------------------------------------------------------------------------------------------------------

test.describe("S32.1 criterion 8: the focus is never stored", () => {
  const stored = (page: Page) => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => JSON.parse(v) as { floors?: [string, { cam?: unknown }][] }));
  test("1024x768: focus, orbit 60 px, reload: the orbit's angles, the zoom from before the focus", async ({ page }) => {
    await boot(page, WIDE);
    const zoom = (await camState(page)).zoom;
    await focusKitchen(page, "search");
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the Kitchen");
    await orbitDrag(page, 60);
    await settled(page);
    const turned = await cam(page);
    await expect.poll(async () => !!(await stored(page))[0]?.floors?.find(([k]) => k === "ground")?.[1].cam, { timeout: 5000 }).toBe(true);
    await page.reload();
    await fit(page, WIDE);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
    await drawn(page);
    await settled(page);
    const back = await cam(page);
    expect(back.az).toBeCloseTo(turned.az, 3);
    expect(back.polar).toBeCloseTo(turned.polar, 3);
    expect((await camState(page)).zoom, "the pre-focus zoom, not the Kitchen's").toBeCloseTo(zoom, 3);
  });
  test("1024x768: Reset camera while focused goes to the first view, drops the focus, keeps the ring", async ({ page }) => {
    await boot(page, WIDE);
    const first = await cam(page);
    await focusKitchen(page, "search");
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the Kitchen");
    await card(page).locator("css=button[aria-label=\"Reset camera\"]").click();
    await settled(page);
    sameCam(await cam(page), first);
    expect(await ring(page), "the room stays picked").toBe(String(KITCHEN));
    await expectFloorFitted(page, "the house");
  });
});

// ---- criterion 9: hostile ---------------------------------------------------------------------------------------------------------

test.describe("S32.1 criterion 9: hostile cases", () => {
  test("two cards on one page: a pick in one moves only its camera", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await serve(page);
    await page.goto(`${ORIGIN}/harness.html`);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    const setup = (layout: unknown, id: string) => page.evaluate(([layout, id]) => {
      const c = document.getElementById(id as string) as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      c.setConfig({ layout: structuredClone(layout), floor: "ground", view: "3d" });
      c.hass = { states: {}, callService: () => undefined };
      return c.updateComplete;
    }, [layout, id] as const);
    const hold = (n: number) => card(page).nth(n).locator("css=.fp-3d");
    const camN = (n: number) => hold(n).evaluate((el) => `${el.dataset.az}|${el.dataset.polar}|${el.dataset.dist}|${el.dataset.target}`);
    const hasDrawn = (n: number) => expect.poll(async () => +((await hold(n).getAttribute("data-drawn")) ?? 0), { timeout: 15000 }).toBeGreaterThan(0);
    // The first card is drawn before the second exists: the test hook (`__fp3d`) is the last card's, so the tap is aimed at the second.
    await page.evaluate(() => { document.body.style.cssText = "margin:0;display:flex"; (document.getElementById("wrap") as HTMLElement).style.width = "540px"; });
    await setup(demo, "card");
    await hasDrawn(0);
    await page.evaluate(() => {
      const b = (document.getElementById("wrap") as HTMLElement).cloneNode(false) as HTMLElement, el = document.createElement("floorplan-studio-card");
      b.id = "wrap2"; el.id = "card2"; b.append(el); document.body.append(b);
    });
    await setup(demo, "card2");
    await hasDrawn(1);
    const rest = async () => { await frames(page, 6); await expect.poll(async () => (await hold(0).getAttribute("data-easing")) === null && (await hold(1).getAttribute("data-easing")) === null).toBe(true); };
    await rest();
    const a0 = await camN(0), b0 = await camN(1);
    // The test hook is the last card's: the second card is the one a tap is aimed at.
    const p = await floorOf(page, KITCHEN);
    const t0 = await now(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => card(page).nth(1).locator("css=.fp-3d").getAttribute("data-ring")).toBe(String(KITCHEN));
    await after(page, t0, 450);
    await rest();
    expect(await camN(0), "the other card's camera").toBe(a0);
    const vis = await visibleBox(page, 1), b = await box(page, KITCHEN);
    expect(await camN(1), "the picked card's camera moved").not.toBe(b0);
    expect(fitted(b, vis), `the Kitchen in the second card ${why(b, vis)}`).toBe(true);
  });

  test("1024x768: a hass update mid-glide changes nothing; the glide ends where it would have", async ({ page }) => {
    await boot(page, WIDE);
    await searchKitchen(page);
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the Kitchen");
    const plain = await cam(page);
    await card(page).getByRole("button", { name: "Back" }).click();
    await settled(page);
    await searchKitchen(page);
    await expect.poll(() => holder(page).getAttribute("data-easing"), { timeout: 3000, message: "the glide shows data-easing" }).not.toBeNull();
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: unknown };
      el.hass = { states: { "light.demo_kitchen": { state: "on", attributes: {}, last_changed: "2026-10-14T09:30:15Z" } }, callService: () => undefined };
    });
    await settled(page);
    sameCam(await cam(page), plain);
  });

  test("1024x768: a floor switch mid-glide frames the new floor", async ({ page }) => {
    await boot(page, WIDE, { floor: "all" });
    const glideMs = (ms: number) => page.evaluate((ms) => (window as unknown as { __fp3d: { glideMs(ms: number): void } }).__fp3d.glideMs(ms), ms);
    await glideMs(20000); // slow, so the switch lands mid-glide however loaded the machine: a 400 ms glide can end between two polls
    await searchKitchen(page);
    await expect.poll(() => holder(page).getAttribute("data-easing"), { timeout: 3000, message: "the glide shows data-easing" }).not.toBeNull();
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await glideMs(400); // the new floor's own framing glides at the usual pace
    await expect(card(page).locator("css=.fp-floors button", { hasText: "First" })).toHaveAttribute("aria-pressed", "true");
    await settled(page);
    await expectFloorFitted(page, "the First floor");
  });

  test("1024x768: a room named __proto__ is framed like any other", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.rooms[KITCHEN].name = "__proto__";
    await page.setViewportSize({ width: WIDE[0], height: WIDE[1] });
    await serve(page);
    await page.goto(`${ORIGIN}/harness.html`);
    await fit(page, WIDE);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, { layout, floor: "ground", view: "3d" });
    await drawn(page);
    await tapKitchen(page);
    await settled(page);
    await expectRoomFitted(page, KITCHEN, "the room named __proto__");
  });

  test("1024x768: a one-room layout frames its room", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.rooms = [layout.floors.ground.rooms[KITCHEN]];
    await page.setViewportSize({ width: WIDE[0], height: WIDE[1] });
    await serve(page);
    await page.goto(`${ORIGIN}/harness.html`);
    await fit(page, WIDE);
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await configure(page, { layout, floor: "ground", view: "3d" });
    await drawn(page);
    await settled(page);
    const [cx, cy] = centreOf(layout.floors.ground.rooms[0]);
    const p = await proj(page, cx, cy, 1);
    expect(await picks(page, p), "what the view finds at the room's centre").toEqual({ type: "room", index: 0 });
    const t0 = await now(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => ring(page)).toBe("0");
    await after(page, t0, 450);
    await settled(page);
    await expectRoomFitted(page, 0, "the only room");
  });

  test("1024x768: a room of 2 points and a room with NaN corners: no throw, the camera stays", async ({ page }) => {
    // Passes against 0.29.0 (a pick moves nothing): a guard for S32.7. The bad floor reaches the view through the test hook's
    // `setFloor` (what the card's own check would have refused); the card is then asked to pick a room by its index.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await boot(page, WIDE);
    await page.evaluate((floor) => {
      const f = structuredClone(floor);
      f.rooms[1].pts = [[500, 0], [800, 0]];
      f.rooms[2].pts[0] = [NaN, 0];
      (window as unknown as { __fp3d: { setFloor(f: unknown): void } }).__fp3d.setFloor(f);
    }, GROUND);
    await drawn(page, 2);
    await settled(page);
    const pre = await cam(page);
    for (const i of [1, 2]) {
      await page.evaluate((i) => (document.getElementById("card") as unknown as { _pickRoom(i: number): void })._pickRoom(i), i);
      await after(page, await now(page), 500);
      await settled(page);
      sameCam(await cam(page), pre);
      expect(await box(page, i), `no box for the bad room ${i}`).toBeNull();
    }
    expect(errors).toEqual([]);
  });
});
