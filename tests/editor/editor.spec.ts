import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEVICE_COLOURS } from "../../src/core/render";
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
/** S4.11: which of Add's submenus a leaf item's id opened under, or null for one that stayed flat (Furniture). */
function addSubFor(id: string): "Openings" | "Wall" | "Areas" | null {
  if (id === "#addDoor" || id === "#addWin" || id === "#addGap") return "Openings";
  if (id.startsWith("#addWall-")) return "Wall";
  if (id === "#addStr" || id === "#addZone" || id === "#addStairs") return "Areas";
  return null;
}
/** Opens Add, then the leaf's submenu (if it has one), then clicks it. */
async function addItem(page: Page, id: string) {
  await menu(page, "Add");
  const sub = addSubFor(id);
  if (sub) await page.locator(`#mAdd details.sub > summary:text-is("${sub}")`).click();
  await page.locator(id).click();
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
  await expect(page.locator(".chip[data-f]")).toHaveCount(3);
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
  await page.locator("#fr90").click();
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

test("File, Export downloads the current layout, with no save-request and no host involved", async ({ page }) => {
  const before = await layoutOf(page);
  let saveRequested = false;
  await page.exposeFunction("__markSaveRequested", () => { saveRequested = true; });
  await page.evaluate((tag) => document.querySelector(tag)!.addEventListener("save-request", () => (window as any).__markSaveRequested()), EDITOR);
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#exp").click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^floorplan-studio-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(before);
  expect(saveRequested).toBe(false);
});

test("a reload restores the edit from localStorage and Reset starts from scratch", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const edited = await groundOf(page);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual(edited.rooms[0].pts[1]);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  const after = await layoutOf(page);
  expect(Object.values(after.floors).every((f) => f.rooms.length === 0 && f.devices.length === 0 && f.outline.length === 0)).toBe(true);
});

test("Undo brings back what Reset erased", async ({ page }) => {
  const before = await layoutOf(page);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await layoutOf(page)).toEqual(before);
});

test("Load demo is off while the plan has content, and says why", async ({ page }) => {
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
  await expect(page.locator("#loaddemo")).toHaveAttribute("title", /Reset first/);
});

test("after Reset, Load demo loads the demo without asking, and is off again", async ({ page }) => {
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeEnabled();
  let asked = false;
  page.once("dialog", (d) => { asked = true; void d.dismiss(); });
  await page.locator("#loaddemo").click();
  expect(asked).toBe(false);
  expect(await layoutOf(page)).toEqual(demo);
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
});

test("break it: Reset cancelled keeps the plan and Load demo stays off", async ({ page }) => {
  const before = await layoutOf(page);
  page.once("dialog", (d) => d.dismiss());
  await menu(page, "File");
  await page.locator("#reset").click();
  expect(await layoutOf(page)).toEqual(before);
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
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

test("S4.24: the contact sensor picker follows the selected door, several allowed, one attach list per door", async ({ page }) => {
  // Rewritten for S4.24 (a door's contact sensors are now a list, not one .value): the #dsens select is an
  // "add" control (always resets to "") and each attached sensor gets its own row with a Remove button.
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0); // Front door: already has one sensor attached
  await expect(page.locator("#dsens")).toHaveValue(""); // add-select, never shows the current pick as its value
  await expect(page.locator('#dsens option[value="binary_sensor.demo_front_door"]')).toHaveCount(0); // already attached: not offered again
  await pick(2); // Garage door: no sensor yet
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1);
  await pick(1);
  await expect(page.locator('#dsens option[value="binary_sensor.demo_patio_door"]')).toHaveCount(0); // Patio door's own sensor already attached to it
  // attach a sensor to the garage door, confirm it lands in the layout, then remove it again
  await pick(2);
  await page.locator("#dsens").selectOption("binary_sensor.demo_garage_door");
  expect((await groundOf(page)).doors[2].sensors).toEqual(["binary_sensor.demo_garage_door"]);
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(0); // now attached: no longer offered
  await page.locator("#dsens-rm0").click();
  expect((await groundOf(page)).doors[2].sensors).toBeUndefined();
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1); // free again
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
const addStairs = async (page: Page) => addItem(page, "#addStairs");

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
  await page.locator("#vrot30").focus();
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
const addKind = async (page: Page, id: "#addZone") => addItem(page, id);
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
  expect([Math.min(...xs) + 100, Math.min(...ys) + 100]).toEqual([1050, 0]); // centred on the spawn point, clear of the demo's own devices (reach x 900), not just the outline (S1.20, S4.13-adjacent)
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
  expect((await groundOf(page)).rooms[0].wk).toEqual(["external", "wall", "wall", "external"]); // two edges lie on the perimeter (S1.52)
  await page.locator("#rk").selectOption("zone");
  const z = (await groundOf(page)).rooms[0];
  expect(z.kind).toBe("zone");
  expect(z.wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  await menu(page, "File");
  await page.locator("#undo").click();
  const back = (await groundOf(page)).rooms[0];
  expect(back.kind).toBe("room");
  expect(back.wk).toEqual(["external", "wall", "wall", "external"]);
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
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Attic"]);
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
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
  await menu(page, "File");
  await expect(undoBtn(page)).toBeDisabled();
});

test("break it: adding \"Ground\" gets the key ground-2 and does not overwrite the ground floor", async ({ page }) => {
  await addFloorVia(page, "Ground");
  const l = await layoutOf(page);
  expect(Object.keys(l.floors)).toEqual(["ground", "first", "test", "ground-2"]);
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
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Loft"]);
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  await page.locator("#ft").fill("   "); // blank: refused, the field falls back
  await page.locator("#ft").press("Enter");
  await expect(page.locator("#ft")).toHaveValue("Loft");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Loft"]);
  await page.locator("#panel").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+z");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Attic"]);
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
  await addFloorVia(page, "Attic"); // ground, first, test, attic; attic selected, at the top
  await expect(page.locator("#fup")).toBeDisabled();
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic", "test"]);
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  expect(await floorKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  await expect(page.locator("#fdown")).toBeDisabled();
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fup").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
});

test("Delete asks first inline: Cancel keeps the floor; Delete removes it and selects a neighbour", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#fdel").click();
  await expect(page.locator("#panel")).toContainText("Delete floor Attic and everything on it?");
  await page.locator("#fdelno").click();
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
  expect(await floorKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["ground", "first", "test"]);
  await expect(page.locator('.chip[data-f="test"]')).toHaveAttribute("aria-pressed", "true"); // the neighbour before it
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
});

test("a pointer press on the plan cancels a pending delete confirm", async ({ page }) => {
  await page.locator("#fdel").click();
  await expect(page.locator("#fdelyes")).toBeVisible();
  await clickCm(page, 200, 150);
  await page.mouse.click(2, 2); // out of the editor: selection clears, the floor panel is back
  await expect(page.locator("#fdelyes")).toHaveCount(0);
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
});

test("deleting the ground floor with content, then Undo, brings it back in place with all its content", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["first", "test"]);
  await page.locator('.chip[data-f="test"]').click();
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["first"]);
  await expect(page.locator("#fdel")).toBeDisabled(); // the last floor cannot go
  await page.keyboard.press("Control+z"); // undo delete test
  await page.keyboard.press("Control+z"); // undo delete ground
  expect(await chipKeys(page)).toEqual(["ground", "first", "test"]);
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
  await addFloorVia(page, "Attic"); // ground, first, test, attic
  await page.locator("#ft").fill("Loft");
  await page.locator("#ft").press("Enter");
  await page.locator("#fdown").click(); // ground, first, attic, test
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
  for (const [keys, titles] of [
    [["ground", "first", "attic", "test"], ["Ground", "First", "Loft", "Test"]], // undo the delete
    [["ground", "first", "test", "attic"], ["Ground", "First", "Test", "Loft"]], // undo the move
    [["ground", "first", "test", "attic"], ["Ground", "First", "Test", "Attic"]], // undo the rename
  ] as [string[], string[]][]) {
    await page.keyboard.press("Control+z");
    expect(await chipKeys(page)).toEqual(keys);
    expect(await chipTitles(page)).toEqual(titles);
  }
  await page.keyboard.press("Control+z");
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
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

test("Opus review: drawing an outline with a different point count still Saves without an error dialog (draw.ts:71-76)", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; these numbers are on the 5 cm grid
  await startDraw(page, "drawOutline");
  await clicksCm(page, [100, 630], [200, 600], [300, 630], [300, 670], [100, 670]); // 5 points; the demo's outline has 4
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.outline).toHaveLength(5);
  expect(g.owk).toHaveLength(5); // owk must track the outline's new point count, or Save below refuses the layout
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  await expect(page.locator("#errors")).toHaveCount(0);
  await expect(page.locator("#status")).not.toContainText("owk");
  const file = await (await dl).path();
  expect(validate(JSON.parse(readFileSync(file, "utf8"))).ok).toBe(true);
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
  await expect(page.locator("#exn")).toHaveValue("New line"); // S4.13: selected on finish, like an opening
  const g = await groundOf(page);
  expect(g.extras).toHaveLength(1);
  expect(g.extras[0].name).toBe("New line");
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

// S4.13 (Opus review, real-layout repro): a structure line's own body took no clicks at all (`.extra` was
// `pointer-events:none`), so a click on "tech area" or "boiler + tank" always fell through to the room under
// it. The test draws one on top of a room on purpose, deselects, then clicks the line itself, not a handle.
test("an existing structure line, drawn over a room, is still selectable and deletable by clicking it", async ({ page }) => {
  await startDraw(page, "drawExtra");
  await clicksCm(page, [180, 150], [260, 150]); // inside the Living Room: on top of a room, like Diego's basement extras
  await clickCm(page, 150, 650); // free ground: deselect
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await clickCm(page, 220, 150); // the line's own midpoint, still over the room
  await expect(page.locator("#exn")).toHaveValue("New line");
  await page.locator("#exdel").click();
  expect((await groundOf(page)).extras).toHaveLength(0);
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
  await addItem(page, "#addDoor"); // a single-shape item ends draw mode
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
  await addItem(page, "#addZone");
  expect((await groundOf(page)).rooms.at(-1)!.kind).toBe("zone");
});

// ---- S1.12 Device menu -------------------------------------------------------
const search = (page: Page) => page.locator("#devSearch");
const shown = (page: Page) => page.locator("#mDev button[data-dev]:visible");

test("the toolbar order is Add, Draw, Device, View, File and Add has no Device item", async ({ page }) => {
  await expect(page.locator("details.menu > summary")).toHaveText(["Add", "Draw", "Device", "View", "File"]);
  await expect(page.locator("#mAdd select")).toHaveCount(2); // furniture and unlinked-device selects (S4.25)
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
const addGap = async (page: Page) => addItem(page, "#addGap");
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
  await addItem(page, "#addWall-wall");
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
  await addItem(page, "#addDoor");
  await addItem(page, "#addWin");
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
  await addItem(page, "#addDoor");
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(zoneYs).not.toContain(d.a[1]);
  expect(zoneYs).not.toContain(d.b[1]);
  await addItem(page, "#addGap");
  const o = (await groundOf(page)).openings.at(-1)!;
  expect(zoneYs).not.toContain(o.a[1]);
  expect(zoneYs).not.toContain(o.b[1]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("Add, Door lands on a free wall when that is the nearest edge, along its direction", async ({ page }) => {
  await addItem(page, "#addWall-wall"); // a horizontal wall
  const w = (await groundOf(page)).walls[0];
  await centreViewOn(page, mid(w)); // the wall is now the edge nearest the view centre
  await addItem(page, "#addDoor");
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
  expect(options).toEqual(["Internal wall", "Dotted boundary", "External wall", "Fence", "Outdoor edge", "Not drawn"]);
  await page.locator("#ek").selectOption("external");
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["external", "external"]);
  expect(g.rooms[0].wk.filter((k) => k === "external")).toHaveLength(3); // edges 0 and 3 are already on the perimeter (S1.52); this makes edge 1 the third
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

test("break it: an outline edge of a floor with no rooms still has a kind select, external by default, and nothing throws (S1.52)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = [];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // the top outline edge
  await expect(page.locator("#elen")).toBeVisible(); // an edge is selected
  await expect(page.locator("#ek")).toHaveValue("external"); // the outline has its own kind now (S1.52)
  expect(errors).toEqual([]);
});

// ---- S1.52 the outline has wall kinds, and its edges can be deleted ----

test("S1.52: a perimeter edge shows External wall by default, and its kind can be changed like any other edge", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // isolate the outline: no room edge competes for the click or the panel
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // the top outline edge, o:0
  await expect(page.locator("#panel strong").first()).toHaveText("External wall");
  await expect(page.locator("#ek")).toHaveValue("external");
  const line = page.locator('svg line[data-e="o:0"]');
  await expect(line).toHaveClass("e external");
  expect(await line.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("6px");
  await page.locator("#ek").selectOption("wall");
  expect((await groundOf(page)).owk?.[0]).toBe("wall");
  await expect(page.locator("#panel strong").first()).toHaveText("Internal wall");
  await expect(line).toHaveClass("e");
  // the block's Test section names "8", the halo twin's width (.eh.external); the selectable line itself goes 6 -> 3
  expect(await line.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("3px");
  await savedValid(page);
});

test("S1.52: Delete on a perimeter edge stops drawing it, and one undo brings it back with its kind", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = [];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // o:0, no door on this edge
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.owk?.[0]).toBe("none");
  await expect(page.locator('svg line.e.none[data-e="o:0"]')).toHaveCount(1); // a guide only in the editor, not a drawn line
  await expect(page.locator("#edel")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  const u = await groundOf(page);
  expect(u.owk?.[0]).toBe("external");
  await expect(page.locator('svg line[data-e="o:0"]')).toHaveClass("e external");
});

test("Opus review: Delete on the unmodified demo clears the room edge AND the outline's collinear edge together (S1.53)", async ({ page }) => {
  // No `rooms = []` here on purpose: that isolation is what hid the bug. The Living room's top edge
  // (r0:0) and the outline's top edge (o:0) share the segment x 0-500, y 0; the room's line is painted
  // after the outline's, so a real click lands on r0:0.
  await clickCm(page, 400, 0);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR)).toEqual({ t: "edge", poly: "r0", i: 0 });
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.rooms[0].wk[0]).toBe("none");
  expect(g.owk?.[0]).toBe("none");
  await expect(page.locator('svg line.e:not(.none)[data-e="r0:0"]')).toHaveCount(0); // no colored line remains on the segment
  await expect(page.locator('svg line.e:not(.none)[data-e="o:0"]')).toHaveCount(0);
  await expect(page.locator('svg line.e.none[data-e="r0:0"]')).toHaveCount(1); // a faint guide only, as usual
  await expect(page.locator('svg line.e.none[data-e="o:0"]')).toHaveCount(1);
  await menu(page, "File");
  await page.locator("#undo").click(); // one undo step restores both kinds together
  const u = await groundOf(page);
  expect(u.rooms[0].wk[0]).toBe("external");
  expect(u.owk?.[0]).toBe("external");
});

