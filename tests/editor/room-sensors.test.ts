import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { MAX_ROOM_SENSORS, validate, type HaData, type Layout } from "../../src/core";
import { setRoomList } from "../../src/editor/ops";
import { EditorState } from "../../src/editor/state";

/**
 * S11.2: a room owns temperature, humidity and motion sensors, picked in the room panel or moved off a loose icon
 * with "Attach to room". Both go through EditorState, one undo step each, and must leave a layout `validate` accepts
 * (CLAUDE.md findings 6 and 12).
 */
const fresh = () => structuredClone(demo) as unknown as Layout;
const LIVING = 0; // demo ground floor: Living, with temp-living at (380,120)
const ok = (l: Layout) => { const r = validate(l); expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true); };

describe("setRoomList", () => {
  const room = () => ({ ...fresh().floors.ground.rooms[LIVING] });
  it("adds, keeps order, and never lists an entity twice", () => {
    const r = room();
    setRoomList(r, "temps", ["sensor.a", "sensor.b", "sensor.a"]);
    expect(r.temps).toEqual(["sensor.a", "sensor.b"]);
  });
  it("an empty list deletes the key", () => {
    const r = room(); r.temps = ["sensor.a"];
    setRoomList(r, "temps", []);
    expect("temps" in r).toBe(false);
  });
  it("stops at MAX_ROOM_SENSORS", () => {
    const r = room();
    setRoomList(r, "humidity", Array.from({ length: MAX_ROOM_SENSORS + 5 }, (_, i) => `sensor.h${i}`));
    expect(r.humidity).toHaveLength(MAX_ROOM_SENSORS);
  });
  it("every list size from 0 to past the cap, for every field, validates", () => {
    for (const field of ["temps", "humidity", "motion"] as const)
      for (const n of [0, 1, 2, MAX_ROOM_SENSORS - 1, MAX_ROOM_SENSORS, MAX_ROOM_SENSORS + 1]) {
        const l = fresh(); const r = l.floors.ground.rooms[LIVING];
        const prefix = field === "motion" ? "binary_sensor" : "sensor";
        setRoomList(r, field, Array.from({ length: n }, (_, i) => `${prefix}.x${i}`));
        ok(l);
      }
  });
});

describe("EditorState room sensors", () => {
  it("a pick is one undo step; undo restores the list and the icon", () => {
    const st = new EditorState(fresh());
    const before = JSON.stringify(st.layout);
    const r = st.attachEntity("sensor.demo_living_temperature", (f) => setRoomList(f.rooms[LIVING], "temps", ["sensor.demo_living_temperature"]));
    expect(r).toEqual({ changed: true, pulled: true });
    expect(st.f.rooms[LIVING].temps).toEqual(["sensor.demo_living_temperature"]);
    ok(st.layout);
    expect(st.undo()).toBe(true);
    expect(JSON.stringify(st.layout)).toBe(before);
    expect(st.canUndo).toBe(false);
  });

  it("picking an entity already in the list is no step", () => {
    const l = fresh(); l.floors.ground.rooms[LIVING].temps = ["sensor.other"];
    const st = new EditorState(l);
    const r = st.attachEntity("sensor.other", (f) => setRoomList(f.rooms[LIVING], "temps", [...(f.rooms[LIVING].temps ?? []), "sensor.other"]));
    expect(r.changed).toBe(false);
    expect(st.canUndo).toBe(false);
  });

  it("roomSensorChoices lists only the right kind, and not what another room already owns", () => {
    const st = new EditorState(fresh());
    const t = st.roomSensorChoices(LIVING, "temps").map((c) => c.entity);
    expect(t).toContain("sensor.demo_living_temperature");
    expect(t).not.toContain("sensor.demo_bathroom_humidity");
    expect(t).not.toContain("binary_sensor.demo_hall_motion");
    expect(st.roomSensorChoices(LIVING, "humidity").map((c) => c.entity)).toEqual(["sensor.demo_bathroom_humidity"]);
    expect(st.roomSensorChoices(LIVING, "motion").map((c) => c.entity)).toEqual(["binary_sensor.demo_hall_motion"]);
    st.edit((f) => { f.rooms[1].temps = ["sensor.demo_living_temperature"]; });
    expect(st.roomSensorChoices(LIVING, "temps").map((c) => c.entity)).not.toContain("sensor.demo_living_temperature");
  });

  it("roomSensorChoices offers HA entities of the right device class never placed", () => {
    const st = new EditorState(fresh());
    const e = (id: string, domain: string, dc?: string) => ({ id, name: id, area: null, domain, dc }) as HaData["entities"][number];
    st.ha = { floors: [], areas: [], entities: [e("sensor.t9", "sensor", "temperature"), e("sensor.h9", "sensor", "humidity"), e("binary_sensor.m9", "binary_sensor", "presence"), e("sensor.pw", "sensor", "power"), e("binary_sensor.d9", "binary_sensor", "door")] };
    expect(st.roomSensorChoices(LIVING, "temps").map((c) => c.entity)).toContain("sensor.t9");
    expect(st.roomSensorChoices(LIVING, "temps").map((c) => c.entity)).not.toContain("sensor.pw");
    expect(st.roomSensorChoices(LIVING, "humidity").map((c) => c.entity)).toContain("sensor.h9");
    const m = st.roomSensorChoices(LIVING, "motion").map((c) => c.entity);
    expect(m).toContain("binary_sensor.m9");
    expect(m).not.toContain("binary_sensor.d9");
  });
});

