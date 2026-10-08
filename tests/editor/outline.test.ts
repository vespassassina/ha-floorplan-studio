import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/core/migrate";
import type { HaData, Layout } from "../../src/core";
import { buildOutline, filterOutline, outlineKey, visibleRows, type OutlineNode } from "../../src/editor/outline";

// S24.5 (U9, U20): the Studio's Outline. floors › rooms › devices with counts, "No room" per floor, and "Unplaced from
// HA" last, grouped by area with Place's own filter. Pure: the tree element renders what these return.
const stress = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;
const tree = buildOutline(stress, undefined, undefined);
const byId = (nodes: OutlineNode[], id: string): OutlineNode | undefined => {
  for (const n of nodes) { if (n.id === id) return n; const c = n.children && byId(n.children, id); if (c) return c; }
  return undefined;
};

const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const floor = (over: Record<string, unknown>) => ({ title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices: [], rooms: [], ...over });
const tiny = (floors: Record<string, unknown>) => ({ version: 2, unit: "cm", north: 0, catalog: [], floors }) as unknown as Layout;

describe("S24.5 outline model", () => {
  it("has the three floors of the stress house, each counting its own devices, 437 in all", () => {
    expect(tree.map((n) => [n.label, n.count])).toEqual([["Ground", 182], ["First", 129], ["Second", 126]]);
  });

  it("a floor lists its rooms in layout order with their device counts; devices sit in the room they stand in", () => {
    const second = tree[2];
    expect(second.children!.slice(0, 2).map((n) => n.label)).toEqual(["Guest bedroom", "Guest bath"]);
    const guest = second.children![0];
    expect(guest.count).toBe(guest.children!.length);
    expect(guest.children!.slice(0, 4).map((n) => n.label)).toEqual(["Guest bedroom spot 1", "Guest bedroom spot 2", "Guest bedroom spot 3", "Guest bedroom bedside left"]);
    const lamp = guest.children![3];
    expect(lamp.entry).toMatchObject({ kind: "device", floor: "second", device: 3 });
    // every device appears exactly once under its floor
    const sum = (n: OutlineNode) => n.children!.reduce((s, c) => s + (c.children?.length ?? 0), 0);
    expect(tree.map(sum)).toEqual([182, 129, 126]);
  });

  it("a light powered by a relay names the relay after an arrow", () => {
    const spot3 = byId(tree, tree[2].children![0].children![2].id)!;
    expect(spot3.via).toBe("switch.guest_bedroom_relay_22"); // no device and no HA name for it: the entity id
  });

  it("a device in no room goes under No room, last on its floor; a room with nothing in it counts 0", () => {
    const l = tiny({ g: floor({ rooms: [{ id: "r1", name: "Den", kind: "room", pts: sq(0, 0, 100) }, { id: "r2", name: "Void", kind: "room", pts: sq(500, 0, 100) }], devices: [{ id: "a", type: "light", entity: "light.a", name: "In", x: 50, y: 50 }, { id: "b", type: "light", entity: "light.b", name: "Out", x: 300, y: 300 }] }) });
    const [g] = buildOutline(l, undefined, undefined);
    expect(g.children!.map((n) => [n.kind, n.label, n.count])).toEqual([["room", "Den", 1], ["room", "Void", 0], ["noroom", "No room", 1]]);
    expect(g.children![2].children![0].label).toBe("Out");
  });

  it("Unplaced from HA is last, groups what Place would offer by area, and leaves out what the plan shows", () => {
    const l = tiny({ g: floor({ devices: [{ id: "a", type: "light", entity: "light.placed", name: "Placed", x: 50, y: 50 }] }) });
    const ha = {
      floors: [], areas: [{ id: "k", name: "Kitchen" }, { id: "h", name: "Hall" }, { id: "k", name: "Kitchen" }],
      entities: [
        { id: "light.placed", name: "Placed", domain: "light", area: "k" },
        { id: "light.k1", name: "Kitchen spot", domain: "light", area: "k" },
        { id: "sensor.k_power", name: "Kitchen power", domain: "sensor", area: "k", dc: "power" },
        { id: "switch.h1", name: "Hall switch", domain: "switch", area: "h" },
      ],
    } as unknown as HaData;
    const out = buildOutline(l, undefined, ha);
    const last = out[out.length - 1];
    expect(last).toMatchObject({ kind: "unplaced", label: "Unplaced from HA", count: 2 });
    expect(last.children!.map((n) => [n.label, n.count])).toEqual([["Kitchen", 1], ["Hall", 1]]);
    expect(last.children![0].children!.map((n) => [n.kind, n.label, n.entity])).toEqual([["entity", "Kitchen spot", "light.k1"]]);
    expect(buildOutline(l, undefined, undefined).some((n) => n.kind === "unplaced")).toBe(false);
  });

  it("a junk layout gives an empty tree, never a throw (finding 1)", () => {
    expect(buildOutline({ floors: { x: 5, __proto__: { rooms: 5 } } } as unknown as Layout, undefined, undefined)).toEqual([]);
    expect(buildOutline(null as unknown as Layout, undefined, undefined)).toEqual([]);
  });
});