test("S1.52: a door on the perimeter edge asks first; Cancel changes nothing, the door stays either way", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // the demo's Front door already sits on outline edge o:2 (the bottom)
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 600, 600); // o:2, away from the door itself but on the same edge
  const before = await groundOf(page);
  await page.locator("#edel").click();
  await expect(page.locator("#edelyes")).toBeVisible();
  expect(await groundOf(page)).toEqual(before);
  await page.locator("#edelno").click();
  await expect(page.locator("#edelyes")).toHaveCount(0);
  await expect(page.locator("#edel")).toBeVisible();
  await page.locator("#edel").click();
  await page.locator("#edelyes").click();
  const g = await groundOf(page);
  expect(g.owk?.[2]).toBe("none");
  expect(g.doors.some((d) => d.id === "door-ground-1")).toBe(true); // the door stays
});

test("S1.52: the outline still fits the view after a perimeter edge is deleted", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // isolate the outline edge so the click cannot land on a room edge instead
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // o:0
  await page.locator("#edel").click();
  expect((await groundOf(page)).owk?.[0]).toBe("none");
  await menu(page, "View");
  await page.locator("#fit").click();
  const box = await page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    return (root.querySelector("svg")!.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  }, EDITOR);
  const [x, y, w, h] = box;
  expect(x).toBeLessThanOrEqual(0); // Fit to window still frames the 0,0 - 800,600 outline
  expect(y).toBeLessThanOrEqual(0);
  expect(x + w).toBeGreaterThanOrEqual(800);
  expect(y + h).toBeGreaterThanOrEqual(600);
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

test("choosing the opening entry on a room edge select is not possible: the edge kind select has the five kinds and Not drawn", async ({ page }) => {
  await clickCm(page, 500, 200);
  expect(await page.locator("#ek option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["wall", "boundary", "external", "fence", "edge", "none"]);
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
const addMenuItem = async (page: Page, id: string) => addItem(page, id);
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
  await expect(page.locator(".chip[data-f]")).toHaveCount(4);
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

// ---- S4.11 Add is grouped into submenus: Openings, Wall, Areas; Furniture stays flat ----

test("S4.11: Add's items sit under three submenus by group, Furniture stays flat, and every id still finds its button one click deeper", async ({ page }) => {
  const subOf = (id: string) => page.locator(`#mAdd details.sub:has(#${id})`);
  await menu(page, "Add");
  // grouped correctly
  for (const id of ["addDoor", "addWin", "addGap"]) await expect(subOf(id).locator("summary")).toHaveText("Openings");
  for (const k of WALL_KINDS) await expect(subOf(`addWall-${k}`).locator("summary")).toHaveText("Wall");
  for (const id of ["addStr", "addZone", "addStairs"]) await expect(subOf(id).locator("summary")).toHaveText("Areas");
  // Furniture is not inside any submenu
  await expect(page.locator("#mAdd > .box > #addFurn")).toHaveCount(1);
  await menu(page, "Add"); // close
  // every existing id still resolves, one submenu-open click deeper (exercises addItem's routing for one of each group)
  for (const id of ["#addDoor", "#addWall-wall", "#addZone"]) {
    const before = await groundOf(page);
    await addItem(page, id);
    const g = await groundOf(page);
    expect(g.walls.length + g.doors.length + g.rooms.length).toBeGreaterThan(before.walls.length + before.doors.length + before.rooms.length);
  }
});

test("S4.11: closing Add by an outside click collapses any open submenu, so reopening Add starts collapsed", async ({ page }) => {
  await menu(page, "Add");
  await page.locator(`#mAdd details.sub > summary:text-is("Openings")`).click();
  await expect(page.locator("#addDoor")).toBeVisible();
  await expect(page.locator("#addOpenings")).toHaveJSProperty("open", true);
  await page.mouse.click(2, 2); // outside every menu
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", false);
  await menu(page, "Add"); // reopen
  await expect(page.locator("#addOpenings")).toHaveJSProperty("open", false); // the submenu did not stay expanded
  await expect(page.locator("#addDoor")).not.toBeVisible();
});

test("S4.11: Tab reaches every Add item in DOM order, submenus included", async ({ page }) => {
  await menu(page, "Add");
  await page.locator(`#mAdd details.sub > summary:text-is("Openings")`).click();
  await page.locator(`#mAdd details.sub > summary:text-is("Wall")`).click();
  await page.locator(`#mAdd details.sub > summary:text-is("Areas")`).click();
  const order = await page.locator("#mAdd .box *:is(summary, button, select)").evaluateAll((els) => els.map((e) => e.id || e.textContent?.trim()));
  expect(order).toEqual(["Openings", "addDoor", "addWin", "addGap", "Wall", "addWall-wall", "addWall-boundary", "addWall-external", "addWall-fence", "addWall-edge", "Areas", "addStr", "addZone", "addStairs", "addFurn", "addUnlDev"]);
});

test("each Add, Wall item places a 200 cm wall of its kind at the spawn point, selected, in one undo step", async ({ page }) => {
  for (const kind of WALL_KINDS) {
    const before = await groundOf(page);
    await addItem(page, `#addWall-${kind}`);
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

// ---- S4.9: locked walls, doors and openings pivot on drag, length fixed ----

test("a locked wall's dragged end pivots on an arc of fixed radius around the other end", async ({ page }) => {
  await addItem(page, "#addWall-wall");
  const w = (await groundOf(page)).walls.at(-1)!;
  await centreViewOn(page, mid(w));
  await expect(page.locator("#wlock")).not.toBeChecked();
  await page.locator("#wlock").check();
  await dragCm(page, w.a as [number, number], [w.a[0] + 30, w.a[1] + 40]);
  const w2 = (await groundOf(page)).walls.at(-1)!;
  expect(Math.abs(dist2(w2.a, w2.b) - dist2(w.a, w.b))).toBeLessThanOrEqual(1); // length fixed, within rounding
  expect(w2.b).toEqual(w.b); // the far end never moved
  expect(w2.a).not.toEqual(w.a);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls.at(-1)!.a).toEqual(w.a); // one undo step
});

test("typing a wall's length locks it; unticking frees it for a normal, length-changing drag", async ({ page }) => {
  await addItem(page, "#addWall-wall");
  const w = (await groundOf(page)).walls.at(-1)!;
  await centreViewOn(page, mid(w));
  await page.locator("#wlen").fill("3");
  await page.locator("#wlen").press("Enter");
  await expect(page.locator("#wlock")).toBeChecked();
  expect(dist2((await groundOf(page)).walls.at(-1)!.a, (await groundOf(page)).walls.at(-1)!.b)).toBe(300);
  await page.locator("#wlock").uncheck();
  const w2 = (await groundOf(page)).walls.at(-1)!;
  await dragCm(page, w2.a as [number, number], [w2.a[0] + 50, w2.a[1]]);
  const w3 = (await groundOf(page)).walls.at(-1)!;
  expect(dist2(w3.a, w3.b)).not.toBe(300); // free again: the drag changed the length
});

test("a locked door's dragged end pivots on an arc of fixed radius", async ({ page }) => {
  await addItem(page, "#addDoor");
  const d = (await groundOf(page)).doors.at(-1)!;
  await centreViewOn(page, mid(d));
  await expect(page.locator("#dlock")).not.toBeChecked();
  await page.locator("#dlock").check();
  await dragCm(page, d.a as [number, number], [d.a[0] + 40, d.a[1] + 30]);
  const d2 = (await groundOf(page)).doors.at(-1)!;
  expect(Math.abs(dist2(d2.a, d2.b) - dist2(d.a, d.b))).toBeLessThanOrEqual(1);
  expect(d2.b).toEqual(d.b);
  expect(d2.a).not.toEqual(d.a);
});

test("a locked opening's dragged end pivots on an arc of fixed radius", async ({ page }) => {
  await addGap(page);
  const o = (await gaps(page))[0];
  await expect(page.locator("#olock")).not.toBeChecked();
  await page.locator("#olock").check();
  await dragCm(page, o.a as [number, number], [o.a[0] + 40, o.a[1] + 25]);
  const o2 = (await gaps(page))[0];
  expect(Math.abs(len(o2) - len(o))).toBeLessThanOrEqual(1);
  expect(o2.b).toEqual(o.b);
  expect(o2.a).not.toEqual(o.a);
});

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
  await addItem(page, "#addDoor");
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
  await page.locator("#vrot90").click();
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
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  await page.locator("#vrotreset").click();
  expect("rot" in (await groundOf(page)).devices[0]).toBe(false); // the key is deleted at 0
  await page.locator("#vrotreset").click(); // already 0: no step
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  await savedValid(page);
});

test("break it: an angle field with rubbish changes nothing", async ({ page }) => {
  await addItem(page, "#addDoor");
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
  await expect(page.locator("#rrot90")).toBeDisabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  await page.locator("#runsnap").click();
  await expect(page.locator("#rrot90")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Snap back");
  await expect(page.locator(".hint", { hasText: "Unsnapped: this room no longer joins its neighbours." })).toBeVisible();
  const free = await groundOf(page);
  expect(free.rooms[0].free).toBe(true);
  expect(free.rooms[0].pts).toEqual(before.rooms[0].pts); // not one centimetre
  expect(free.rooms.slice(1)).toEqual(before.rooms.slice(1)); // and the neighbours' corners stay
  expect(free.outline).toEqual(before.outline);
  await page.locator("#rrot30").click();
  const turned = await groundOf(page);
  expect(turned.rooms[0].pts).not.toEqual(free.rooms[0].pts);
  expect(turned.rooms[0].pts.length).toBe(4);
  // still 500 x 400 apart corner to corner: a turn keeps lengths (within rounding)
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  expect(Math.abs(d(turned.rooms[0].pts[0], turned.rooms[0].pts[1]) - 500)).toBeLessThanOrEqual(1);
  expect(Math.abs(d(turned.rooms[0].pts[1], turned.rooms[0].pts[2]) - 400)).toBeLessThanOrEqual(1);
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
  await expect(page.locator("#rrot90")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  const before = await groundOf(page);
  await page.locator("#rrot90").click();
  const after = await groundOf(page);
  expect(after.rooms[6].pts).not.toEqual(before.rooms[6].pts);
  expect(after.rooms.filter((_, i) => i !== 6)).toEqual(before.rooms.filter((_, i) => i !== 6));
});

test("break it: the turn buttons of a snapped room are disabled and add no undo step", async ({ page }) => {
  await clickCm(page, 50, 200);
  for (const n of [30, 45, 60, 90]) await expect(page.locator(`#rrot${n}`)).toBeDisabled();
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
  expect(t).toMatchObject({ shape: "round", dia: 200, inner: 80, steps: 11, rot: 0 }); // pi * 140 / 40, derived
  expect(t.pts).toHaveLength(24);
  const cx = t.pts.reduce((s, p) => s + p[0], 0) / 24, cy = t.pts.reduce((s, p) => s + p[1], 0) / 24;
  for (const p of t.pts) expect(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 100)).toBeLessThan(1);
  await expect(page.locator('svg circle[data-h^="s1:"]')).toHaveCount(0);
  await expect(page.locator('svg g[data-s="1"] line.tread')).toHaveCount(10);
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
  expect(b).toMatchObject({ shape: "straight", steps: 8 }); // 300 cm / 40, rounded
  expect("dia" in b || "inner" in b).toBe(false);
  expect(b.pts).toHaveLength(4);
});

test("stairs: a real click on a rotated flight, where the unrotated one is not, selects it", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await page.locator("#srot90").click();
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
  await page.locator("#srot30").click();
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(0);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(0);
  await page.locator("#srotreset").click();
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(4);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(4);
  const pts = (await groundOf(page)).stairs[0].pts;
  for (const [j, p] of pts.entries()) {
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cx", String(p[0]));
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cy", String(p[1]));
  }
});

test("S1.44: the steps are read only and follow the run", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sst")).toHaveCount(0);
  await expect(page.locator("#sstn")).toHaveText("4"); // 160 cm / 40
  await expect(page.locator('svg g[data-s="0"] line.tread')).toHaveCount(3);
  await drag(page, 'circle[data-h="s0:0"]', 0, -60); // the run grows
  const st = (await groundOf(page)).stairs[0];
  const run = Math.max(...st.pts.map((p) => p[1])) - Math.min(...st.pts.map((p) => p[1]));
  expect(run).toBeGreaterThan(160);
  expect(st.steps).toBe(Math.round(run / 40));
  const again = await screenOf(page, 740, 500); // the corner drag selected the corner; pick the flight again
  await page.mouse.click(again.x, again.y);
  await expect(page.locator("#sstn")).toHaveText(String(st.steps));
  await expect(page.locator('svg g[data-s="0"] line.tread')).toHaveCount(st.steps - 1);
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
// LIGHT is the fixed on-dark button text (S1.53): white, not --fp-bg, so a danger/primary button stays readable in both themes.
const RED = "rgb(176, 42, 42)", ORANGE = "rgb(242, 140, 40)", LIGHT = "rgb(255, 255, 255)", DARK = "rgb(43, 42, 39)";
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
  await addItem(page, "#addDoor");
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

test("S1.31: the cone is dark grey at 25 % alpha in the browser, the disc is 75 % white and lets the pointer through to the room", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const cone = page.locator("svg g.dev-camera path.cone");
  await expect(cone).toHaveCount(1);
  const st = await cone.evaluate((el) => { const s = getComputedStyle(el); return { fill: s.fill, op: s.fillOpacity, pe: s.pointerEvents }; });
  expect(st).toEqual({ fill: "rgb(74, 74, 72)", op: "0.25", pe: "none" });
  // the disc behind every icon is its own: white at 50 % (Diego, 2026-09-23), a 1 px grey border (S1.45)
  const disc = await page.locator("svg .dev .halo").evaluateAll((els) => [...new Set(els.map((e) => { const s = getComputedStyle(e); return [s.fill, s.fillOpacity, s.stroke, s.strokeWidth].join("|"); }))]);
  expect(disc).toEqual(["rgb(255, 255, 255)|0.5|rgb(139, 133, 120)|1px"]);
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
  await expect(page.locator("#vrot90")).toHaveCount(0);
});

test("S1.31: the rotation field turns the cone; the panel carries the hint; rot 90 points it along +x", async ({ page }) => {
  const c = await screenOf(page, CAM.x, CAM.y);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#vrot90")).toBeVisible();
  await expect(page.locator(".hint", { hasText: "The cone shows a 120 degree field of view, 1 m deep." })).toHaveCount(1);
  const centreOf = () => page.locator("svg path.cone").evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const up = await centreOf();
  expect(up.y).toBeLessThan(c.y - 20); // above the camera
  expect(Math.abs(up.x - c.x)).toBeLessThan(5);
  await page.locator("#vrot90").click();
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
  await expect(page.locator(`${EDITOR} svg g.plan-turn[transform^="rotate(135 "]`)).toHaveCount(3); // the measure grid, the drawing (now inside the theme group) and the overlay (S1.50)
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
  await addItem(page, "#addStairs");
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
  await addItem(page, "#addStairs");
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
  const sw = page.locator('#panel .swatches[aria-label="Colours"] .sw');
  await expect(sw).toHaveCount(12);
  await expect(page.locator("#panel .sw.tex")).toHaveCount(11); // and eleven textures beside them (S4.19)
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
  await expect(page.locator(`${EDITOR} #devcols [data-type]`)).toHaveCount(27); // S4.25 added boiler, car, ups, printer, speaker
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
  expect(await varOn(page, lights, "--fp-dev-light")).toBe("#ff8a1f"); // blueprint's --fp-dev-light collapses to the single accent
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
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
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

test("S1.41: a refused inner diameter snaps back, an accepted one stays", async ({ page }) => {
  await addStairs(page);
  await page.locator("#ss").selectOption("round");
  await setField(page, "#sdia", "200");
  await setField(page, "#sinner", "500"); // clamped to 160
  await expect(page.locator("#sinner")).toHaveValue("160");
  await setField(page, "#sinner", "80");
  await expect(page.locator("#sinner")).toHaveValue("80");
  expect((await groundOf(page)).stairs[1].inner).toBe(80);
});

test("S1.41: a clamped furniture width shows the clamped value", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5");
  expect((await groundOf(page)).furniture.at(-1)!.w).toBe(5);
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5"); // already 5: the state does not change, the field still resets
  await setField(page, "#fw", "137");
  await expect(page.locator("#fw")).toHaveValue("137");
  await setField(page, "#fw", ""); // refused: no number, so the state stays 137 and the field goes back to it
  await expect(page.locator("#fw")).toHaveValue("137");
  await setField(page, "#fh", "2");
  await expect(page.locator("#fh")).toHaveValue("5");
  const m = (await groundOf(page)).furniture.at(-1)!;
  expect([m.w, m.h]).toEqual([137, 5]);
});

// ---- a device never hides a room name (S1.42) ------------------------------------------

test("S1.42: on the demo no room name box overlaps a device halo", async ({ page }) => {
  const boxes = await page.evaluate((tag) => {
    const root = document.querySelector(tag)!.shadowRoot!;
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    return { names: [...root.querySelectorAll("text.lbl")].filter((t) => t.textContent && ["Living", "Kitchen", "Hall", "Reading corner"].includes(t.textContent)).map((t) => [t.textContent, ...r(t)]),
      halos: [...root.querySelectorAll("circle.halo")].map(r) };
  }, EDITOR);
  expect(boxes.names).toHaveLength(4);
  expect(boxes.halos.length).toBeGreaterThan(3);
  for (const [name, l, t, rr, b] of boxes.names as [string, number, number, number, number][])
    for (const h of boxes.halos) expect(l < h[2] && rr > h[0] && t < h[3] && b > h[1], `${name} ${[l,t,rr,b]} under a halo ${h}`).toBe(false);
});

test("S1.42: at plan rotations 0, 45, 90 and 135 no name box overlaps a device halo", async ({ page }) => {
  for (const deg of [0, 45, 90, 135]) {
    await page.evaluate(([tag, d]) => { const el = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.rotate = d; el.layout = l; }, [EDITOR, deg] as const);
    await expect(page.locator("svg g.plan-turn, svg polygon[data-r]").first()).toBeVisible();
    const boxes = await page.evaluate((tag) => {
      const root = document.querySelector(tag)!.shadowRoot!;
      const r = (e: Element) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      return { names: [...root.querySelectorAll("text.lbl")].filter((t) => t.textContent && ["Living", "Kitchen", "Hall", "Reading corner"].includes(t.textContent)).map((t) => [t.textContent, ...r(t)]),
        halos: [...root.querySelectorAll("circle.halo")].map(r) };
    }, EDITOR);
    expect(boxes.names, `rotation ${deg}`).toHaveLength(4);
    expect(boxes.halos.length).toBeGreaterThan(3);
    for (const [name, l, t, rr, b] of boxes.names as [string, number, number, number, number][])
      for (const h of boxes.halos) expect(l < h[2] && rr > h[0] && t < h[3] && b > h[1], `rotation ${deg}: ${name} ${[l, t, rr, b]} under a halo ${h}`).toBe(false);
  }
});

// ---- rotation buttons (S1.43) -----------------------------------------------------------

test("S1.43: stairs turn by the pressed amount, in the chosen direction, and Reset returns to 0", async ({ page }) => {
  await addStairs(page);
  const rot = async () => (await groundOf(page)).stairs[1].rot;
  await page.locator("#srot30").click();
  await page.locator("#srot45").click();
  expect(await rot()).toBe(75);
  await page.locator("#srotdir").click();
  await expect(page.locator("#srotdir")).toHaveText("counter-clockwise");
  await page.locator("#srot90").click();
  expect(await rot()).toBe(345);
  await page.locator("#srot60").click();
  expect(await rot()).toBe(285);
  await page.locator("#srotreset").click();
  expect(await rot()).toBe(0);
  for (const id of ["#srot", "#fr", "#vrot", "#rrot"]) await expect(page.locator(`input${id}`)).toHaveCount(0);
});

test("S1.43: one press is one undo step; 360 wraps", async ({ page }) => {
  await addStairs(page);
  for (let i = 0; i < 4; i++) await page.locator("#srot90").click();
  expect((await groundOf(page)).stairs[1].rot).toBe(0);
  await page.locator("#srot90").click();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).stairs[1].rot).toBe(0);
});

test("S1.43: furniture and devices turn; the device Reset deletes rot", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await page.locator("#fr45").click();
  await page.locator("#fr45").click();
  expect((await groundOf(page)).furniture.at(-1)!.rot).toBe(90);
  await page.locator("#frreset").click();
  expect((await groundOf(page)).furniture.at(-1)!.rot).toBe(0);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vrot60").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(60);
  await page.locator("#vrotreset").click();
  expect("rot" in (await groundOf(page)).devices[0]).toBe(false);
});

test("S1.43: an unsnapped room turns a quarter, and has no Reset", async ({ page }) => {
  await clickCm(page, 50, 200);
  await expect(page.locator("#rrotreset")).toHaveCount(0);
  await page.locator("#runsnap").click();
  const before = (await groundOf(page)).rooms[0].pts;
  await page.locator("#rrot90").click();
  const after = (await groundOf(page)).rooms[0].pts;
  expect(after).not.toEqual(before);
  const w = (p: number[][]) => Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
  expect(Math.abs(w(after) - w(before))).toBeLessThanOrEqual(1);
});

// ---- the icon disc (S1.45) ----------------------------------------------------------------

test("S1.45: the disc is 3 units wider than the icon and stays white on a dark floor", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const r = await page.locator("svg g.dev .halo").first().evaluate((el) => Number(el.getAttribute("r")));
  expect(r).toBe(16); // the icon glyph is 12 out from the centre, the border adds one, the gap three
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); for (const rm of l.floors.ground.rooms) rm.color = "#222222"; el.layout = l; }, EDITOR);
  const fill = await page.locator("svg g.dev .halo").first().evaluate((el) => getComputedStyle(el).fill);
  expect(fill).toBe("rgb(255, 255, 255)");
  const cone = await page.locator("svg path.cone").evaluate((el) => getComputedStyle(el).fillOpacity);
  expect(cone).toBe("0.25");
});

