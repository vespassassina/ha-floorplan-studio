import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, type Layout, type Floor, type WallKind } from "../../src/core/schema";

// Every pointer action goes through page.mouse at real screen coordinates, so the
// real top element decides what is hit (icons, handles, walls), as for a user.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const unplaced = (page: Page) => page.locator("#mDev button[data-dev]");
const devItem = (page: Page, id: string) => page.locator(`#mDev button[data-dev="${id}"]`);

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function drag(page: Page, selector: string, dx: number, dy: number) {
  const c = await centre(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 4 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
async function menu(page: Page, name: string) {
  await page.locator(`details.menu > summary:text-is("${name}")`).click();
}
/** Chooses the snap grid in View, Grid (0 = none), and closes the menu. */
async function setGrid(page: Page, g: number) {
  await menu(page, "View");
  await page.locator(`#grid [data-grid="${g}"]`).click();
  await menu(page, "View");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("loads the demo and draws the ground floor", async ({ page }) => {
  const l = await layoutOf(page);
  expect(l.floors.ground.rooms).toHaveLength(7); // three rooms, the Reading corner zone, garden, pavement and the pond
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
  await expect(page.locator(".chip[data-f]")).toHaveCount(2);
});

test("dragging a room corner 50 px moves the coincident corner of the neighbour", async ({ page }) => {
  const before = await groundOf(page);
  const living = before.rooms[0].pts[1], kitchen = before.rooms[1].pts[0];
  expect(living).toEqual([500, 0]);
  expect(kitchen).toEqual([500, 0]);
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const after = await groundOf(page);
  expect(after.rooms[0].pts[1]).not.toEqual([500, 0]);
  expect(after.rooms[0].pts[1][1]).toBeGreaterThan(0);
  expect(after.rooms[1].pts[0]).toEqual(after.rooms[0].pts[1]);
  // the panel shows the same numbers
  await expect(page.locator("#py")).toHaveValue(String(after.rooms[0].pts[1][1]));
});

test("Shift while dragging moves only the grabbed corner", async ({ page }) => {
  // The kitchen's corner is drawn after the living room's, so it is the one on top at (500, 0).
  await page.keyboard.down("Shift");
  await drag(page, 'circle[data-h="r1:0"]', 0, 50);
  await page.keyboard.up("Shift");
  const after = await groundOf(page);
  expect(after.rooms[1].pts[0][1]).toBeGreaterThan(0);
  expect(after.rooms[0].pts[1]).toEqual([500, 0]);
});

test("clicking a device icon selects that device, not what lies under it", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#panel")).toContainText("Living light");
  await expect(page.locator("#panel")).not.toContainText("Room");
});

test("Device places one and the list shrinks; removing it makes the list grow", async ({ page }) => {
  // the demo catalog holds one contact sensor not on the plan, and the relay: bound to a light, it has no icon (S1.32).
  await expect(unplaced(page)).toHaveCount(2);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vdel").click();
  // the light and its relay come back together
  await expect(unplaced(page)).toHaveCount(3);
  expect((await groundOf(page)).devices).toHaveLength(7);
  await menu(page, "Device");
  await devItem(page, "light-living").click(); // a real click on the visible item
  await expect(unplaced(page)).toHaveCount(2);
  expect((await groundOf(page)).devices).toHaveLength(8);
});

test("Add, Furniture, bed places a bed that can be moved and resized in the panel", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addFurn").selectOption("bed");
  let g = await groundOf(page);
  expect(g.furniture).toHaveLength(3);
  const bed = g.furniture[2];
  expect(bed.symbol).toBe("bed");
  const n = g.furniture.length - 1;
  await drag(page, `g[data-f="${n}"]`, 60, 40);
  g = await groundOf(page);
  expect(g.furniture[2].x).not.toBe(bed.x);
  await page.locator("#fr").fill("90");
  await page.locator("#fr").press("Enter");
  expect((await groundOf(page)).furniture[2].rot).toBe(90);
});

test("File, Save downloads a file that validates", async ({ page }) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const file = await (await dl).path();
  const res = validate(JSON.parse(readFileSync(file, "utf8")));
  expect(res.ok).toBe(true);
});

test("a reload restores the edit from localStorage and Reset returns to the demo", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const edited = await groundOf(page);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual(edited.rooms[0].pts[1]);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  expect(await layoutOf(page)).toEqual(demo);
});

test("undo reverts the last drag", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual([500, 0]);
});

test("Open takes a v1 file and migrates it; a bad file lists errors and changes nothing", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2,"floors":{"g":{"outline":[[0,0]]}}}') });
  await expect(page.locator("#errors")).toContainText("outline needs at least 3 points");
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.locator("#errors")).toBeVisible();
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect(page.locator("#errors")).toHaveCount(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("a device name with markup is shown as text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices[0].name = '<img src=x onerror="window.__pwn=1">';
    el.layout = l;
  }, EDITOR);
  await page.locator("#names").click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  await expect(page.locator("svg text.lbl", { hasText: "<img" })).toHaveCount(1);
});

// ---- S1.6 review fixes ------------------------------------------------------

/** Screen position of a plan point (cm), read through the svg's own matrix. */
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    // A turned plan (S1.33) is drawn inside a group that carries the rotation: plan points are read through that group's own matrix.
    const g = svg.querySelector(':scope > g.plan-turn') as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
async function dragCm(page: Page, from: [number, number], to: [number, number], mods: string[] = []) {
  const a = await screenOf(page, ...from), b = await screenOf(page, ...to);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

test("stairs draw edges and corner handles, and a corner can be dragged", async ({ page }) => {
  await expect(page.locator('svg circle[data-h="s0:0"]')).toHaveCount(1);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(4);
  const before = (await groundOf(page)).stairs[0].pts;
  await dragCm(page, [700, 420], [660, 450]);
  const after = (await groundOf(page)).stairs[0].pts;
  expect(after[0]).not.toEqual(before[0]);
  expect(after.slice(1)).toEqual(before.slice(1));
});

test("Shift while dragging a stairs corner moves only that corner", async ({ page }) => {
  // put another polygon's corner on the stairs corner, so Shift has something to leave behind
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[2].pts[2] = [780, 580];
    el.layout = l;
  }, EDITOR);
  const before = await groundOf(page);
  await dragCm(page, [780, 580], [760, 560], ["Shift"]);
  const after = await groundOf(page);
  expect(after.stairs[0].pts[2]).not.toEqual([780, 580]);
  expect(after.rooms[2].pts[2]).toEqual(before.rooms[2].pts[2]);
});

test("openings and extras have a body, and their names are text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 400], b: [200, 400] });
    l.floors.ground.extras.push({ id: "extra-ground-1", name: "<b>shed</b>", a: [100, 450], b: [200, 520] });
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg line.opening")).toHaveCount(1);
  await expect(page.locator("svg rect.extra")).toHaveCount(1);
  await expect(page.locator("svg text.lbl", { hasText: "<b>shed</b>" })).toHaveCount(1);
  await expect(page.locator("svg b")).toHaveCount(0);
  await expect(page.locator('svg circle[data-hp="openings:0:a"]')).toHaveCount(1);
});

test("keys act only inside the editor", async ({ page }) => {
  await page.evaluate(() => { for (const [tag, id] of [["input", "outside"], ["button", "outsideBtn"]]) { const e = document.createElement(tag); e.id = id; document.body.append(e); } });
  const c = await centre(page, 'g[data-x="0"]');
  await page.mouse.click(c.x, c.y);
  const before = await layoutOf(page);
  for (const id of ["#outside", "#outsideBtn"]) {
    await page.locator(id).focus();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    expect(await layoutOf(page)).toEqual(before);
  }
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices).toHaveLength(before.floors.ground.devices.length - 1);
  await page.locator("#outsideBtn").focus();
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices).toHaveLength(before.floors.ground.devices.length - 1);
  await page.mouse.click(c.x + 400, c.y + 300);
  await page.keyboard.press("Control+z");
  expect(await layoutOf(page)).toEqual(before);
});

test("a device snaps to the 5 cm grid when chosen, and Alt places it freely", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([265, 205]);
  expect(d.x % 5).toBe(0);
  await dragCm(page, [265, 205], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("Alt turns snapping off for a corner", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await dragCm(page, [700, 420], [697, 433], ["Alt"]);
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([697, 433]);
  await dragCm(page, [697, 433], [663, 447]);
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([665, 445]);
});

test("a corner snaps to the nearest of loose ends and corners", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls.push({ id: "wall-ground-1", a: [790, 410], b: [790, 480], kind: "wall" });
    el.layout = l;
  }, EDITOR);
  await dragCm(page, [700, 420], [797, 404]);
  // the room corner (800, 400) is 5 cm away, the wall end (790, 410) is 9 cm away
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([800, 400]);
});

test("break it: a corner dragged onto its own neighbour never collapses the edge", async ({ page }) => {
  // stairs are (700,420) (780,420) (780,580) (700,580); drag the first corner onto each neighbour
  for (const to of [[779, 421], [701, 579]] as [number, number][]) {
    await dragCm(page, [700, 420], to);
    const pts = (await groundOf(page)).stairs[0].pts;
    expect(pts[0], `dropped at ${to}`).not.toEqual([780, 420]);
    expect(pts[0], `dropped at ${to}`).not.toEqual([700, 580]);
    for (let j = 0; j < pts.length; j++) expect(Math.hypot(pts[j][0] - pts[(j + 1) % 4][0], pts[j][1] - pts[(j + 1) % 4][1])).toBeGreaterThan(0);
    await page.keyboard.press("Control+z");
  }
});

test("the contact sensor picker follows the selected door", async ({ page }) => {
  // A behaviour check only: in Chromium it also passes with the .value binding removed (tried, incl. changing one door before selecting another), because every change re-renders the option attributes.
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_front_door");
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("");
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1);
  await pick(1);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_patio_door");
  // choose a sensor for the garage door, then go back to a door with another one and to one with none
  await pick(2);
  await page.locator("#dsens").selectOption("binary_sensor.demo_garage_door");
  expect((await groundOf(page)).doors[2].sensor).toBe("binary_sensor.demo_garage_door");
  await pick(0);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_front_door");
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_garage_door");
  await page.locator("#dsens").selectOption("");
  await pick(1);
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("");
});

test("File, Save waits for the host: Saving until saveDone, Saved after the download", async ({ page }) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  await dl;
  // the standalone page calls saveDone(true) once its download started
  await expect(page.locator("#status")).toHaveText("Saved");
});

test("saveDone(true) says Saved, saveDone(false, msg) shows the error, and a slow host stays at Saving", async ({ page }) => {
  // a fresh element with one listener that never answers by itself
  await page.evaluate(([tag, l]) => {
    document.querySelector(tag)!.remove();
    const el = document.createElement(tag) as any;
    el.id = "e2";
    el.layout = l;
    el.addEventListener("save-request", () => { (window as any).__asked = ((window as any).__asked ?? 0) + 1; });
    document.body.append(el);
  }, [EDITOR, demo] as const);
  await menu(page, "File");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("Saving…");
  await page.waitForTimeout(300);
  await expect(page.locator("#status")).toHaveText("Saving…");
  await page.evaluate(() => (document.getElementById("e2") as any).saveDone(false, "Disk full"));
  await expect(page.locator("#status")).toHaveText("Disk full");
  await menu(page, "File");
  await page.locator("#save").click();
  await page.evaluate(() => (document.getElementById("e2") as any).saveDone(true));
  await expect(page.locator("#status")).toHaveText("Saved");
  expect(await page.evaluate(() => (window as any).__asked)).toBe(2);
});

test("with no save-request listener at all, Save falls back to Saved", async ({ page }) => {
  await page.evaluate(([tag, l]) => {
    document.querySelector(tag)!.remove();
    const el = document.createElement(tag) as any;
    el.layout = l;
    document.body.append(el);
  }, [EDITOR, demo] as const);
  await menu(page, "File");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("Saved");
});

// ---- add and remove stairs --------------------------------------------------

const stairsCount = (page: Page) => page.locator("svg g[data-s]");
const savedValid = async (page: Page) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const res = validate(JSON.parse(readFileSync(await (await dl).path(), "utf8")));
  expect(res.ok).toBe(true);
  return res.ok ? res.layout : null;
};
const addStairs = async (page: Page) => { await menu(page, "Add"); await page.locator("#addStairs").click(); };

test("Add, Stairs places a 100 x 300 cm stairs on the grid, selected, with a fresh id", async ({ page }) => {
  await expect(stairsCount(page)).toHaveCount(1);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(2);
  const g = await groundOf(page);
  expect(g.stairs).toHaveLength(2);
  const t = g.stairs[1];
  expect(t.id).toBe("stairs-ground-2");
  expect(t.name).toBe("Stairs");
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(100);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(300);
  for (const n of [...xs, ...ys]) expect(Math.abs(n % 5)).toBe(0);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  await savedValid(page);
});

test("a stairs corner can be dragged, renamed in the panel, deleted with the button, and undo restores it", async ({ page }) => {
  await addStairs(page);
  await page.locator("#sn").fill("Cellar <b>stairs</b>");
  await page.locator("#sn").press("Enter");
  expect((await groundOf(page)).stairs[1].name).toBe("Cellar <b>stairs</b>");
  const before = (await groundOf(page)).stairs[1];
  await dragCm(page, before.pts[2] as [number, number], [before.pts[2][0] + 40, before.pts[2][1] + 40]);
  const moved = (await groundOf(page)).stairs[1];
  expect(moved.pts[2]).not.toEqual(before.pts[2]);
  // a click on the body selects it again (the drag left the corner selected)
  const c = await screenOf(page, moved.pts[0][0] + 50, moved.pts[0][1] + 60);
  await page.mouse.click(c.x, c.y);
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(1);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1"]);
  await menu(page, "File");
  await page.locator("#undo").click();
  await expect(stairsCount(page)).toHaveCount(2);
  const back = (await groundOf(page)).stairs;
  expect(back[1].id).toBe("stairs-ground-2");
  expect(back[1].name).toBe("Cellar <b>stairs</b>");
  expect(back[1].pts).toEqual(moved.pts);
});

test("Delete removes selected stairs; nothing selected is a no-op with no undo step; a saved file validates and a reload restores", async ({ page }) => {
  // nothing selected: Delete does nothing and Undo has nothing to undo
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  await page.keyboard.press("Delete");
  expect(await layoutOf(page)).toEqual(demo);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
  await menu(page, "File"); // closes it again
  // select the demo stairs by a real click, delete with the key
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  await page.keyboard.press("Backspace");
  await expect(stairsCount(page)).toHaveCount(0);
  const l = await savedValid(page);
  expect(l?.floors.ground.stairs).toHaveLength(0);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  await expect(stairsCount(page)).toHaveCount(0);
});

test("two stairs get distinct ids after one is deleted and another added; every floor got its own ids (S1.26)", async ({ page }) => {
  await addStairs(page);
  await addStairs(page);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-2", "stairs-ground-3"]);
  await page.locator("#sdel").click();
  await addStairs(page);
  const ids = (await groundOf(page)).stairs.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // the upper floor had none: it got the three adds, and the delete touched the ground floor only
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(3);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(4);
  expect((await layoutOf(page)).floors.first.stairs.map((t) => t.id)).toEqual(["stairs-first-1", "stairs-first-2", "stairs-first-3", "stairs-first-4"]);
  await savedValid(page);
});

// ---- Controlled by (bound light) -------------------------------------------
const selectDev = async (page: Page, i: number) =>
  page.mouse.click(...Object.values(await centre(page, `g[data-x="${i}"]`)) as [number, number]);
const RELAY = "switch.demo_living_relay";
/** Adds catalog entries and optionally runs `code` (a statement using `l`, the layout) before handing the layout to the editor. */
const setCatalog = (page: Page, extra: object[], code = "") =>
  page.evaluate(([tag, more, c]) => {
    const el = document.querySelector(tag as string) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.catalog.push(...(more as object[]));
    new Function("l", c as string)(l);
    el.layout = l;
  }, [EDITOR, extra, code] as const);
const bound = async (page: Page, i: number) => (await groundOf(page)).devices[i].bound;

test("the living light shows its relay; clearing it frees the relay, undo restores it", async ({ page }) => {
  await selectDev(page, 0);
  await expect(page.locator("#vbound")).toHaveValue(RELAY);
  await expect(page.locator("#panel")).toContainText("Living light + Living lamp relay");
  await expect(unplaced(page)).toHaveCount(2); // the relay is listed while it is bound: it has no icon
  await page.locator("#vbound").selectOption("");
  expect(await bound(page, 0)).toBeUndefined();
  expect("bound" in (await groundOf(page)).devices[0]).toBe(false);
  await expect(unplaced(page)).toHaveCount(2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await bound(page, 0)).toBe(RELAY);
  await expect(unplaced(page)).toHaveCount(2);
  // choosing the same value again records no step
  await selectDev(page, 0);
  await page.locator("#vbound").selectOption(RELAY);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another free switch updates the list and the saved layout validates", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Hall - Hall switch", "Living - TV plug", "Living - Living lamp relay", "Living - Free plug"]);
  await page.locator("#vbound").selectOption("switch.free_plug");
  expect(await bound(page, 0)).toBe("switch.free_plug");
  // a bound switch is still on the Device list: it has no icon of its own
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1);
  await expect(devItem(page, "plug-free")).toHaveCount(1);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("a switch already bound elsewhere or placed is offered too; only the light's own entity is not", async ({ page }) => {
  await setCatalog(page, [], "l.floors.ground.devices[1].bound = l.floors.ground.devices[0].bound; delete l.floors.ground.devices[0].bound;");
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Hall - Hall switch", "Living - TV plug", "Living - Living lamp relay"]); // the relay is the kitchen light's, the others are placed
  await page.locator("#vbound").selectOption(RELAY);
  expect(await bound(page, 0)).toBe(RELAY);
  expect(await bound(page, 1)).toBe(RELAY);
});

test("S1.32: two lights on one wall switch, and the switch placed as its own icon: all three are on the plan and the file is valid", async ({ page }) => {
  await selectDev(page, 1); // the kitchen light
  await page.locator("#vbound").selectOption(RELAY); // the living light already has it
  const g1 = await groundOf(page);
  expect(g1.devices.filter((d) => d.bound === RELAY).map((d) => d.id)).toEqual(["light-living", "light-kitchen"]);
  await menu(page, "Device");
  await devItem(page, "switch-living-relay").click(); // still offered while two lights name it
  await expect(devItem(page, "switch-living-relay")).toHaveCount(0);
  const g2 = await groundOf(page);
  expect(g2.devices.filter((d) => d.entity === RELAY)).toHaveLength(1);
  expect(g2.devices.filter((d) => d.bound === RELAY)).toHaveLength(2);
  await expect(page.locator("svg g.dev-light.bound")).toHaveCount(2);
  await expect(page.locator("svg g.dev-switch")).toHaveCount(2); // the hall switch and the relay
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("S1.32 break it: a light cannot be bound to its own entity, so the file is refused", async ({ page }) => {
  const res = await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices[0].bound = l.floors.ground.devices[0].entity;
    return l;
  }, EDITOR);
  expect(validate(res).ok).toBe(false);
});

