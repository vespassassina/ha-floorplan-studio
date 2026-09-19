import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, type Layout, type Floor } from "../../src/core/schema";

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("loads the demo and draws the ground floor", async ({ page }) => {
  const l = await layoutOf(page);
  expect(l.floors.ground.rooms).toHaveLength(5); // three rooms, the Reading corner zone and the pond
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(5);
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
  // the demo catalog holds one contact sensor not on the plan; the relay leaves the list with its light.
  await expect(unplaced(page)).toHaveCount(1);
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
    const q = new DOMPoint(px as number, py as number).matrixTransform(svg.getScreenCTM()!);
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

test("a device snaps to the 5 cm grid, and Alt places it freely", async ({ page }) => {
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([265, 205]);
  expect(d.x % 5).toBe(0);
  await dragCm(page, [265, 205], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("Alt turns snapping off for a corner", async ({ page }) => {
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

const stairsCount = (page: Page) => page.locator("svg polygon[data-s]");
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
  for (const n of [...xs, ...ys]) expect(n % 5).toBe(0);
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

test("two stairs get distinct ids after one is deleted and another added; a floor with none takes the first id", async ({ page }) => {
  await addStairs(page);
  await addStairs(page);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-2", "stairs-ground-3"]);
  await page.locator("#sdel").click();
  await addStairs(page);
  const ids = (await groundOf(page)).stairs.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // the upper floor has an empty stairs array
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(0);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(1);
  expect((await layoutOf(page)).floors.first.stairs[0].id).toBe("stairs-first-1");
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
  await expect(unplaced(page)).toHaveCount(1);
  await page.locator("#vbound").selectOption("");
  expect(await bound(page, 0)).toBeUndefined();
  expect("bound" in (await groundOf(page)).devices[0]).toBe(false);
  await expect(unplaced(page)).toHaveCount(2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await bound(page, 0)).toBe(RELAY);
  await expect(unplaced(page)).toHaveCount(1);
  // choosing the same value again records no step
  await selectDev(page, 0);
  await page.locator("#vbound").selectOption(RELAY);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another free switch updates the list and the saved layout validates", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Living - Living lamp relay", "Living - Free plug"]);
  await page.locator("#vbound").selectOption("switch.free_plug");
  expect(await bound(page, 0)).toBe("switch.free_plug");
  // the relay is free again, the plug is not
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1);
  await expect(devItem(page, "plug-free")).toHaveCount(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("a switch already bound elsewhere or placed is not offered", async ({ page }) => {
  await setCatalog(page, [], "l.floors.ground.devices[1].bound = l.floors.ground.devices[0].bound; delete l.floors.ground.devices[0].bound;");
  await selectDev(page, 0);
  const opts = page.locator("#vbound option");
  await expect(opts).toHaveText(["(none)"]); // relay is the kitchen light's; hall switch and TV plug are placed
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
const addKind = async (page: Page, id: "#addZone" | "#addWater") => { await menu(page, "Add"); await page.locator(id).click(); };
const roomPolys = (page: Page) => page.locator("svg polygon[data-r]");

test("Add, Zone places a 200 x 200 cm zone on the grid, centred, selected, dotted, with all w false; one undo step removes it", async ({ page }) => {
  const before = await groundOf(page);
  await addKind(page, "#addZone");
  await expect(roomPolys(page)).toHaveCount(before.rooms.length + 1);
  const g = await groundOf(page), z = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(z.kind).toBe("zone");
  expect(z.w).toEqual([false, false, false, false]);
  expect(new Set(g.rooms.map((r) => r.id)).size).toBe(g.rooms.length);
  const xs = z.pts.map((p) => p[0]), ys = z.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(200);
  for (const v of [...xs, ...ys]) expect(v % 5).toBe(0);
  const view = await page.evaluate((tag) => ({ ...(document.querySelector(tag) as any).st.view }), EDITOR);
  expect(Math.abs((Math.min(...xs) + 100) - (view.x + view.w / 2))).toBeLessThanOrEqual(5);
  expect(Math.abs((Math.min(...ys) + 100) - (view.y + view.h / 2))).toBeLessThanOrEqual(5);
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

test("Add, Water places a 200 x 200 cm water polygon filled from --fp-water, selected", async ({ page }) => {
  await addKind(page, "#addWater");
  const g = await groundOf(page), w = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(w.kind).toBe("water");
  const xs = w.pts.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
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
  expect(options).toEqual(expect.arrayContaining(["zone", "water"]));
  expect((await groundOf(page)).rooms[0].w).toEqual([true, true, true, true]);
  await page.locator("#rk").selectOption("zone");
  const z = (await groundOf(page)).rooms[0];
  expect(z.kind).toBe("zone");
  expect(z.w).toEqual([false, false, false, false]);
  await menu(page, "File");
  await page.locator("#undo").click();
  const back = (await groundOf(page)).rooms[0];
  expect(back.kind).toBe("room");
  expect(back.w).toEqual([true, true, true, true]);
});

test("dragging a zone corner onto a wall does not insert a point into the wall or the rooms", async ({ page }) => {
  await addKind(page, "#addZone");
  const g0 = await groundOf(page), zi = g0.rooms.length - 1, z = g0.rooms[zi];
  const counts = (g: Floor) => ({ o: g.outline.length, rooms: g.rooms.slice(0, 3).map((r) => r.pts.length), w: g.rooms.slice(0, 3).map((r) => r.w.length), walls: g.walls.length });
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

test("the wall panel has a kind select with five human labels and no toggle button", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wk")).toHaveJSProperty("tagName", "SELECT");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"],
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
async function addFloorVia(page: Page, title: string) {
  const c = await centre(page, "#addFloor");
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#newFloor")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

test("the + chip sits after the floor chips, opens an input, and Enter adds an empty floor that is selected", async ({ page }) => {
  const add = await page.locator("#addFloor").boundingBox(), last = await chips(page).last().boundingBox();
  expect(add!.x).toBeGreaterThan(last!.x + last!.width - 1);
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await addFloorVia(page, "Attic");
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic"]);
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Attic"]);
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(0); // empty
  const l = await layoutOf(page);
  expect(l.floors.attic).toMatchObject({ title: "Attic", outline: [], rooms: [], walls: [], devices: [], furniture: [] });
  expect(l.floors.ground.rooms).toHaveLength(5); // untouched
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
  expect(l.floors.ground.rooms).toHaveLength(5);
  expect(l.floors["ground-2"].rooms).toHaveLength(0);
});

test("with nothing selected the panel is the floor panel: title field, Move up, Move down, Delete; a selection replaces it", async ({ page }) => {
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await expect(page.locator("#ft")).toHaveValue("Ground");
  await expect(page.locator("#fup")).toBeDisabled(); // first
  await expect(page.locator("#fdown")).toBeEnabled();
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

test("Move up puts Attic first, the chips follow the order, Move down is disabled at the end, and it undoes", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await expect(page.locator("#fdown")).toBeDisabled();
  await page.locator("#fup").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first"]);
  await page.locator("#fup").click();
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first"]);
  expect(await floorKeys(page)).toEqual(["attic", "ground", "first"]);
  await expect(page.locator("#fup")).toBeDisabled();
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fdown").click();
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
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(5);
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
  await page.locator("#fup").click();
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

/** Add, then one Draw item, through the real menu. */
async function startDraw(page: Page, id: string) {
  await menu(page, "Add");
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
  expect([room.kind, room.name, room.area, room.w]).toEqual(["room", "New room", "new-room", [true, true, true, true]]);
  await expect(page.locator("#rn")).toHaveValue("New room"); // selected: the room panel
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Wall (fence): three clicks and Enter give two fence walls sharing a point, one undo step", async ({ page }) => {
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
  const g0 = await groundOf(page);
  expect(g0.rooms[0].pts[2]).toEqual([500, 400]); // Living's corner, also Kitchen's and the Hall's edge
  await startDraw(page, "drawZone");
  await clicksCm(page, [503, 398], [603, 398], [603, 460]);
  await page.keyboard.press("Enter");
  const z = (await groundOf(page)).rooms.at(-1)!;
  expect(z.kind).toBe("zone");
  expect(z.pts[0]).toEqual([505, 400]); // the grid, not the corner (500, 400)
  expect(z.w).toEqual([false, false, false]);
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
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  const c = await screenOf(page, FREE[3][0], FREE[3][1]);
  await page.mouse.dblclick(c.x, c.y);
  const room = (await groundOf(page)).rooms.at(-1)!;
  expect(room.pts).toEqual(FREE_SNAPPED);
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("a click on the first point closes a polygon of three or more points and adds no point", async ({ page }) => {
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
  const before = await groundOf(page);
  await startDraw(page, "drawOutline");
  await clicksCm(page, ...FREE);
  await page.keyboard.press("Enter");
  expect((await groundOf(page)).outline).toEqual(FREE_SNAPPED);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).outline).toEqual(before.outline);
});

test("Draw, Water and Draw, Opening and Draw, Structure line add their shapes", async ({ page }) => {
  await startDraw(page, "drawWater");
  await clicksCm(page, [850, 300], [900, 300], [900, 350]);
  await page.keyboard.press("Enter");
  const w = (await groundOf(page)).rooms.at(-1)!;
  expect([w.kind, w.name, w.area, w.w]).toEqual(["water", "New water", "", [false, false, false]]);
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

test("the toolbar order is Add, Device, View, File and Add has no Device item", async ({ page }) => {
  await expect(page.locator("details.menu > summary")).toHaveText(["Add", "Device", "View", "File"]);
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
  await expect(shown(page)).toHaveCount(2);
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
  await expect(shown(page)).toHaveCount(2);
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
  await expect(shown(page)).toHaveCount(1);
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
  await page.locator("#addWall").click(); // a wall through the view centre
  const w = (await groundOf(page)).walls[0];
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
  await page.locator("#addFloor").click();
  await page.locator("#newFloor").fill("Attic");
  await page.locator("#newFloor").press("Enter");
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
  await expect(page.locator("#wallt")).toHaveCount(0);
  const zi = (await groundOf(page)).rooms.findIndex((r) => r.kind === "zone");
  const zoneW = async () => (await groundOf(page)).rooms[zi].w;
  const ok = async () => { expect(validate(await layoutOf(page)).ok).toBe(true); expect(await zoneW()).toEqual((await zoneW()).map(() => false)); };
  await page.locator("#elen").fill("1.5");
  await page.locator("#elen").press("Enter");
  await ok();
  await expect(page.locator("#wallt")).toHaveCount(0);
  await page.locator("#mkh").click();
  await ok();
  await page.locator("#mkv").click();
  await ok();
  await expect(page.locator("#wallt")).toHaveCount(0);
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
    z.pts = [[500, 0], [560, 0], [520, 60]]; z.w = [false, false, false];
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

test("Draw, Opening: the dblclick that follows the finishing click adds no corner to the wall under it", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400); // finishes the opening
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

test("the guard is short-lived and local: a later dblclick, or one after a click elsewhere, adds its point", async ({ page }) => {
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
  await page.locator("#addWall").click(); // a horizontal wall through the view centre
  const w = (await groundOf(page)).walls[0];
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
  expect(await page.locator("svg text.lbl.zone").first().evaluate((el) => el.getAttribute("font-size"))).not.toBe(await page.locator("svg text.lbl:not(.zone)").first().evaluate((el) => el.getAttribute("font-size")));
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