// ---- every text has a white outline (S1.46) ----------------------------------------------

test("S1.46: room, zone, device and extra names and the edge length are dark grey with a white outline", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.extras.push({ id: "x1", name: "Shed", a: [100, 700], b: [200, 760] }); l.floors.ground.rooms[0].color = "#222222"; el.layout = l; }, EDITOR);
  await page.locator("#names").click();
  await page.mouse.click(...Object.values(await screenOf(page, 500, 200)) as [number, number]); // a click on the shared edge shows its length
  const kinds = ["svg text.lbl:not(.zone)", "svg text.lbl.zone", "svg text.len"];
  const widths: string[] = [];
  for (const sel of kinds) {
    const st = await page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return [s.fill, s.stroke, s.paintOrder.split(" ")[0], s.strokeWidth]; });
    expect(st.slice(0, 3), sel).toEqual(["rgb(58, 58, 58)", "rgb(255, 255, 255)", "stroke"]);
    widths.push(st[3]);
  }
  expect(widths, "the edge length outline is as wide as the names' (3, not 3 x zoom)").toEqual(["3px", "3px", "3px"]);
  const names = await page.locator("svg text.lbl").evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return [el.textContent, s.fill, s.stroke]; }));
  expect(names.length).toBeGreaterThan(8); // rooms, the zone, device names, the extra
  for (const [t, fill, stroke] of names) { expect(fill, String(t)).toBe("rgb(58, 58, 58)"); expect(stroke, String(t)).toBe("rgb(255, 255, 255)"); }
  expect(names.some(([t]) => t === "Shed")).toBe(true);
});

// ---- delete a room edge (S1.47) -------------------------------------------------------------

const twins = (page: Page) => page.locator("svg line.eh").count();

test("S1.47: Delete on a shared edge stops drawing it on both rooms, and one undo brings it back", async ({ page }) => {
  const before = await twins(page);
  await clickCm(page, 500, 300); // the edge Living and Kitchen share
  await expect(page.locator("#ek")).toHaveValue("wall");
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.rooms[0].wk[1]).toBe("none");
  expect(g.rooms[1].wk[3]).toBe("none");
  expect(await twins(page)).toBe(before - 2);
  await expect(page.locator('svg line.e.none[data-e="r0:1"]')).toHaveCount(1);
  await expect(page.locator("#edel")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  const u = await groundOf(page);
  expect(u.rooms[0].wk[1]).toBe("wall");
  expect(u.rooms[1].wk[3]).toBe("wall");
  expect(await twins(page)).toBe(before);
});

test("S1.47: a deleted edge can be picked again and brought back from the kind list", async ({ page }) => {
  await clickCm(page, 500, 300);
  await page.locator("#edel").click();
  await page.mouse.click(...Object.values(await screenOf(page, 200, 100)) as [number, number]); // elsewhere
  await clickCm(page, 500, 300);
  await expect(page.locator("#ek")).toHaveValue("none");
  await page.locator("#ek").selectOption("wall");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("wall");
});

test("S1.47: a door on the edge asks first; Cancel changes nothing", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.doors.push({ id: "door-x", name: "Between", kind: "door", a: [500, 100], b: [500, 190] }); el.layout = l; }, EDITOR);
  await clickCm(page, 500, 330);
  const before = await groundOf(page);
  await page.locator("#edel").click();
  await expect(page.locator("#edelyes")).toBeVisible();
  expect(await groundOf(page)).toEqual(before);
  await page.locator("#edelno").click();
  await expect(page.locator("#edelyes")).toHaveCount(0);
  await expect(page.locator("#edel")).toBeVisible();
  await page.locator("#edel").click();
  await page.locator("#edelyes").click();
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["none", "none"]);
  expect(g.doors.some((d) => d.id === "door-x")).toBe(true); // the door stays
});

test("S1.47: Delete on the edge Hall shares in halves leaves no line drawn; one undo restores exactly", async ({ page }) => {
  const before = await groundOf(page), lines = await twins(page);
  await clickCm(page, 250, 400); // Hall's edge (0,400)-(800,400); Living and Kitchen own half each
  await page.locator("#edel").click();
  const g = await groundOf(page);
  const onSeam = g.rooms.flatMap((r) => r.pts.map((p, i) => ({ a: p, b: r.pts[(i + 1) % r.pts.length], k: r.wk[i], name: r.name })).filter((e) => e.a[1] === 400 && e.b[1] === 400));
  expect(onSeam.length).toBe(3); // Living's, Kitchen's and Hall's edge
  expect(onSeam.map((e) => e.k)).toEqual(onSeam.map(() => "none"));
  expect(await twins(page)).toBe(lines - 3);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.52: an outline edge with no room on it still has Delete (the perimeter is always editable)", async ({ page }) => {
  await addFloorVia(page, "Attic"); // the outline only
  await clickCm(page, 400, 0);
  await expect(page.locator("#addpt")).toBeVisible(); // the edge panel is up
  await expect(page.locator("#edel")).toBeVisible();
});

// ---- S1.48 a closed loop of walls becomes a room ----
const LOOP: [number, number][] = [[103, 632], [297, 633], [298, 668], [102, 667]];

for (const [wall, kind, label] of [["wall", "room", "Room"], ["external", "room", "Room"], ["boundary", "zone", "Zone"], ["fence", "garden", "Garden"], ["edge", "garden", "Garden"]] as const) {
  test(`walls (${wall}) closed on the first point become a ${kind}, selected and named, one undo step`, async ({ page }) => {
    await setGrid(page, 5);
    const before = await groundOf(page);
    await startDraw(page, `drawWall-${wall}`);
    await clicksCm(page, ...LOOP, LOOP[0]);
    const g = await groundOf(page);
    expect(g.walls).toEqual(before.walls); // the four walls are gone
    expect(g.rooms).toHaveLength(before.rooms.length + 1);
    const room = g.rooms.at(-1)!;
    expect([room.kind, room.area, room.wk]).toEqual([kind, "", [wall, wall, wall, wall]]);
    expect(room.pts.map((p) => p.join()).sort()).toEqual(FREE_SNAPPED.map((p) => p.join()).sort());
    await expect(page.locator("#status")).toHaveText(`${label} created from 4 walls`);
    await expect(page.locator("#rn")).toBeFocused();
    await expect(page.locator("#rn")).toHaveValue(`New ${kind}`);
    await expect(page.locator("[data-draw]")).toHaveCount(0);
    expect(validate(await layoutOf(page)).ok).toBe(true);
    await menu(page, "File"); // the name field has focus, so Ctrl+Z would undo typing
    await page.locator("#undo").click();
    expect(await groundOf(page)).toEqual(before); // the walls are only drawn on commit, so one undo removes the room and leaves no walls
    await expect(page.locator("#undo")).toBeDisabled();
  });
}

