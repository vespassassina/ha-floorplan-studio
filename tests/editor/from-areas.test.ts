import { describe, it, expect } from "vitest";
import { renderFloor } from "../../src/core";
import type { HaData } from "../../src/core";
import { haData, type PickerHass } from "../../src/editor/hass-pickers";
import { layoutFromAreas } from "../../src/editor/from-areas";
import { loadLayout } from "../../src/editor/state";

// S37.2: one 4 x 4 m room per Home Assistant area, its entities inside as icons.
// Shapes: area_registry/list rows are { area_id, name, floor_id, ... }, entity_registry/list rows { entity_id, device_id,
// area_id, platform, disabled_by, entity_category, ... }, device_registry/list rows { id, area_id, name, name_by_user, ... },
// as Home Assistant's websocket API sends them (`EntityReg` and `DeviceReg` in src/editor/hass-pickers.ts are the readers).
// `haData` turns them into `HaData`; the two-places test feeds the builder what `haData` returns, not a hand-made shape.

const ent = (id: string, area: string | null, extra: Partial<HaData["entities"][number]> = {}): HaData["entities"][number] => ({ id, name: id, domain: id.split(".")[0], area, ...extra });
const ha = (areas: { id: string; name: string }[], entities: HaData["entities"]): HaData => ({ floors: [], areas, entities });
type D = { entity: string; type: string; x: number; y: number; power?: string };
const devs = (f: { devices: unknown[] }) => f.devices as D[];
const valid = (l: unknown) => { const r = loadLayout(l); expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true); return r.ok ? r.layout : (undefined as never); };

