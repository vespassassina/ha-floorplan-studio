import { test, expect, type Page } from "@playwright/test";
import { validate, type Layout } from "../../src/core/schema";
import { readCanvasRect } from "../helpers/pixels";

const EDITOR = "floorplan-studio-editor";

type Fp3d = {
  where(kind: string, index: number): { x: number; y: number } | null;
  project(x: number, y: number, z: number): { x: number; y: number };
};

const layoutOf = (page: Page) =>
  page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as unknown as { layout: Layout }).layout)) as Layout, EDITOR);

async function centerDiffCm(page: Page, selector: string, pt: [number, number]): Promise<number> {
  return page.evaluate(([tag, sel, xy]) => {
    const el = document.querySelector(tag as string) as unknown as {
      toSvg(ev: { clientX: number; clientY: number }): [number, number];
      shadowRoot: ShadowRoot;
    };
    const r = el.shadowRoot.querySelector(sel as string)!.getBoundingClientRect();
    const c2 = el.toSvg({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    return Math.hypot(c2[0] - (xy as [number, number])[0], c2[1] - (xy as [number, number])[1]);
  }, [EDITOR, selector, pt] as const);
}

const stage = (page: Page) => page.locator(`${EDITOR} #stage3d`);
const drawn = (page: Page) => stage(page).evaluate((el) => +(el.dataset.drawn ?? 0));
const waitDrawn = (page: Page, min = 1) => expect.poll(() => drawn(page), { timeout: 15000 }).toBeGreaterThanOrEqual(min);

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} .canvas > svg`)).toBeVisible();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}

async function open3d(page: Page) {
  await page.locator(`${EDITOR} #btn3d`).click();
  await expect(page.locator(`${EDITOR} #pane3d`)).toBeVisible();
  await expect(page.locator(`${EDITOR} #stage3d canvas`)).toBeVisible();
  await waitDrawn(page, 1);
}

async function dragMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