test("a device that is not a light has no Controlled by field", async ({ page }) => {
  await selectDev(page, 2);
  await expect(page.locator("#panel")).toContainText("Hall switch");
  await expect(page.locator("#vbound")).toHaveCount(0);
});

test("deleting the light returns its switch to the Add list", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click();
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1);
  expect((await groundOf(page)).devices.some((d) => d.bound)).toBe(false);
});

test("a catalog name with markup is shown as text in Controlled by", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-evil", floor: "ground", room: "Living", type: "plug", name: '<img src=x onerror="window.__pwn=1">', entity: "switch.evil" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option", { hasText: "<img" })).toHaveCount(1);
  await expect(page.locator("#vbound img")).toHaveCount(0);
  await page.locator("#vbound").selectOption("switch.evil");
  await expect(page.locator("#panel")).toContainText("+ <img");
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
});

// ---- selection and focus -------------------------------------------------------

test("clicking outside the editor clears the selection, so a highlight always means Delete works", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("svg polygon.hl")).toHaveCount(1);
  // into the side panel: the selection stays
  await page.locator("#sn").click();
  await expect(page.locator("svg polygon.hl")).toHaveCount(1);
  // onto the page outside the editor: it goes, and Delete then removes nothing
  await page.mouse.click(2, 2);
  await expect(page.locator("svg polygon.hl")).toHaveCount(0);
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await page.keyboard.press("Delete");
  await expect(stairsCount(page)).toHaveCount(1);
});

test("a blur that is still waiting to clear the selection does not clear one made after it", async ({ page }) => {
  // The clear runs one task after focus leaves. A click on a device in that gap must keep its selection.
  // Synthetic pointer here on purpose: a real click cannot land inside a one-task gap.
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vrot").focus();
  await page.evaluate(async (tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    (root.activeElement as HTMLElement).blur(); // focus leaves for the page: the clear is queued
    root.querySelector('g[data-x="1"] path')!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, composed: true, clientX: 0, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 50));
  }, EDITOR);
  await expect(page.locator("#panel")).not.toContainText("Nothing selected");
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
});

test("Ctrl+Z works right after the Delete button in the panel", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(stairsCount(page)).toHaveCount(1);
});

test("a selection made from the Device menu survives the menu closing, then Delete works", async ({ page }) => {
  await menu(page, "Device");
  await unplaced(page).first().click();
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
  await expect(page.locator("#panel")).not.toContainText("Nothing selected");
  const n = (await groundOf(page)).devices.length;
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices.length).toBe(n - 1);
});

// ---- S1.8 zones and water ----------------------------------------------------
const addKind = async (page: Page, id: "#addZone") => { await menu(page, "Add"); await page.locator(id).click(); };
const roomPolys = (page: Page) => page.locator("svg polygon[data-r]");

test("Add, Zone places a 200 x 200 cm zone on the grid, centred on the spawn point, selected, dotted, with all wk boundary; one undo step removes it", async ({ page }) => {
  const before = await groundOf(page);
  await addKind(page, "#addZone");
  await expect(roomPolys(page)).toHaveCount(before.rooms.length + 1);
  const g = await groundOf(page), z = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(z.kind).toBe("zone");
  expect(z.wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  expect(new Set(g.rooms.map((r) => r.id)).size).toBe(g.rooms.length);
  const xs = z.pts.map((p) => p[0]), ys = z.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(200);
  for (const v of [...xs, ...ys]) expect(Math.abs(v % 5)).toBe(0);
  expect([Math.min(...xs) + 100, Math.min(...ys) + 100]).toEqual([950, 0]); // centred on the spawn point, right of the house (S1.20)
  // selected: the panel shows kind zone
  await expect(page.locator("#rk")).toHaveValue("zone");
  // its four edges are dotted for real: the browser resolves the dash array from the shared CSS
  const edges = page.locator(`svg line[data-e^="r${n}:"]`);
  await expect(edges).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(edges.nth(i)).toHaveClass(/\bnw\b/);
    expect(await edges.nth(i).evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe("none");
  }
  expect(await page.locator(`svg polygon[data-r="${n}"]`).evaluate((el) => getComputedStyle(el).fill)).toBe("none");
  await menu(page, "File");
  await page.locator("#undo").click();
  await expect(roomPolys(page)).toHaveCount(before.rooms.length);
  await savedValid(page);
});

test("a drawn water polygon is filled from --fp-water and selected", async ({ page }) => {
  await startDraw(page, "drawWater");
  await clicksCm(page, [830, 100], [890, 100], [890, 200], [830, 200]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page), w = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(w.kind).toBe("water");
  await expect(page.locator("#rk")).toHaveValue("water");
  const fill = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).fill);
  const water = await fill(`svg polygon[data-r="${n}"]`);
  expect(water).not.toBe("none");
  expect(water).not.toBe(await fill('svg polygon[data-r="0"]'));
  await savedValid(page);
});

test("the room panel kind select lists zone and water; picking zone clears every wall flag, and it undoes in one step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  const options = await page.locator("#rk option").allTextContents();
  expect(options).toEqual(expect.arrayContaining(["Zone", "Water"])); // labels, not raw ids
  expect((await groundOf(page)).rooms[0].wk).toEqual(["wall", "wall", "wall", "wall"]);
  await page.locator("#rk").selectOption("zone");
  const z = (await groundOf(page)).rooms[0];
  expect(z.kind).toBe("zone");
  expect(z.wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  await menu(page, "File");
  await page.locator("#undo").click();
  const back = (await groundOf(page)).rooms[0];
  expect(back.kind).toBe("room");
  expect(back.wk).toEqual(["wall", "wall", "wall", "wall"]);
});

test("dragging a zone corner onto a wall does not insert a point into the wall or the rooms", async ({ page }) => {
  await addKind(page, "#addZone");
  const g0 = await groundOf(page), zi = g0.rooms.length - 1, z = g0.rooms[zi];
  const counts = (g: Floor) => ({ o: g.outline.length, rooms: g.rooms.slice(0, 3).map((r) => r.pts.length), w: g.rooms.slice(0, 3).map((r) => r.wk.length), walls: g.walls.length });
  const before = counts(g0);
  // the corner that has no neighbour on the target; the target lies on the living / kitchen wall x = 500
  const corner = z.pts.reduce((a, p) => (p[0] < a[0] ? p : a)); // a left corner of the zone
  const j = z.pts.indexOf(corner);
  const target: [number, number] = [500, 250];
  expect(z.pts.some((p) => p[0] === 500 && p[1] === 250)).toBe(false);
  await dragCm(page, corner as [number, number], target);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[j]).toEqual(target); // it did land on the wall
  expect(counts(g1)).toEqual(before);
  expect(g1.rooms[0].pts).toEqual(g0.rooms[0].pts);
  expect(g1.rooms[1].pts).toEqual(g0.rooms[1].pts);
});

test("dragging a room corner onto a zone edge does not insert a point into the zone", async ({ page }) => {
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const top = z.pts.filter((p) => p[1] === Math.min(...z.pts.map((q) => q[1])));
  const mx = Math.round((top[0][0] + top[1][0]) / 2 / 5) * 5;
  // hall corner (0, 600) is far; drag the kitchen's free corner (800, 0)?  Use the living room corner (0, 400) onto the zone's top edge
  const target: [number, number] = [mx, top[0][1]];
  await dragCm(page, [0, 400], target);
  const g1 = await groundOf(page);
  expect(g1.rooms[0].pts.some((p) => p[0] === target[0] && p[1] === target[1])).toBe(true);
  expect(g1.rooms[zi].pts).toHaveLength(z.pts.length);
});

test("a room corner dropped 8 cm from a zone corner does not snap onto it", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page), z = g0.rooms.find((r) => r.kind === "zone")!;
  const c = z.pts[2]; // (460, 140)
  await dragCm(page, [0, 400], [c[0] + 8, c[1] + 6]);
  const p = (await groundOf(page)).rooms[0].pts[3];
  expect(p).not.toEqual(c);
  expect(p).toEqual([c[0] + 10, c[1] + 5]); // the 5 cm grid, not the zone corner
});

// ---- S1.8 zone selection ----
async function clickCm(page: Page, x: number, y: number) {
  const c = await screenOf(page, x, y);
  await page.mouse.click(c.x, c.y);
}

test("a click inside the Reading corner selects the zone: room panel with kind zone and area reading", async ({ page }) => {
  await clickCm(page, 440, 60);
  await expect(page.locator("#rk")).toHaveValue("zone");
  await expect(page.locator("#ra")).toHaveValue("reading");
  await expect(page.locator("#rn")).toHaveValue("Reading corner");
});

test("a click in the living room outside the zone selects the living room", async ({ page }) => {
  await clickCm(page, 200, 150);
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#ra")).toHaveValue("living");
});

test("a device icon inside a zone still selects the device, not the zone", async ({ page }) => {
  const g = await groundOf(page);
  const zone = g.rooms.find((r) => r.kind === "zone")!;
  const d = g.devices.find((x) => "x" in x && x.x > 340 && x.x < 460 && x.y > 40 && x.y < 140)!;
  expect(d).toBeTruthy();
  expect(zone).toBeTruthy();
  await clickCm(page, (d as any).x, (d as any).y);
  await expect(page.locator("#ve")).toHaveValue(d.entity);
  await expect(page.locator("#rk")).toHaveCount(0);
});

test("a zone listed before the room under it is still on top: a click inside it selects the zone", async ({ page }) => {
  const l = await layoutOf(page);
  const rooms = l.floors.ground.rooms, zi = rooms.findIndex((r) => r.kind === "zone");
  rooms.unshift(...rooms.splice(zi, 1)); // the zone is now rooms[0], drawn before the living room
  await page.evaluate(([tag, lay]) => { (document.querySelector(tag as string) as any).layout = lay; }, [EDITOR, l] as const);
  await expect(page.locator('svg polygon[data-r="0"]')).toHaveClass(/room-zone/);
  await clickCm(page, 440, 60);
  await expect(page.locator("#rk")).toHaveValue("zone");
  await expect(page.locator("#ra")).toHaveValue("reading");
});

// ---- S1.9 wall kinds ----
const WALL_KINDS = ["wall", "boundary", "external", "fence", "edge"] as const;
const WALL_CLASS: Record<string, string> = { wall: "e", boundary: "e nw", external: "e external", fence: "e fence", edge: "e edge" };

/** Five free walls of one kind each, side by side under the house (outline ends at y 600), clear of every room. */
async function withWallRow(page: Page) {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const kinds = ["wall", "boundary", "external", "fence", "edge"];
    l.floors.ground.walls = kinds.map((kind, i) => ({ id: `wall-ground-${i + 1}`, a: [10 + i * 150, 650], b: [110 + i * 150, 650], kind }));
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg line[data-w]")).toHaveCount(5);
}