describe("S24.5 outline filter", () => {
  it("keeps the matching devices with their room and floor, and opens those branches", () => {
    const { nodes, open } = filterOutline(tree, "bedside guest");
    expect(nodes.map((n) => n.label)).toEqual(["Second"]);
    expect(nodes[0].children!.map((n) => n.label)).toEqual(["Guest bedroom"]);
    expect(nodes[0].children![0].children!.map((n) => n.label)).toEqual(["Guest bedroom bedside left", "Guest bedroom bedside right", "Guest bedroom bedside plug"]);
    expect([...open].sort()).toEqual([nodes[0].id, nodes[0].children![0].id].sort());
  });

  it("matches entity ids, ignores case and accents, and an empty filter is the whole tree", () => {
    const { nodes } = filterOutline(tree, "SWITCH.GUEST_BEDROOM_WALL");
    expect(nodes[0].children![0].children!.map((n) => n.label)).toEqual(["Guest bedroom wall switch"]);
    expect(filterOutline(tree, "  ").nodes).toBe(tree);
  });

  it("a matching room keeps all its devices", () => {
    const { nodes } = filterOutline(tree, "guest bath");
    const bath = nodes[0].children!.find((n) => n.label === "Guest bath")!;
    expect(bath.children!.length).toBe(bath.count);
  });
});

describe("S24.5 outline rows and keys", () => {
  const nodes: OutlineNode[] = [
    { id: "f1", kind: "floor", label: "A", children: [{ id: "r1", kind: "room", label: "R", children: [{ id: "d1", kind: "device", label: "D1" }, { id: "d2", kind: "device", label: "D2" }] }] },
    { id: "f2", kind: "floor", label: "B", children: [{ id: "r2", kind: "room", label: "S", children: [] }] },
  ];

  it("lists only what is open, with level, parent, position and set size", () => {
    expect(visibleRows(nodes, new Set()).map((r) => r.node.id)).toEqual(["f1", "f2"]);
    const rows = visibleRows(nodes, new Set(["f1", "r1"]));
    expect(rows.map((r) => [r.node.id, r.level, r.parent, r.pos, r.size])).toEqual([
      ["f1", 1, null, 1, 2], ["r1", 2, "f1", 1, 1], ["d1", 3, "r1", 1, 2], ["d2", 3, "r1", 2, 2], ["f2", 1, null, 2, 2],
    ]);
  });

  it("Up and Down move, Home and End jump, and none of them leaves the list", () => {
    const rows = visibleRows(nodes, new Set(["f1", "r1"]));
    expect(outlineKey(rows, "r1", "ArrowDown")).toEqual({ active: "d1" });
    expect(outlineKey(rows, "f2", "ArrowDown")).toEqual({ active: "f2" });
    expect(outlineKey(rows, "f1", "ArrowUp")).toEqual({ active: "f1" });
    expect(outlineKey(rows, "d2", "Home")).toEqual({ active: "f1" });
    expect(outlineKey(rows, "f1", "End")).toEqual({ active: "f2" });
  });

  it("Right opens a closed branch, then enters it; Left closes an open one, else goes to the parent", () => {
    const closed = visibleRows(nodes, new Set());
    expect(outlineKey(closed, "f1", "ArrowRight")).toEqual({ active: "f1", open: "f1" });
    const opened = visibleRows(nodes, new Set(["f1"]));
    expect(outlineKey(opened, "f1", "ArrowRight")).toEqual({ active: "r1" });
    expect(outlineKey(opened, "f1", "ArrowLeft")).toEqual({ active: "f1", close: "f1" });
    expect(outlineKey(opened, "r1", "ArrowLeft")).toEqual({ active: "f1" });
    const deep = visibleRows(nodes, new Set(["f1", "r1"]));
    expect(outlineKey(deep, "d1", "ArrowRight")).toEqual({ active: "d1" }); // a leaf: nothing to open
    expect(outlineKey(deep, "d2", "ArrowLeft")).toEqual({ active: "r1" });
    // an empty branch has nothing to enter
    const b = visibleRows(nodes, new Set(["f2", "r2"]));
    expect(outlineKey(b, "r2", "ArrowRight")).toEqual({ active: "r2" });
  });

  it("Enter and Space go to the row; an unknown key or row is not the tree's", () => {
    const rows = visibleRows(nodes, new Set(["f1"]));
    expect(outlineKey(rows, "r1", "Enter")).toEqual({ active: "r1", go: true });
    expect(outlineKey(rows, "r1", " ")).toEqual({ active: "r1", go: true });
    expect(outlineKey(rows, "r1", "x")).toBeNull();
    expect(outlineKey(rows, "gone", "ArrowDown")).toEqual({ active: "f1" });
  });
});