describe("Attach to room", () => {
  const devIndex = (st: EditorState, id: string) => st.f.devices.findIndex((d) => d.id === id);

  it("moves a loose temp into its room in one undo step", () => {
    const st = new EditorState(fresh());
    const i = devIndex(st, "temp-living");
    expect(st.roomAttach(i)).toMatchObject({ ok: true, field: "temps" });
    expect(st.attachToRoom(i)).toBe(true);
    expect(st.f.rooms[LIVING].temps).toEqual(["sensor.demo_living_temperature"]);
    expect(st.f.devices.some((d) => d.id === "temp-living")).toBe(false);
    ok(st.layout);
    expect(st.undo()).toBe(true);
    expect(st.f.devices.some((d) => d.id === "temp-living")).toBe(true);
    expect(st.f.rooms[LIVING].temps).toBeUndefined();
    expect(st.canUndo).toBe(false);
  });

  it("picks the right list for humidity and motion", () => {
    const st = new EditorState(fresh());
    st.floor = "first";
    expect(st.roomAttach(st.f.devices.findIndex((d) => d.id === "humidity-bathroom"))).toMatchObject({ ok: true, field: "humidity" });
    st.floor = "ground";
    expect(st.roomAttach(devIndex(st, "motion-hall"))).toMatchObject({ ok: true, field: "motion" });
  });

  it("goes to the smallest room holding the point, never a zone", () => {
    const st = new EditorState(fresh());
    // the Reading corner zone (340..460, 40..?) covers temp-living; the room under it must win
    const zone = st.f.rooms.find((r) => r.kind === "zone")!;
    expect(zone.pts.some((p) => p[0] === 340)).toBe(true);
    const a = st.roomAttach(devIndex(st, "temp-living"));
    expect(a.ok && st.f.rooms[a.room].name).toBe("Living");
  });

  it("says why it cannot: no entity, outside every room, already on the room, a type that is not a room sensor, list full", () => {
    const st = new EditorState(fresh());
    const i = devIndex(st, "temp-living");
    st.edit((f) => { f.devices[i].entity = ""; });
    expect(st.roomAttach(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/entity/i) });
    expect(st.attachToRoom(i)).toBe(false);
    st.undo();
    st.edit((f) => { Object.assign(f.devices[i], { x: 5000, y: 5000 }); });
    expect(st.roomAttach(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/room/i) });
    st.undo();
    st.edit((f) => { f.rooms[LIVING].temps = ["sensor.demo_living_temperature"]; });
    expect(st.roomAttach(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/already/i) });
    st.undo();
    st.edit((f) => { f.rooms[LIVING].temps = Array.from({ length: MAX_ROOM_SENSORS }, (_, k) => `sensor.x${k}`); });
    expect(st.roomAttach(i)).toMatchObject({ ok: false, reason: expect.stringMatching(/full|20/i) });
    const before = JSON.stringify(st.layout);
    expect(st.attachToRoom(i)).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(before);
    const light = devIndex(st, st.f.devices.find((d) => d.type === "light")!.id);
    expect(st.roomAttach(light)).toMatchObject({ ok: false });
  });

  it("roomOwning names the room whose list holds a device's entity", () => {
    const st = new EditorState(fresh());
    const i = devIndex(st, "temp-living");
    expect(st.roomOwning(i)).toBeNull();
    st.edit((f) => { f.rooms[LIVING].temps = ["sensor.demo_living_temperature"]; });
    expect(st.roomOwning(i)).toBe("Living");
  });
});