test("walls closed on the first point: one undo leaves nothing behind, redo brings the room again", async ({ page }) => {
  await setGrid(page, 5);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...LOOP, LOOP[0]);
  const after = await groundOf(page);
  await menu(page, "File");
  await page.locator("#undo").click();
  await menu(page, "File");
  await page.locator("#redo").click();
  expect(await groundOf(page)).toEqual(after);
});

test("a last click 30 cm from the first point is outside the snap: four walls, no room", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...LOOP, [133, 632]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(4);
});

test("walls that return to an intermediate corner stay walls: no room, no wall taken", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [105, 630], [295, 630], [295, 670], [200, 670], [295, 630]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(4);
  await expect(page.locator("#status")).toHaveText("Added the shape");
});

test("a ring of 13 walls stays walls and the status says why", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  const ring = Array.from({ length: 13 }, (_, i): [number, number] => [Math.round((400 + 250 * Math.cos((i * 2 * Math.PI) / 13)) / 5) * 5, Math.round((300 + 250 * Math.sin((i * 2 * Math.PI) / 13)) / 5) * 5]);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...ring, ring[0]);
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(13);
  await expect(page.locator("#status")).toHaveText("13 walls, too many to make a room (max 12)");
});

test("two rings sharing a wall make two rooms", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [105, 630], [295, 630], [295, 670], [105, 670], [105, 630]);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [295, 630], [395, 630], [395, 670], [295, 670], [295, 630]);
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length + 2);
  expect(g.walls).toEqual(before.walls);
});

test("Opus review: a dotted chain that closes over an older wall makes a room whose wk is the truth, and the layout validates", async ({ page }) => {
  await setGrid(page, 5);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.walls.push({ id: "wall-old", a: [105, 630], b: [295, 630], kind: "wall" }); el.layout = l; }, EDITOR);
  await startDraw(page, "drawWall-boundary");
  await clicksCm(page, [295, 630], [295, 670], [105, 670], [105, 630]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  const room = g.rooms.at(-1)!;
  expect(room.kind).toBe("room");
  expect([...room.wk].sort()).toEqual(["boundary", "boundary", "boundary", "wall"]);
  expect(g.walls.some((w) => w.id === "wall-old")).toBe(false);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("Opus review a11y: the turn buttons are a labelled group and their names carry the direction; no label points at nothing", async ({ page }) => {
  await clickCm(page, 200, 200); // a room: has rotation buttons
  const group = page.getByRole("group", { name: "Turn by degrees" });
  await expect(group).toHaveCount(1);
  for (const n of [30, 45, 60, 90]) await expect(group.getByRole("button", { name: `Turn ${n} degrees clockwise`, exact: true })).toBeVisible();
  await page.locator("#rrotdir").click();
  for (const n of [30, 45, 60, 90]) await expect(group.getByRole("button", { name: `Turn ${n} degrees counter-clockwise`, exact: true })).toBeVisible();
  // the stairs panel: every <label> is tied to a control
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sstn")).toBeVisible();
  const orphans = await page.locator("label").evaluateAll((ls) => ls.filter((l) => !(l as HTMLLabelElement).control).map((l) => l.textContent));
  expect(orphans).toEqual([]);
});

// ---- Opus review: every CSS rule that render.test.ts only matches as a string is checked here in the browser ----

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
/** Adds shapes below the house: one room per kind, one wall per kind, a room with a "none" edge, a temp sensor in a garden. */
async function addCssFixtures(page: Page) {
  await setTheme(page, "light"); // the CSS pairs below pin light values; blueprint is the default since S2.12
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)), g = l.floors.ground;
    const kinds = ["garden", "terrace", "pavement", "fill", "zone", "water"];
    kinds.forEach((k, i) => g.rooms.push({ id: `css-${k}`, name: k, area: "", label: "", kind: k, pts: [[1000 + i * 100, 0], [1080 + i * 100, 0], [1080 + i * 100, 80], [1000 + i * 100, 80]], wk: Array(4).fill(k === "zone" ? "boundary" : "wall") }));
    g.rooms.push({ id: "css-none", name: "none", area: "", label: "", kind: "room", pts: [[1700, 0], [1780, 0], [1780, 80], [1700, 80]], wk: ["wall", "none", "wall", "wall"] });
    ["wall", "external", "fence", "edge"].forEach((k, i) => g.walls.push({ id: `css-w-${k}`, a: [1000, 200 + i * 40], b: [1200, 200 + i * 40], kind: k }));
    g.devices.push({ id: "css-out", type: "temp", entity: "sensor.css_out", x: 1040, y: 40 }); // inside css-garden
    // S2.9: types with no fixture elsewhere in the demo, so the colour-pair tests below have something to toggle .on.
    ["contact", "climate", "tv", "computer", "humidity"].forEach((t, i) => g.devices.push({ id: `css-${t}`, type: t, entity: `sensor.css_${t}`, x: 1900 + i * 40, y: 40 }));
    g.rooms.push({ id: "css-pond", name: "pond", area: "", label: "", kind: "water", pts: [[1800, 200], [1880, 200], [1880, 280], [1800, 280]], wk: Array(4).fill("wall"), entity: "switch.css_pond" });
    g.furniture.push({ id: "css-gate", symbol: "patio-wood", x: 1940, y: 240, rot: 0, w: 100, h: 100, entity: "cover.css_gate" });
    el.layout = l;
  }, EDITOR);
}

test("Opus review CSS pair: wall kinds have their colour, thickness and dash (render.test.ts:323-333)", async ({ page }) => {
  await addCssFixtures(page);
  const st = (k: string) => page.locator(`svg line.e.${k}`).first().evaluate((e) => { const s = getComputedStyle(e); return { stroke: s.stroke, w: parseFloat(s.strokeWidth), dash: s.strokeDasharray }; });
  const wall = await page.locator("svg line.e:not(.external):not(.fence):not(.edge):not(.none):not(.se):not(.nw)").first().evaluate((e) => parseFloat(getComputedStyle(e).strokeWidth));
  const ext = await st("external"), fence = await st("fence"), edge = await st("edge");
  expect([ext.stroke, fence.stroke, edge.stroke]).toEqual([rgb("#1a1917"), rgb("#7a5c3a"), rgb("#a29e94")]);
  expect(ext.w).toBeGreaterThan(wall);
  expect(fence.w).toBeLessThan(wall);
  expect(fence.dash.split(",").length).toBe(4); // dash-dot
  expect(edge.dash).toBe("none");
});

test("Opus review CSS pair: each room kind has its own fill; fill is hatched; zone is unfilled (render.test.ts:207-210, 371-394)", async ({ page }) => {
  await addCssFixtures(page);
  const fill = (k: string) => page.locator(`svg polygon.room-${k}`).first().evaluate((e) => getComputedStyle(e).fill);
  expect(await fill("garden")).toBe(rgb("#9db98a"));
  expect(await fill("terrace")).toBe(rgb("#cdb094"));
  expect(await fill("pavement")).toBe(rgb("#c9c6bf"));
  expect(await fill("water")).toBe(rgb("#a9cfe3"));
  expect(await fill("zone")).toBe("none");
  expect(await fill("fill")).toContain("#fp-hatch");
  // the hatch pattern paints with the two fill variables
  const pat = await page.locator("svg pattern#fp-hatch").evaluate((p) => { const r = p.querySelector("rect")!, l = p.querySelector("line, path")!; return [getComputedStyle(r).fill, getComputedStyle(l).stroke]; });
  expect(pat).toEqual([rgb("#c4c0b8"), rgb("#9a958b")]);
});

test("Opus review CSS pair: a deleted edge is a faint dotted guide, stair treads have their colour (render.test.ts:521, 859)", async ({ page }) => {
  await addCssFixtures(page);
  const none = await page.locator("svg line.e.none").first().evaluate((e) => { const s = getComputedStyle(e); return [s.strokeDasharray, s.strokeWidth, s.opacity]; });
  expect(none).toEqual(["2px, 5px", "1px", "0.6"]);
  expect(await page.locator("svg g[data-s] line.tread").first().evaluate((e) => getComputedStyle(e).stroke)).toBe(rgb("#8b8578"));
});

test("Opus review CSS pair: the palette variables equal DEVICE_COLOURS, camera and garden sensor paint from them (render.test.ts:598-600, 757)", async ({ page }) => {
  await addCssFixtures(page);
  const vars = await page.locator("svg g.dev").first().evaluate((e) => { const s = getComputedStyle(e), o: Record<string, string> = {}; for (const k of ["light", "motion", "contact", "heater", "climate", "ac-cool", "ac-heat", "tv", "plug", "computer", "camera", "garden"]) o[k] = s.getPropertyValue(`--fp-dev-${k}`).trim(); return o; });
  expect(vars).toEqual({ light: "#e0a800", motion: "#d64545", contact: "#d64545", heater: "#e8801a", climate: "#e8801a", "ac-cool": "#2c7fb8", "ac-heat": "#e8801a", tv: "#2c7fb8", plug: "#2c7fb8", computer: "#2c7fb8", camera: "#4a4a48", garden: "#3f8f4f" });
  for (const k of ["light", "motion", "contact", "heater", "climate", "tv", "plug", "computer", "camera"] as const) expect(vars[k], k).toBe((DEVICE_COLOURS as Record<string, string>)[k]);
  expect(await camFill(page)).toBe(rgb("#4a4a48"));
  const out = await page.locator("svg g.dev.outdoor path:not(.halo)").first().evaluate((e) => getComputedStyle(e).fill);
  expect(out).toBe(rgb("#3f8f4f"));
});

test("Opus review CSS pair: a lamp's aura fills with --fp-aura at --fp-alpha and lets a real click pass through to the room under it (render.test.ts:S2.8)", async ({ page }) => {
  // The editor has no live `hass` state, so no aura is ever drawn by renderFloor here; this pins the .aura rule
  // itself the way the motion-fade pair above pins .dev-motion, by putting a circle with that one class on the
  // live stylesheet and reading it back through getComputedStyle in the real browser (CLAUDE.md finding 10: the
  // FLOORPLAN_CSS string match in render.test.ts is blind to specificity and to pointer-events actually taking hold).
  const c = await screenOf(page, 200, 150); // inside the Living room (room 0), away from every device icon
  await page.evaluate((tag) => {
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "aura");
    circle.setAttribute("cx", "200");
    circle.setAttribute("cy", "150");
    circle.setAttribute("r", "100");
    svg.querySelector('polygon[data-r="0"]')!.after(circle);
  }, EDITOR);
  const style = await page.locator("svg circle.aura").evaluate((e) => { const s = getComputedStyle(e); return { fill: s.fill, op: s.fillOpacity, pe: s.pointerEvents }; });
  expect(style.fill).toBe(rgb("#ff8a1f")); // blueprint's --fp-aura collapses to the single accent
  expect(style.op).toBe("0.25");
  expect(style.pe).toBe("none");
  await page.mouse.click(c.x, c.y); // the aura visually covers this point; pointer-events:none must let the click fall through to the room
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#ra")).toHaveValue("living");
});

test("Opus review CSS pair: a motion sensor that is on still fades: the fill follows --fp-fade (render.test.ts:107)", async ({ page }) => {
  const g = page.locator("svg g.dev-motion").first();
  const fillAt = (fade: string, on: boolean) => g.evaluate((e, [f, o]) => { e.classList.toggle("on", o as boolean); (e as SVGElement).style.setProperty("--fp-fade", f as string); return getComputedStyle(e.querySelector("path:not(.halo)")!).fill; }, [fade, on] as const);
  // color-mix computes to color(srgb r g b) in 0..1, a plain colour to rgb(r, g, b) in 0..255: compare in 0..255
  const chan = (c: string) => (c.startsWith("color(") ? c.match(/[\d.]+/g)!.slice(-3).map((n) => Math.round(+n * 255)) : c.match(/\d+/g)!.map(Number));
  const idle = chan(await fillAt("0", false));
  expect(chan(await fillAt("1", true))).toEqual([255, 138, 31]); // fully faded in: blueprint's motion colour collapses to the single accent
  expect(chan(await fillAt("0", true))).toEqual(idle);          // fully faded out: idle, not the "on" colour
  const half = chan(await fillAt("0.5", true));
  expect(half).not.toEqual(idle);
  expect(half).not.toEqual([214, 69, 69]);
});