test("clicking each wall with the mouse selects it and the kind select shows its kind", async ({ page }) => {
  await withWallRow(page);
  for (const [i, kind] of WALL_KINDS.entries()) {
    await clickCm(page, 60 + i * 150, 650);
    await expect(page.locator("#wk")).toHaveValue(kind);
    await expect(page.locator(`svg line[data-w="${i}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
});

test("a thin fence stays clickable a few pixels off its line, and of two walls 6 px apart the nearer one wins", async ({ page }) => {
  await withWallRow(page);
  const c = await screenOf(page, 60 + 3 * 150, 650); // the fence
  await page.mouse.click(c.x, c.y + 5);
  await expect(page.locator("#wk")).toHaveValue("fence");
  await page.mouse.click(c.x, c.y - 6);
  await expect(page.locator("#wk")).toHaveValue("fence");
  // a competing outdoor edge 6 screen px below the fence, both inside the 8 px pick radius of a click between them
  const perCm = ((await screenOf(page, 60 + 3 * 150, 660)).y - c.y) / 10;
  await page.evaluate(([tag, dy]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls.push({ id: "wall-ground-6", a: [460, 650 + (dy as number)], b: [560, 650 + (dy as number)], kind: "edge" });
    el.layout = l;
  }, [EDITOR, 6 / perCm] as const);
  await expect(page.locator("svg line[data-w]")).toHaveCount(6);
  await page.mouse.click(c.x, c.y + 1.5); // 1.5 px from the fence, 4.5 from the edge wall
  await expect(page.locator("#wk")).toHaveValue("fence");
  await page.mouse.click(c.x, c.y + 4.5); // 4.5 px from the fence, 1.5 from the edge wall
  await expect(page.locator("#wk")).toHaveValue("edge");
});

test("the wall panel has a kind select with five human labels, the opening entry and no toggle button", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wk")).toHaveJSProperty("tagName", "SELECT");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"], ["opening", "Opening (a gap in the wall)"],
  ]);
  await expect(page.locator("button#wk")).toHaveCount(0);
});

test("changing a wall's kind in the panel changes its class, is one undo step, and undo restores it", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  for (const kind of ["external", "fence", "edge", "boundary"]) {
    await page.locator("#wk").selectOption(kind);
    await expect(page.locator('svg line[data-w="0"]')).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
    expect((await groundOf(page)).walls[0].kind).toBe(kind);
  }
  await page.locator("#wk").selectOption("boundary"); // unchanged: no step
  await page.locator("#wk").selectOption("wall");
  await page.locator("#wk").selectOption("fence");
  await page.locator("#wk").selectOption("wall");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("fence");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("wall");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("boundary");
});

// ---- S1.10 floors ----
const chips = (page: Page) => page.locator(".chip[data-f]");
const chipKeys = (page: Page) => chips(page).evaluateAll((c) => c.map((x) => x.getAttribute("data-f")));
const chipTitles = (page: Page) => chips(page).allTextContents();
const floorKeys = async (page: Page) => Object.keys((await layoutOf(page)).floors);
const undoBtn = (page: Page) => page.locator("#undo");

/** Types a title into the "+" chip's input with the real keyboard and presses Enter. */
/**
 * A new floor with the inherited outline and stairs taken away again: what a floor looked like before S1.27.
 * The layout setter refuses an outline of fewer than three points (validate), so this reaches into the editor's state.
 */
async function addBareFloor(page: Page, title: string) {
  await addFloorVia(page, title);
  await page.evaluate(([tag, key]) => {
    const el = document.querySelector(tag as string) as any, f = el.st.layout.floors[key as string];
    f.outline = []; f.stairs = [];
    el.st.views = {};
    el.requestUpdate();
  }, [EDITOR, title.toLowerCase()]);
  await expect(page.locator("svg g[data-s]")).toHaveCount(0);
}
async function addFloorVia(page: Page, title: string) {
  const c = await centre(page, "#addFloor");
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#newFloor")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

test("the + chip sits after the floor chips, opens an input, and Enter adds a floor that is selected and has no rooms", async ({ page }) => {
  const add = await page.locator("#addFloor").boundingBox(), last = await chips(page).last().boundingBox();
  expect(add!.x).toBeGreaterThan(last!.x + last!.width - 1);
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await addFloorVia(page, "Attic");
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic"]);
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Attic"]);
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(0); // no rooms
  const l = await layoutOf(page);
  expect(l.floors.attic).toMatchObject({ title: "Attic", outline: l.floors.ground.outline, rooms: [], walls: [], devices: [], furniture: [] }); // S1.27: the outline is inherited
  expect(l.floors.ground.rooms).toHaveLength(7); // untouched
});

test("+ then Esc adds nothing and leaves no undo step; Enter on an empty or blank title adds nothing", async ({ page }) => {
  await page.locator("#addFloor").click();
  await page.keyboard.type("Nope");
  await page.keyboard.press("Escape");
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await page.locator("#addFloor").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("   ");
  await page.keyboard.press("Enter");
  await expect(page.locator("#newFloor")).toBeVisible(); // still asking
  await page.keyboard.press("Escape");
  expect(await floorKeys(page)).toEqual(["ground", "first"]);
  await menu(page, "File");
  await expect(undoBtn(page)).toBeDisabled();
});

test("break it: adding \"Ground\" gets the key ground-2 and does not overwrite the ground floor", async ({ page }) => {
  await addFloorVia(page, "Ground");
  const l = await layoutOf(page);
  expect(Object.keys(l.floors)).toEqual(["ground", "first", "ground-2"]);
  expect(l.floors.ground.rooms).toHaveLength(7);
  expect(l.floors["ground-2"].rooms).toHaveLength(0);
});

test("with nothing selected the panel is the floor panel: title field, Move up, Move down, Delete; a selection replaces it", async ({ page }) => {
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await expect(page.locator("#ft")).toHaveValue("Ground");
  await expect(page.locator("#fdown")).toBeDisabled(); // lowest floor
  await expect(page.locator("#fup")).toBeEnabled();
  await expect(page.locator("#fdel")).toBeEnabled();
  await clickCm(page, 200, 150);
  await expect(page.locator("#ft")).toHaveCount(0);
  await expect(page.locator("#rk")).toHaveValue("room");
});

test("renaming from the panel changes the chip title, keeps the key, is one undo step", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#ft").fill("  Loft  ");
  await page.locator("#ft").press("Enter");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Loft"]);
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic"]);
  await page.locator("#ft").fill("   "); // blank: refused, the field falls back
  await page.locator("#ft").press("Enter");
  await expect(page.locator("#ft")).toHaveValue("Loft");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Loft"]);
  await page.locator("#panel").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+z");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Attic"]);
});

test("a title is text, never markup", async ({ page }) => {
  await addFloorVia(page, '"><img src=x onerror=window.__pwned=1>');
  await expect(page.locator(".chip[data-f]").last()).toHaveText('"><img src=x onerror=window.__pwned=1>');
  await expect(page.locator("#ft")).toHaveValue('"><img src=x onerror=window.__pwned=1>');
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await page.locator("#fdel").click();
  await expect(page.locator("#panel")).toContainText('Delete floor "><img src=x onerror=window.__pwned=1> and everything on it?');
  await expect(page.locator("#panel img")).toHaveCount(0);
});

test("Move down puts Attic first, the chips follow the order, Move up is disabled at the top, and it undoes", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await expect(page.locator("#fup")).toBeDisabled();
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first"]);
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first"]);
  expect(await floorKeys(page)).toEqual(["attic", "ground", "first"]);
  await expect(page.locator("#fdown")).toBeDisabled();
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fup").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first"]);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic"]);
});

test("Delete asks first inline: Cancel keeps the floor; Delete removes it and selects a neighbour", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#fdel").click();
  await expect(page.locator("#panel")).toContainText("Delete floor Attic and everything on it?");
  await page.locator("#fdelno").click();
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
  expect(await floorKeys(page)).toEqual(["ground", "first", "attic"]);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["ground", "first"]);
  await expect(page.locator('.chip[data-f="first"]')).toHaveAttribute("aria-pressed", "true"); // the neighbour before it
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
});

test("a pointer press on the plan cancels a pending delete confirm", async ({ page }) => {
  await page.locator("#fdel").click();
  await expect(page.locator("#fdelyes")).toBeVisible();
  await clickCm(page, 200, 150);
  await page.mouse.click(2, 2); // out of the editor: selection clears, the floor panel is back
  await expect(page.locator("#fdelyes")).toHaveCount(0);
  expect(await floorKeys(page)).toEqual(["ground", "first"]);
});

test("deleting the ground floor with content, then Undo, brings it back in place with all its content", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["first"]);
  await expect(page.locator("#fdel")).toBeDisabled(); // the last floor cannot go
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first"]);
  expect(await layoutOf(page)).toEqual(before);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
});

test("devices of a deleted floor go back to the Device menu and the catalog is unchanged", async ({ page }) => {
  await menu(page, "Device");
  const n = await unplaced(page).count();
  await page.keyboard.press("Escape");
  const cat = (await layoutOf(page)).catalog;
  await page.locator('.chip[data-f="first"]').click();
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect((await layoutOf(page)).catalog).toEqual(cat);
  await menu(page, "Device");
  expect(await unplaced(page).count()).toBeGreaterThan(n);
});

test("a floor added, renamed, moved and deleted is four undo steps, one per action", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#ft").fill("Loft");
  await page.locator("#ft").press("Enter");
  await page.locator("#fdown").click();
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await floorKeys(page)).toEqual(["ground", "first"]);
  for (const [keys, titles] of [
    [["ground", "attic", "first"], ["Ground", "Loft", "First"]], // undo the delete
    [["ground", "first", "attic"], ["Ground", "First", "Loft"]], // undo the move
    [["ground", "first", "attic"], ["Ground", "First", "Attic"]], // undo the rename
  ] as [string[], string[]][]) {
    await page.keyboard.press("Control+z");
    expect(await chipKeys(page)).toEqual(keys);
    expect(await chipTitles(page)).toEqual(titles);
  }
  await page.keyboard.press("Control+z");
  expect(await floorKeys(page)).toEqual(["ground", "first"]);
});

// ---- S1.11 draw mode ----
const DRAW_STATUS = "Click to add points, double-click or Enter to finish, Esc to cancel";

/** Draw, then one Draw item, through the real menu. */
async function startDraw(page: Page, id: string) {
  await menu(page, "Draw");
  await page.locator(`#${id}`).click(); // scrolls the menu to the item; the menu is taller than a short window
}
/** Real clicks at plan points (cm). */
async function clicksCm(page: Page, ...pts: [number, number][]) {
  for (const [x, y] of pts) await clickCm(page, x, y);
}
const svgCursor = (page: Page) => page.locator("svg").first().evaluate((s) => getComputedStyle(s).cursor);
const drawnPoints = (page: Page) => page.locator("svg [data-dp]");
// Free ground below the house (outline ends at y 600), away from every corner. Off-grid on purpose:
// the snapped points differ from the pointer, so a click that skipped snapping is caught.
const FREE: [number, number][] = [[103, 632], [297, 633], [298, 668], [102, 667]];
const FREE_SNAPPED = [[105, 630], [295, 630], [295, 670], [105, 670]];

test("Draw, Room: four clicks and Enter give a room of four points at the snapped coordinates, selected, one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
  expect(await svgCursor(page)).toBe("crosshair");
  await clicksCm(page, ...FREE);
  await expect(drawnPoints(page)).toHaveCount(4);
  expect(await groundOf(page)).toEqual(before); // nothing is written before the shape is finished
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length + 1);
  const room = g.rooms.at(-1)!;
  expect(room.pts).toEqual(FREE_SNAPPED);
  expect([room.kind, room.name, room.area, room.wk]).toEqual(["room", "New room", "new-room", ["wall", "wall", "wall", "wall"]]);
  await expect(page.locator("#rn")).toHaveValue("New room"); // selected: the room panel
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Wall (fence): three clicks and Enter give two fence walls sharing a point, one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawWall-fence");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(2);
  expect(g.walls.map((w) => w.kind)).toEqual(["fence", "fence"]);
  expect(g.walls[0].a).toEqual([105, 630]);
  expect(g.walls[0].b).toEqual([295, 630]);
  expect(g.walls[1].a).toEqual(g.walls[0].b);
  expect(g.walls[1].b).toEqual([295, 670]);
  await expect(page.locator("#wk")).toHaveValue("fence"); // the last wall is selected
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
});

test("each of the five wall kinds is drawn with its own kind", async ({ page }) => {
  for (const kind of WALL_KINDS) {
    await startDraw(page, `drawWall-${kind}`);
    await clicksCm(page, [103, 632], [297, 633]);
    await page.keyboard.press("Enter");
    const walls = (await groundOf(page)).walls;
    expect(walls.at(-1)!.kind).toBe(kind);
    // and the plan shows it: the class the core gives that kind, on the line just drawn
    await expect(page.locator(`svg line[data-w="${walls.length - 1}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
  expect((await groundOf(page)).walls).toHaveLength(5);
});

test("Esc after two clicks leaves the floor unchanged and the undo stack as long as before", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50); // one real undo step to count against
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await expect(drawnPoints(page)).toHaveCount(2);
  await page.keyboard.press("Escape");
  expect(await groundOf(page)).toEqual(before);
  await expect(drawnPoints(page)).toHaveCount(0);
  await expect(page.locator("[data-draw]")).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  await page.keyboard.press("Control+z"); // exactly one step: the drag, not a phantom draw step
  await expect(page.locator("#undo")).toBeDisabled();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual([500, 0]);
});

test("after Esc a click on the plan selects again instead of adding points", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Escape");
  await clickCm(page, 60, 200); // inside the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("Backspace removes the last point; the shape then uses the remaining ones", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await page.keyboard.press("Backspace");
  await expect(drawnPoints(page)).toHaveCount(2);
  await clicksCm(page, [200, 668]);
  await page.keyboard.press("Enter");
  expect((await groundOf(page)).rooms.at(-1)!.pts).toEqual([[105, 630], [295, 630], [200, 670]]);
});

test("entering draw mode clears the selection, so Delete and Backspace cannot remove it", async ({ page }) => {
  await clickCm(page, 60, 200); // select the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  const n = (await groundOf(page)).rooms.length;
  await startDraw(page, "drawRoom");
  await expect(page.locator("#rn")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).rooms).toHaveLength(n);
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("finishing with fewer than three points leaves the floor and the undo stack unchanged", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await page.keyboard.press("Enter");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(drawnPoints(page)).toHaveCount(0);
  // a wall needs two points
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Enter");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Zone on top of a room's corner does not snap to it", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page);
  expect(g0.rooms[0].pts[2]).toEqual([500, 400]); // Living's corner, also Kitchen's and the Hall's edge
  await startDraw(page, "drawZone");
  await clicksCm(page, [503, 398], [603, 398], [603, 460]);
  await page.keyboard.press("Enter");
  const z = (await groundOf(page)).rooms.at(-1)!;
  expect(z.kind).toBe("zone");
  expect(z.pts[0]).toEqual([505, 400]); // the grid, not the corner (500, 400)
  expect(z.wk).toEqual(["boundary", "boundary", "boundary"]);
  expect((await groundOf(page)).rooms[0].pts).toEqual(g0.rooms[0].pts); // nothing stitched into the room
});

test("Draw, Room next to an existing corner snaps to it", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, [503, 398], [560, 470], [420, 470]); // first point within reach of the corner (500, 400)
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms.at(-1)!.pts[0]).toEqual([500, 400]);
});

test("a double-click finishes the shape without a duplicate point", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  const c = await screenOf(page, FREE[3][0], FREE[3][1]);
  await page.mouse.dblclick(c.x, c.y);
  const room = (await groundOf(page)).rooms.at(-1)!;
  expect(room.pts).toEqual(FREE_SNAPPED);
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("a click on the first point closes a polygon of three or more points and adds no point", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await clickCm(page, 107, 628); // on the first point
  const g = await groundOf(page);
  expect(g.rooms.at(-1)!.pts).toEqual([[105, 630], [295, 630], [295, 670]]);
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("break it: a click on the first point of a 2-point polygon does not close it", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633]);
  await clickCm(page, 107, 628);
  await expect(drawnPoints(page)).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
  expect(await groundOf(page)).toEqual(before);
  await clickCm(page, 200, 668); // still drawing: a third point
  await expect(drawnPoints(page)).toHaveCount(3);
});

test("Alt while clicking disables snapping", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await page.keyboard.down("Alt");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await page.keyboard.up("Alt");
  await page.keyboard.press("Enter");
  const pts = (await groundOf(page)).rooms.at(-1)!.pts;
  for (const [i, p] of [[103, 632], [297, 633], [298, 668]].entries()) {
    expect(Math.abs(pts[i][0] - p[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(pts[i][1] - p[1])).toBeLessThanOrEqual(1);
  }
  expect(pts[0]).not.toEqual([105, 630]);
});

test("Draw, Outline replaces the floor outline in one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawOutline");
  await clicksCm(page, ...FREE);
  await page.keyboard.press("Enter");
  expect((await groundOf(page)).outline).toEqual(FREE_SNAPPED);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).outline).toEqual(before.outline);
});

test("Draw, Water and Draw, Opening and Draw, Structure line add their shapes", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawWater");
  await clicksCm(page, [850, 300], [900, 300], [900, 350]);
  await page.keyboard.press("Enter");
  const w = (await groundOf(page)).rooms.at(-1)!;
  expect([w.kind, w.name, w.area, w.wk]).toEqual(["water", "New water", "", ["boundary", "boundary", "boundary"]]);
  await startDraw(page, "drawOpening");
  await clicksCm(page, [103, 632], [297, 633]); // the second click finishes a single segment
  await expect(drawnPoints(page)).toHaveCount(0);
  expect((await groundOf(page)).openings.map((o) => [o.a, o.b])).toEqual([[[105, 630], [295, 630]]]);
  await expect(page.locator("#ol")).toHaveValue("190"); // the opening is selected on finish (S1.13)
  await expect(page.locator("svg line.hl")).toHaveCount(1);
  await startDraw(page, "drawExtra");
  await clicksCm(page, [103, 662], [297, 663]);
  await expect(page.locator("#panel")).toContainText("Nothing selected"); // extras stay unselected
  const g = await groundOf(page);
  expect(g.extras).toHaveLength(1);
  expect(g.extras[0].name).toBe("New line");
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("switching floor mid-draw cancels: no points left, no change, later clicks select", async ({ page }) => {
  const before = await layoutOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await page.locator('.chip[data-f]:not([aria-pressed="true"])').first().click();
  await page.locator('.chip[data-f="ground"]').click();
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  expect(await layoutOf(page)).toEqual(before);
  await clicksCm(page, FREE[2]);
  await expect(drawnPoints(page)).toHaveCount(0);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another Add item or Undo mid-draw leaves draw mode and its rubber band", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await startDraw(page, "drawZone"); // another Draw item starts afresh
  await expect(drawnPoints(page)).toHaveCount(0);
  await clickCm(page, 200, 668);
  await expect(drawnPoints(page)).toHaveCount(1);
  await menu(page, "Add");
  await page.locator("#addDoor").click(); // a single-shape item ends draw mode
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  // Undo
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Control+z"); // undoes the door
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  await expect(page.locator("[data-draw]")).toHaveCount(0);
});

test("the rubber band runs from the last point to the pointer as a dashed line, in editor variables", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  const c = await screenOf(page, 250, 660);
  await page.mouse.move(c.x, c.y);
  const path = page.locator('svg [data-draw="path"]');
  await expect(path).toHaveCount(1);
  const pts = (await path.getAttribute("points"))!.split(" ").map((s) => s.split(",").map(Number));
  expect(pts[0]).toEqual([105, 630]);
  expect(Math.abs(pts[1][0] - 250)).toBeLessThanOrEqual(5);
  expect(await path.evaluate((e) => getComputedStyle(e).strokeDasharray)).not.toBe("none");
  expect(await path.evaluate((e) => e.outerHTML)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
});

test("draw mode still pans with the middle button and zooms with the wheel, and keeps its points", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  const vb = () => page.locator("svg").first().getAttribute("viewBox");
  const v0 = await vb();
  const c = await screenOf(page, 250, 300);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 300);
  await expect.poll(vb).not.toBe(v0);
  const v1 = await vb();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  expect(await vb()).not.toBe(v1);
  await expect(drawnPoints(page)).toHaveCount(1); // still drawing, nothing added by the pan
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("draw-mode keys stay on the editor: Enter and Esc elsewhere in the page do nothing", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(drawnPoints(page)).toHaveCount(3);
});

test("draw items keep the single-shape Add items: Zone still adds a square in one step", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addZone").click();
  expect((await groundOf(page)).rooms.at(-1)!.kind).toBe("zone");
});

// ---- S1.12 Device menu -------------------------------------------------------
const search = (page: Page) => page.locator("#devSearch");
const shown = (page: Page) => page.locator("#mDev button[data-dev]:visible");

test("the toolbar order is Add, Draw, Device, View, File and Add has no Device item", async ({ page }) => {
  await expect(page.locator("details.menu > summary")).toHaveText(["Add", "Draw", "Device", "View", "File"]);
  await expect(page.locator("#mAdd select")).toHaveCount(1); // only the furniture select is left
  await expect(page.locator("#mAdd #addDev")).toHaveCount(0);
  await expect(page.locator("#mAdd")).not.toContainText("Device");
});

test("Device lists the unplaced entries grouped by type; a deleted light and its relay come back, placing the light takes only the light", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click(); // the light and its relay come back
  await menu(page, "Device");
  expect(await page.locator("#mDev .grp").allInnerTexts()).toEqual(["Lights", "Wall switches", "Window / door sensor"]);
  await devItem(page, "light-living").click();
  await expect(devItem(page, "light-living")).toHaveCount(0);
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1); // the placed copy has no bound any more
});

test("the search filters by name and by entity id, ignoring case", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.Garden_Pump" }]);
  await menu(page, "Device");
  await expect(shown(page)).toHaveCount(3); // contact sensor, relay (bound, no icon) and the free plug
  await search(page).fill("FREE PL");
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText("Free plug");
  await search(page).fill("garden_pump"); // entity id, other case
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText("Free plug");
  await search(page).fill("contact");
  await expect(shown(page)).toHaveCount(1);
  await expect(page.locator("#mDev .grp:visible")).toHaveText(["Window / door sensor"]);
  await search(page).fill("");
  await expect(shown(page)).toHaveCount(3);
});

test("a search with no match says so, and the search is cleared when the menu closes", async ({ page }) => {
  await menu(page, "Device");
  await search(page).fill("zzz-no-such-thing");
  await expect(shown(page)).toHaveCount(0);
  await expect(page.locator("#mDev")).toContainText("No device matches");
  await page.mouse.click(2, 2); // closes the menu
  await expect(page.locator("#mDev")).not.toHaveAttribute("open", "");
  await menu(page, "Device");
  await expect(search(page)).toHaveValue("");
  await expect(shown(page)).toHaveCount(2); // contact sensor and the bound relay
  await expect(page.locator("#mDev")).not.toContainText("No device matches");
});

test("the search is cleared when the menu closes by choosing an item, and by opening another menu", async ({ page }) => {
  await menu(page, "Device");
  await search(page).fill("contact");
  await shown(page).first().click();
  await menu(page, "Device");
  await expect(search(page)).toHaveValue("");
  await search(page).fill("x");
  await menu(page, "View");
  await menu(page, "Device");
  await expect(search(page)).toHaveValue("");
});

test("typing in the search field does not trigger editor shortcuts", async ({ page }) => {
  await selectDev(page, 0); // a selected light: Delete or Backspace outside an input would remove it
  const before = await layoutOf(page);
  await menu(page, "Device");
  await search(page).click();
  await page.keyboard.type("Delete abcz");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect(search(page)).toHaveValue("Delete abc"); // typed, edited by the field itself, not swallowed
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
});

test("Ctrl+Z in the search field does not undo the plan", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click();
  const after = await layoutOf(page);
  await menu(page, "Device");
  await search(page).click();
  await page.keyboard.press("Control+z");
  expect(await layoutOf(page)).toEqual(after);
});

test("Escape in the search field closes the menu and gives the keys back to the editor", async ({ page }) => {
  await menu(page, "Device");
  await search(page).fill("abc");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mDev")).not.toHaveAttribute("open", "");
  await selectDev(page, 0);
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices).toHaveLength(7);
});

test("a device name with markup is text in the Device menu, and a click on it places that device", async ({ page }) => {
  await setCatalog(page, [{ id: "evil", floor: "ground", room: "Living", type: "plug", name: '<img src=x onerror="window.__pwn=1">', entity: "switch.evil" }]);
  await menu(page, "Device");
  await expect(page.locator("#mDev img")).toHaveCount(0);
  await expect(devItem(page, "evil")).toContainText("<img");
  await search(page).fill("<img");
  await expect(shown(page)).toHaveCount(1);
  await shown(page).first().click();
  expect((await groundOf(page)).devices.some((d) => d.id === "evil")).toBe(true);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
});

// ---- S1.13 opening tool ------------------------------------------------------
const addGap = async (page: Page) => { await menu(page, "Add"); await page.locator("#addGap").click(); };
const gaps = async (page: Page) => (await groundOf(page)).openings;
const len = (o: { a: number[]; b: number[] }) => Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
/** The real top element at a plan point (the editor's hit order), as a short description. */
const topAt = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const svg = root.querySelector("svg") as SVGSVGElement;
    const q = new DOMPoint(px as number, py as number).matrixTransform(svg.getScreenCTM()!);
    const el = root.elementFromPoint(q.x, q.y);
    return el ? `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}` : "";
  }, [EDITOR, x, y] as const);
const mid = (o: { a: number[]; b: number[] }): [number, number] => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
/** Pans the editor's view so that (x, y) is its centre; zoom is kept. */
const centreViewOn = (page: Page, c: [number, number]) =>
  page.evaluate(([tag, x, y]) => {
    const el = document.querySelector(tag as string) as any, v = el.st.view;
    el.st.views[el.st.floor] = { ...v, x: (x as number) - v.w / 2, y: (y as number) - v.h / 2 };
    el.requestUpdate();
  }, [EDITOR, c[0], c[1]] as const);

test("Add, Opening adds one 120 cm opening on the room edge nearest the view centre, selected, in one undo step", async ({ page }) => {
  const before = await gaps(page);
  expect(before).toHaveLength(0);
  await addGap(page);
  const o = await gaps(page);
  expect(o).toHaveLength(1);
  expect(o[0].id).toBe("opening-ground-1");
  expect(len(o[0])).toBe(120);
  expect(o[0].a[0]).toBe(500); // the edge between the Living room and the Kitchen is the nearest to the view centre
  expect(o[0].b[0]).toBe(500);
  await expect(page.locator("#panel")).toContainText("Opening");
  await expect(page.locator("svg line.hl")).toHaveCount(1);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.keyboard.press("Control+z"); // one step removes it
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+Shift+z");
  expect(await gaps(page)).toEqual(o);
});

test("the wall under an opening is not the element you hit: the opening is on top of the room edge, in the editor's hit order", async ({ page }) => {
  await addGap(page);
  const o = (await gaps(page))[0], m = mid(o);
  expect(o.a[0]).toBe(500); // the edge between the Living room and the Kitchen: a wall line is drawn there
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]); // deselect
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  expect(await topAt(page, m[0], m[1])).toBe("line.opening"); // not line.e (the wall) and not the room polygon
  // and a real click there selects it
  const c = await screenOf(page, m[0], m[1]);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ol")).toHaveValue("120");
  await expect(page.locator("svg line.hl")).toHaveCount(1);
});

test("a real click picks the opening you point at when there are several", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 640], b: [200, 640] }, { id: "opening-ground-2", a: [300, 660], b: [460, 660] });
    el.layout = l;
  }, EDITOR);
  const c = await screenOf(page, 380, 660);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ol")).toHaveValue("160");
  const d = await screenOf(page, 150, 640);
  await page.mouse.click(d.x, d.y);
  await expect(page.locator("#ol")).toHaveValue("100");
});

test("the length field sets the length and keeps the midpoint and the direction", async ({ page }) => {
  await addGap(page);
  const before = (await gaps(page))[0];
  await page.locator("#ol").fill("200");
  await page.locator("#ol").press("Enter");
  const o = (await gaps(page))[0];
  expect(len(o)).toBe(200);
  expect(mid(o)).toEqual(mid(before));
  expect(o.a[0]).toBe(before.a[0]);
  expect(Math.sign(o.b[1] - o.a[1])).toBe(Math.sign(before.b[1] - before.a[1]));
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(len((await gaps(page))[0])).toBe(120); // one step
  await expect(page.locator("#undo")).toBeEnabled();
});

test("the length field ignores an unchanged value and rubbish", async ({ page }) => {
  await addGap(page);
  const o = await gaps(page);
  await page.locator("#ol").fill("120");
  await page.locator("#ol").press("Enter");
  await page.locator("#ol").fill("");
  await page.locator("#ol").press("Enter");
  expect(await gaps(page)).toEqual(o);
  await menu(page, "File");
  await page.locator("#undo").click(); // undoes the add itself: the unchanged 120 and the empty field left no step of their own
  expect(await gaps(page)).toEqual([]);
});

test("Delete in the panel, and the Delete and Backspace keys, remove the opening; Undo restores it", async ({ page }) => {
  await addGap(page);
  const o = await gaps(page);
  await page.locator("#odel").click();
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
  const pick = async () => { const c = await screenOf(page, ...mid(o[0])); await page.mouse.click(c.x, c.y); await expect(page.locator("#odel")).toBeVisible(); };
  await pick(); // undo clears the selection; a real click selects it again
  await page.keyboard.press("Delete");
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
  await pick();
  await page.keyboard.press("Backspace");
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
});

test("an opening lands on a free wall when that is the nearest edge", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addWall-wall").click();
  const w = (await groundOf(page)).walls[0];
  await centreViewOn(page, mid(w)); // the wall is now the edge nearest the view centre
  await addGap(page);
  const o = (await gaps(page))[0];
  expect(o.a[1]).toBe(w.a[1]);
  expect(o.b[1]).toBe(w.a[1]);
  expect(mid(o)[0]).toBe((w.a[0] + w.b[0]) / 2);
  expect(len(o)).toBe(120);
});

test("an opening lands on the outline edge when there are no rooms", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const g = l.floors.ground;
    g.rooms = []; g.doors = []; g.devices = []; g.stairs = []; g.furniture = []; g.outline = [[0, 0], [600, 0], [600, 200], [0, 200]];
    l.catalog = [];
    el.layout = l;
  }, EDITOR);
  await addGap(page);
  const o = (await gaps(page))[0];
  expect(o.a[1]).toBe(o.b[1]);
  expect([0, 200]).toContain(o.a[1]);
  expect(mid(o)[0]).toBeGreaterThan(0);
  expect(mid(o)[0]).toBeLessThan(600);
  expect(len(o)).toBe(120);
});

test("break it: with no wall on the floor, Add, Opening places a horizontal opening at the view centre and does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await addBareFloor(page, "Attic");
  expect(await page.evaluate((tag) => Object.keys((document.querySelector(tag as string) as any).layout.floors.attic).length > 0, EDITOR)).toBe(true);
  await addGap(page);
  const o = (await layoutOf(page)).floors.attic.openings;
  expect(o).toHaveLength(1);
  expect(o[0].a[1]).toBe(o[0].b[1]);
  expect(len(o[0])).toBe(120);
  const vb = (await page.locator("svg").first().getAttribute("viewBox"))!.split(" ").map(Number);
  expect(Math.abs(mid(o[0])[0] - (vb[0] + vb[2] / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(mid(o[0])[1] - (vb[1] + vb[3] / 2))).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("Add, Door and Add, Window still place a door and a window", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addDoor").click();
  await menu(page, "Add");
  await page.locator("#addWin").click();
  const d = (await groundOf(page)).doors;
  expect(d.slice(-2).map((x) => [x.kind, len(x)])).toEqual([["door", 90], ["window", 120]]);
});

test("dragging an opening end snaps like a door end: to a corner", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 640], b: [200, 640] });
    el.layout = l;
  }, EDITOR);
  await dragCm(page, [200, 640], [497, 402]); // near the corner (500, 400)
  expect((await gaps(page))[0].b).toEqual([500, 400]);
  await page.keyboard.press("Control+z");
  expect((await gaps(page))[0].b).toEqual([200, 640]);
});

// ---- Sprint 1.5 review fixes ----

test("a zone edge has no wall toggle, and every panel action on it leaves a valid layout", async ({ page }) => {
  await clickCm(page, 400, 40); // the top edge of the Reading corner zone, on the real screen
  await expect(page.locator("#elen")).toBeVisible();
  await expect(page.locator("#ek")).toHaveCount(0);
  const zi = (await groundOf(page)).rooms.findIndex((r) => r.kind === "zone");
  const zoneW = async () => (await groundOf(page)).rooms[zi].wk;
  const ok = async () => { expect(validate(await layoutOf(page)).ok).toBe(true); expect(await zoneW()).toEqual((await zoneW()).map((): WallKind => "boundary")); };
  await page.locator("#elen").fill("1.5");
  await page.locator("#elen").press("Enter");
  await ok();
  await expect(page.locator("#ek")).toHaveCount(0);
  await page.locator("#mkh").click();
  await ok();
  await page.locator("#mkv").click();
  await ok();
  await expect(page.locator("#ek")).toHaveCount(0);
  await page.locator("#addpt").click();
  await ok();
  await savedValid(page);
});

/** The demo with a zone corner on the living / kitchen corner (500, 0), and another on (500, 400). */
async function withZoneOnRoomCorners(page: Page, zoneFirst: boolean) {
  await page.evaluate(([tag, first]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const rooms = l.floors.ground.rooms, z = rooms.find((r: any) => r.kind === "zone");
    z.pts = [[500, 0], [560, 0], [560, 60], [500, 60]];
    if (first) rooms.unshift(...rooms.splice(rooms.indexOf(z), 1));
    el.layout = l;
  }, [EDITOR, zoneFirst] as const);
}
const zoneOf = async (page: Page) => (await groundOf(page)).rooms.find((r) => r.kind === "zone")!;

test("a room corner typed into the corner panel does not take a zone corner on it along", async ({ page }) => {
  await withZoneOnRoomCorners(page, true); // the zone is drawn first, so the room's handle is on top at (500, 0)
  await clickCm(page, 500, 0);
  await expect(page.locator("#px")).toHaveValue("500");
  await page.locator("#px").fill("530");
  await page.locator("#px").press("Enter");
  const g = await groundOf(page);
  expect(g.rooms.find((r) => r.name === "Living")!.pts[1]).toEqual([530, 0]);
  expect(g.rooms.find((r) => r.name === "Kitchen")!.pts[0]).toEqual([530, 0]);
  expect((await zoneOf(page)).pts[0]).toEqual([500, 0]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("a zone corner typed into the corner panel does not take the room corners on it along", async ({ page }) => {
  await withZoneOnRoomCorners(page, false); // the zone handle is on top at (500, 0)
  await clickCm(page, 500, 0);
  await page.locator("#px").fill("470");
  await page.locator("#px").press("Enter");
  const g = await groundOf(page);
  expect((await zoneOf(page)).pts[0]).toEqual([470, 0]);
  expect(g.rooms.find((r) => r.name === "Living")!.pts[1]).toEqual([500, 0]);
  expect(g.rooms.find((r) => r.name === "Kitchen")!.pts[0]).toEqual([500, 0]);
});

test("the length of a room edge does not take a zone corner on its second end along", async ({ page }) => {
  // a triangle with one corner on the shared living / kitchen corner (500, 0), away from the edge being selected
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const z = l.floors.ground.rooms.find((r: any) => r.kind === "zone");
    z.pts = [[500, 0], [560, 0], [520, 60]]; z.wk = ["boundary", "boundary", "boundary"];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 500, 200); // the shared edge; the top polygon's line (the kitchen's) is the one hit, its second end is (500, 0)
  await expect(page.locator("#elen")).toHaveValue("4.00");
  await page.locator("#elen").fill("3");
  await page.locator("#elen").press("Enter");
  const g = await groundOf(page);
  expect(g.rooms[1].pts[0]).toEqual([500, 100]); // the edge got shorter: the room corners moved
  expect(g.rooms[0].pts[1]).toEqual([500, 100]);
  expect((await zoneOf(page)).pts[0]).toEqual([500, 0]);
});

// ---- a double-click whose first click already finished the shape ----
const dblclickCm = async (page: Page, x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.dblclick(c.x, c.y); };
/**
 * The dblclick event that Firefox and Safari send after a click that finished a shape. Chromium sends none:
 * the plan is redrawn between the two clicks, its click count restarts, and page.mouse.dblclick fires nothing.
 * The clicks before it are real page.mouse clicks; only this event is synthetic.
 */
const sendDblclick = async (page: Page, x: number, y: number) => {
  const c = await screenOf(page, x, y);
  await page.evaluate(([tag, cx, cy]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    root.elementFromPoint(cx as number, cy as number)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, clientX: cx as number, clientY: cy as number, detail: 2 }));
  }, [EDITOR, c.x, c.y] as const);
};
const pointCount = (g: Floor) => g.outline.length + g.rooms.reduce((n, r) => n + r.pts.length, 0) + g.stairs.reduce((n, r) => n + r.pts.length, 0);

test("a double-click on a wall outside draw mode still adds a point to it, in one undo step", async ({ page }) => {
  const before = await groundOf(page);
  await dblclickCm(page, 250, 400); // the living room / hall edge
  expect(pointCount(await groundOf(page))).toBeGreaterThan(pointCount(before));
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Opening: a click, a real double-click on the second end on a wall: one opening, one undo step, no new corner", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await dblclickCm(page, 300, 400);
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(g.rooms.map((r) => r.pts)).toEqual(before.rooms.map((r) => r.pts));
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Opening: a deliberate double-click right after finishing on the wall adds a corner (the finishing press and two more)", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400); // finishes the opening
  await dblclickCm(page, 300, 400); // press 2 and press 3: a real double-click
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(pointCount(g)).toBeGreaterThan(pointCount(before)); // the corner went into the wall under the pointer
});

test("Draw, Opening: the dblclick that follows the finishing click adds no corner to the wall under it", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400); // finishes the opening
  await clickCm(page, 300, 400); // the second press of the pair: exactly one press follows the finishing one
  await sendDblclick(page, 300, 400);
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(pointCount(g)).toBe(pointCount(before));
  expect(g.rooms.map((r) => r.pts)).toEqual(before.rooms.map((r) => r.pts));
  await page.keyboard.press("Control+z"); // one undo step: the opening
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("a polygon closed on its first point, then the dblclick there, gets no extra corner", async ({ page }) => {
  const before = await groundOf(page);
  // the first point lies on the living room / hall edge (y = 400), so closing stitches it into both rooms
  const tri: [number, number][] = [[250, 400], [330, 460], [190, 470]];
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...tri);
  await clickCm(page, 250, 400); // the closing click
  const single = await groundOf(page);
  await clickCm(page, 250, 400); // the second press of the pair
  await sendDblclick(page, 250, 400);
  expect(await groundOf(page)).toEqual(single);
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
  // and a real double-click on the first point closes it just the same
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...tri);
  await dblclickCm(page, 250, 400);
  expect(await groundOf(page)).toEqual(single);
});

test("pinned regression, passes with or without the guard: a late dblclick, or one after a click elsewhere, adds its point", async ({ page }) => {
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400);
  const n = pointCount(await groundOf(page));
  await page.waitForTimeout(700); // past the double-click interval
  await sendDblclick(page, 650, 400);
  expect(pointCount(await groundOf(page))).toBeGreaterThan(n);
  await page.keyboard.press("Control+z");
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400);
  await clickCm(page, 100, 500); // a press elsewhere is not part of that double-click
  await sendDblclick(page, 650, 400);
  expect(pointCount(await groundOf(page))).toBeGreaterThan(n);
});

test("Add, Door and Add, Opening skip a zone edge: they land on the nearest wall, not on the zone edge next to the view centre", async ({ page }) => {
  const v = await page.evaluate((tag) => ({ ...(document.querySelector(tag as string) as any).st.view }), EDITOR);
  const cx = Math.round(v.x + v.w / 2), cy = Math.round(v.y + v.h / 2);
  await page.evaluate(([tag, x, y]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const z = l.floors.ground.rooms.find((r: any) => r.kind === "zone");
    z.pts = [[x - 60, y - 20], [x + 60, y - 20], [x + 60, y + 40], [x - 60, y + 40]]; // its top edge is 20 cm above the view centre
    el.layout = l;
  }, [EDITOR, cx, cy] as const);
  const zoneYs = [cy - 20, cy + 40];
  await menu(page, "Add");
  await page.locator("#addDoor").click();
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(zoneYs).not.toContain(d.a[1]);
  expect(zoneYs).not.toContain(d.b[1]);
  await menu(page, "Add");
  await page.locator("#addGap").click();
  const o = (await groundOf(page)).openings.at(-1)!;
  expect(zoneYs).not.toContain(o.a[1]);
  expect(zoneYs).not.toContain(o.b[1]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("Add, Door lands on a free wall when that is the nearest edge, along its direction", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addWall-wall").click(); // a horizontal wall
  const w = (await groundOf(page)).walls[0];
  await centreViewOn(page, mid(w)); // the wall is now the edge nearest the view centre
  await menu(page, "Add");
  await page.locator("#addDoor").click();
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(d.a[1]).toBe(w.a[1]);
  expect(d.b[1]).toBe(w.a[1]);
  expect(mid(d)[0]).toBe((w.a[0] + w.b[0]) / 2);
  expect(len(d)).toBe(90);
});

test("a zone's plan label is drawn muted: its class has a rule, unlike a room label", async ({ page }) => {
  const style = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return { fill: c.fill, opacity: c.opacity }; });
  const zone = await style("svg text.lbl.zone"), room = await style("svg text.lbl:not(.zone)");
  expect(zone).not.toEqual(room);
});

test("a floor property named like an Object.prototype key does not cancel a draw or change the floor", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...FREE.slice(0, 2));
  await expect(drawnPoints(page)).toHaveCount(2);
  // The editor's own layout has null-prototype floors, so a prototype key is unreachable there. Give it a plain
  // object, as any host that hands in one would, to reach the lookup.
  await page.evaluate(() => { const st = (document.querySelector("floorplan-studio-editor") as any).st; st.layout.floors = { ...st.layout.floors }; });
  const floor = await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).st.floor);
  for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    await page.evaluate((v) => { (document.querySelector("floorplan-studio-editor") as any).floor = v; }, k);
    await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).updateComplete);
    expect(await page.evaluate(() => !!(document.querySelector("floorplan-studio-editor") as any).draw)).toBe(true); // the draw was not stopped
  }
  expect(await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).st.floor)).toBe(floor);
});

test("a dragged zone corner dropped 4 cm from a room corner lands on the grid, not on the room corner", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const j = 1; // (460, 40); the living room corner (500, 0) is 40 cm away, the drop is 4 cm from it
  await dragCm(page, z.pts[j] as [number, number], [496, 4]);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[j]).toEqual([495, 5]); // the 5 cm grid; a snap would give [500, 0]
  expect(g1.rooms[0].pts).toEqual(g0.rooms[0].pts);
  expect(g1.rooms[1].pts).toEqual(g0.rooms[1].pts);
  await savedValid(page);
});

test("a dragged zone corner lines up with another corner of the same zone, and with nothing else", async ({ page }) => {
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  // (460, 140) is corner 2; drop it 3 cm from x = 340, the x of corners 0 and 3: it lines up with them
  await dragCm(page, z.pts[2] as [number, number], [343, 160]);
  expect((await groundOf(page)).rooms[zi].pts[2]).toEqual([340, 160]);
});

test("placing a device whose catalog floor is named like an Object.prototype key stays on the current floor and keeps its chip pressed", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click(); // light-living is unplaced again
  // the editor's own floors have a null prototype; a plain object reaches the lookup
  await page.evaluate((tag) => { const st = (document.querySelector(tag) as any).st; st.layout.floors = { ...st.layout.floors }; st.layout.catalog.find((c: any) => c.id === "light-living").floor = "constructor"; }, EDITOR);
  const floor = await page.evaluate((tag) => (document.querySelector(tag) as any).st.floor, EDITOR);
  await menu(page, "Device");
  await devItem(page, "light-living").click();
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).floor, EDITOR)).toBe(floor);
  await expect(page.locator(`.chip[data-f="${floor}"]`)).toHaveAttribute("aria-pressed", "true");
  expect((await groundOf(page)).devices.some((d) => d.id === "light-living")).toBe(true); // it landed on the current floor
});

test("a click 3 cm off a zone edge that lies on a room edge picks the room edge, so its wall toggle is reachable, whichever is listed first", async ({ page }) => {
  for (const first of [true, false]) {
    await page.evaluate(([tag, zoneFirst]) => {
      const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
      const rooms = l.floors.ground.rooms, z = rooms.find((r: any) => r.kind === "zone");
      z.pts = [[500, 100], [560, 100], [560, 200], [500, 200]]; // its left edge lies on the living / kitchen wall x = 500
      const at = rooms.indexOf(z); rooms.splice(at, 1);
      if (zoneFirst) rooms.unshift(z); else rooms.push(z);
      el.layout = l;
    }, [EDITOR, first] as const);
    await clickCm(page, 503, 150);
    await expect(page.locator("#ek")).toHaveCount(1); // the room edge under the zone edge has a kind select
  }
});

test("a zone corner dropped on a wall where a third polygon has a corner is not stitched into the rooms either side", async ({ page }) => {
  // a small structure whose corner (500, 250) lies on the living / kitchen wall x = 500
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms.push({ id: "room-ground-9", name: "Shed", area: "shed", label: "", kind: "structure", pts: [[500, 250], [540, 250], [540, 290]], wk: ["wall", "wall", "wall"] });
    el.layout = l;
  }, EDITOR);
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const counts = (g: Floor) => g.rooms.map((r) => r.pts.length);
  const before = counts(g0);
  await dragCm(page, z.pts[0] as [number, number], [500, 250]);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[0]).toEqual([500, 250]); // it landed there
  expect(counts(g1)).toEqual(before); // no point went into the living room or the kitchen
  expect(g1.outline).toEqual(g0.outline);
  await savedValid(page);
});

test("the room colour input sets the polygon fill, one undo step, and the default button clears it", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  const plain = await computed();
  await expect(page.locator("#rcol")).toHaveValue("#ffffff");
  await page.locator("#rcol").fill("#aabbcc");
  await expect(poly).toHaveAttribute("fill", "#aabbcc");
  expect(await computed()).toBe("rgb(170, 187, 204)"); // the class rule must not override it
  expect((await groundOf(page)).rooms[0].color).toBe("#aabbcc");
  await page.locator("#rcol").fill("#aabbcc"); // unchanged: no step
  await page.locator("#rcolx").click();
  await expect(poly).not.toHaveAttribute("fill", /.*/);
  expect((await groundOf(page)).rooms[0]).not.toHaveProperty("color");
  expect(await computed()).toBe(plain);
  await page.locator("#rcolx").click(); // nothing to clear: no step
  await page.keyboard.press("Control+z");
  await expect(poly).toHaveAttribute("fill", "#aabbcc");
  await page.keyboard.press("Control+z");
  await expect(poly).not.toHaveAttribute("fill", /.*/);
  expect(await poly.evaluate((el) => getComputedStyle(el).fill)).toBe(plain);
});

test("a fill room is painted with the hatch pattern in the browser, with or without its own colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator("#rk").selectOption("fill");
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  expect(await computed()).toContain("fp-hatch");
  await page.locator("#rcol").fill("#aabbcc");
  expect(await computed()).toContain("fp-hatch");
});

// ---- S1.18 the kind of a room edge ----
test("the kind select of a shared edge writes both rooms, redraws the line, is one undo step, and none when unchanged", async ({ page }) => {
  await clickCm(page, 500, 300); // the living / kitchen edge
  await expect(page.locator("#ek")).toHaveValue("wall");
  await expect(page.locator("#wallt")).toHaveCount(0);
  await expect(page.locator("#panel strong").first()).toHaveText("Internal wall");
  const options = await page.locator("#ek option").allTextContents();
  expect(options).toEqual(["Internal wall", "Dotted boundary", "External wall", "Fence", "Outdoor edge"]);
  await page.locator("#ek").selectOption("external");
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["external", "external"]);
  expect(g.rooms[0].wk.filter((k) => k === "external")).toHaveLength(1);
  await expect(page.locator('svg line[data-e="r0:1"]')).toHaveClass("e external");
  await expect(page.locator('svg line[data-e="r1:3"]')).toHaveClass("e external");
  await expect(page.locator("#panel strong").first()).toHaveText("External wall");
  await page.locator("#ek").selectOption("external"); // same kind: no step
  await page.locator("#ek").selectOption("fence");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("fence");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("external"); // one step back, not two
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("wall");
  await savedValid(page);
});

test("break it: an outline edge of a floor with no rooms has no kind select and nothing throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = [];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // the top outline edge
  await expect(page.locator("#elen")).toBeVisible(); // an edge is selected
  await expect(page.locator("#ek")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---- S1.19 a free wall becomes an opening, and back ----
const status = (page: Page) => page.locator("#status");

test("a free wall becomes an opening and back to a wall of a chosen kind; two undos return to the first wall", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60 + 3 * 150, 650); // the fence, wall index 3
  await expect(page.locator("#wk")).toHaveValue("fence");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]).slice(5))).toEqual([["opening", "Opening (a gap in the wall)"]]);
  const before = await groundOf(page), fence = before.walls[3];
  await page.locator("#wk").selectOption("opening");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(4);
  expect(g.openings).toHaveLength(1);
  expect([g.openings[0].a, g.openings[0].b]).toEqual([fence.a, fence.b]);
  expect(g.openings[0].id).toBe("opening-ground-1");
  await expect(page.locator("#panel strong").first()).toHaveText("Opening");
  await expect(page.locator("svg line.hl")).toHaveCount(1); // the new opening is selected
  // the real pointer reaches the new opening, not a wall
  expect(await topAt(page, 60 + 3 * 150, 650)).toBe("line.opening");
  expect(await page.locator("#ok option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["opening", "Opening"], ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"],
  ]);
  await expect(page.locator("#ok")).toHaveValue("opening");
  await page.locator("#ok").selectOption("external");
  const h = await groundOf(page);
  expect(h.openings).toHaveLength(0);
  expect(h.walls).toHaveLength(5);
  const back = h.walls[h.walls.length - 1];
  expect([back.a, back.b, back.kind]).toEqual([fence.a, fence.b, "external"]);
  await expect(page.locator("#wk")).toHaveValue("external");
  await expect(page.locator(`svg line[data-w="${h.walls.length - 1}"]`)).toHaveClass("e external");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await savedValid(page);
});

test("choosing the opening entry on a room edge select is not possible: the edge kind select has five kinds", async ({ page }) => {
  await clickCm(page, 500, 200);
  expect(await page.locator("#ek option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["wall", "boundary", "external", "fence", "edge"]);
});

test("break it: a wall of zero length is not turned into an opening; the status line says so and nothing is written", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls = [{ id: "wall-ground-1", a: [100, 700], b: [100, 700], kind: "wall" }, { id: "wall-ground-2", a: [300, 700], b: [400, 700], kind: "wall" }];
    el.layout = l;
  }, EDITOR);
  // a zero-length wall has no body to click: select it through the editor state
  await page.evaluate((tag) => { (document.querySelector(tag as string) as any).st.sel = { t: "wall", i: 0 }; (document.querySelector(tag as string) as any).requestUpdate(); }, EDITOR);
  await expect(page.locator("#wk")).toBeVisible();
  const before = await layoutOf(page);
  await page.locator("#wk").selectOption("opening");
  await expect(status(page)).toContainText("zero length");
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator("#wk")).toHaveValue("wall"); // the select snaps back to the kind
  await page.keyboard.press("Control+z"); // nothing was recorded: undo does nothing
  expect(await layoutOf(page)).toEqual(before);
});

// ---- S1.20 a new item lands outside the house ----
/** The part of the plan the svg shows now: [x0, y0, x1, y1] in cm. */
const visible = (page: Page) =>
  page.evaluate((tag) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement, v = svg.viewBox.baseVal;
    return [v.x, v.y, v.x + v.width, v.y + v.height] as [number, number, number, number];
  }, EDITOR);
const addMenuItem = async (page: Page, id: string) => { await menu(page, "Add"); await page.locator(id).click(); };
const OUTLINE_MAX_X = 800;

test("Add, Structure puts every point outside the outline's box, and the structure is inside the view afterwards", async ({ page }) => {
  await addMenuItem(page, "#addStr");
  const g = await groundOf(page), s = g.rooms[g.rooms.length - 1];
  expect(s.kind).toBe("structure");
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThan(OUTLINE_MAX_X); expect(x % 5).toBe(0); expect(y % 5).toBe(0); }
  const v = await visible(page);
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThanOrEqual(v[0]); expect(x).toBeLessThanOrEqual(v[2]); expect(y).toBeGreaterThanOrEqual(v[1]); expect(y).toBeLessThanOrEqual(v[3]); }
});

test("Add, Wall, Zone, Stairs and Furniture all land right of the house, top aligned with it", async ({ page }) => {
  await addMenuItem(page, "#addWall-wall");
  await addMenuItem(page, "#addZone");
  await addMenuItem(page, "#addStairs");
  await menu(page, "Add");
  await page.locator("#addFurn").selectOption("bed");
  const g = await groundOf(page);
  const pts: number[][] = [...g.walls.flatMap((w) => [w.a, w.b]), ...g.rooms.slice(7).flatMap((r) => r.pts), ...g.stairs.slice(1).flatMap((t) => t.pts)];
  expect(pts.length).toBe(2 + 4 + 4);
  for (const [x] of pts) expect(x).toBeGreaterThan(OUTLINE_MAX_X);
  const bed = g.furniture[g.furniture.length - 1];
  expect(bed.x - bed.w / 2).toBeGreaterThan(OUTLINE_MAX_X);
  expect(bed.y).toBe(0); // the top of the outline
});

test("break it: with the view panned far from the house, an added item is still outside the house and comes into view", async ({ page }) => {
  // pan with real drags on the background, far to the south-west of the house
  for (let n = 0; n < 4; n++) {
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await page.mouse.move(600, 500, { steps: 5 });
    await page.mouse.move(350, 700, { steps: 5 });
    await page.mouse.up();
  }
  const far = await visible(page);
  expect(far[0]).toBeGreaterThan(OUTLINE_MAX_X + 1500); // the house is nowhere near the view
  await addMenuItem(page, "#addStr");
  const g = await groundOf(page), s = g.rooms[g.rooms.length - 1];
  for (const [x] of s.pts) expect(x).toBeGreaterThan(OUTLINE_MAX_X);
  const v = await visible(page);
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThanOrEqual(v[0]); expect(x).toBeLessThanOrEqual(v[2]); expect(y).toBeGreaterThanOrEqual(v[1]); expect(y).toBeLessThanOrEqual(v[3]); }
  // the zoom did not change
  expect(Math.round((v[2] - v[0]) * 10)).toBe(Math.round((far[2] - far[0]) * 10));
});

/** True when the shape's screen box lies wholly inside the svg's own box. */
const inCanvas = (page: Page, shape: string) =>
  page.evaluate(([tag, sel]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const c = root.querySelector("svg")!.getBoundingClientRect(), r = root.querySelector(sel as string)!.getBoundingClientRect();
    return r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
  }, [EDITOR, shape] as const);
const NEW_SHAPES: [string, (page: Page) => Promise<void>, string][] = [
  ["wall", (p) => addMenuItem(p, "#addWall-wall"), 'line[data-w="0"]'],
  ["structure", (p) => addMenuItem(p, "#addStr"), 'polygon[data-r="7"]'],
  ["zone", (p) => addMenuItem(p, "#addZone"), 'polygon[data-r="7"]'],
  ["stairs", (p) => addMenuItem(p, "#addStairs"), '[data-s="1"]'],
  ["furniture", async (p) => { await menu(p, "Add"); await p.locator("#addFurn").selectOption("bed"); }, 'g[data-f="2"]'],
];
async function zoomIn(page: Page, ticks: number) {
  const c = await screenOf(page, 400, 300);
  await page.mouse.move(c.x, c.y);
  for (let n = 0; n < ticks; n++) await page.mouse.wheel(0, -300);
}
for (const [name, add, shape] of NEW_SHAPES) {
  for (const zoom of [0, 6]) {
    test(`a new ${name} is wholly in view, ${zoom ? "after zooming in" : "at the default view"}`, async ({ page }) => {
      if (zoom) await zoomIn(page, zoom);
      await add(page);
      await expect(page.locator(shape)).toHaveCount(1);
      expect(await inCanvas(page, shape)).toBe(true);
    });
  }
}

test("a new structure that does not fit at this zoom brings the view out until it does", async ({ page }) => {
  await zoomIn(page, 14); // a window a few metres wide
  const before = (await visible(page));
  await addMenuItem(page, "#addStr");
  expect(await inCanvas(page, 'polygon[data-r="7"]')).toBe(true);
  const after = await visible(page);
  expect(after[2] - after[0]).toBeGreaterThan(before[2] - before[0]); // it zoomed out, and only because it had to
});

test("a floor with no outline: an added zone lands at the view centre, as before", async ({ page }) => {
  await addBareFloor(page, "Attic");
  await expect(page.locator(".chip[data-f]")).toHaveCount(3);
  const v = await visible(page);
  await addMenuItem(page, "#addZone");
  const l = await layoutOf(page), z = l.floors.attic.rooms[0], cx = (z.pts[0][0] + z.pts[2][0]) / 2, cy = (z.pts[0][1] + z.pts[2][1]) / 2;
  expect(Math.abs(cx - (v[0] + v[2]) / 2)).toBeLessThan(10);
  expect(Math.abs(cy - (v[1] + v[3]) / 2)).toBeLessThan(10);
});

test("a device whose catalog room is not on the floor lands right of the house and is in view", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.catalog.find((c: any) => c.id === "contact-garage").room = "Nowhere";
    el.layout = l;
  }, EDITOR);
  await menu(page, "Device");
  await devItem(page, "contact-garage").click();
  const g = await groundOf(page), d = g.devices[g.devices.length - 1] as { id: string; x: number; y: number };
  expect(d.id).toBe("contact-garage");
  expect(d.x).toBeGreaterThan(OUTLINE_MAX_X);
  const v = await visible(page);
  expect(d.x).toBeGreaterThanOrEqual(v[0]); expect(d.x).toBeLessThanOrEqual(v[2]);
});

// ---- S1.21 Draw is its own menu ----
const DRAW_IDS = ["drawRoom", "drawZone", "drawWater", "drawOutline", "drawWall-wall", "drawWall-boundary", "drawWall-external", "drawWall-fence", "drawWall-edge", "drawOpening", "drawExtra"];

test("the Add menu holds no Draw item and no Water; the Draw menu holds all eleven", async ({ page }) => {
  for (const id of [...DRAW_IDS, "addWater", "addWall"]) await expect(page.locator(`#mAdd #${id}`)).toHaveCount(0);
  await expect(page.locator("#mAdd .grp, #mAdd .sep").filter({ hasText: /Draw/ })).toHaveCount(0);
  const ids = await page.locator("#mAdd button").evaluateAll((b) => b.map((x) => x.id));
  expect(ids).toEqual(["addDoor", "addWin", "addGap", "addWall-wall", "addWall-boundary", "addWall-external", "addWall-fence", "addWall-edge", "addStr", "addZone", "addStairs"]);
  await expect(page.locator("#mAdd select#addFurn")).toHaveCount(1);
  expect(await page.locator("#mDraw button").evaluateAll((b) => b.map((x) => x.id))).toEqual(DRAW_IDS);
  // and they are really there to click: open, visible, inside the window
  await menu(page, "Draw");
  const box = await page.locator("#drawRoom").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await expect(page.locator("#drawRoom")).toBeVisible();
});

test("each Add, Wall item places a 200 cm wall of its kind at the spawn point, selected, in one undo step", async ({ page }) => {
  for (const kind of WALL_KINDS) {
    const before = await groundOf(page);
    await menu(page, "Add");
    await page.locator(`#addWall-${kind}`).click();
    const g = await groundOf(page), w = g.walls[g.walls.length - 1];
    expect(g.walls).toHaveLength(before.walls.length + 1);
    expect([w.kind, dist2(w.a, w.b)]).toEqual([kind, 200]);
    expect(w.a[0]).toBeGreaterThan(OUTLINE_MAX_X);
    await expect(page.locator("#wk")).toHaveValue(kind);
    await expect(page.locator(`svg line[data-w="${g.walls.length - 1}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls).toHaveLength(4);
});
const dist2 = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

test("opening Draw closes Add, and a Draw item starts drawing with the Draw menu closed", async ({ page }) => {
  await menu(page, "Add");
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", true);
  await menu(page, "Draw");
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", false);
  await expect(page.locator("#mDraw")).toHaveJSProperty("open", true);
  await page.locator("#drawWall-fence").click();
  await expect(page.locator("#mDraw")).toHaveJSProperty("open", false);
  expect(await svgCursor(page)).toBe("crosshair");
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("break it: a second Draw item chosen mid-draw starts afresh and writes nothing from the first", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawWall-fence");
  await clicksCm(page, FREE[0], FREE[1]);
  await expect(drawnPoints(page)).toHaveCount(2);
  await startDraw(page, "drawWall-edge");
  await expect(drawnPoints(page)).toHaveCount(0);
  await clicksCm(page, FREE[2], FREE[3]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(before.walls.length + 1);
  expect(g.walls[g.walls.length - 1].kind).toBe("edge");
  expect(g.walls.some((w) => w.kind === "fence")).toBe(false);
});

// ---- S1.22 everything drags by its body ----
const bbox = (page: Page, sel: string) => page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });

test("dragging the pond by its middle moves every point by the same amount, adds no point to any wall, and is one undo step", async ({ page }) => {
  const before = await groundOf(page), pond = before.rooms[6];
  expect(pond.kind).toBe("water");
  const b0 = await bbox(page, 'svg polygon[data-r="6"]');
  await drag(page, 'svg polygon[data-r="6"]', 20, 60); // far from any corner, so the drop does not snap
  const b1 = await bbox(page, 'svg polygon[data-r="6"]');
  expect(Math.round(b1.x - b0.x)).toBe(20); // it followed the pointer on screen
  expect(Math.round(b1.y - b0.y)).toBe(60);
  const after = await groundOf(page), moved = after.rooms[6];
  const d = [moved.pts[0][0] - pond.pts[0][0], moved.pts[0][1] - pond.pts[0][1]];
  expect(d[0]).toBeGreaterThan(0); expect(d[1]).toBeGreaterThan(0);
  moved.pts.forEach((p, i) => expect([p[0] - pond.pts[i][0], p[1] - pond.pts[i][1]]).toEqual(d));
  expect(moved.wk).toEqual(pond.wk);
  expect(after.rooms.map((r) => r.pts.length)).toEqual(before.rooms.map((r) => r.pts.length));
  expect(after.outline).toEqual(before.outline);
  expect(after.rooms.filter((_, i) => i !== 6)).toEqual(before.rooms.filter((_, i) => i !== 6));
  await expect(page.locator("#rk")).toHaveValue("water"); // it is selected
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("dragging the stairs by their middle moves every point by the same amount", async ({ page }) => {
  const before = await groundOf(page), t0 = before.stairs[0];
  const b0 = await bbox(page, 'svg g[data-s="0"]');
  await drag(page, 'svg g[data-s="0"]', -50, -30);
  const b1 = await bbox(page, 'svg g[data-s="0"]');
  expect(Math.round(b1.x - b0.x)).toBe(-50);
  expect(Math.round(b1.y - b0.y)).toBe(-30);
  const after = await groundOf(page), t1 = after.stairs[0];
  const d = [t1.pts[0][0] - t0.pts[0][0], t1.pts[0][1] - t0.pts[0][1]];
  expect(d[0]).toBeLessThan(0);
  t1.pts.forEach((p, i) => expect([p[0] - t0.pts[i][0], p[1] - t0.pts[i][1]]).toEqual(d));
  expect(after.rooms).toEqual(before.rooms); // nothing else moved, and no room gained a point
  await expect(page.locator("#sn")).toBeVisible();
});

test("a press on a room body that does not move selects it and records no undo step; the plan does not pan", async ({ page }) => {
  const v0 = await visible(page);
  const c = await screenOf(page, 100, 300);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y + 1); // under the 4 px threshold
  await page.mouse.up();
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(page.locator("#undo")).toBeDisabled();
  expect(await visible(page)).toEqual(v0);
});

test("break it: dragging a room by its body leaves the neighbour's corner and the outline where they were", async ({ page }) => {
  const before = await groundOf(page);
  expect(before.rooms[0].pts[1]).toEqual(before.rooms[1].pts[0]); // living and kitchen share (500, 0)
  await dragCm(page, [100, 300], [100, 340]); // the living room, by its middle
  const after = await groundOf(page);
  expect(after.rooms[0].pts.map((p) => p[1] - before.rooms[0].pts[after.rooms[0].pts.indexOf(p)][1])).toEqual([40, 40, 40, 40]);
  expect(after.rooms[1]).toEqual(before.rooms[1]); // the kitchen kept its corner
  expect(after.rooms[2]).toEqual(before.rooms[2]);
  expect(after.outline).toEqual(before.outline);
  expect(after.rooms[0].pts.length).toBe(4);
});

test("a room dragged 300 cm away and back to within a few cm snaps corner on corner and shares its edges again", async ({ page }) => {
  const before = await groundOf(page);
  await dragCm(page, [50, 200], [350, 200]); // the living room, by its body, 300 cm to the right
  const away = await groundOf(page);
  expect(away.rooms[0].pts[0]).toEqual([before.rooms[0].pts[0][0] + 300, before.rooms[0].pts[0][1]]);
  await dragCm(page, [350, 200], [47, 203]); // back to 3 cm left and 3 cm low of its place
  const after = await groundOf(page);
  expect(after.rooms[0].pts).toEqual(before.rooms[0].pts); // exactly the original points
  expect(after.rooms[0].pts[1]).toEqual(after.rooms[1].pts[0]); // living and kitchen share (500, 0) again
  expect(after.rooms[0].wk).toEqual(before.rooms[0].wk);
  expect(after.rooms[1].pts).toContainEqual(after.rooms[0].pts[1]); // the neighbour has that corner too
  for (const q of before.outline) expect(after.outline).toContainEqual(q); // the outline kept its corners (it may have gained points where the room's corners touched it)
  await savedValid(page);
});

test("holding Alt while dropping a room near its place leaves it exactly where it was dropped", async ({ page }) => {
  const before = await groundOf(page);
  await dragCm(page, [50, 200], [350, 200]);
  await dragCm(page, [350, 200], [47, 203], ["Alt"]);
  const after = await groundOf(page);
  expect(after.rooms[0].pts).not.toEqual(before.rooms[0].pts);
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeLessThan(8);
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeGreaterThan(0);
});

test("a device sitting on a room is still dragged as a device, not as the room", async ({ page }) => {
  const before = await groundOf(page);
  await drag(page, 'g[data-x="0"]', 30, 30);
  const after = await groundOf(page);
  expect(after.rooms).toEqual(before.rooms);
  expect(after.devices[0]).not.toEqual(before.devices[0]);
});

// ---- S1.23 rotate a device, a wall, a door or an opening ----
const angleOf = (o: { a: number[]; b: number[] }) => Math.round(((Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) * 180) / Math.PI + 360) % 360);

test("a door's angle field turns it about its midpoint: at 90 the ends swap axis, the midpoint stays, the length stays", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addDoor").click();
  const d0 = (await groundOf(page)).doors.at(-1)!;
  const turn = (angleOf(d0) + 90) % 360;
  await expect(page.locator("#drot")).toHaveValue(String(angleOf(d0)));
  await page.locator("#drot").fill(String(turn));
  await page.locator("#drot").press("Enter");
  const d1 = (await groundOf(page)).doors.at(-1)!;
  expect(angleOf(d1)).toBe(turn); // a quarter turn: the ends swap axis
  expect(d0.a[0] === d0.b[0]).not.toBe(d1.a[0] === d1.b[0]);
  expect(mid(d1)).toEqual(mid(d0));
  expect(Math.abs(len(d1) - len(d0))).toBeLessThanOrEqual(1);
  await expect(page.locator("#drot")).toHaveValue(String(turn));
  // the line drawn in the browser follows it
  const box = await page.locator(`svg line[data-d="${(await groundOf(page)).doors.length - 1}"]`).boundingBox();
  if (d1.a[0] === d1.b[0]) expect(box!.height).toBeGreaterThan(box!.width * 2);
  else expect(box!.width).toBeGreaterThan(box!.height * 2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).doors.at(-1)).toEqual(d0);
  await savedValid(page);
});

test("the wall and opening angle fields turn them; an unchanged value is no undo step", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wrot")).toHaveValue("0");
  await page.locator("#wrot").fill("0");
  await page.locator("#wrot").press("Enter");
  await expect(page.locator("#undo")).toBeDisabled();
  await page.locator("#wrot").fill("90");
  await page.locator("#wrot").press("Enter");
  const w = (await groundOf(page)).walls[0];
  expect([w.a, w.b]).toEqual([[60, 600], [60, 700]]);
  await page.locator("#wk").focus(); // as a real click does
  await page.locator("#wk").selectOption("opening");
  await expect(page.locator("#orot")).toHaveValue("90");
  await page.locator("#orot").fill("0");
  await page.locator("#orot").press("Enter");
  const o = (await groundOf(page)).openings[0];
  expect([o.a, o.b]).toEqual([[10, 650], [110, 650]]);
});

test("a device rotation is stored, drawn on the group and undone; the glyph stays upright in the browser; the real pointer still hits it", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#vrot")).toHaveValue("0");
  await page.locator("#vrot").fill("450"); // stored modulo 360
  await page.locator("#vrot").press("Enter");
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  const m = await page.locator('g[data-x="0"] > g path').evaluate((p) => { const c = (p as SVGGraphicsElement).getScreenCTM()!; return [c.a, c.b, c.c, c.d]; });
  expect(Math.abs(m[1])).toBeLessThan(1e-6); // the icon has no rotation of its own on screen
  expect(Math.abs(m[2])).toBeLessThan(1e-6);
  const g = await page.locator('g[data-x="0"]').evaluate((p) => { const c = (p as SVGGraphicsElement).getScreenCTM()!; return [c.a, c.b]; });
  expect(Math.abs(g[0])).toBeLessThan(1e-6); // the group itself is turned by a quarter
  expect(Math.abs(g[1])).toBeGreaterThan(0.1);
  // click elsewhere, then the rotated device by pointer: it is still the device that is hit
  await clickCm(page, 300, 500); // empty ground inside the view (900 cm is below the 800 px viewport: that click blurs the editor and races)
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#vrot")).toHaveValue("90");
  await page.locator("#vrot").fill("0");
  await page.locator("#vrot").press("Enter");
  expect("rot" in (await groundOf(page)).devices[0]).toBe(false); // the key is deleted at 0
  await page.locator("#vrot").fill("0"); // unchanged
  await page.locator("#vrot").press("Enter");
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  await savedValid(page);
});

test("break it: an angle field with rubbish changes nothing", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addDoor").click();
  const before = await groundOf(page);
  await page.locator("#drot").fill("");
  await page.locator("#drot").press("Enter");
  expect(await groundOf(page)).toEqual(before);
});

// ---- S1.24 unsnap a room, then rotate it ----
test("a room that shares corners cannot be rotated until it is unsnapped; unsnapping moves nothing; rotating is one undo step", async ({ page }) => {
  const before = await groundOf(page);
  await clickCm(page, 50, 200); // the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(page.locator("#rrot")).toBeDisabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  await page.locator("#runsnap").click();
  await expect(page.locator("#rrot")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Snap back");
  await expect(page.locator(".hint", { hasText: "Unsnapped: this room no longer joins its neighbours." })).toBeVisible();
  const free = await groundOf(page);
  expect(free.rooms[0].free).toBe(true);
  expect(free.rooms[0].pts).toEqual(before.rooms[0].pts); // not one centimetre
  expect(free.rooms.slice(1)).toEqual(before.rooms.slice(1)); // and the neighbours' corners stay
  expect(free.outline).toEqual(before.outline);
  await page.locator("#rrot").fill("30");
  await page.locator("#rrot").press("Enter");
  const turned = await groundOf(page);
  expect(turned.rooms[0].pts).not.toEqual(free.rooms[0].pts);
  expect(turned.rooms[0].pts.length).toBe(4);
  // still 500 x 400 apart corner to corner: a turn keeps lengths (within rounding)
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  expect(Math.abs(d(turned.rooms[0].pts[0], turned.rooms[0].pts[1]) - 500)).toBeLessThanOrEqual(1);
  expect(Math.abs(d(turned.rooms[0].pts[1], turned.rooms[0].pts[2]) - 400)).toBeLessThanOrEqual(1);
  await expect(page.locator("#rrot")).toHaveValue("0"); // the field is a turn, so it resets
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].pts).toEqual(free.rooms[0].pts); // one step back
  await savedValid(page);
});

test("an unsnapped room is not pulled onto a neighbour's corner when it is dropped near it", async ({ page }) => {
  await clickCm(page, 50, 200);
  await page.locator("#runsnap").click();
  const before = await groundOf(page);
  await dragCm(page, [50, 200], [350, 200]);
  await dragCm(page, [350, 200], [47, 203]); // back, 3 cm short and 3 cm low
  const after = await groundOf(page);
  expect(after.rooms[0].pts).not.toEqual(before.rooms[0].pts); // a snapped room would have landed exactly
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeLessThan(8);
  expect(after.rooms[1].pts).toEqual(before.rooms[1].pts); // nothing was stitched into the kitchen
});

test("a room clear of every corner rotates at once and touches no other room", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'svg polygon[data-r="6"]')) as [number, number]); // the pond
  await expect(page.locator("#rk")).toHaveValue("water");
  await expect(page.locator("#rrot")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  const before = await groundOf(page);
  await page.locator("#rrot").fill("90");
  await page.locator("#rrot").press("Enter");
  const after = await groundOf(page);
  expect(after.rooms[6].pts).not.toEqual(before.rooms[6].pts);
  expect(after.rooms.filter((_, i) => i !== 6)).toEqual(before.rooms.filter((_, i) => i !== 6));
});

test("break it: rubbish and a full turn in the rotation field change nothing", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'svg polygon[data-r="6"]')) as [number, number]);
  const before = await groundOf(page);
  for (const v of ["", "360", "0"]) {
    await page.locator("#rrot").fill(v);
    await page.locator("#rrot").press("Enter");
  }
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

// ---- stairs shape, steps, rotation (S1.25) -----------------------------------

async function setField(page: Page, id: string, v: string) {
  await page.locator(id).fill(v);
  await page.locator(id).press("Enter");
}

test("stairs: switching to round and setting the diameters gives a 24-gon, the inner diameter and no corner handles", async ({ page }) => {
  await addStairs(page);
  await expect(page.locator('svg circle[data-h^="s1:"]')).toHaveCount(4);
  await page.locator("#ss").selectOption("round");
  await expect(page.locator("#sdia")).toBeVisible();
  await setField(page, "#sdia", "200");
  await setField(page, "#sinner", "80");
  const t = (await groundOf(page)).stairs[1];
  expect(t).toMatchObject({ shape: "round", dia: 200, inner: 80, steps: 12, rot: 0 });
  expect(t.pts).toHaveLength(24);
  const cx = t.pts.reduce((s, p) => s + p[0], 0) / 24, cy = t.pts.reduce((s, p) => s + p[1], 0) / 24;
  for (const p of t.pts) expect(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 100)).toBeLessThan(1);
  await expect(page.locator('svg circle[data-h^="s1:"]')).toHaveCount(0);
  await expect(page.locator('svg g[data-s="1"] line.tread')).toHaveCount(11);
  await expect(page.locator('svg g[data-s="1"] path[fill-rule="evenodd"]')).toHaveCount(1);
  // the inner diameter cannot leave less than 40 cm of tread; the outer keeps the centre
  await setField(page, "#sinner", "500");
  expect((await groundOf(page)).stairs[1].inner).toBe(160);
  await setField(page, "#sdia", "100");
  const s = (await groundOf(page)).stairs[1];
  expect([s.dia, s.inner]).toEqual([100, 60]);
  expect(Math.round(s.pts.reduce((a, p) => a + p[0], 0) / 24)).toBe(Math.round(cx));
  await savedValid(page);
  // back to straight: the diameters go, the flight is 100 x 300 again
  await page.locator("#ss").selectOption("straight");
  const b = (await groundOf(page)).stairs[1];
  expect(b).toMatchObject({ shape: "straight", steps: 12 });
  expect("dia" in b || "inner" in b).toBe(false);
  expect(b.pts).toHaveLength(4);
});

test("stairs: a real click on a rotated flight, where the unrotated one is not, selects it", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await setField(page, "#srot", "90");
  expect((await groundOf(page)).stairs[0].rot).toBe(90);
  // deselect on empty ground, then click at (670, 500): inside the turned flight (x 660 to 820), outside the stored one (x 700 to 780)
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  await expect(page.locator("#sn")).toHaveCount(0);
  const at = await screenOf(page, 670, 500);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  // ... and where the stored flight is but the turned one is not, it selects no stairs
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  const off = await screenOf(page, 740, 430);
  await page.mouse.click(off.x, off.y);
  await expect(page.locator("#sn")).toHaveCount(0);
});

test("stairs: a turned flight has no corner handles, and rotation 0 brings them back on the drawn corners", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(4);
  await setField(page, "#srot", "30");
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(0);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(0);
  await setField(page, "#srot", "0");
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(4);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(4);
  const pts = (await groundOf(page)).stairs[0].pts;
  for (const [j, p] of pts.entries()) {
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cx", String(p[0]));
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cy", String(p[1]));
  }
});

test("stairs: steps take a whole number from 2 to 40 and rubbish changes nothing", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await setField(page, "#sst", "6");
  await expect(page.locator('svg g[data-s="0"] line.tread')).toHaveCount(5);
  const before = await groundOf(page);
  for (const v of ["1", "41", "3.5", ""]) await setField(page, "#sst", v);
  expect(await groundOf(page)).toEqual(before);
});

// ---- stairs go on every floor (S1.26) ----------------------------------------

test("Add, Stairs puts the same stairs on every floor; Delete removes them from one floor only", async ({ page }) => {
  const before = await layoutOf(page);
  expect(before.floors.first.stairs).toHaveLength(0);
  await addStairs(page);
  const l = await layoutOf(page);
  const g = l.floors.ground.stairs[1], u = l.floors.first.stairs;
  expect(u).toHaveLength(1);
  expect(u[0].pts).toEqual(g.pts);
  expect(u[0].id).toBe("stairs-first-1");
  await expect(page.locator("#status")).toHaveText("Added stairs to every floor");
  await expect(page.locator("#sn")).toBeVisible();
  await expect(page.locator("#sdel").locator("xpath=following::p[contains(@class,'hint')][1]")).toContainText("added to every floor and deleted from one");
  // one undo step for all floors
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeEnabled();
  await menu(page, "File");
  // on the first floor by a real click on the stairs' body, then delete: the ground floor keeps its own
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(1);
  // this floor's view was fitted to its outline, so the stairs beside the house are off screen: zoom out until they show
  const mid = await screenOf(page, 400, 300);
  await page.mouse.move(mid.x, mid.y);
  for (let n = 0; n < 3; n++) await page.mouse.wheel(0, 300);
  expect(await inCanvas(page, 'g[data-s="0"]')).toBe(true);
  const c = await screenOf(page, g.pts[0][0] + 50, g.pts[0][1] + 60);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sn")).toBeVisible();
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(0);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(stairsCount(page)).toHaveCount(2);
  const after = await layoutOf(page);
  expect(after.floors.first.stairs).toHaveLength(0);
  expect(after.floors.ground.stairs).toHaveLength(2);
  // Undo the delete, then Undo the add: every floor is back to what it was
  await menu(page, "File"); await page.locator("#undo").click();
  await menu(page, "File"); await page.locator("#undo").click();
  const back = await layoutOf(page);
  expect(back.floors.ground.stairs).toEqual(before.floors.ground.stairs);
  expect(back.floors.first.stairs).toEqual([]);
});

// ---- a new floor inherits the outline and the stairs (S1.27) -------------------

test("a new floor has the outline and the stairs of the ground floor, no rooms, and Delete floor starts it clean", async ({ page }) => {
  await addFloorVia(page, "Attic");
  const l = await layoutOf(page);
  expect(l.floors.attic.outline).toEqual(l.floors.ground.outline);
  expect(l.floors.attic.stairs.map((t) => ({ ...t, id: "" }))).toEqual(l.floors.ground.stairs.map((t) => ({ ...t, id: "" })));
  expect(l.floors.attic.stairs[0].id).toBe("stairs-attic-1");
  expect(l.floors.attic.rooms).toEqual([]);
  await expect(page.locator("svg g[data-s]")).toHaveCount(1);
  await expect(page.locator('svg line[data-e^="o:"]')).toHaveCount(4);
  await expect(page.locator("#status")).toContainText("Added floor Attic");
  await expect(page.locator("p.hint").filter({ hasText: "outline and the stairs" })).toBeVisible();
  // the inherited outline can be clicked like any other: a real click on an outline edge selects it
  const c = await screenOf(page, 400, 0);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ft")).toHaveCount(0); // not the floor panel any more
});

// ---- red and orange buttons (S1.28) ---------------------------------------------

// Computed style, not class names: a rule that loses on specificity would pass a class check.
const RED = "rgb(176, 42, 42)", ORANGE = "rgb(242, 140, 40)", LIGHT = "rgb(244, 240, 230)", DARK = "rgb(43, 42, 39)";
const paint = (page: Page, sel: string) => page.locator(sel).evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color]; });
const expectWarn = async (page: Page, sel: string) => expect(await paint(page, sel), sel).toEqual([ORANGE, DARK]);
const expectDanger = async (page: Page, sel: string) => expect(await paint(page, sel), sel).toEqual([RED, LIGHT]);

test("S1.28: Reset is red", async ({ page }) => {
  await menu(page, "File");
  await expectDanger(page, "#reset");
  await expect(page.locator("#save")).not.toHaveCSS("background-color", RED); // an ordinary button stays ordinary
});

test("S1.28: Delete floor and its confirmation are red, Cancel is not", async ({ page }) => {
  await expect(page.locator("#fdel")).toBeVisible();
  await expectDanger(page, "#fdel");
  await page.locator("#fdel").click();
  await expectDanger(page, "#fdelyes");
  await expect(page.locator("#fdelno")).not.toHaveCSS("background-color", RED);
  await expect(page.locator("#fdelno")).not.toHaveCSS("background-color", ORANGE);
});

test("S1.28: every item Delete is orange", async ({ page }) => {
  // corner: a real click on a corner handle
  const h = await centre(page, 'svg circle[data-h="r0:1"]');
  await page.mouse.click(h.x, h.y);
  await expectWarn(page, "#delv");
  // room: a real click on its body
  const r = await screenOf(page, 100, 100);
  await page.mouse.click(r.x, r.y);
  await expectWarn(page, "#rdel");
  // device: a real click on an icon
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expectWarn(page, "#vdel");
  // furniture, stairs, wall, door, opening: added, so they are selected
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await expectWarn(page, "#fudel");
  await addStairs(page);
  await expectWarn(page, "#sdel");
  await addMenuItem(page, "#addWall-wall");
  await expectWarn(page, "#wdel");
  await menu(page, "Add"); await page.locator("#addDoor").click();
  await expectWarn(page, "#deld");
  await addGap(page);
  await expectWarn(page, "#odel");
});

test("S1.28: the floor panel and the furniture panel each own their id", async ({ page }) => {
  await expect(page.locator("#fdel")).toHaveText("Delete floor");
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await expect(page.locator("#fdel")).toHaveCount(0);
  await expect(page.locator("#fudel")).toHaveText("Delete");
  await page.locator("#fudel").click();
  expect((await groundOf(page)).furniture).toHaveLength(2); // the bed went, the demo's two stay
  await expect(page.locator("#fdel")).toHaveText("Delete floor"); // nothing selected: the floor panel again
  await expect(page.locator("#fudel")).toHaveCount(0);
  await expectDanger(page, "#fdel");
});

test("S1.29: a device standing on a room name is the top element there", async ({ page }) => {
  const hit = await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    const lay = JSON.parse(JSON.stringify(el.layout));
    const lbl = [...el.shadowRoot.querySelectorAll("svg text.lbl")].find((t: Element) => !t.classList.contains("zone") && t.textContent) as SVGTextElement;
    const b = lbl.getBBox();
    // Label centre in plan units: the svg root maps them through the viewBox, so ask the svg for the inverse.
    const svg = lbl.ownerSVGElement!;
    const p = svg.createSVGPoint(); p.x = b.x + b.width / 2; p.y = b.y + b.height / 2;
    lay.floors.ground.devices[0].x = p.x; lay.floors.ground.devices[0].y = p.y;
    lay.floors.ground.devices[0].type = "light";
    el.layout = lay;
    return { x: p.x, y: p.y };
  }, EDITOR);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const r = await screenOf(page, hit.x, hit.y);
  const top = await page.evaluate(([x, y]) => {
    const t = document.querySelector("floorplan-studio-editor")!.shadowRoot!.elementFromPoint(x, y) as Element;
    return t.closest("[data-x]")?.getAttribute("data-x") ?? t.tagName;
  }, [r.x, r.y]);
  expect(top).toBe("0");
  // Names may be click-through in the editor, so also assert the paint order in the live DOM.
  const after = await page.evaluate(() => {
    const root = document.querySelector("floorplan-studio-editor")!.shadowRoot!;
    const names = [...root.querySelectorAll("svg text.lbl")].filter((t) => !t.closest("[data-x]"));
    const dev = root.querySelector('svg g[data-x="0"]')!;
    return names.every((n) => !!(n.compareDocumentPosition(dev) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(after).toBe(true);
});

// ---- S1.31 camera cone ----
const CAM = { x: 20, y: 580 }; // the demo hall camera

test("S1.31: the cone is dark grey at 25 % alpha in the browser, the halo has the same alpha and lets the pointer through to the room", async ({ page }) => {
  const cone = page.locator("svg g.dev-camera path.cone");
  await expect(cone).toHaveCount(1);
  const st = await cone.evaluate((el) => { const s = getComputedStyle(el); return { fill: s.fill, op: s.fillOpacity, pe: s.pointerEvents }; });
  expect(st).toEqual({ fill: "rgb(74, 74, 72)", op: "0.25", pe: "none" });
  // the halo behind every icon shares the alpha (one variable, --fp-alpha)
  expect(await page.locator("svg .dev .halo").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fillOpacity))])).toEqual(["0.25"]);
  // the cone is 100 cm deep: its box is 100 cm tall on screen (rot 0 points up)
  const box = await cone.evaluate((el) => el.getBoundingClientRect().height);
  const one = Math.abs((await screenOf(page, CAM.x, CAM.y - 100)).y - (await screenOf(page, CAM.x, CAM.y)).y);
  expect(Math.abs(box - one)).toBeLessThan(1.5);
  // 60 cm up the cone (rot 0 points up), over the Hall: the top element is the room, not the cone or the camera
  const p = await screenOf(page, CAM.x, CAM.y - 60);
  const top = await page.evaluate(([tag, x, y]) => (document.querySelector(tag as string) as any).shadowRoot.elementFromPoint(x, y)?.outerHTML.slice(0, 40), [EDITOR, p.x, p.y] as const);
  expect(top).toContain('data-r="2"');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#rn")).toHaveValue("Hall");
  await expect(page.locator("#vrot")).toHaveCount(0);
});

test("S1.31: the rotation field turns the cone; the panel carries the hint; rot 90 points it along +x", async ({ page }) => {
  const c = await screenOf(page, CAM.x, CAM.y);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#vrot")).toBeVisible();
  await expect(page.locator(".hint", { hasText: "The cone shows a 120 degree field of view, 1 m deep." })).toHaveCount(1);
  const centreOf = () => page.locator("svg path.cone").evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const up = await centreOf();
  expect(up.y).toBeLessThan(c.y - 20); // above the camera
  expect(Math.abs(up.x - c.x)).toBeLessThan(5);
  await page.locator("#vrot").fill("90");
  await page.locator("#vrot").press("Enter");
  const right = await centreOf();
  expect(right.x).toBeGreaterThan(c.x + 20);
  expect(Math.abs(right.y - c.y)).toBeLessThan(5);
  const p = await screenOf(page, CAM.x + 60, CAM.y); // inside the turned cone, over the Hall
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#rn")).toHaveValue("Hall");
});

test("S1.31: only a camera has a cone", async ({ page }) => {
  await expect(page.locator("svg path.cone")).toHaveCount(1);
  await expect(page.locator("svg g.dev:not(.dev-camera) path.cone")).toHaveCount(0);
});

// ---- S1.33 rotate the whole plan ----
const rotateBy = async (page: Page, steps: number) => {
  await menu(page, "View");
  for (let n = 0; n < Math.abs(steps); n++) await page.locator(steps > 0 ? "#rotr" : "#rotl").click();
  await menu(page, "View"); // close it: it would cover the plan
};
const rotOf = async (page: Page) => (await layoutOf(page)).rotate;
const withoutRotate = (l: Layout) => { const c = structuredClone(l); delete c.rotate; return c; };
const rpt = (page: Page) => page.locator(EDITOR);

test("S1.33: View has Rotate the plan; right steps +45, left steps -45, wrapping; one undo step each; the reading follows", async ({ page }) => {
  await menu(page, "View");
  await expect(page.locator("#rotv")).toContainText("0°");
  await page.locator("#rotr").click();
  await expect(page.locator("#rotv")).toContainText("45°");
  await page.locator("#rotl").click();
  await page.locator("#rotl").click();
  await expect(page.locator("#rotv")).toContainText("315°");
  expect(await rotOf(page)).toBe(315);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(45);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(0);
  await expect(page.locator("#undo")).toBeDisabled(); // exactly three steps
});

test("S1.33 break it: right, right, left, left leaves rotate at 0 and the layout byte-identical", async ({ page }) => {
  const before = JSON.stringify(await layoutOf(page));
  await rotateBy(page, 2);
  expect(await rotOf(page)).toBe(90);
  await rotateBy(page, -2);
  expect(await rotOf(page)).toBe(0);
  expect(JSON.stringify(await layoutOf(page))).toBe(before);
});

test("S1.33: a turned plan changes only rotate in the data, and Save then Open keeps it", async ({ page }) => {
  const l0 = await layoutOf(page);
  await rotateBy(page, 3);
  const l1 = await layoutOf(page);
  expect(l1.rotate).toBe(135);
  expect(withoutRotate(l1)).toEqual(withoutRotate(l0));
  const saved = (await savedValid(page))!;
  expect(saved.rotate).toBe(135);
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, { ...l0, rotate: 0 }] as const);
  expect(await rotOf(page)).toBe(0);
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, saved] as const);
  expect(await rotOf(page)).toBe(135);
  await expect(page.locator(`${EDITOR} svg > g.plan-turn[transform^="rotate(135 "]`)).toHaveCount(2); // the drawing and the overlay
});

for (const deg of [45, 90]) {
  test.describe(`plan turned ${deg}`, () => {
    test.beforeEach(async ({ page }) => { await rotateBy(page, deg / 45); });

    test("the drawing is turned on screen and fits the window: the outline's corners are all in view", async ({ page }) => {
      const svg = (await page.locator("svg").first().boundingBox())!;
      for (const [x, y] of [[0, 0], [800, 0], [800, 600], [0, 600]]) {
        const c = await screenOf(page, x, y);
        expect(c.x, `${x},${y}`).toBeGreaterThan(svg.x); expect(c.x).toBeLessThan(svg.x + svg.width);
        expect(c.y).toBeGreaterThan(svg.y); expect(c.y).toBeLessThan(svg.y + svg.height);
      }
      // the top wall of the Living room (0,0)-(500,0) runs along x on the plan; on screen it runs at `deg`
      const a = await screenOf(page, 0, 0), b = await screenOf(page, 500, 0);
      expect(Math.round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360)).toBe(deg);
    });

    test("real clicks select the room, the device and the stairs under the pointer", async ({ page }) => {
      const click = async (x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.click(c.x, c.y); };
      await click(100, 300); // Living, clear of the plug at (60, 340)
      await expect(page.locator("#rn")).toHaveValue("Living");
      await click(700, 100);
      await expect(page.locator("#rn")).toHaveValue("Kitchen");
      await click(250, 200); // the living light
      await expect(page.locator("#ve")).toHaveValue("light.demo_living");
      const st = (await groundOf(page)).stairs[0], xs = st.pts.map((p) => p[0]), ys = st.pts.map((p) => p[1]);
      await click((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      await expect(page.locator("#panel strong")).toHaveText(/Stairs/i);
    });

    test("dragging a corner handle lands the corner where the pointer is", async ({ page }) => {
      await dragCm(page, [500, 0], [500, 40]); // the shared Living / Kitchen corner
      const g = await groundOf(page);
      expect(g.rooms[0].pts[1]).toEqual([500, 40]);
      expect(g.rooms[1].pts[0]).toEqual([500, 40]);
      await dragCm(page, [500, 40], [450, 90]);
      expect((await groundOf(page)).rooms[0].pts[1]).toEqual([450, 90]);
    });

    test("dragging a device lands it where the pointer is, on the grid", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
      await dragCm(page, [650, 200], [615, 270]);
      const d = (await groundOf(page)).devices[1] as { x: number; y: number };
      expect([d.x, d.y]).toEqual([615, 270]);
    });

    test("drawing a room clicks its corners at the plan points under the pointer, snapped to the grid", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
      const n0 = (await groundOf(page)).rooms.length;
      await startDraw(page, "drawRoom");
      await clicksCm(page, ...FREE);
      await page.keyboard.press("Enter");
      const g = await groundOf(page);
      expect(g.rooms).toHaveLength(n0 + 1);
      expect(g.rooms.at(-1)!.pts).toEqual(FREE_SNAPPED);
    });

    test("snapping still pulls a drawn wall's ends onto the corners they are near, in plan space", async ({ page }) => {
      const n0 = (await groundOf(page)).walls.length;
      await startDraw(page, "drawWall-wall");
      await clicksCm(page, [497, 3], [803, -3]); // off the grid on purpose: only the corner snap gives 500,0 and 800,0
      await page.keyboard.press("Enter");
      const w = (await groundOf(page)).walls;
      expect(w).toHaveLength(n0 + 1);
      expect([w.at(-1)!.a, w.at(-1)!.b]).toEqual([[500, 0], [800, 0]]);
    });

    test("wheel zoom keeps the plan point under the pointer where it is, and zooms", async ({ page }) => {
      const P: [number, number] = [650, 100];
      const a = await screenOf(page, ...P), q = await screenOf(page, 800, 100);
      const w0 = Math.hypot(q.x - a.x, q.y - a.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.wheel(0, -300);
      await expect.poll(async () => { const b = await screenOf(page, 800, 100), c = await screenOf(page, ...P); return Math.hypot(b.x - c.x, b.y - c.y) > w0 * 1.1; }).toBe(true);
      const after = await screenOf(page, ...P);
      expect(Math.abs(after.x - a.x)).toBeLessThan(1.5);
      expect(Math.abs(after.y - a.y)).toBeLessThan(1.5);
    });

    test("dragging the background pans: every plan point follows the pointer by the same screen shift", async ({ page }) => {
      const a = await screenOf(page, 300, 500), o0 = await screenOf(page, 700, 100);
      const before = JSON.stringify(withoutRotate(await layoutOf(page)));
      const s = await screenOf(page, 100, 650); // empty ground, below the Hall
      await page.mouse.move(s.x, s.y);
      await page.mouse.down();
      await page.mouse.move(s.x + 40, s.y + 25, { steps: 4 });
      await page.mouse.move(s.x + 80, s.y + 50, { steps: 4 });
      await page.mouse.up();
      const b = await screenOf(page, 300, 500), o1 = await screenOf(page, 700, 100);
      expect(b.x - a.x).toBeCloseTo(80, 0); expect(b.y - a.y).toBeCloseTo(50, 0);
      expect(o1.x - o0.x).toBeCloseTo(80, 0); expect(o1.y - o0.y).toBeCloseTo(50, 0);
      expect(JSON.stringify(withoutRotate(await layoutOf(page)))).toBe(before); // a pan writes nothing
    });

    test("names, values and icons stay upright: their screen matrix has no turn", async ({ page }) => {
      await page.locator("#names").click();
      const turns = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const off = (el: Element) => { const m = (el as SVGGraphicsElement).getScreenCTM()!; return Math.max(Math.abs(m.b), Math.abs(m.c)) / Math.abs(m.a); };
        const texts = [...svg.querySelectorAll("text.lbl, text.val")], icons = [...svg.querySelectorAll("g[data-x] > g > path, g[data-x] > path:not(.cone)")];
        return { nt: texts.length, ni: icons.length, t: Math.max(...texts.map(off)), i: Math.max(...icons.map(off)) };
      });
      expect(turns.nt).toBeGreaterThan(5);
      expect(turns.ni).toBeGreaterThan(5);
      expect(turns.t).toBeLessThan(0.001);
      expect(turns.i).toBeLessThan(0.001);
    });

    test("a camera's cone turns with the plan while its icon stays upright", async ({ page }) => {
      const m = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const c = (svg.querySelector("path.cone") as SVGGraphicsElement).getScreenCTM()!;
        return { a: c.a, b: c.b };
      });
      expect(Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI)).toBe(deg);
    });

    test("the length labels of the overlay stay upright too", async ({ page }) => {
      await menu(page, "View");
      if ((await page.locator("#lens").getAttribute("aria-pressed")) !== "true") await page.locator("#lens").click();
      await menu(page, "View");
      const off = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const ts = [...svg.querySelectorAll("text.len")];
        return { n: ts.length, off: Math.max(...ts.map((t) => { const m = (t as SVGGraphicsElement).getScreenCTM()!; return Math.abs(m.b) / Math.abs(m.a); })) };
      });
      expect(off.n).toBeGreaterThan(0);
      expect(off.off).toBeLessThan(0.001);
    });
  });
}

test("S1.33: adding an item at 90 puts it in view and the panel value survives", async ({ page }) => {
  await rotateBy(page, 2);
  await menu(page, "Add");
  await page.locator("#addStairs").click();
  const svg = (await page.locator("svg").first().boundingBox())!;
  const t = (await groundOf(page)).stairs.at(-1)!;
  for (const p of t.pts) {
    const c = await screenOf(page, p[0], p[1]);
    expect(c.x).toBeGreaterThan(svg.x); expect(c.x).toBeLessThan(svg.x + svg.width);
    expect(c.y).toBeGreaterThan(svg.y); expect(c.y).toBeLessThan(svg.y + svg.height);
  }
});

// ---- S1.34 the grid is a setting ----
const gridChoices = (page: Page) => page.locator(`${EDITOR} #grid [data-grid]`);
const pressedGrid = async (page: Page) => page.locator(`${EDITOR} #grid [data-grid][aria-pressed="true"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-grid")));

test("S1.34: View has a Grid group of four, 10 cm pressed by default; the old Snap chip is gone", async ({ page }) => {
  await menu(page, "View");
  await expect(gridChoices(page)).toHaveText(["None", "5 cm", "10 cm", "50 cm"]);
  expect(await pressedGrid(page)).toEqual(["10"]);
  await expect(page.locator(`${EDITOR} button#grid`)).toHaveCount(0);
  await expect(page.getByText("Snap 5 cm")).toHaveCount(0);
});

for (const [g, want] of [[10, [660, 450]], [50, [650, 450]], [5, [665, 445]], [0, [663, 447]]] as const) {
  test(`S1.34: with grid ${g || "none"} a stairs corner dragged to 663,447 lands on ${want}`, async ({ page }) => {
    if (g !== 10) await setGrid(page, g);
    else expect(await pressedGrid(page)).toEqual(["10"]); // the default, nothing chosen
    await dragCm(page, [700, 420], [663, 447]);
    expect((await groundOf(page)).stairs[0].pts[0]).toEqual(want);
    await menu(page, "View");
    expect(await pressedGrid(page)).toEqual([String(g)]);
  });
}

test("S1.34: with 10 selected a device lands on a multiple of 10 and Alt still places it freely", async ({ page }) => {
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([260, 210]);
  await dragCm(page, [260, 210], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("S1.34: with 50 selected a whole room dragged by its edge moves by a multiple of 50", async ({ page }) => {
  await setGrid(page, 50);
  const before = (await groundOf(page)).rooms[0].pts;
  await dragCm(page, [250, 0], [250 + 61, 0 + 37]);
  const after = (await groundOf(page)).rooms[0].pts;
  const dx = after[0][0] - before[0][0], dy = after[0][1] - before[0][1];
  expect(dx % 50).toBe(0); expect(dy % 50).toBe(0);
});

test("S1.34: new items go on the chosen grid", async ({ page }) => {
  await setGrid(page, 50);
  await menu(page, "Add");
  await page.locator("#addStairs").click();
  const t = (await groundOf(page)).stairs.at(-1)!;
  for (const p of t.pts) { expect(Math.abs(p[0] % 50)).toBe(0); expect(Math.abs(p[1] % 50)).toBe(0); }
});

test("S1.34: the choice survives a reload and is not in the layout", async ({ page }) => {
  await setGrid(page, 50);
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:grid"))).toBe("50");
  expect(JSON.stringify(await layoutOf(page))).not.toContain("grid");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await menu(page, "View");
  expect(await pressedGrid(page)).toEqual(["50"]);
});

test("S1.34 break it: a stored 7 or x falls back to 10 without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const v of ["7", "x"]) {
    await page.evaluate((val) => localStorage.setItem("floorplan-studio:grid", val), v);
    await page.reload();
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await menu(page, "View");
    expect(await pressedGrid(page)).toEqual(["10"]);
  }
  expect(errors).toEqual([]);
});

test("S1.34 break it: with storage blocked the editor loads, uses 10 and lets the grid be changed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const boom = () => { throw new Error("blocked"); };
    Storage.prototype.getItem = boom; Storage.prototype.setItem = boom;
  });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await menu(page, "View");
  expect(await pressedGrid(page)).toEqual(["10"]);
  await page.locator(`#grid [data-grid="50"]`).click();
  expect(await pressedGrid(page)).toEqual(["50"]);
  expect(errors).toEqual([]);
});

// ---- S1.35 floor colours for rooms ----
test("S1.35: the room panel shows twelve floor swatches next to the free colour input", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const sw = page.locator("#panel .sw");
  await expect(sw).toHaveCount(12);
  await expect(sw.nth(10)).toHaveAttribute("title", "Belgian stone");
  await expect(sw.nth(10)).toHaveAttribute("aria-label", "Belgian stone");
  await expect(page.locator("#rcol")).toHaveCount(1);
  // each swatch shows its own colour
  expect(await sw.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))).toContain("rgb(77, 78, 80)");
});

test("S1.35: the Belgian stone swatch sets the fill, one undo step; the default button brings it back", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  const plain = await computed();
  await page.locator("#panel .sw").nth(10).click();
  expect(await computed()).toBe("rgb(77, 78, 80)");
  expect((await groundOf(page)).rooms[0].color).toBe("#4d4e50");
  await expect(page.locator("#rcol")).toHaveValue("#4d4e50"); // the free input follows
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await computed()).toBe(plain);
  await page.mouse.click(at.x, at.y); // an undo leaves the room selected or not; select it
  await page.locator("#panel .sw").nth(10).click();
  await page.locator("#rcolx").click();
  expect(await computed()).toBe(plain);
  expect((await groundOf(page)).rooms[0].color).toBeUndefined();
});

test("S1.35 break it: a colour typed in the free input still works, and a swatch after it replaces it", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  await page.locator("#rcol").fill("#123456");
  expect(await poly.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(18, 52, 86)");
  await page.locator("#panel .sw").nth(0).click();
  expect((await groundOf(page)).rooms[0].color).toBe("#f4f4f0");
});

// ---- S1.36 device colours by type ----
const colourRow = (page: Page, type: string) => page.locator(`${EDITOR} #devcols [data-type="${type}"]`);
const openDevCols = async (page: Page) => {
  await menu(page, "View");
  await page.locator(`${EDITOR} #devcols > summary`).click();
};
const setColourInput = (page: Page, type: string, hex: string) =>
  colourRow(page, type).locator("input[type=color]").evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, hex);