describe("layoutFromAreas (S37.2)", () => {
  it("0 areas, or areas with nothing the plan can draw, give no layout (the caller changes nothing)", () => {
    expect(layoutFromAreas(ha([], []))).toBeNull();
    expect(layoutFromAreas(ha([{ id: "attic", name: "Attic" }], []))).toBeNull();
    expect(layoutFromAreas(ha([{ id: "attic", name: "Attic" }], [ent("sensor.power", "attic"), ent("person.diego", "attic"), ent("sensor.batt", "attic", { dc: "battery" })]))).toBeNull();
    expect(layoutFromAreas(undefined as never)).toBeNull();
    expect(layoutFromAreas({ areas: 5, entities: "x" } as never)).toBeNull();
  });

  it("1 area: a 4 x 4 m room with a wall on every edge, linked to the area, its drawable entities inside as icons, valid", () => {
    const l = layoutFromAreas(ha([{ id: "kitchen", name: "Kitchen" }, { id: "attic", name: "Attic" }], [
      ent("light.k", "kitchen"), ent("sensor.k_t", "kitchen", { dc: "temperature" }), ent("binary_sensor.k_m", "kitchen", { dc: "motion" }),
      ent("sensor.k_power", "kitchen"), // type other: skipped
      ent("light.elsewhere", "hall"),
    ]))!;
    const f = valid(l).floors.ground;
    expect(f.rooms).toHaveLength(1); // Attic has nothing: skipped
    expect(f.rooms[0]).toMatchObject({ name: "Kitchen", area: "kitchen", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["external", "external", "external", "external"] }); // a lone room: every edge is the outline
    expect(devs(f).map((d) => [d.entity, d.type]).sort()).toEqual([["binary_sensor.k_m", "motion"], ["light.k", "light"], ["sensor.k_t", "temp"]]);
    for (const d of devs(f)) expect(d.x > 0 && d.x < 400 && d.y > 0 && d.y < 400, `${d.entity} inside`).toBe(true);
    expect(l.catalog.map((c) => c.room)).toEqual(["Kitchen", "Kitchen", "Kitchen"]);
    expect(f.outline).toEqual([[0, 0], [400, 0], [400, 400], [0, 400]]);
  });

  it("S38.9: areas with the same name get distinct room names and catalog rooms, a real 'Office 2' keeps its name, a blank name falls back to the id, a payload stays plain text", () => {
    const areas = [
      { id: "o1", name: "Office" }, { id: "o2", name: "Office" }, { id: "o3", name: "office" }, { id: "o4", name: "Office" },
      { id: "real", name: "Office 2" }, { id: "blank", name: "" }, { id: "x", name: '"><script>' },
    ];
    const l = layoutFromAreas(ha(areas, areas.map((a, i) => ent(`light.l${i}`, a.id))))!;
    const f = valid(l).floors.ground;
    const names = f.rooms.map((r) => r.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(7); // room names are matched case-insensitively elsewhere (render.ts)
    expect(f.rooms.find((r) => r.area === "real")!.name).toBe("Office 2"); // the real one is never renamed
    expect(f.rooms.find((r) => r.area === "blank")!.name).toBe("blank");
    expect(f.rooms.find((r) => r.area === "x")!.name).toBe('"><script>'); // escaping happens at render
    expect(f.rooms.filter((r) => /^office \d$/i.test(r.name) && r.area !== "real").map((r) => r.name).sort()).toEqual(["Office 3", "Office 4", "Office 5"]);
    const rooms = l.catalog.map((c) => c.room);
    expect(new Set(rooms).size).toBe(7); // one device per room: catalog.room tells the rooms apart
    for (const r of f.rooms) expect(l.catalog.find((c) => c.room === r.name)?.entity, r.name).toBeTruthy();
  });

  it("13 areas: the grid wraps, no two rooms overlap, valid", () => {
    const areas = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, name: `Area ${String(i).padStart(2, "0")}` }));
    const l = layoutFromAreas(ha(areas, areas.map((a, i) => ent(`light.l${i}`, a.id))))!;
    const f = valid(l).floors.ground;
    expect(f.rooms).toHaveLength(13);
    expect(new Set(f.rooms.map((r) => `${r.pts[0]}`)).size).toBe(13);
    expect(new Set(f.rooms.map((r) => r.pts[0][0])).size).toBe(4);
    expect(new Set(f.rooms.map((r) => r.pts[0][1])).size).toBe(4);
    for (const r of f.rooms) { expect(r.pts[2][0] - r.pts[0][0]).toBe(400); expect(r.pts[2][1] - r.pts[0][1]).toBe(400); }
    expect(devs(f)).toHaveLength(13);
    const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
    expect([Math.max(...xs), Math.max(...ys)]).toEqual([1600, 1600]); // the outline holds every room
  });

  it("walls sit only on room edges: every count with a short last row, the outline is the union of the cells and no wall is drawn twice", () => {
    const S = 400, area = (pts: [number, number][]) => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;
    for (const n of [2, 5, 7, 13]) {
      const areas = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Area ${String(i).padStart(2, "0")}` }));
      const f = valid(layoutFromAreas(ha(areas, areas.map((a, i) => ent(`light.l${i}`, a.id))))!).floors.ground;
      const inUnion = (x: number, y: number) => f.rooms.some((r) => x > r.pts[0][0] && x < r.pts[2][0] && y > r.pts[0][1] && y < r.pts[2][1]);
      // the two probe points either side of an edge, 1 cm off it, 37 % along (never on a cell line)
      const sides = (a: number[], b: number[]) => {
        const mx = a[0] + (b[0] - a[0]) * 0.37, my = a[1] + (b[1] - a[1]) * 0.37, nx = -(b[1] - a[1]), ny = b[0] - a[0], l = Math.hypot(nx, ny);
        return [inUnion(mx + (nx / l), my + (ny / l)), inUnion(mx - (nx / l), my - (ny / l))];
      };
      expect(area(f.outline as [number, number][]), `${n} areas: outline area`).toBe(n * S * S);
      f.outline.forEach((p, i) => expect(sides(p, f.outline[(i + 1) % f.outline.length]).filter(Boolean), `${n}: outline edge ${i} lies on the union's boundary`).toHaveLength(1));
      const drawn = new Map<string, number>();
      for (const r of f.rooms) r.pts.forEach((p, i) => {
        const q = r.pts[(i + 1) % 4], kind = r.wk[i];
        if (kind === "none" || kind === "boundary") return;
        const key = [`${p}`, `${q}`].sort().join(">");
        drawn.set(key, (drawn.get(key) ?? 0) + 1);
        expect(sides(p, q).some(Boolean), `${n}: wall ${key} lies on a room`).toBe(true);
      });
      expect([...drawn.entries()].filter(([, c]) => c > 1), `${n}: walls drawn twice`).toEqual([]);
      // every edge of every cell has a wall, once
      for (const r of f.rooms) r.pts.forEach((p, i) => expect(drawn.has([`${p}`, `${r.pts[(i + 1) % 4]}`].sort().join(">")), `${n}: ${r.name} edge ${i} has a wall`).toBe(true));
    }
  });

  it("an area name such as \"><script> stays text: valid, and never raw in the drawn plan", () => {
    const evil = "\"><script>alert(1)</script>";
    const l = layoutFromAreas(ha([{ id: "x", name: evil }], [ent("light.x", "x", { name: evil })]))!;
    const f = valid(l).floors.ground;
    expect(f.rooms[0].name).toBe(evil);
    const svg = renderFloor(f, { scale: 1, editor: true, showNames: true } as never);
    expect(svg).toContain("&lt;script&gt;"); // the name is drawn, escaped
    expect(svg).not.toContain("<script>");
  });

  it("an area with 40 entities: all 40 icons, none stacked, inside the room, valid; 200 still valid", () => {
    const mk = (n: number) => layoutFromAreas(ha([{ id: "big", name: "Big" }], Array.from({ length: n }, (_, i) => ent(`light.l${i}`, "big"))))!;
    const l40 = mk(40), f40 = valid(l40).floors.ground;
    expect(devs(f40)).toHaveLength(40);
    expect(new Set(devs(f40).map((d) => `${d.x},${d.y}`)).size).toBe(40);
    for (const d of devs(f40)) expect(d.x >= 0 && d.x <= 400 && d.y >= 0 && d.y <= 400).toBe(true);
    expect(new Set(l40.catalog.map((c) => c.id)).size).toBe(40);
    expect(valid(mk(200)).floors.ground.devices).toHaveLength(200);
  });

  it("duplicate area ids, blank names, and rows that are not areas never break it", () => {
    const l = layoutFromAreas(ha([{ id: "a", name: "A" }, { id: "a", name: "A again" }, { id: "", name: "No id" }, { id: "b", name: "" }, null as never, 7 as never], [ent("light.a", "a"), ent("light.b", "b")]))!;
    const f = valid(l).floors.ground;
    expect(f.rooms.map((r) => r.area).sort()).toEqual(["a", "b"]);
    expect(f.rooms.find((r) => r.area === "b")!.name).toBe("b"); // a blank name takes the id
  });

  it("an entity that sits in two places (device area, own area) is drawn once, in its own area", async () => {
    const REG: Record<string, unknown> = {
      "config/area_registry/list": [{ area_id: "kitchen", name: "Kitchen", floor_id: null, aliases: [], icon: null, picture: null, labels: [] }, { area_id: "bedroom", name: "Bedroom", floor_id: null, aliases: [], icon: null, picture: null, labels: [] }],
      "config/entity_registry/list": [
        { entity_id: "light.lamp", device_id: "dev1", area_id: "kitchen", platform: "hue", disabled_by: null, entity_category: null, name: null, original_name: "Lamp", unique_id: "u1" },
        { entity_id: "light.via_device", device_id: "dev2", area_id: null, platform: "hue", disabled_by: null, entity_category: null, name: null, original_name: "Via device", unique_id: "u2" },
      ],
      "config/device_registry/list": [{ id: "dev1", area_id: "bedroom", name: "Hue lamp", name_by_user: null }, { id: "dev2", area_id: "bedroom", name: "Hue strip", name_by_user: null }],
      "config/floor_registry/list": [],
    };
    const hass: PickerHass = { states: { "light.lamp": { state: "on", attributes: {} }, "light.via_device": { state: "on", attributes: {} } }, callWS: async <T,>({ type }: { type: string }) => REG[type] as T };
    const f = valid(layoutFromAreas((await haData(hass))!)).floors.ground;
    const where = (e: string) => f.rooms.find((r) => devs(f).some((d) => d.entity === e && d.x >= r.pts[0][0] && d.x <= r.pts[2][0] && d.y >= r.pts[0][1] && d.y <= r.pts[2][1]))?.area;
    expect(devs(f).filter((d) => d.entity === "light.lamp")).toHaveLength(1);
    expect(where("light.lamp")).toBe("kitchen");
    expect(where("light.via_device")).toBe("bedroom");
  });

  it("a plug gets its power sensor, the way Place does", () => {
    const l = layoutFromAreas(ha([{ id: "k", name: "K" }], [ent("switch.p", "k", { dc: "outlet", dev: "d1" }), ent("sensor.p_power", "k", { dc: "power", dev: "d1" })]))!;
    const f = valid(l).floors.ground;
    expect(devs(f)).toHaveLength(1);
    expect(devs(f)[0]).toMatchObject({ type: "plug", entity: "switch.p", power: "sensor.p_power" });
  });
});