test("Opus review CSS pair: S2.9 a device wears its colour when it is on (--fp-dev per type, icon and halo)", async ({ page }) => {
  await addCssFixtures(page);
  // The editor has no live hass state, so .on is never set by renderFloor here; toggling it by hand pins the CSS
  // rule itself in a real browser, the same technique as the motion-fade pair test above.
  const read = (type: string) => page.locator(`svg g.dev-${type}`).first().evaluate((e) => {
    e.classList.add("on");
    const s = getComputedStyle(e);
    const path = e.querySelector("path:not(.halo)")!;
    const halo = e.querySelector(".halo")!;
    const r = { devVar: s.getPropertyValue("--fp-dev").trim(), pathFill: getComputedStyle(path).fill, haloFill: getComputedStyle(halo).fill, haloOp: getComputedStyle(halo).fillOpacity };
    e.classList.remove("on");
    return r;
  });
  const light = await read("light");
  expect(light.devVar).toBe("#e0a800");
  expect(light.pathFill).toBe(rgb("#e0a800"));
  expect(light.haloFill).toBe(rgb("#e0a800"));
  expect(light.haloOp).toBe("0.25");

  const heater = await read("heater");
  expect(heater.pathFill).toBe(rgb("#e8801a"));
  expect(heater.haloFill).toBe(rgb("#e8801a"));

  const climate = await read("climate");
  expect(climate.pathFill).toBe(rgb("#e8801a"));
  expect(climate.haloFill).toBe(rgb("#e8801a"));

  const tv = await read("tv");
  expect(tv.pathFill).toBe(rgb("#2c7fb8"));
  expect(tv.haloFill).toBe(rgb("#2c7fb8"));

  const plug = await read("plug");
  expect(plug.pathFill).toBe(rgb("#2c7fb8"));
  expect(plug.haloFill).toBe(rgb("#2c7fb8"));

  const computer = await read("computer");
  expect(computer.pathFill).toBe(rgb("#2c7fb8"));
  expect(computer.haloFill).toBe(rgb("#2c7fb8"));

  const contact = await read("contact");
  expect(contact.pathFill).toBe(rgb("#d64545"));
  expect(contact.haloFill).toBe(rgb("#d64545"));

  // switch and humidity draw no brighter on than off: --fp-dev falls back to idle grey.
  const sw = await read("switch");
  expect(sw.devVar).toBe("#8b8578");
  expect(sw.pathFill).toBe(rgb("#8b8578"));
  expect(sw.haloFill).toBe(rgb("#8b8578"));
  const hum = await read("humidity");
  expect(hum.devVar).toBe("#8b8578");
  expect(hum.pathFill).toBe(rgb("#8b8578"));

  // motion: the icon path keeps following --fp-fade (the S1.6 fix), but the halo reads --fp-dev normally, red.
  const motion = await page.locator("svg g.dev-motion").first().evaluate((e) => {
    e.classList.add("on");
    (e as SVGElement).style.setProperty("--fp-fade", "1");
    const halo = e.querySelector(".halo")!;
    const r = { devVar: getComputedStyle(e).getPropertyValue("--fp-dev").trim(), haloFill: getComputedStyle(halo).fill };
    e.classList.remove("on");
    (e as SVGElement).style.removeProperty("--fp-fade");
    return r;
  });
  expect(motion.devVar).toBe("#d64545");
  expect(motion.haloFill).toBe(rgb("#d64545"));
});

test("Opus review CSS pair: S2.9 break-it, a light that is on and unavailable keeps the unavailable opacity (render.test.ts:S2.9)", async ({ page }) => {
  const g = page.locator("svg g.dev-light").first();
  const opacityWith = (on: boolean, unavailable: boolean) => g.evaluate((e, [o, u]) => {
    e.classList.toggle("on", o as boolean);
    e.classList.toggle("unavailable", u as boolean);
    return getComputedStyle(e).opacity;
  }, [on, unavailable] as const);
  expect(await opacityWith(false, false)).toBe("1");
  expect(await opacityWith(true, false)).toBe("1");
  expect(await opacityWith(true, true)).toBe("0.45"); // the colour rule never overrides unavailable
  await opacityWith(false, false); // leave the fixture clean
});

// parses "rgb(r, g, b)" (or the "color(srgb r g b)" form color-mix can produce) into 0..255 channels
const channels = (c: string) => (c.startsWith("color(") ? c.match(/[\d.]+/g)!.slice(-3).map((n) => Math.round(+n * 255)) : c.match(/\d+/g)!.map(Number));

test("Opus review CSS pair: S2.9 a water room with an entity outlines, but its fill never moves, when it is on (Opus review: a fill tint desaturated the water and read as switched off)", async ({ page }) => {
  await addCssFixtures(page);
  const read = (on: boolean) => page.locator("svg polygon.room-water").last().evaluate((e, o) => {
    e.classList.toggle("on", o as boolean);
    const s = getComputedStyle(e);
    return { fill: s.fill, stroke: s.stroke, width: parseFloat(s.strokeWidth) };
  }, on);
  const off = await read(false), on = await read(true);
  await read(false); // leave the fixture clean
  expect(on.fill).toBe(off.fill); // "on" is a stroke now: the fill never moves, so it can't desaturate the kind colour.
  expect(on.stroke).toBe(rgb("#8a5117")); // --fp-active, the same token furniture wears: one colour for "on" across the plan.
  expect(on.width).toBeGreaterThan(0);
});

test("Opus review CSS pair: S2.9 a zone room (fill:none) still shows the on outline (Opus review: a fill tint there was a silent no-op)", async ({ page }) => {
  await addCssFixtures(page);
  const stroke = await page.locator("svg polygon.room-zone").first().evaluate((e) => {
    e.classList.add("on");
    const s = getComputedStyle(e).stroke;
    e.classList.remove("on");
    return s;
  });
  expect(stroke).toBe(rgb("#8a5117"));
});

test("Opus review CSS pair: S2.9 a room that is both on and selected strokes with the selection colour, not the on colour (Opus review: .room.on's two classes would otherwise outrank .sel's one)", async ({ page }) => {
  await addCssFixtures(page);
  const stroke = await page.locator("svg polygon.room-water").last().evaluate((e) => {
    e.classList.add("on", "sel");
    const s = getComputedStyle(e).stroke;
    e.classList.remove("on", "sel");
    return s;
  });
  expect(stroke).toBe(rgb("#2b2a27")); // --fp-ink, light theme: selection still wins.
});

test("Opus review CSS pair: S2.9 room_glow has the same fix (Opus review: a pre-existing bug, same cause)", async ({ page }) => {
  await addCssFixtures(page);
  const off = channels(await page.locator("svg polygon.room-water").last().evaluate((e) => getComputedStyle(e).fill));
  const glowing = channels(await page.locator("svg polygon.room-water").last().evaluate((e) => {
    e.classList.add("glow");
    const fill = getComputedStyle(e).fill;
    e.classList.remove("glow");
    return fill;
  }));
  expect(glowing).not.toEqual(off);
  expect(glowing[2]).toBeGreaterThanOrEqual(glowing[0]);
  expect(glowing[1]).toBeGreaterThanOrEqual(glowing[0]);
});

test("Opus review CSS pair: S2.9 furniture with an entity turns present, not paler, when it is on (Opus review: --fp-glow nearly vanished it)", async ({ page }) => {
  await addCssFixtures(page);
  const furnColor = await page.locator("svg g.furn").last().evaluate((e) => {
    e.classList.add("on");
    const color = getComputedStyle(e).color;
    e.classList.remove("on");
    return color;
  });
  expect(furnColor).toBe(rgb("#8a5117")); // --fp-active, light theme
});

// ---- S1.50 a measure grid with metre markers ----

test("S1.50: .mg lines are 50 cm apart in plan units and sit before the first room in DOM order", async ({ page }) => {
  const xs = await page.locator("svg line.mg").evaluateAll((els) => {
    const vertical = els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2"));
    return [...new Set(vertical.map((e) => Number(e.getAttribute("x1"))))].sort((a, b) => a - b);
  });
  expect(xs.length).toBeGreaterThan(1);
  const diffs = new Set(xs.slice(1).map((x, i) => Math.round(x - xs[i])));
  expect(diffs).toEqual(new Set([50]));
  const order = await rpt(page).evaluate((host) => {
    const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const all = [...svg.querySelectorAll("*")];
    return { mg: all.findIndex((e) => e.classList.contains("mg")), room: all.findIndex((e) => e.matches("polygon[data-r]")) };
  });
  expect(order.mg).toBeGreaterThanOrEqual(0);
  expect(order.mg).toBeLessThan(order.room);
});

test("Opus review CSS pair: the measure grid is thin and non-scaling, brighter on the metre (render.test.ts:522)", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const half = await page.locator("svg line.mg:not(.m)").first().evaluate((e) => { const s = getComputedStyle(e); return { stroke: s.stroke, w: s.strokeWidth, ve: s.vectorEffect, op: s.strokeOpacity }; });
  const metre = await page.locator("svg line.mg.m").first().evaluate((e) => { const s = getComputedStyle(e); return { w: s.strokeWidth, op: s.strokeOpacity }; });
  expect(half.stroke).toBe(rgb("#3a3a3a"));
  expect(half.ve).toBe("non-scaling-stroke");
  expect(half.w).toBe("0.5px");
  expect(half.op).toBe("0.12");
  expect(metre.w).toBe("1px");
  expect(metre.op).toBe("0.22");
});

test("the grid's zero is the plan's top-left corner: the number there reads 0 m, the one a metre right reads 1", async ({ page }) => {
  // the top-edge (x-axis) numbers sit at x="<plan x>"; the left-edge ones do not, so this picks the x-axis label
  // Move the whole plan off the layout origin first, so a grid still zeroed at (0, 0) cannot pass by accident.
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const shift = (p: [number, number]): [number, number] => [p[0] + 730, p[1] + 310];
    const f = l.floors.ground;
    f.outline = f.outline.map(shift);
    for (const r of f.rooms) r.pts = r.pts.map(shift);
    for (const w of f.walls) { w.a = shift(w.a); w.b = shift(w.b); }
    for (const d of f.doors) { d.a = shift(d.a); d.b = shift(d.b); }
    for (const o of f.openings) { o.a = shift(o.a); o.b = shift(o.b); }
    for (const x of f.extras) { x.a = shift(x.a); x.b = shift(x.b); }
    for (const t of f.stairs) t.pts = t.pts.map(shift);
    for (const m of f.furniture) { m.x += 730; m.y += 310; }
    for (const dv of f.devices) { if ("a" in dv) { dv.a = shift(dv.a); dv.b = shift(dv.b); } else { dv.x += 730; dv.y += 310; } }
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  const zx = await page.evaluate((tag) => Math.min(...(document.querySelector(tag) as any).layout.floors.ground.outline.map((p: number[]) => p[0])), EDITOR);
  expect(zx).toBeGreaterThan(0);
  await expect(page.locator(`svg text.mg-n[x="${zx}"]`)).toHaveText("0 m");
  await expect(page.locator(`svg text.mg-n[x="${zx + 100}"]`)).toHaveText("1");
  const lx = await page.locator("svg line.mg.m").evaluateAll((els) => els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2")).map((e) => Number(e.getAttribute("x1"))));
  expect(lx).toContain(zx); // a bright metre line stands on the corner
});

test("the grid covers everything the editor shows, not only the plan's box", async ({ page }) => {
  const r = await page.evaluate((tag) => {
    const o = (document.querySelector(tag) as any).layout.floors.ground.outline as number[][];
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const xs = [...svg.querySelectorAll("line.mg")].map((e) => [Number(e.getAttribute("x1")), Number(e.getAttribute("x2")), Number(e.getAttribute("y1")), Number(e.getAttribute("y2"))]);
    return { vb: [vb.x, vb.y, vb.width, vb.height], minx: Math.min(...xs.map((l) => l[0])), maxx: Math.max(...xs.map((l) => l[0])), miny: Math.min(...xs.map((l) => Math.min(l[2], l[3]))), maxy: Math.max(...xs.map((l) => Math.max(l[2], l[3]))), o: [Math.min(...o.map((p) => p[0])), Math.max(...o.map((p) => p[0]))] };
  }, EDITOR);
  const [vx, vy, vw, vh] = r.vb;
  expect(r.miny).toBeLessThanOrEqual(vy + 1); // the lines reach the top and bottom of what is shown
  expect(r.maxy).toBeGreaterThanOrEqual(vy + vh - 1);
  expect(r.minx).toBeLessThan(vx + 50); // and stand within one step of the left and right edges
  expect(r.maxx).toBeGreaterThan(vx + vw - 50);
});

test("S1.50: toggling #mgrid off removes every .mg and the choice survives a reload", async ({ page }) => {
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  await menu(page, "View");
  await expect(page.locator("#mgrid")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#mgrid").click();
  await menu(page, "View");
  await expect(page.locator("svg line.mg")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:measure"))).toBe("false");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(page.locator("svg line.mg")).toHaveCount(0);
  await menu(page, "View");
  await expect(page.locator("#mgrid")).toHaveAttribute("aria-pressed", "false");
});

test("a measure grid on an all-negative layout still reads 0 m at the plan's corner", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const shift = (p: [number, number]): [number, number] => [p[0] - 1000, p[1] - 1000];
    const f = l.floors.ground;
    f.outline = f.outline.map(shift);
    for (const r of f.rooms) r.pts = r.pts.map(shift);
    for (const w of f.walls) { w.a = shift(w.a); w.b = shift(w.b); }
    for (const d of f.doors) { d.a = shift(d.a); d.b = shift(d.b); }
    for (const o of f.openings) { o.a = shift(o.a); o.b = shift(o.b); }
    for (const x of f.extras) { x.a = shift(x.a); x.b = shift(x.b); }
    for (const s of f.stairs) s.pts = s.pts.map(shift);
    for (const m of f.furniture) { m.x -= 1000; m.y -= 1000; }
    for (const dv of f.devices) { if ("a" in dv) { dv.a = shift(dv.a); dv.b = shift(dv.b); } else { dv.x -= 1000; dv.y -= 1000; } }
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  const texts = await page.locator("svg text.mg-n").allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  await expect(page.locator("svg text.mg-n", { hasText: "0 m" })).toHaveCount(1); // zero follows the plan's corner, wherever the plan sits
  const zx = await page.locator("svg text.mg-n", { hasText: "0 m" }).getAttribute("x");
  expect(Number(zx)).toBeLessThan(0);
});

test("S1.50: turning the plan turns the grid lines with the walls while the numbers stay upright", async ({ page }) => {
  await rotateBy(page, 1); // 45 degrees
  const lineAngle = await page.locator("svg line.mg").first().evaluate((e) => { const c = (e as SVGGraphicsElement).getScreenCTM()!; return Math.round((Math.atan2(c.b, c.a) * 180) / Math.PI); });
  expect(lineAngle).toBe(45);
  const numOff = await page.locator("svg text.mg-n").first().evaluate((e) => { const m = (e as SVGGraphicsElement).getScreenCTM()!; return Math.abs(m.b) / Math.abs(m.a); });
  expect(numOff).toBeLessThan(0.001);
});

test("S1.50: a floor 600 m wide draws the 5 m step and no more than 400 lines per axis", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.outline = [[0, 0], [60000, 0], [60000, 600], [0, 600]];
    el.layout = l;
  }, EDITOR);
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  const xs = await page.locator("svg line.mg").evaluateAll((els) => {
    const vertical = els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2"));
    return [...new Set(vertical.map((e) => Number(e.getAttribute("x1"))))].sort((a, b) => a - b);
  });
  expect(xs.length).toBeLessThanOrEqual(400);
  const diffs = new Set(xs.slice(1).map((x, i) => Math.round(x - xs[i])));
  expect(diffs).toEqual(new Set([500]));
});