const camFill = (page: Page) => page.locator("svg .dev-camera path:not(.cone):not(.halo)").first().evaluate((el) => getComputedStyle(el).fill);
const varOn = (page: Page, sel: string, name: string) => page.locator(sel).first().evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

test("S1.36: View, Device colours has a row per type with a colour input and a reset, and Reset all", async ({ page }) => {
  await openDevCols(page);
  await expect(page.locator(`${EDITOR} #devcols [data-type]`)).toHaveCount(16);
  await expect(colourRow(page, "light").locator("input[type=color]")).toHaveValue("#e0a800");
  await expect(colourRow(page, "light").locator("button")).toHaveCount(1);
  await expect(page.locator(`${EDITOR} #devcolsx`)).toBeVisible();
});

test("S1.36: changing the light colour reaches every light icon, camera colour changes the camera fill, undo restores", async ({ page }) => {
  const l0 = await layoutOf(page);
  expect(l0.colors).toBeUndefined();
  const lights = 'svg .dev-light';
  const n = await page.locator(lights).count();
  expect(n).toBeGreaterThan(1);
  const cam0 = await camFill(page);
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  expect((await layoutOf(page)).colors).toEqual({ light: "#123456" });
  const seen = await page.locator(lights).evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue("--fp-dev-light").trim()));
  expect(seen).toEqual(Array(n).fill("#123456")); // every light icon sees it
  await setColourInput(page, "camera", "#0000ff");
  expect(await camFill(page)).toBe("rgb(0, 0, 255)");
  expect(await camFill(page)).not.toBe(cam0);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await camFill(page)).toBe(cam0);
  expect((await layoutOf(page)).colors).toEqual({ light: "#123456" });
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await layoutOf(page)).colors).toBeUndefined();
  expect(await varOn(page, lights, "--fp-dev-light")).toBe("#e0a800");
});

