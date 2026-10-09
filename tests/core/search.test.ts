import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { migrate } from "../../src/core/migrate";
import type { Layout } from "../../src/core/schema";
import { buildSearchIndex, entryDetail, layoutEntries, normalize, searchIndex, type SearchEntry } from "../../src/core/search";

// S24.1 (F1, U9): one search index for both apps. tests/fixtures/stress-layout.json is the stress generator's house,
// three storeys, 46 rooms, 437 devices, synthetic names only.
const stress = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;
const entries = layoutEntries(stress, undefined);
const index = buildSearchIndex(entries);
const q = (query: string, limit?: number) => searchIndex(index, query, limit);

const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const floor = (over: Record<string, unknown>) => ({ title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices: [], rooms: [], ...over });
const tiny = (floors: Record<string, unknown>) => ({ version: 2, unit: "cm", north: 0, catalog: [], floors }) as unknown as Layout;

describe("S24.1 search entries", () => {
  it("holds every floor, every named room and all 437 devices of the stress house", () => {
    expect(entries.filter((e) => e.kind === "floor").map((e) => e.floor)).toEqual(["ground", "first", "second"]);
    expect(entries.filter((e) => e.kind === "room")).toHaveLength(46);
    expect(entries.filter((e) => e.kind === "device")).toHaveLength(437);
  });

  it("a device carries what a host needs to go there: floor key, device index, entity, room and type label", () => {
    const e = entries.find((x) => x.entity === "light.guest_bedroom_bedside_left")!;
    const f = stress.floors.second;
    expect(e).toMatchObject({ kind: "device", floor: "second", floorName: "Second", name: "Guest bedroom bedside left", type: "light", typeLabel: "Light", roomName: "Guest bedroom" });
    expect(f.devices[e.device!].entity).toBe("light.guest_bedroom_bedside_left");
    expect(f.rooms[e.room!].name).toBe("Guest bedroom");
    expect(entryDetail(e)).toBe("Guest bedroom · Second · Light");
  });

  it("a room carries its floor and index; a floor its key", () => {
    const r = entries.find((x) => x.kind === "room" && x.name === "Server room")!;
    expect(r).toMatchObject({ floor: "second", typeLabel: "Room" });
    expect(stress.floors.second.rooms[r.room!].name).toBe("Server room");
    expect(entryDetail(r)).toBe("Second · Room");
    expect(entryDetail(entries.find((x) => x.kind === "floor" && x.floor === "first")!)).toBe("Floor");
  });

  it("uses HA's friendly name through the state overlay when the plan has none", () => {
    const l = tiny({ g: floor({ devices: [{ id: "d", type: "light", entity: "light.x", x: 1, y: 1 }] }) });
    const st = { "light.x": { state: "on", attributes: { friendly_name: "Desk lamp" }, last_changed: "" } };
    expect(layoutEntries(l, st).find((e) => e.kind === "device")!.name).toBe("Desk lamp");
    expect(layoutEntries(l, undefined).find((e) => e.kind === "device")!.name).toBe("light.x");
  });

  it("a device outside every room has no room; a linked piece is a device of its type", () => {
    const l = tiny({ g: floor({
      rooms: [{ id: "r", name: "Den", area: "", kind: "room", pts: sq(0, 0, 100), wk: [] }],
      devices: [{ id: "d", type: "light", entity: "light.out", name: "Porch", x: 500, y: 500 }],
      furniture: [{ id: "m", symbol: "tv", x: 50, y: 50, rot: 0, w: 100, h: 10, entity: "media_player.den_tv", name: "Den TV" }],
    }) });
    const es = layoutEntries(l, undefined);
    expect(es.find((e) => e.name === "Porch")!.roomName).toBeUndefined();
    const tv = es.find((e) => e.entity === "media_player.den_tv")!;
    expect(tv).toMatchObject({ kind: "device", piece: true, device: 0, type: "tv", roomName: "Den" });
  });
});