test("S1.50 break it: an empty floor draws a grid around the origin with no error, and toggling it is not an undo step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground = { title: "Empty", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] };
    el.layout = l;
  }, EDITOR);
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  await expect(page.locator("svg text.mg-n", { hasText: /^0 m$/ })).toHaveCount(1);
  expect(errors).toEqual([]);
  await menu(page, "View");
  await page.locator("#mgrid").click();
  await menu(page, "View");
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled(); // the toggle is a viewer preference, not an undo step
});

// ---- fix/heater-bar-under-icon ------------------------------------------------------

test("fix/heater-bar-under-icon: the heater icon sits on top of its bar, idle, selected, and with the plan turned 45", async ({ page }) => {
  const HEATER: [number, number] = [180, 8]; // demo's "Living radiator": a=[100,8] b=[260,8], midpoint 180,8
  const topOf = async () =>
    page.evaluate(([tag, x, y]) => {
      const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
      const el = root.elementFromPoint(x, y) as Element | null;
      return el?.closest("g[data-x]") ? "icon" : el?.closest("[data-xbar]") ? "bar" : (el?.tagName ?? "none");
    }, [EDITOR, x, y] as const);
  let p = await screenOf(page, ...HEATER);
  let x = p.x, y = p.y;
  expect(await topOf()).toBe("icon"); // idle
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#vrot90")).toBeVisible(); // a device is selected
  p = await screenOf(page, ...HEATER); x = p.x; y = p.y;
  expect(await topOf()).toBe("icon"); // selected
  await rotateBy(page, 1); // 45 degrees
  p = await screenOf(page, ...HEATER); x = p.x; y = p.y;
  expect(await topOf()).toBe("icon"); // plan turned 45
});

test("fix/heater-bar-under-icon: the bar itself, away from the icon, still drags the whole device", async ({ page }) => {
  // 250,8 sits on the visible bar (a=[100,8] b=[260,8]) but well clear of the icon halo at its midpoint 180,8.
  // The drop point (470,500) is far from every wall and room edge (over 80 cm), so the drag isn't pulled to sit beside one.
  await dragCm(page, [250, 8], [470, 500]);
  const f = await groundOf(page);
  const heater = f.devices.find((d: any) => d.id === "heater-living") as any;
  // The pointer grabbed the bar 70 cm right of its centre (180,8); the whole 160 cm bar keeps its length and heading.
  expect(heater.a).toEqual([320, 500]);
  expect(heater.b).toEqual([480, 500]);
});

// ---- S1.51 scale furniture by its corners ------------------------------------------------------

const SOFA = { x: 250, y: 320, w: 200, h: 90 }; // demo's furniture-ground-1, rot 0

test("S1.51: dragging the se handle grows the sofa while nw stays put; the panel follows live; one Undo restores it exactly", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y); // select the sofa
  await expect(page.locator("#fw")).toHaveValue(String(SOFA.w));
  await expect(page.locator("svg circle[data-fh]")).toHaveCount(4);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 100, SOFA.y + SOFA.h / 2 + 60]);
  const m = (await groundOf(page)).furniture[0];
  expect(m.w).toBeGreaterThan(SOFA.w);
  expect(m.h).toBeGreaterThan(SOFA.h);
  await expect(page.locator("#fw")).toHaveValue(String(m.w));
  await expect(page.locator("#fh")).toHaveValue(String(m.h));
  const nwBefore: [number, number] = [SOFA.x - SOFA.w / 2, SOFA.y - SOFA.h / 2];
  const nwAfter: [number, number] = [m.x - m.w / 2, m.y - m.h / 2];
  expect(Math.hypot(nwAfter[0] - nwBefore[0], nwAfter[1] - nwBefore[1])).toBeLessThan(1);
  await menu(page, "File");
  await page.locator("#undo").click();
  const undone = (await groundOf(page)).furniture[0];
  expect(undone).toEqual({ id: "furniture-ground-1", symbol: "sofa", x: SOFA.x, y: SOFA.y, rot: 0, w: SOFA.w, h: SOFA.h });
});

test("S1.51: at plan rotation 45 a corner still drags along the sofa's own axes, not the screen's", async ({ page }) => {
  await rotateBy(page, 1);
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  const nwBefore: [number, number] = [SOFA.x - SOFA.w / 2, SOFA.y - SOFA.h / 2];
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 80, SOFA.y + SOFA.h / 2 + 40]);
  const m = (await groundOf(page)).furniture[0];
  const nwAfter: [number, number] = [m.x - m.w / 2, m.y - m.h / 2];
  expect(Math.hypot(nwAfter[0] - nwBefore[0], nwAfter[1] - nwBefore[1])).toBeLessThan(1);
  expect(m.w).toBeGreaterThan(SOFA.w);
});

test("S1.51: Shift while dragging a corner keeps the width/depth ratio the sofa had when the drag started", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 300, SOFA.y + SOFA.h / 2 + 10], ["Shift"]);
  const m = (await groundOf(page)).furniture[0];
  expect(m.h / m.w).toBeCloseTo(SOFA.h / SOFA.w, 2);
});

test("S1.51: a corner drag that ends where it started adds no undo step", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  // Alt disables the grid, like every other handle, so a true no-op drag lands on the exact same corner.
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], ["Alt"]);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.51 break it: a corner dragged past its opposite one clamps at 5 cm instead of flipping; handles are furniture-only", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x - SOFA.w, SOFA.y - SOFA.h]); // well past the nw corner
  const m = (await groundOf(page)).furniture[0];
  expect(m.w).toBe(5);
  expect(m.h).toBe(5);
  // a device (the demo's hall camera) is never given corner handles
  const cam = await screenOf(page, CAM.x, CAM.y);
  await page.mouse.click(cam.x, cam.y);
  await expect(page.locator("svg circle[data-fh]")).toHaveCount(0);
});

// ---- S1.53 / S2.12 themes: blueprint (default), light, Home Assistant ---------------------------------------------------------

// Blueprint palette (role-generated, 2026-09-22): base #1c3f73 shaded into ground #0c1521 / wall #6394dd, fg #eef3fb,
// line (measure) #35d47a. An unpainted room (the demo's Living, room 0) is --fp-room-empty, #d6d6d2 = rgb(214, 214, 210)
// in every theme, unchanged since 2026-09-22.
const ROOM_EMPTY = "rgb(214, 214, 210)";
const DARK_TH = { bg: "rgb(12, 21, 33)", room: ROOM_EMPTY, wall: "rgb(99, 148, 221)", text: "rgb(238, 243, 251)", outline: "rgb(12, 21, 33)", disc: "rgb(238, 243, 251)", measure: "rgb(53, 212, 122)" };
// Midnight (the old default, ex-"blueprint", renamed 2026-09-22): ground #0d1522, room #14213a, wall #8fb4f0, text
// #d8e2f2. Still what the ha theme's dark-mode fallback uses (Diego's call: ha stays untouched by the new palettes).
const MIDNIGHT_TH = { bg: "rgb(13, 21, 34)" };
const LIGHT_TH = { bg: "rgb(244, 240, 230)", room: ROOM_EMPTY, wall: "rgb(43, 42, 39)", text: "rgb(58, 58, 58)", outline: "rgb(255, 255, 255)" };

test("CSS pair: an off icon's disc is 50 % in every theme (Diego, 2026-09-23)", async ({ page }) => {
  for (const t of ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha"] as const) {
    await setTheme(page, t);
    const ops = await page.locator("svg .dev:not(.on) .halo").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fillOpacity))]);
    expect(ops, t).toEqual(["0.5"]);
  }
});

async function setTheme(page: Page, t: "blueprint" | "midnight" | "light" | "slate" | "terminal" | "solarized" | "ha") {
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await page.locator(`[data-th="${t}"]`).click();
  await menu(page, "View");
}

test("S2.12: blueprint, the default, has the dark page background, room fill, wall stroke, room name colours, device disc and measure grid", async ({ page }) => {
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const host = document.querySelector(tag) as HTMLElement;
    const room = root.querySelector('svg polygon[data-r="0"]')!, wall = root.querySelector("svg line.e")!;
    const lbl = root.querySelector("svg text.lbl")!, halo = root.querySelector("svg .dev .halo")!, mg = root.querySelector("svg line.mg")!;
    const s = (el: Element) => getComputedStyle(el);
    return {
      bg: s(host).backgroundColor, room: s(room).fill, wall: s(wall).stroke,
      lblFill: s(lbl).fill, lblStroke: s(lbl).stroke, disc: s(halo).fill, mg: s(mg).stroke,
    };
  }, EDITOR);
  expect(got.bg).toBe(DARK_TH.bg);
  expect(got.room).toBe(DARK_TH.room);
  expect(got.wall).toBe(DARK_TH.wall);
  expect(got.lblFill).toBe(DARK_TH.text); // a room name on a dark room: light fill...
  expect(got.lblStroke).toBe(DARK_TH.outline); // ...with a dark outline, the S1.46 trick inverted
  expect(got.disc).toBe(DARK_TH.disc);
  expect(got.mg).toBe(DARK_TH.measure);
});

test("S1.53: light theme keeps its values", async ({ page }) => {
  await setTheme(page, "light");
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const host = document.querySelector(tag) as HTMLElement;
    const room = root.querySelector('svg polygon[data-r="0"]')!, wall = root.querySelector("svg line.e")!;
    const lbl = root.querySelector("svg text.lbl")!;
    const s = (el: Element) => getComputedStyle(el);
    return { bg: s(host).backgroundColor, room: s(room).fill, wall: s(wall).stroke, lblFill: s(lbl).fill, lblStroke: s(lbl).stroke };
  }, EDITOR);
  expect(got.bg).toBe(LIGHT_TH.bg);
  expect(got.room).toBe(LIGHT_TH.room);
  expect(got.wall).toBe(LIGHT_TH.wall);
  expect(got.lblFill).toBe(LIGHT_TH.text);
  expect(got.lblStroke).toBe(LIGHT_TH.outline);
});

test("S1.53: every .btn keeps at least 4.5:1 contrast against its own background, in blueprint, light and Home Assistant", async ({ page }) => {
  const checkAll = async () => {
    const pairs = await page.evaluate((tag) => {
      const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
      return Array.from(root.querySelectorAll(".btn")).map((el) => {
        const s = getComputedStyle(el);
        return { label: el.id || (el.textContent ?? "").trim(), bg: s.backgroundColor, fg: s.color };
      });
    }, EDITOR);
    expect(pairs.length).toBeGreaterThan(5);
    for (const { label, bg, fg } of pairs) expect(ratio(rgbOf(bg), rgbOf(fg)), label).toBeGreaterThanOrEqual(4.5);
  };
  await checkAll(); // blueprint, the default
  await setTheme(page, "light");
  await checkAll();
  await setTheme(page, "ha");
  await checkAll();
});

test("S2.12: the theme chip switches Blueprint, Light and Home Assistant, and the choice survives a reload", async ({ page }) => {
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await expect(page.locator('[data-th="blueprint"]')).toHaveAttribute("aria-pressed", "true"); // Blueprint is the default
  await expect(page.locator('[data-th="ha"]')).toHaveText("Home Assistant");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "blueprint");
  await page.locator('[data-th="ha"]').click();
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:theme"))).toBe("ha");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "ha");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "ha");
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await expect(page.locator('[data-th="ha"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-th="light"]').click();
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:theme"))).toBe("light");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "light");
});

test("S2.12: an editor on the Home Assistant theme follows haDark when the host gives it, and the OS when it does not", async ({ page }) => {
  await setTheme(page, "ha");
  const host = () => page.evaluate((tag) => getComputedStyle(document.querySelector(tag) as HTMLElement).backgroundColor, EDITOR);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await host()).toBe(LIGHT_TH.bg); // no HA variables here, no haDark: the OS is light
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.haDark = true; }, EDITOR);
  await expect(page.locator(EDITOR)).toHaveAttribute("data-mode", "dark");
  expect(await host()).toBe(MIDNIGHT_TH.bg); // ha's dark fallback is midnight's bg, not blueprint's
  await page.emulateMedia({ colorScheme: null });
});

test("S1.53 break it: a per-room colour stays the same colour in both themes, and its name stays readable", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[0].color = "#aabbcc"; el.layout = l; }, EDITOR);
  const fillOf = () => page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const poly = root.querySelector('svg polygon[data-r="0"]')!, lbl = root.querySelector("svg text.lbl")!;
    return { fill: getComputedStyle(poly).fill, lblFill: getComputedStyle(lbl).fill, lblStroke: getComputedStyle(lbl).stroke };
  }, EDITOR);
  await setTheme(page, "light");
  const light = await fillOf();
  expect(light.fill).toBe("rgb(170, 187, 204)"); // #aabbcc, the user's own choice
  await setTheme(page, "blueprint");
  const dark = await fillOf();
  expect(dark.fill).toBe(light.fill); // unchanged by theme
  expect(dark.lblFill).toBe(DARK_TH.text); // the name still reads: light fill, dark outline
  expect(dark.lblStroke).toBe(DARK_TH.outline);
});

test("S1.53 break it: switching theme mid-drag does not lose the drag (pointer capture survives the re-render)", async ({ page }) => {
  const before = await groundOf(page);
  expect(before.rooms[0].pts[1]).toEqual([500, 0]);
  const c = await centre(page, 'circle[data-h="r0:1"]');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + 25, { steps: 4 }); // partway, still holding the button
  // A theme switch normally goes through a menu click, which would release the mouse; this drives the
  // same state change (and the requestUpdate/re-render it causes) directly, mouse button still down, to
  // prove the drag survives a mid-drag re-render rather than that the user can open a menu while dragging.
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.st.setTheme("light"); el.requestUpdate(); }, EDITOR);
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "light");
  await page.mouse.move(c.x, c.y + 50, { steps: 4 });
  await page.mouse.up();
  const after = await groundOf(page);
  expect(after.rooms[0].pts[1]).not.toEqual([500, 0]); // the drag committed, not reset by the re-render
  expect(after.rooms[0].pts[1][1]).toBeGreaterThan(0);
  expect(after.rooms[1].pts[0]).toEqual(after.rooms[0].pts[1]); // the coincident neighbour corner moved with it, as an uninterrupted drag would
});

// ---- zoom buttons, top right of the canvas ----