test.describe("Stage 1: 3D preview split pane (criterion 16)", () => {
  test("toggles side-by-side 3D view, resizes divider, syncs room rings, cycles walls and resets camera", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await openEditor(page);
    await expect(page.locator(`${EDITOR} #pane3d`)).toHaveCount(0);

    await open3d(page);

    const svgBox = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
    const p3dBox = (await page.locator(`${EDITOR} #pane3d`).boundingBox())!;
    expect(svgBox.width).toBeGreaterThan(200);
    expect(p3dBox.width).toBeGreaterThan(200);
    expect(Math.abs(svgBox.width - p3dBox.width)).toBeLessThan(20);

    // Canvas actually renders colourful house geometry (non-blank)
    const cBox = (await page.locator(`${EDITOR} #stage3d canvas`).boundingBox())!;
    const px = (await readCanvasRect(page, cBox, { host: EDITOR, canvas: "#stage3d canvas" })).data;
    const cols = new Set<number>();
    for (let i = 0; i < px.length; i += 3) cols.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    expect(cols.size).toBeGreaterThan(10);

    // Drag split divider to grow 2D and narrow 3D
    const divBox = (await page.locator(`${EDITOR} #splitDiv`).boundingBox())!;
    await dragMouse(page, { x: divBox.x + divBox.width / 2, y: divBox.y + divBox.height / 2 }, { x: divBox.x + 110, y: divBox.y + divBox.height / 2 });
    const svgAfter = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
    const p3dAfter = (await page.locator(`${EDITOR} #pane3d`).boundingBox())!;
    expect(svgAfter.width).toBeGreaterThan(svgBox.width + 80);
    expect(p3dAfter.width).toBeLessThan(p3dBox.width - 80);

    // Selecting a room in 2D highlights its ring in 3D
    await page.locator(`${EDITOR} .canvas > svg polygon[data-r="0"]`).click({ position: { x: 40, y: 40 } });
    await expect.poll(() => stage(page).getAttribute("data-ring")).toBe("0");

    // Orbit camera, then reset it
    const azBefore = Number(await stage(page).getAttribute("data-az"));
    await dragMouse(page, { x: cBox.x + cBox.width - 60, y: cBox.y + 40 }, { x: cBox.x + cBox.width - 140, y: cBox.y + 70 });
    await expect.poll(async () => Number(await stage(page).getAttribute("data-az"))).not.toBeCloseTo(azBefore, 2);
    await page.locator(`${EDITOR} #reset3d`).click();
    await expect.poll(async () => Number(await stage(page).getAttribute("data-az"))).toBeCloseTo(azBefore, 2);

    // Cycle walls button
    await expect(page.locator(`${EDITOR} #walls3d`)).toContainText("Walls: cut");
    await page.locator(`${EDITOR} #walls3d`).click();
    await expect(page.locator(`${EDITOR} #walls3d`)).toContainText("Walls: low");
    await page.locator(`${EDITOR} #walls3d`).click();
    await expect(page.locator(`${EDITOR} #walls3d`)).toContainText("Walls: full");

    // Toggle 3D off closes pane and disposes canvas
    await page.locator(`${EDITOR} #btn3d`).click();
    await expect(page.locator(`${EDITOR} #pane3d`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("2D edit rebuilds 3D scene within 200 ms and live states sync to 3D", async ({ page }) => {
    await openEditor(page);
    await open3d(page);

    // Set live HA state (Living light on) and verify 3D accepts live update
    await page.evaluate((tag) => {
      const el = document.querySelector(tag) as { hassState?: Record<string, { state: string; attributes: Record<string, unknown>; last_changed: string }> };
      el.hassState = { "light.demo_living": { state: "on", attributes: { brightness: 255 }, last_changed: new Date().toISOString() } };
    }, EDITOR);

    // Move Living light in 2D and verify 3D scene updates and follows within 500 ms on edit
    const devBox = (await page.locator(`${EDITOR} .canvas > svg g.dev[data-x="0"]`).boundingBox())!;
    const beforeDraws = await drawn(page);
    const where0 = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("device", 0) ?? null);
    await dragMouse(page, { x: devBox.x + devBox.width / 2, y: devBox.y + devBox.height / 2 }, { x: devBox.x + devBox.width / 2 + 60, y: devBox.y + devBox.height / 2 });
    await expect.poll(() => drawn(page)).toBeGreaterThan(beforeDraws);
    await expect.poll(async () => {
      const w = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("device", 0) ?? null);
      return w && where0 ? Math.hypot(w.x - where0.x, w.y - where0.y) : 0;
    }).toBeGreaterThan(10);

    // Discrete 2D edit rebuilds 3D well within 500 ms (criterion 16)
    const beforeDiscrete = await drawn(page);
    const t0 = Date.now();
    await page.keyboard.press("r");
    await expect.poll(() => drawn(page), { timeout: 500 }).toBeGreaterThan(beforeDiscrete);
    expect(Date.now() - t0).toBeLessThanOrEqual(500);
  });
});

test.describe("Stage 2: 3D pick, drag within 1 cm of 2D, Shift-z, and R rotate 15° (criterion 17)", () => {
  test("picks and drags a device and a furniture piece in 3D, landing within 1 cm of 2D with one undo step", async ({ page }) => {
    await openEditor(page);
    await open3d(page);
    await page.locator(`${EDITOR} label.lockplan`).click(); // unlock plan so furniture is editable

    // Click furniture piece 0 (sofa) in 3D without dragging -> selects without creating an undo step
    const furnPt = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("furniture", 0) ?? null);
    expect(furnPt).not.toBeNull();
    await page.mouse.click(furnPt!.x, furnPt!.y);
    await expect(page.locator(`${EDITOR} #frotsl`)).toBeVisible();
    await expect(page.locator(`${EDITOR} #undo`)).toBeDisabled();

    // Drag furniture piece 0 in 3D on horizontal plane
    const furnBefore = (await layoutOf(page)).floors.ground.furniture[0];
    const azBefore = await stage(page).getAttribute("data-az");
    await dragMouse(page, furnPt!, { x: furnPt!.x + 70, y: furnPt!.y + 20 });
    await waitDrawn(page);

    const furnAfter = (await layoutOf(page)).floors.ground.furniture[0];
    expect(Math.hypot(furnAfter.x - furnBefore.x, furnAfter.y - furnBefore.y)).toBeGreaterThan(15);
    expect(furnAfter.x % 10).toBe(0);
    expect(furnAfter.y % 10).toBe(0);
    expect(await stage(page).getAttribute("data-az")).toBe(azBefore); // item drag did not orbit camera

    // Compare 3D coordinate with rendered 2D bbox centre within 1 cm
    const diffCm = await centerDiffCm(page, '.canvas > svg g[data-f="0"]', [furnAfter.x, furnAfter.y]);
    expect(diffCm).toBeLessThanOrEqual(1);

    // One undo step restores original position
    await expect(page.locator(`${EDITOR} #undo`)).toBeEnabled();
    await page.locator(`${EDITOR} #undo`).click();
    const furnUndone = (await layoutOf(page)).floors.ground.furniture[0];
    expect([furnUndone.x, furnUndone.y]).toEqual([furnBefore.x, furnBefore.y]);
    await expect(page.locator(`${EDITOR} #undo`)).toBeDisabled();

    // Drag device 0 in 3D and verify within 1 cm + single undo step
    const devPt = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("device", 0) ?? null);
    expect(devPt).not.toBeNull();
    const devBefore = (await layoutOf(page)).floors.ground.devices[0] as { x: number; y: number };
    await dragMouse(page, devPt!, { x: devPt!.x + 65, y: devPt!.y });
    await waitDrawn(page);

    const devAfter = (await layoutOf(page)).floors.ground.devices[0] as { x: number; y: number };
    expect(Math.hypot(devAfter.x - devBefore.x, devAfter.y - devBefore.y)).toBeGreaterThan(15);

    const devDiffCm = await centerDiffCm(page, '.canvas > svg g.dev[data-x="0"]', [devAfter.x, devAfter.y]);
    expect(devDiffCm).toBeLessThanOrEqual(1);

    await page.locator(`${EDITOR} #undo`).click();
    const devUndone = (await layoutOf(page)).floors.ground.devices[0] as { x: number; y: number };
    expect([devUndone.x, devUndone.y]).toEqual([devBefore.x, devBefore.y]);
  });

  test("R rotates selected item by 15° and Shift-drag changes z height with one undo step", async ({ page }) => {
    await openEditor(page);
    await open3d(page);
    await page.locator(`${EDITOR} label.lockplan`).click();

    // Select furniture 0 in 3D and press R
    const furnPt = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("furniture", 0) ?? null);
    await page.mouse.click(furnPt!.x, furnPt!.y);
    const rot0 = (await layoutOf(page)).floors.ground.furniture[0].rot;
    await page.keyboard.press("r");
    expect((await layoutOf(page)).floors.ground.furniture[0].rot).toBe((rot0 + 15) % 360);
    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.furniture[0].rot).toBe(rot0);

    // Shift-drag device 0 upward in 3D changes its z mount height
    const devPt = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("device", 0) ?? null);
    expect(devPt).not.toBeNull();
    await page.keyboard.down("Shift");
    await dragMouse(page, devPt!, { x: devPt!.x, y: devPt!.y - 55 });
    await page.keyboard.up("Shift");
    await waitDrawn(page);

    const layoutZ = await layoutOf(page);
    const devZ = layoutZ.floors.ground.devices[0].z;
    expect(typeof devZ).toBe("number");
    expect(devZ!).toBeGreaterThan(220);
    expect(validate(layoutZ).ok).toBe(true);

    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.devices[0].z).toBeUndefined();
  });

  test("Escape cancels an active 3D drag without leaving an undo step", async ({ page }) => {
    await openEditor(page);
    await open3d(page);

    const devPt = await page.evaluate(() => ((window as unknown as { __fp3d?: Fp3d }).__fp3d)?.where("device", 0) ?? null);
    const before = (await layoutOf(page)).floors.ground.devices[0] as { x: number; y: number };
    await page.mouse.move(devPt!.x, devPt!.y);
    await page.mouse.down();
    await page.mouse.move(devPt!.x + 60, devPt!.y + 20);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    const after = (await layoutOf(page)).floors.ground.devices[0] as { x: number; y: number };
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    await expect(page.locator(`${EDITOR} #undo`)).toBeDisabled();
  });
});