test("S1.36: a row's reset and Reset all remove colours, each one undo step", async ({ page }) => {
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  await setColourInput(page, "tv", "#654321");
  await colourRow(page, "light").locator("button").click();
  expect((await layoutOf(page)).colors).toEqual({ tv: "#654321" });
  await page.locator(`${EDITOR} #devcolsx`).click();
  expect((await layoutOf(page)).colors).toBeUndefined();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await layoutOf(page)).colors).toEqual({ tv: "#654321" });
});

test("S1.36: Save then Open keeps the colours, and the light icons follow", async ({ page }) => {
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  const saved = (await savedValid(page))!;
  expect(saved.colors).toEqual({ light: "#123456" });
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, { ...saved, colors: undefined }] as const);
  expect((await layoutOf(page)).colors).toBeUndefined();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, saved] as const);
  expect(await varOn(page, "svg .dev-light", "--fp-dev-light")).toBe("#123456");
});

test("S1.36 break it: a layout with no colors draws no style group, and a hostile colors value is refused on load", async ({ page }) => {
  await expect(page.locator("svg .dev-colours")).toHaveCount(0);
  const errs = await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = { ...l, colors: { light: 'red;" onload="x' } }; return (document.querySelector(tag as string) as any).errors ?? null; }, [EDITOR, await layoutOf(page)] as const);
  expect(JSON.stringify(errs)).toMatch(/colors/);
  await expect(page.locator("svg [onload]")).toHaveCount(0);
});