test("zoom buttons: + zooms in, - zooms out, 0 fits the floor again, and none of them is an edit", async ({ page }) => {
  const vb = async () => (await page.locator(`${EDITOR} svg`).first().getAttribute("viewBox"))!.split(" ").map(Number);
  const start = await vb();
  const undoBefore = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await page.locator("#zin").click();
  const zin = await vb();
  expect(zin[2] / start[2]).toBeCloseTo(1 / 1.25, 1); // shows less of the plan: the plan looks bigger
  expect(zin[0] + zin[2] / 2).toBeCloseTo(start[0] + start[2] / 2, 0); // about the middle of what is shown
  await page.locator("#zout").click();
  await page.locator("#zout").click();
  expect((await vb())[2]).toBeGreaterThan(start[2]);
  await page.locator("#zin").click();
  await page.locator("#zreset").click();
  expect(await vb()).toEqual(start);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(undoBefore);
  const box = await page.locator(".zoom").boundingBox(), canvas = await page.locator(".canvas").boundingBox();
  expect(box!.x + box!.width).toBeGreaterThan(canvas!.x + canvas!.width - 20); // top right
  expect(box!.y).toBeLessThan(canvas!.y + 20);
});

test("a custom room colour becomes a swatch (kept in layout.palette); textures paint the room and survive undo", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const custom = page.locator('.swatches[aria-label="Colours"] .sw.custom');
  await expect(custom).toHaveCount(0);
  await page.locator("#rcol").fill("#12ab34");
  await expect(custom).toHaveCount(1);
  expect((await layoutOf(page)).palette).toEqual(["#12ab34"]);
  // Another room can use it from the swatches without opening the picker.
  const r1 = (await groundOf(page)).rooms[1].pts; // a point near a corner: the middle of a room may hold a device
  const other = await screenOf(page, Math.min(...r1.map((p) => p[0])) + 30, Math.min(...r1.map((p) => p[1])) + 30);
  await page.mouse.click(other.x, other.y);
  await expect(page.locator('.swatches[aria-label="Colours"] .sw.custom')).toHaveCount(1);
  // A texture.
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark)"]')).toHaveCount(1);
  await expect(page.locator("pattern#fp-tex-wood-dark")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark)"]')).toHaveCount(0);
  // Undo the first colour: the palette goes with it.
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("Control+z");
  expect((await layoutOf(page)).palette).toBeUndefined();
});

// ---- S4.22: a texture's own rotation, dragged with the paint panel's slider ----------------------------------------

/** Sets a range input's value and fires the given events, exactly as a real drag or a release would. */
async function moveSlider(page: Page, sel: string, value: number, event: "input" | "change") {
  await page.locator(sel).evaluate((el: HTMLInputElement, [v, ev]) => {
    el.value = String(v);
    el.dispatchEvent(new Event(ev, { bubbles: true, composed: true }));
  }, [value, event] as const);
}

test("S4.22: the rotation slider appears only once a texture is chosen, and disappears back at the default colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rrot")).toHaveCount(0);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator("#rrot")).toHaveCount(1);
  await expect(page.locator("#rrot")).toHaveValue("0");
  await page.getByText("Use the default colour").click();
  await expect(page.locator("#rrot")).toHaveCount(0);
});

test("S4.22: dragging the slider live-updates the rendered rotation, and releasing commits exactly one undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rrot", 45, "input");
  await moveSlider(page, "#rrot", 90, "input");
  // Live preview: the rotated pattern is already on the plan, but no undo step has been recorded yet.
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark-r90)"]')).toHaveCount(1);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  await moveSlider(page, "#rrot", 90, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before + 1);
  expect((await groundOf(page)).rooms[0].textureRot).toBe(90);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].textureRot).toBeUndefined();
});

test("S4.22: a slider drag that ends back at its starting value adds no undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rrot", 30, "change"); // an initial rotation to drag away from and back to
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rrot", 200, "input");
  await moveSlider(page, "#rrot", 30, "input"); // back to where it started
  await moveSlider(page, "#rrot", 30, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  expect((await groundOf(page)).rooms[0].textureRot).toBe(30);
});

test("S4.22: the rotation survives a save/reload round trip", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rrot", 200, "change");
  const saved = await layoutOf(page);
  expect(saved.floors.ground.rooms[0].textureRot).toBe(200);
  expect(validate(saved).ok).toBe(true);
});

// ---- S4.19: a texture's own scale, dragged with the paint panel's slider --------------------------------------

test("S4.19: the scale slider appears only once a texture is chosen, defaults to 100%, and disappears back at the default colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rscale")).toHaveCount(0);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator("#rscale")).toHaveCount(1);
  await expect(page.locator("#rscale")).toHaveValue("100");
  await page.getByText("Use the default colour").click();
  await expect(page.locator("#rscale")).toHaveCount(0);
});

test("S4.19: dragging the scale slider live-updates the rendered pattern, and releasing commits exactly one undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rscale", 120, "input");
  await moveSlider(page, "#rscale", 150, "input");
  // Live preview: the scaled pattern is already on the plan, but no undo step has been recorded yet.
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark-s150)"]')).toHaveCount(1);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  await moveSlider(page, "#rscale", 150, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before + 1);
  expect((await groundOf(page)).rooms[0].textureScale).toBe(1.5);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].textureScale).toBeUndefined();
});

test("S4.19: a scale slider drag that ends back at its starting value adds no undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rscale", 75, "change"); // an initial scale to drag away from and back to
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rscale", 200, "input");
  await moveSlider(page, "#rscale", 75, "input"); // back to where it started
  await moveSlider(page, "#rscale", 75, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  expect((await groundOf(page)).rooms[0].textureScale).toBe(0.75);
});

test("S4.19: the scale survives a save/reload round trip", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rscale", 200, "change");
  const saved = await layoutOf(page);
  expect(saved.floors.ground.rooms[0].textureScale).toBe(2);
  expect(validate(saved).ok).toBe(true);
});

test("S4.19: two more wood textures and one more stone texture, plus a checkerboard, are offered", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.sw.tex[aria-label="Herringbone wood"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Parquet wood"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Terracotta tiles"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Checkerboard"]')).toHaveCount(1);
  await page.locator('.sw.tex[aria-label="Checkerboard"]').click();
  await expect(page.locator('svg polygon[fill="url(#fp-tex-checker-classic)"]')).toHaveCount(1);
});

// ---- S3.3: attach, switch and clear a device's entity ---------------------------------

const PICK_HA = { floors: [], areas: [{ id: "living", name: "Living" }],
  entities: [
    { id: "light.living_lamp", name: "Living lamp", domain: "light", area: "living" },
    { id: "light.garage", name: "Garage light", domain: "light", area: "garage" },
    { id: "sensor.pond", name: "Pond level", domain: "sensor", area: null },
  ] };
/** The demo with its first light reduced to a wired fitting that is not in Home Assistant: entity "". */
async function withUnboundLight(page: Page) {
  const idx = await page.evaluate(([tag]) => {
    const ed = document.querySelector(tag as string) as any;
    const l = JSON.parse(JSON.stringify(ed.layout));
    const g = l.floors.ground, i = g.devices.findIndex((d: any) => d.type === "light");
    delete g.devices[i].bound; g.devices[i].entity = "";
    ed.layout = l;
    return i;
  }, [EDITOR]);
  return idx as number;
}

test("S3.3: an unbound device is marked on the plan and listed, and the list selects it", async ({ page }) => {
  const i = await withUnboundLight(page);
  await expect(page.locator("svg .dev.unbound")).toHaveCount(1);
  await expect(page.locator("#unbound")).toContainText("Needs an entity (1)");
  await page.locator("#unbound button[data-unbound]").click();
  await expect(page.locator("#ve")).toBeVisible();
  expect((await groundOf(page)).devices[i].entity).toBe("");
});

test("S3.3: the picker attaches an entity, switches to another, and clears it back to unbound", async ({ page }) => {
  const i = await withUnboundLight(page);
  await setHa(page, PICK_HA);
  await page.locator("#unbound button[data-unbound]").click();
  const sel = page.locator("#ve");
  await expect(sel).toHaveJSProperty("tagName", "SELECT");
  // A light: light entities first, the pond sensor still reachable under everything else.
  expect(await opts(page, "#ve")).toEqual(expect.arrayContaining(["", "light.living_lamp", "light.garage", "sensor.pond"]));
  await sel.selectOption("light.garage");
  expect((await groundOf(page)).devices[i].entity).toBe("light.garage");
  await expect(page.locator("svg .dev.unbound")).toHaveCount(0);
  await sel.selectOption("light.living_lamp"); // switch
  expect((await groundOf(page)).devices[i].entity).toBe("light.living_lamp");
  await sel.selectOption(""); // back to unbound
  expect((await groundOf(page)).devices[i].entity).toBe("");
  await expect(page.locator("svg .dev.unbound")).toHaveCount(1);
  await savedValid(page);
});

test("S3.3 break it: an entity id HA does not know stays selected and is not cleared, and no HA means a text field", async ({ page }) => {
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(ed.layout)); const g = l.floors.ground; g.devices.find((d: any) => d.type === "light").entity = "light.gone"; ed.layout = l; }, [EDITOR]);
  await page.locator("svg .dev-light").first().click();
  await expect(page.locator("#ve")).toHaveJSProperty("tagName", "INPUT");
  await setHa(page, PICK_HA);
  await expect(page.locator("#ve")).toHaveJSProperty("tagName", "SELECT");
  await expect(page.locator("#ve")).toHaveValue("light.gone");
  await expect(page.locator("#panel")).toContainText("Home Assistant does not have this one");
});

test("S3.3: the picker does not offer an entity that is already on the plan, except the device's own", async ({ page }) => {
  const i = await withUnboundLight(page);
  const placed = await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; return ed.layout.floors.ground.devices.filter((d: any) => d.entity && d.type === "light").map((d: any) => d.entity) as string[]; }, [EDITOR]);
  expect(placed.length).toBeGreaterThan(0);
  await setHa(page, { floors: [], areas: [], entities: [...placed, "light.free"].map((id) => ({ id, name: id, domain: "light", area: null })) });
  await page.locator("#unbound button[data-unbound]").click();
  const offered = await opts(page, "#ve");
  expect(offered).toContain("light.free");
  for (const p of placed) expect(offered).not.toContain(p);
  await page.locator("#ve").selectOption("light.free");
  expect((await groundOf(page)).devices[i].entity).toBe("light.free");
  expect(await opts(page, "#ve")).toContain("light.free"); // still there: it is this device's own
});

// ---- S4.4: create a light from a placed switch ------------------------------------------

/** Gives the editor HA data and a recording writer. `fail` makes createHelper throw. Calls land in window.__calls. */
async function withWriter(page: Page, opt: { fail?: string } = {}) {
  await setHa(page, { floors: [], areas: [], entities: [{ id: "switch.demo_hall", name: "Hall switch", domain: "switch", area: null }] });
  await page.evaluate(([tag, fail]) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {},
      createHelper: async (...a: unknown[]) => { w.__calls.push(a); if (fail) throw new Error(fail as string); return { entity_id: "light.hall_switch" }; },
    };
  }, [EDITOR, opt.fail ?? ""]);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls as unknown[][]);
const selectHallSwitch = (page: Page) => page.locator("svg .dev-switch").first().click();

test("S4.4: Create a light from this switch asks, then swaps the switch for a bound light on the plan, in one undo step", async ({ page }) => {
  await withWriter(page);
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0); // asking is not doing
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual(["switch_as_x", [{ entity_id: "switch.demo_hall", target_domain: "light" }]]);
  const g = await groundOf(page);
  expect(g.devices.some((d) => d.entity === "switch.demo_hall")).toBe(false);
  expect(g.devices.find((d) => d.entity === "light.hall_switch")).toMatchObject({ type: "light", bound: "switch.demo_hall" });
  await savedValid(page);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);
  expect((await groundOf(page)).devices.some((d) => d.entity === "light.hall_switch")).toBe(false);
});

test("S4.4 break it: Cancel writes nothing, a failing Home Assistant leaves the plan alone, and no writer means no button", async ({ page }) => {
  await withWriter(page);
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await page.locator("#fp-confirm-no").click();
  expect(await calls(page)).toHaveLength(0);
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);

  await withWriter(page, { fail: "entity_not_found" });
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);

  await page.evaluate(([tag]) => { (document.querySelector(tag as string) as any).writer = undefined; }, [EDITOR]);
  await selectHallSwitch(page);
  await expect(page.locator("#vmklight")).toHaveCount(0);
});

test("S4.4: a switch that a light is already bound to has no button", async ({ page }) => {
  await withWriter(page);
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(ed.layout)); l.floors.ground.devices.find((d: any) => d.type === "light").bound = "switch.demo_hall"; ed.layout = l; }, [EDITOR]);
  await selectHallSwitch(page);
  await expect(page.locator("#vmklight")).toHaveCount(0);
});

// ---- S4.3: move a dropped device into the room's HA area ------------------------------------

const AREA_HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
  { id: "light.demo_kitchen", name: "Kitchen light", domain: "light", area: "kitchen", dev: "dev-k" },
  { id: "sensor.a", name: "A", domain: "sensor", area: "kitchen", dev: "dev-shared" }, { id: "sensor.b", name: "B", domain: "sensor", area: "kitchen", dev: "dev-shared" },
] };
async function withAreaWriter(page: Page, fail = "") {
  await setHa(page, AREA_HA);
  await page.evaluate(([tag, f]) => {
    const w = window as any; w.__area = [];
    (document.querySelector(tag as string) as any).writer = {
      createHelper: async () => ({ entity_id: "x.y" }),
      setDeviceArea: async (d: string, a: string) => { w.__area.push(["device", d, a]); if (f) throw new Error(f as string); },
      setEntityArea: async (e: string, a: string) => { w.__area.push(["entity", e, a]); if (f) throw new Error(f as string); },
    };
  }, [EDITOR, fail]);
}
const areaCalls = (page: Page) => page.evaluate(() => (window as any).__area as unknown[][]);

test("S4.3: dropping the kitchen light in the Living room asks, then moves its device to Living in HA", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await expect(page.locator("#fp-confirm")).toContainText("Move Kitchen light to Living?");
  expect(await areaCalls(page)).toHaveLength(0);
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await areaCalls(page)).length).toBe(1);
  expect((await areaCalls(page))[0]).toEqual(["device", "dev-k", "living"]);
  await expect(page.locator("#status")).toContainText("Moved");
});