describe("S24.1 ranking", () => {
  it('"bedside guest" ranks a guest bedroom bedside lamp first, its two neighbours next', () => {
    const r = q("bedside guest");
    // The fixture has two such lamps (left, right) and a bedside plug; all three match on word prefix, the shorter
    // name first, then layout order: the left lamp.
    expect(r[0]).toMatchObject({ entity: "light.guest_bedroom_bedside_left", type: "light" });
    expect(r.slice(0, 3).map((e) => e.entity).sort()).toEqual(["light.guest_bedroom_bedside_left", "light.guest_bedroom_bedside_right", "switch.guest_bedroom_bedside_plug"]);
    expect(r).toHaveLength(3);
  });

  it("orders exact name, name prefix, word prefix, substring, entity id, then room", () => {
    const es: SearchEntry[] = [
      { kind: "device", id: "6", name: "Fan", entity: "fan.a", roomName: "Lampshade room" }, // room tier: "lamp" only in its room
      { kind: "device", id: "5", name: "Bulb", entity: "light.lamp_7" }, // entity tier
      { kind: "device", id: "4", name: "Floorlamp", entity: "light.b" }, // substring
      { kind: "device", id: "3", name: "Desk lamp", entity: "light.c" }, // word prefix
      { kind: "device", id: "2", name: "Lamp in hall", entity: "light.d" }, // name prefix
      { kind: "device", id: "1", name: "Lamp", entity: "light.e" }, // exact
      { kind: "device", id: "0", name: "Toaster", entity: "switch.t" }, // no match
    ];
    expect(searchIndex(buildSearchIndex(es), "lamp").map((e) => e.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("ignores case and accents, in the query and in names", () => {
    const es: SearchEntry[] = [{ kind: "room", id: "r", name: "Salle à manger" }, { kind: "room", id: "s", name: "Café" }];
    const ix = buildSearchIndex(es);
    expect(searchIndex(ix, "SALLE A").map((e) => e.id)).toEqual(["r"]);
    expect(searchIndex(ix, "cafe").map((e) => e.id)).toEqual(["s"]);
    expect(searchIndex(ix, "CAFÉ").map((e) => e.id)).toEqual(["s"]);
    expect(normalize("  Éé  ÀB ")).toBe("ee ab");
  });

  it("S24.R5: in one tier the shorter name wins over layout order", () => {
    // Both are a name prefix of "desk" (tier 1); the longer one comes first in the layout, so only the length rule
    // puts "Desk" first.
    const es: SearchEntry[] = [
      { kind: "device", id: "long", name: "Desk lamp left", entity: "light.a" },
      { kind: "device", id: "short", name: "Desk", entity: "light.b" },
      { kind: "device", id: "mid", name: "Desk lamp", entity: "light.c" },
    ];
    expect(searchIndex(buildSearchIndex(es), "des").map((e) => e.id)).toEqual(["short", "mid", "long"]);
  });

  it("S24.R10b: letters NFD does not split are folded too: ø, ß, æ, ł, đ, þ, œ", () => {
    expect(normalize("Søren Øster")).toBe("soren oster");
    expect(normalize("Straße")).toBe("strasse");
    expect(normalize("Æble Łódź Đakovo Þór Œuvre")).toBe("aeble lodz dakovo thor oeuvre");
    const ix = buildSearchIndex([{ kind: "room", id: "s", name: "Søren's room" }, { kind: "room", id: "g", name: "Große Küche" }]);
    expect(searchIndex(ix, "soren").map((e) => e.id)).toEqual(["s"]);
    expect(searchIndex(ix, "grosse kuche").map((e) => e.id)).toEqual(["g"]);
    // The query folds the same way, so typing the letter itself still finds it.
    expect(searchIndex(ix, "SØREN").map((e) => e.id)).toEqual(["s"]);
  });

  it("several words must all match, across name, room, floor and type", () => {
    expect(q("guest bedside zzz")).toEqual([]);
    const r = q("second light bedside");
    expect(r.map((e) => e.entity).sort()).toEqual(["light.guest_bedroom_bedside_left", "light.guest_bedroom_bedside_right"]);
  });

  it("an entity id finds its device, first", () => {
    expect(q("switch.guest_bedroom_bedside_plug")[0]).toMatchObject({ kind: "device", name: "Guest bedroom bedside plug" });
    expect(q("light.bedroom_4_bedside_r")[0]?.entity).toBe("light.bedroom_4_bedside_right");
  });

  it("an empty or blank query returns nothing", () => {
    expect(q("")).toEqual([]);
    expect(q("   ")).toEqual([]);
  });

  it("caps at the limit, best first", () => {
    const all = q("bedroom");
    expect(all.length).toBeGreaterThan(10);
    expect(q("bedroom", 10)).toEqual(all.slice(0, 10));
  });

  it("host commands rank the same way as everything else", () => {
    const cmd: SearchEntry = { kind: "command", id: "all-off", name: "Turn off this floor" };
    const ix = buildSearchIndex([...entries, cmd]);
    expect(searchIndex(ix, "turn off")[0]).toBe(cmd);
    expect(entryDetail(cmd)).toBe("Command");
  });

  it("437 devices query in under 5 ms", () => {
    const queries = ["b", "bedside guest", "light.", "stair hall", "zzz", "second light bedside", "kitchen"];
    for (const s of queries) q(s); // warm up
    const runs = 20, t0 = performance.now();
    for (let i = 0; i < runs; i++) for (const s of queries) q(s, 10);
    const per = (performance.now() - t0) / (runs * queries.length);
    expect(per).toBeLessThan(5);
  });
});

describe("S24.1 untrusted layout (finding 1)", () => {
  it("never throws on missing arrays, junk rows and odd names", () => {
    const l = tiny({
      a: { title: 5, rooms: 5, devices: "x" },
      b: { title: "B", rooms: [null, { kind: "room", name: { x: 1 }, pts: 5 }, { kind: "room", name: "__proto__", pts: sq(0, 0, 10) }],
        devices: [null, 7, { type: "nope", entity: 3, x: "a" }, { id: "d", type: "light", entity: "light.ok", name: "<b>Ok</b>", x: 5, y: 5 }], furniture: "no" },
      c: null,
    });
    let es: SearchEntry[] = [];
    expect(() => { es = layoutEntries(l, undefined); }).not.toThrow();
    expect(es.find((e) => e.entity === "light.ok")).toMatchObject({ name: "<b>Ok</b>", roomName: "__proto__", typeLabel: "Light" });
    expect(es.find((e) => e.kind === "floor" && e.floor === "a")!.name).toBe("a");
    expect(() => searchIndex(buildSearchIndex(es), "ok proto")).not.toThrow();
    expect(() => layoutEntries({ floors: 5 } as unknown as Layout, undefined)).not.toThrow();
    expect(() => layoutEntries(null as unknown as Layout, undefined)).not.toThrow();
  });
});