// ---- S1.49 Re-center ----
/** Every room, stairs, device and piece of furniture on screen lies inside the svg. */
const wholeFloorInView = (page: Page) =>
  page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const c = root.querySelector("svg")!.getBoundingClientRect();
    const bad: string[] = [];
    root.querySelectorAll("svg polygon[data-r], svg g[data-x], svg g[data-s], svg g[data-f]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!(r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1)) bad.push(el.getAttribute("data-r") ?? el.getAttribute("data-x") ?? el.getAttribute("data-s") ?? el.getAttribute("data-f") ?? "?");
    });
    return { n: root.querySelectorAll("svg polygon[data-r], svg g[data-x], svg g[data-s], svg g[data-f]").length, bad };
  }, EDITOR);
async function zoomAndPanAway(page: Page) {
  await zoomIn(page, 6);
  const s = await screenOf(page, 100, 650); // empty ground below the Hall
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 150, s.y - 200, { steps: 6 });
  await page.mouse.up();
}

for (const [floor, deg] of [["ground", 0], ["first", 0], ["ground", 45]] as const) {
  test(`S1.49: Re-center brings the whole ${floor} floor back into view after a zoom and a pan, plan turned ${deg}`, async ({ page }) => {
    if (deg) await rotateBy(page, deg / 45);
    if (floor !== "ground") await page.locator(`.chip[data-f="${floor}"]`).click();
    const before = JSON.stringify(await layoutOf(page));
    await zoomAndPanAway(page);
    const away = await wholeFloorInView(page);
    expect(away.bad.length, "zoomed in and panned, something must be out of view").toBeGreaterThan(0);
    await menu(page, "View");
    await page.locator("#recenter").click();
    const now = await wholeFloorInView(page);
    expect(now.bad).toEqual([]);
    expect(now.n).toBeGreaterThan(3);
    expect(JSON.stringify(await layoutOf(page))).toBe(before); // a view change writes nothing
    await menu(page, "File");
    if (!deg) await expect(page.locator("#undo")).toBeDisabled();
    else { await page.locator("#undo").click(); expect(await rotOf(page)).toBe(0); await menu(page, "File"); await expect(page.locator("#undo")).toBeDisabled(); } // the one step is the rotation
  });
}