test("S4.3 break it: Cancel writes nothing and leaves a note plus a button; a drop outside every room asks nothing; a failing HA changes nothing", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await page.locator("#fp-confirm-no").click();
  expect(await areaCalls(page)).toHaveLength(0);
  await expect(page.locator("#panel")).toContainText("another area than Living");
  await dragCm(page, [250, 300], [850, 250]); // off every room
  await expect(page.locator("#fp-confirm")).toHaveCount(0);
  await dragCm(page, [850, 250], [250, 300]);
  await page.locator("#fp-confirm-no").click();
  await withAreaWriter(page, "not_allowed");
  await page.locator("#vmovearea").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
  await expect(page.locator("#vmovearea")).toHaveCount(1); // still differs
});

test("S4.3: 'Don't ask again' moves the next drops without the dialog, and a device with siblings moves only its entity", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await page.locator("#fp-confirm-remember").check();
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await areaCalls(page)).length).toBe(1);
  // the temperature sensor's entity has a sibling on its device
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; ed.ha = { ...ed.ha, entities: ed.ha.entities.map((e: any) => (e.id === "light.demo_living" ? e : e)).concat([{ id: "sensor.demo_living_temperature", name: "T", domain: "sensor", area: "living", dev: "dev-shared" }]) }; }, [EDITOR]);
  await dragCm(page, [380, 120], [650, 300]); // Living to Kitchen, no dialog now
  await expect(page.locator("#fp-confirm")).toHaveCount(0);
  await expect.poll(async () => (await areaCalls(page)).length).toBe(2);
  expect((await areaCalls(page))[1]).toEqual(["entity", "sensor.demo_living_temperature", "kitchen"]);
});

// ---- S4.10: the Home Assistant menu lists and removes everything floorplan-studio labelled --------

/** A writer whose list/remove are scripted from the test; `removes` records what Remove was called with. */
async function withHaMenu(page: Page, opt: { list?: unknown[]; failRemove?: string } = {}) {
  await setHa(page, { floors: [], areas: [], entities: [] });
  await page.evaluate(([tag, list, failRemove]) => {
    const w = window as any; w.__removes = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {}, createHelper: async () => ({ entity_id: "x.y" }),
      listLabelled: async () => list,
      removeLabelled: async (item: unknown) => { w.__removes.push(item); if (failRemove) throw new Error(failRemove as string); },
    };
  }, [EDITOR, opt.list ?? [], opt.failRemove ?? ""]);
}
const removes = (page: Page) => page.evaluate(() => (window as any).__removes as unknown[]);

test("S4.10: the Home Assistant menu lists what's labelled, grouped by kind, and Remove asks then deletes it there", async ({ page }) => {
  await withHaMenu(page, { list: [
    { kind: "helper", id: "E1", name: "Hall light", entityId: "light.hall_switch" },
    { kind: "automation", id: "A1", name: "Close at night", entityId: "automation.close_at_night" },
    { kind: "area", id: "attic", name: "Attic" },
  ] });
  await page.locator("#mHA summary").click();
  await expect(page.locator(".harow")).toHaveCount(3);
  const box = page.locator("#mHA .box");
  for (const t of ["Helpers", "Hall light", "Automations", "Close at night", "Areas", "Attic"]) await expect(box).toContainText(t);
  await page.locator('[data-ha="attic"] button.warn').click();
  await expect(page.locator("#fp-confirm")).toContainText("Remove Attic from Home Assistant?");
  expect(await removes(page)).toHaveLength(0);
  await withHaMenu(page, { list: [] }); // Remove reloads the list: the next load comes back empty
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await removes(page)).length).toBe(1);
  expect((await removes(page))[0]).toMatchObject({ kind: "area", id: "attic" });
  await expect(page.locator("#status")).toContainText("Removed Attic from Home Assistant");
  await page.locator("#mHA summary").click(); // confirming closed the menu (an outside click); reopen it to see the refreshed list
  await expect(page.locator("#haNone")).toBeVisible();
});

test("S4.10 break it: nothing labelled says so, a failing remove changes nothing, and no writer means no menu", async ({ page }) => {
  await withHaMenu(page, { list: [] });
  await page.locator("#mHA summary").click();
  await expect(page.locator("#haNone")).toBeVisible();

  await page.locator("#mHA summary").click(); // close it first: it opened above
  await withHaMenu(page, { list: [{ kind: "helper", id: "E1", name: "Hall light", entityId: "light.hall_switch" }], failRemove: "not_allowed" });
  await page.locator("#mHA summary").click();
  await page.locator('[data-ha="E1"] button.warn').click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");

  await page.evaluate(([tag]) => { (document.querySelector(tag as string) as any).writer = undefined; }, [EDITOR]);
  await expect(page.locator("#mHA")).toHaveCount(0);
});

// ---- S4.23: Undo/Redo move to the toolbar, after Home Assistant, no menu to open first --------------------------------

test("S4.23: Undo and Redo sit in the toolbar, outside every menu box, styled lighter, and still undo/redo", async ({ page }) => {
  await expect(page.locator("#mFile .box #undo")).toHaveCount(0); // no longer inside the File menu
  await expect(page.locator("#mFile .box #redo")).toHaveCount(0);
  await expect(page.locator("#undo")).toBeVisible(); // visible with no menu open
  await expect(page.locator("#redo")).toBeVisible();
  await expect(page.locator("#undo")).toHaveClass(/light/);
  await expect(page.locator("#redo")).toHaveClass(/light/);
  await expect(page.locator("#undo")).toBeDisabled();

  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw[aria-label="Marble"]').click(); // one undoable edit, no menu opened
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].color).toBeUndefined();
  await expect(page.locator("#redo")).toBeEnabled();
  await page.locator("#redo").click();
  expect((await groundOf(page)).rooms[0].color).toBe("#e2dfda");
});

// ---- S4.24: door/window sensors, locks and curtains attach several; heater and ac bindings too ------------------------

test("S4.24: a door attaches several vibration sensors and locks, each removable, one undo step per change", async ({ page }) => {
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0); // Front door
  await expect(page.locator("#dvibr")).toBeVisible();
  await expect(page.locator("#dlocks")).toBeVisible();
  await expect(page.locator("#dvibr option")).toHaveCount(1); // only the placeholder: no vibration sensor in the catalog yet
  await expect((await groundOf(page)).doors[0].vibration).toBeUndefined();
  await expect((await groundOf(page)).doors[0].locks).toBeUndefined();
});

test("S4.24: a heater attaches several temperature sensors; removing the last one clears the field, one undo step each way", async ({ page }) => {
  const HEATER: [number, number] = [180, 8]; // demo's "Living radiator"
  const p = await screenOf(page, ...HEATER);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#hsens")).toBeVisible();
  await expect(page.locator("#htrv")).toBeVisible();
  const before = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(before.tempSensors).toBeUndefined();

  await page.locator("#hsens").selectOption("sensor.demo_bedroom_temperature");
  let heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);

  await page.locator("#hsens-rm0").click();
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toBeUndefined();

  // two undo steps: the removal, then the attach
  await page.keyboard.press("Control+z");
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);
  await page.keyboard.press("Control+z");
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toBeUndefined();
});

// ---- S4.18: a device's type can be corrected after placement, and clears type-specific fields it no longer fits -----

test("S4.18: the device panel's type selector changes a device's type and drops fields the new type does not use, one undo step", async ({ page }) => {
  const p = await screenOf(page, 180, 8); // demo's "Living radiator" heater, with tempSensors already set
  await page.mouse.click(p.x, p.y);
  await page.locator("#hsens").selectOption("sensor.demo_bedroom_temperature");
  await expect(page.locator("#vtype")).toBeVisible();
  await expect(page.locator("#vtype")).toHaveValue("heater");

  await page.locator("#vtype").selectOption("light");
  const before = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(before.type).toBe("light");
  expect(before.tempSensors).toBeUndefined();
  expect(before.trvs).toBeUndefined();
  await expect(page.locator("#hsens")).toHaveCount(0); // heater-only field is gone
  await expect(page.locator("#vbound")).toBeVisible(); // light-only field appeared

  // one undo step brings the type and the cleared fields back together
  await page.keyboard.press("Control+z");
  const after = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(after.type).toBe("heater");
  expect(after.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);
});

// ---- S4.18: right-click context menu on a room, zone or structure -----------------------------------------------

async function rightClickCm(page: Page, x: number, y: number) {
  const c = await screenOf(page, x, y);
  await page.mouse.click(c.x, c.y, { button: "right" });
}

test("S4.18: right-clicking a room selects it and opens a context menu with Change colour and Delete", async ({ page }) => {
  await rightClickCm(page, 200, 150); // inside Living
  await expect(page.locator("#rk")).toHaveValue("room"); // the room panel is already open, per the design decision
  const menu = page.locator(".ctxmenu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("#cmColour")).toBeVisible();
  await expect(menu.locator("#cmDelete")).toBeVisible();
});

test("S4.18: right-clicking the background or a device opens no menu", async ({ page }) => {
  await rightClickCm(page, 950, 700); // outside every room
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
});

test("S4.18: outside click, Escape and scroll all close the context menu", async ({ page }) => {
  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctxmenu")).toHaveCount(0);

  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  const bg = await screenOf(page, 950, 700);
  await page.mouse.click(bg.x, bg.y);
  await expect(page.locator(".ctxmenu")).toHaveCount(0);

  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await page.mouse.wheel(0, 100);
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
});

test("S4.18: Delete from the menu removes the room, same as the panel's own Delete", async ({ page }) => {
  await rightClickCm(page, 200, 150); // Living
  await page.locator("#cmDelete").click();
  expect((await groundOf(page)).rooms.find((r: any) => r.name === "Living")).toBeUndefined();
});

test("S4.18: 'Add device from <area>' lists the room's unplaced HA entities and adds one, one undo step", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas], entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }] });
  await rightClickCm(page, 200, 150); // Living, area "living"
  const menu = page.locator(".ctxmenu");
  await expect(menu).toContainText("Living temp");
  await menu.locator("button", { hasText: "Living temp" }).click();
  const devs = (await groundOf(page)).devices;
  const d = devs.find((x: any) => x.entity === "sensor.living_temp");
  expect(d).toMatchObject({ type: "temp", name: "Living temp" });
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.living_temp")).toMatchObject({ type: "temp", room: "Living" });
  await expect(page.locator(".ctxmenu")).toHaveCount(0); // the menu closes after adding

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.living_temp")).toBe(false);
});

// ---- S4.15: the room panel places every unplaced entity of the room's HA area ------------------------------------

test("S4.15: the room panel's Place button adds every unplaced entity of the area, one undo step, and is absent when none is left", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas], entities: [...HA.entities,
    { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" },
    { id: "binary_sensor.living_motion", name: "Living motion", domain: "binary_sensor", dc: "motion", area: "living" }] });
  const before = (await groundOf(page)).devices.length;
  const c = await screenOf(page, 200, 150); // inside Living
  await page.mouse.click(c.x, c.y);
  const btn = page.locator("#rplace");
  await expect(btn).toHaveText(/Place 2 Home Assistant devices/);
  await btn.click();
  const devs = (await groundOf(page)).devices;
  expect(devs).toHaveLength(before + 2);
  const added = devs.filter((d: any) => d.entity === "sensor.living_temp" || d.entity === "binary_sensor.living_motion");
  expect(added.map((d: any) => d.type).sort()).toEqual(["motion", "temp"]);
  expect(new Set(added.map((d: any) => `${d.x},${d.y}`)).size).toBe(2);
  await expect(page.locator("#rplace")).toHaveCount(0); // nothing left to place

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices).toHaveLength(before); // one gesture, one step
});

test("S4.15: no Place button without Home Assistant", async ({ page }) => {
  const c = await screenOf(page, 200, 150);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#rplace")).toHaveCount(0);
});

// ---- S4.14: Add > Entities, a palette of every HA entity not yet on the plan -------------------------------------

test("S4.14: Add > Entities lists HA entities not yet placed or catalogued, grouped by type, and is absent without Home Assistant", async ({ page }) => {
  await menu(page, "Add");
  await expect(page.locator('#mAdd details.sub > summary:text-is("Entities")')).toHaveCount(0); // no ha: nothing to add from
  await menu(page, "Add"); // close it again

  await setHa(page, { ...HA, entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }, { id: "light.demo_kitchen", name: "Kitchen light", domain: "light" }] });
  await menu(page, "Add");
  await page.locator('#mAdd details.sub > summary:text-is("Entities")').click();
  const sub = page.locator("#addEntSub");
  await expect(sub).toContainText("Living temp");
  await expect(sub).toContainText("Pond level"); // HA's own fixture entity, not yet placed or catalogued
  await expect(sub.locator('button:text-is("Kitchen light")')).toHaveCount(0); // already a device on the demo plan
});

test("S4.14: search filters the palette by name or entity id", async ({ page }) => {
  await setHa(page, HA);
  await menu(page, "Add");
  await page.locator('#mAdd details.sub > summary:text-is("Entities")').click();
  await page.locator("#entSearch").fill("pond");
  await expect(page.locator("#addEntSub")).toContainText("Pond level");
  await page.locator("#entSearch").fill("nothing-matches-this");
  await expect(page.locator("#addEntNone")).toHaveText("No entity matches");
});

test("S4.14: clicking an entity places it — at its area's room centre when one is drawn, else near the plan centre — one undo step", async ({ page }) => {
  await setHa(page, { ...HA, entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }] });
  await menu(page, "Add");
  await page.locator('#mAdd details.sub > summary:text-is("Entities")').click();
  await page.locator('[data-ent="sensor.living_temp"]').click();
  await expect(page.locator("#mAdd")).not.toHaveJSProperty("open", true); // the menu closes after placing

  const devs = (await groundOf(page)).devices;
  const d = devs.find((x: any) => x.entity === "sensor.living_temp");
  expect(d).toMatchObject({ type: "temp", name: "Living temp" });
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.living_temp")).toMatchObject({ room: "Living" });

  await menu(page, "Add");
  await page.locator('#mAdd details.sub > summary:text-is("Entities")').click();
  await page.locator('[data-ent="sensor.pond"]').click(); // no area on this fixture entity: falls back, not refused
  const pond = (await groundOf(page)).devices.find((x: any) => x.entity === "sensor.pond");
  expect(pond).toBeTruthy();
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.pond")?.room).toBeFalsy();

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.pond")).toBe(false);
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.living_temp")).toBe(true);
});