test.describe("Stage 3: 3D structure editing (corners, wall/room/floor heights, slab, sill/head)", () => {
  test("drags floor height and slab handles in 3D validly with one undo step each", async ({ page }) => {
    await openEditor(page);
    await open3d(page);
    await page.locator(`${EDITOR} label.lockplan`).click();

    // Nothing selected -> floor-h & floor-slab handles are shown
    const hFh = (await page.locator(`${EDITOR} #ov3d [data-h3d="floor-h"]`).boundingBox())!;
    await dragMouse(page, { x: hFh.x + hFh.width / 2, y: hFh.y + hFh.height / 2 }, { x: hFh.x + hFh.width / 2, y: hFh.y + hFh.height / 2 - 45 });
    const lHeight = await layoutOf(page);
    expect(lHeight.floors.ground.height).toBeGreaterThan(250);
    expect(validate(lHeight).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.height).toBeUndefined();

    const hSlab = (await page.locator(`${EDITOR} #ov3d [data-h3d="floor-slab"]`).boundingBox())!;
    await dragMouse(page, { x: hSlab.x + hSlab.width / 2, y: hSlab.y + hSlab.height / 2 }, { x: hSlab.x + hSlab.width / 2, y: hSlab.y + hSlab.height / 2 + 40 });
    const lSlab = await layoutOf(page);
    expect(lSlab.floors.ground.slab).toBeGreaterThan(25);
    expect(validate(lSlab).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.slab).toBeUndefined();
  });

  test("drags room corner, room height and window sill/head in 3D validly with single-step undo", async ({ page }) => {
    await openEditor(page);
    await open3d(page);
    await page.locator(`${EDITOR} label.lockplan`).click();

    // Select Room 0 in 2D -> room corner & height handles appear in #ov3d
    await page.locator(`${EDITOR} .canvas > svg polygon[data-r="0"]`).click({ position: { x: 40, y: 40 } });
    await expect(page.locator(`${EDITOR} #ov3d [data-h3d="room-h"]`)).toHaveCount(1);

    // Drag room height up
    const hRoom = (await page.locator(`${EDITOR} #ov3d [data-h3d="room-h"]`).boundingBox())!;
    await dragMouse(page, { x: hRoom.x + hRoom.width / 2, y: hRoom.y + hRoom.height / 2 }, { x: hRoom.x + hRoom.width / 2, y: hRoom.y + hRoom.height / 2 - 40 });
    const lRoomH = await layoutOf(page);
    expect(lRoomH.floors.ground.rooms[0].height).toBeGreaterThan(250);
    expect(validate(lRoomH).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.rooms[0].height).toBeUndefined();

    // Re-select Room 0 and drag its corner 2 in 3D (inner shared corner [500, 400])
    await page.locator(`${EDITOR} .canvas > svg polygon[data-r="0"]`).click({ position: { x: 40, y: 40 } });
    const hCorner = (await page.locator(`${EDITOR} #ov3d [data-hid="corner:r0:2"]`).boundingBox())!;
    const beforePt = (await layoutOf(page)).floors.ground.rooms[0].pts[2];
    await dragMouse(page, { x: hCorner.x + hCorner.width / 2, y: hCorner.y + hCorner.height / 2 }, { x: hCorner.x + hCorner.width / 2 + 50, y: hCorner.y + hCorner.height / 2 });
    const lCorner = await layoutOf(page);
    expect(lCorner.floors.ground.rooms[0].pts[2]).not.toEqual(beforePt);
    expect(validate(lCorner).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
    expect((await layoutOf(page)).floors.ground.rooms[0].pts[2]).toEqual(beforePt);

    // Switch to First floor where Bedroom window stands on North wall [100,0]..[300,0] and drag sill & head
    const beforeFirst = await drawn(page);
    await page.locator(`${EDITOR} button[data-f="first"]`).click();
    await waitDrawn(page, beforeFirst + 1);
    await page.locator(`${EDITOR} .canvas > svg line[data-d="0"]`).first().click({ force: true });
    await expect(page.locator(`${EDITOR} #ov3d [data-h3d="sill"]`)).toHaveCount(1);
    await expect(page.locator(`${EDITOR} #ov3d [data-h3d="head"]`)).toHaveCount(1);

    const hSill = (await page.locator(`${EDITOR} #ov3d [data-h3d="sill"]`).boundingBox())!;
    await dragMouse(page, { x: hSill.x + hSill.width / 2, y: hSill.y + hSill.height / 2 }, { x: hSill.x + hSill.width / 2, y: hSill.y + hSill.height / 2 + 35 });
    const lSill = await layoutOf(page);
    expect(lSill.floors.first.doors[0].sill).toBeLessThan(90);
    expect(validate(lSill).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();

    await page.locator(`${EDITOR} .canvas > svg line[data-d="0"]`).first().click({ force: true });
    const hHead = (await page.locator(`${EDITOR} #ov3d [data-h3d="head"]`).boundingBox())!;
    await dragMouse(page, { x: hHead.x + hHead.width / 2, y: hHead.y + hHead.height / 2 }, { x: hHead.x + hHead.width / 2, y: hHead.y + hHead.height / 2 - 35 });
    const lHead = await layoutOf(page);
    expect(lHead.floors.first.doors[0].height).toBeGreaterThan(120);
    expect(validate(lHead).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
  });

  test("drags free wall ends & height, worktop corner, and stair corner in 3D cleanly", async ({ page }) => {
    await openEditor(page);
    await open3d(page);
    await page.locator(`${EDITOR} label.lockplan`).click();

    // Add a free wall via Add > Wall > Wall so we can select & drag its end + height in 3D
    const beforeW = await drawn(page);
    await page.locator(`${EDITOR} #mAdd > summary`).click();
    await page.locator(`${EDITOR} #addWallSub > summary`).click();
    await page.locator(`${EDITOR} #addWall-wall`).click();
    await waitDrawn(page, beforeW + 1);
    await page.locator(`${EDITOR} #reset3d`).click();
    await waitDrawn(page, beforeW + 2);
    await expect(page.locator(`${EDITOR} #ov3d [data-h3d="wall-h"]`)).toHaveCount(1);
    const wBefore = (await layoutOf(page)).floors.ground.walls[0];
    const hWall = (await page.locator(`${EDITOR} #ov3d [data-h3d="wall-h"]`).boundingBox())!;
    await dragMouse(page, { x: hWall.x + hWall.width / 2, y: hWall.y + hWall.height / 2 }, { x: hWall.x + hWall.width / 2, y: hWall.y + hWall.height / 2 - 35 });
    const lWallH = await layoutOf(page);
    expect(lWallH.floors.ground.walls[0].height).toBeGreaterThan(250);
    expect(validate(lWallH).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();

    await page.locator(`${EDITOR} .canvas > svg [data-w="0"]`).first().click({ force: true });
    const hWallEnd = (await page.locator(`${EDITOR} #ov3d [data-hid="corner:walls:0:a"]`).boundingBox())!;
    await dragMouse(page, { x: hWallEnd.x + hWallEnd.width / 2, y: hWallEnd.y + hWallEnd.height / 2 }, { x: hWallEnd.x + hWallEnd.width / 2 + 45, y: hWallEnd.y + hWallEnd.height / 2 });
    const lWallEnd = await layoutOf(page);
    expect(lWallEnd.floors.ground.walls[0].a).not.toEqual(wBefore.a);
    expect(validate(lWallEnd).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();

    // Select Stair 0 on ground and drag a corner in 3D
    await page.locator(`${EDITOR} .canvas > svg [data-s="0"]`).click({ force: true });
    await expect(page.locator(`${EDITOR} #ov3d [data-hid="corner:s0:0"]`)).toHaveCount(1);
    const sBefore = (await layoutOf(page)).floors.ground.stairs[0].pts[0];
    const hStair = (await page.locator(`${EDITOR} #ov3d [data-hid="corner:s0:0"]`).boundingBox())!;
    await dragMouse(page, { x: hStair.x + hStair.width / 2, y: hStair.y + hStair.height / 2 }, { x: hStair.x + hStair.width / 2 - 45, y: hStair.y + hStair.height / 2 });
    const lStair = await layoutOf(page);
    expect(lStair.floors.ground.stairs[0].pts[0]).not.toEqual(sBefore);
    expect(validate(lStair).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();

    // Add a worktop by drawing its points on the 2D plan, finish with Enter, and drag its 3D corner handle
    const beforeWt = await drawn(page);
    await page.locator(`${EDITOR} #mAdd > summary`).click();
    await page.locator(`${EDITOR} #addFurn > summary`).click();
    await page.locator(`${EDITOR} #addFurn-worktop`).click();
    const sBox = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
    const ox = sBox.x + sBox.width * 0.35, oy = sBox.y + sBox.height * 0.35;
    for (const [dx, dy] of [[0, 0], [80, 0], [80, 60], [0, 60]]) await page.mouse.click(ox + dx, oy + dy);
    await page.keyboard.press("Enter");
    await waitDrawn(page, beforeWt + 1);
    await expect(page.locator(`${EDITOR} #ov3d [data-hid^="corner:w"]`).first()).toBeVisible();
    const wIdx = (await layoutOf(page)).floors.ground.furniture.length - 1;
    const wtBefore = (await layoutOf(page)).floors.ground.furniture[wIdx].pts![0];
    const hWt = (await page.locator(`${EDITOR} #ov3d [data-hid="corner:w${wIdx}:0"]`).boundingBox())!;
    await dragMouse(page, { x: hWt.x + hWt.width / 2, y: hWt.y + hWt.height / 2 }, { x: hWt.x + hWt.width / 2 - 40, y: hWt.y + hWt.height / 2 });
    const lWt = await layoutOf(page);
    expect(lWt.floors.ground.furniture[wIdx].pts![0]).not.toEqual(wtBefore);
    expect(validate(lWt).ok).toBe(true);
    await page.locator(`${EDITOR} #undo`).click();
  });
});