test("S1.49: Re-center shows a device parked far outside the outline, which Fit to window does not", async ({ page }) => {
  await page.evaluate(([tag, l]) => {
    const el = document.querySelector(tag as string) as any, c = JSON.parse(JSON.stringify(l));
    c.floors.ground.devices.push({ id: "far-temp", type: "temp", entity: "sensor.far_temp", x: 1900, y: -400 });
    c.catalog.push({ id: "sensor.far_temp", floor: "ground", room: "", type: "temp", name: "Far", entity: "sensor.far_temp" });
    el.layout = c;
  }, [EDITOR, await layoutOf(page)] as const);
  await menu(page, "View");
  await page.locator("#fit").click();
  const inFit = await wholeFloorInView(page);
  await menu(page, "View");
  await page.locator("#recenter").click();
  const inRe = await wholeFloorInView(page);
  expect(inFit.bad.length).toBeGreaterThan(0); // fit follows the outline only
  expect(inRe.bad).toEqual([]);
});

// ---- S1.35b white twin under walls and edges ----
test("S1.35b: on a Lava floor the wall has a white twin, wider than the wall, that never takes the click", async ({ page }) => {
  await page.evaluate(([tag, l]) => {
    const c = JSON.parse(JSON.stringify(l));
    c.floors.ground.rooms[0].color = "#38393b";
    (document.querySelector(tag as string) as any).layout = c;
  }, [EDITOR, await layoutOf(page)] as const);
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const e = root.querySelector('line[data-e="r0:2"]')!, twin = root.querySelector("line.eh")!;
    const ce = getComputedStyle(e), ct = getComputedStyle(twin);
    return { fill: getComputedStyle(root.querySelector('polygon[data-r="0"]')!).fill, twinStroke: ct.stroke, twinW: parseFloat(ct.strokeWidth), edgeW: parseFloat(ce.strokeWidth), edgeStroke: ce.stroke, pe: ct.pointerEvents };
  }, EDITOR);
  expect(got.fill).toBe("rgb(56, 57, 59)");
  expect(got.twinStroke).toBe("rgb(255, 255, 255)");
  expect(got.twinW).toBeGreaterThan(got.edgeW);
  expect(got.edgeStroke).not.toBe(got.twinStroke);
  expect(got.pe).toBe("none");
  // a real click on the wall selects the edge, not the twin
  const c = await centre(page, 'line[data-e="r0:2"]');
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#panel")).toContainText("wall");
});

// ---- HA pickers and name refresh (S1.38, S1.39) ------------------------------------

const HA = { floors: [{ id: "gf", name: "Ground" }, { id: "up", name: "Upstairs" }],
  areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }, { id: "study", name: "Study" }],
  entities: [{ id: "sensor.pond", name: "Pond level", domain: "sensor" }, { id: "light.lamp", name: "Lamp", domain: "light" }] };
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const opts = (page: Page, sel: string) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test("S1.38: without Home Assistant the area is a text field, with it a select", async ({ page }) => {
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "INPUT");
  await setHa(page, HA);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "SELECT");
  expect(await opts(page, "#ra")).toEqual(["", "living", "study", "kitchen"]);
});

test("S1.38: picking an area writes its id and its name, one undo restores both", async ({ page }) => {
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await page.locator("#ra").selectOption("study");
  let r = (await groundOf(page)).rooms[0];
  expect(r).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rn")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  r = (await groundOf(page)).rooms[0];
  expect(r).toMatchObject({ area: "living", name: "Living" });
});

test("S1.38: an area already on the plan sits under its own group and says so", async ({ page }) => {
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await expect(page.locator('#ra optgroup[label="Already on the plan"] option')).toHaveText(["Kitchen"]);
  await page.locator("#ra").selectOption("kitchen");
  await expect(page.locator("#status")).toContainText("already on the plan");
});

test("S1.38: custom brings back the name and entity fields, an area removes the entity", async ({ page }) => {
  await setHa(page, HA);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  const pond = (await groundOf(page)).rooms[6];
  expect(pond.area).toBe("");
  await expect(page.locator("#rn")).toBeVisible();
  await expect(page.locator("#rent")).toHaveJSProperty("tagName", "SELECT");
  await page.locator("#rent").selectOption("sensor.pond");
  expect((await groundOf(page)).rooms[6].entity).toBe("sensor.pond");
  await page.locator("#ra").selectOption("study");
  const r = (await groundOf(page)).rooms[6];
  expect(r.entity).toBeUndefined();
  expect(r).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rent")).toHaveCount(0);
});

test("S1.38: an id Home Assistant does not know stays as an extra option", async ({ page }) => {
  await clickCm(page, 200, 150);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[0].area = "bogus"; el.layout = l; }, EDITOR);
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveValue("bogus");
  await expect(page.locator('#ra option[value="bogus"]')).toContainText("not in Home Assistant");
  expect((await groundOf(page)).rooms[0].area).toBe("bogus");
});

test("S1.38: the floor links to an HA floor and unlinking brings the title field back", async ({ page }) => {
  await setHa(page, HA);
  await expect(page.locator("#ft")).toBeVisible();
  await page.locator("#fha").selectOption("up");
  expect((await layoutOf(page)).floors.ground).toMatchObject({ ha: "up", title: "Upstairs" });
  await expect(page.locator("#ft")).toHaveCount(0);
  await page.locator("#fha").selectOption("");
  expect((await groundOf(page)).ha).toBeUndefined();
  await expect(page.locator("#ft")).toBeVisible();
});

test("S1.38: furniture has a plan name and an entity picker", async ({ page }) => {
  await setHa(page, HA);
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await page.locator("#fun").fill("Guest bed");
  await page.locator("#fun").press("Enter");
  await page.locator("#fuent").selectOption("light.lamp");
  const f = (await groundOf(page)).furniture.at(-1)!;
  expect(f).toMatchObject({ name: "Guest bed", entity: "light.lamp" });
});

test("S1.38: an empty Home Assistant changes no name and does not throw", async ({ page }) => {
  const before = await layoutOf(page);
  await setHa(page, { floors: [], areas: [], entities: [] });
  expect(await layoutOf(page)).toEqual(before);
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "SELECT");
});

test("S1.39: names refresh when Home Assistant arrives, and it is not an undo step", async ({ page }) => {
  await setHa(page, { ...HA, areas: [{ id: "living", name: "Lounge" }, { id: "kitchen", name: "Kitchen" }] });
  expect((await groundOf(page)).rooms[0].name).toBe("Lounge");
  await expect(page.locator("#status")).toContainText("1 names updated from Home Assistant");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.39: without Home Assistant no message shows and nothing is renamed", async ({ page }) => {
  await expect(page.locator("#status")).not.toContainText("updated from Home Assistant");
  expect((await groundOf(page)).rooms[0].name).toBe("Living");
});

test("S1.39: the match button links a room whose name is an HA area", async ({ page }) => {
  await setHa(page, HA);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); Object.assign(l.floors.ground.rooms[6], { name: "study" }); el.layout = l; }, EDITOR);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  await page.locator("#rmatch").click();
  expect((await groundOf(page)).rooms[6]).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rmatch")).toHaveCount(0);
});

test("S1.39: two areas with the same name give no match button", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas, { id: "study2", name: "study" }] });
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[6].name = "Study"; el.layout = l; }, EDITOR);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  await expect(page.locator("#rmatch")).toHaveCount(0);
});

// ---- readable buttons (S1.40) ------------------------------------------------------

const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (css: string) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

test("S1.40: the contrast helper is right on two known pairs", () => {
  expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  expect(ratio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
});

test("S1.40: Reset, item Delete and Save reach 4.5:1 in Chromium", async ({ page }) => {
  await menu(page, "File");
  for (const id of ["#reset", "#save"]) {
    const [bg, fg] = await paint(page, id);
    expect(ratio(rgbOf(bg), rgbOf(fg)), id).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator("#save")).toHaveCSS("background-color", "rgb(31, 102, 153)");
  await clickCm(page, 100, 100);
  const [bg, fg] = await paint(page, "#rdel");
  expect(ratio(rgbOf(bg), rgbOf(fg)), "#rdel").toBeGreaterThanOrEqual(4.5);
});

// ---- a rejected number goes back (S1.41) ---------------------------------------------

test("S1.41: a refused steps value snaps back, an accepted one stays", async ({ page }) => {
  await addStairs(page);
  await setField(page, "#sst", "12");
  const steps = async () => (await groundOf(page)).stairs[1].steps;
  expect(await steps()).toBe(12);
  await setField(page, "#sst", "3.5");
  await expect(page.locator("#sst")).toHaveValue("12");
  expect(await steps()).toBe(12);
  await setField(page, "#sst", "1");
  await expect(page.locator("#sst")).toHaveValue("12");
  await setField(page, "#sst", "60");
  await expect(page.locator("#sst")).toHaveValue("12");
  await setField(page, "#sst", "20");
  await expect(page.locator("#sst")).toHaveValue("20");
  expect(await steps()).toBe(20);
});

test("S1.41: a clamped furniture width shows the clamped value", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5");
  expect((await groundOf(page)).furniture.at(-1)!.w).toBe(5);
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5"); // already 5: the state does not change, the field still resets
});
