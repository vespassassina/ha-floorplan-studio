import { describe, expect, it } from "vitest";
import type { Floor, Furniture } from "../../src/core/schema";
import { activeDevices } from "../../src/core/active";
import { classOf, FLOORPLAN_CSS, THEMES, pieceOn, renderFloor, type StateOverlay } from "../../src/core/render";
import { pieceDevice } from "../../src/core/solids";
import { LINKED } from "../../src/core/link";

// B53.11: a linked appliance or plant is a device for its state, Active row and tap, as a car piece. States are copied from the shapes in
// link.test.ts (Home Connect washer, Mi Flora moisture, a Zigbee door contact).
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-11-06T10:00:00Z" });
const piece = (symbol: string, extra: Partial<Furniture> = {}): Furniture => ({ id: "p", symbol, x: 300, y: 200, rot: 0, w: 60, h: 60, ...extra }) as Furniture;
const floorOf = (furniture: Furniture[]): Floor => ({
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], devices: [], furniture,
  rooms: [{ id: "r0", name: "Kitchen", area: "", kind: "room", pts: [[0, 0], [800, 0], [800, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] }],
}) as unknown as Floor;
const draw = (m: Furniture, state?: StateOverlay, view?: "2.5d") => renderFloor(floorOf([m]), { scale: 1, ...(state ? { state } : {}), ...(view ? { view } : {}) });
const groupOf = (html: string) => /<g data-f="0"[^>]*>/.exec(html)?.[0] ?? "";
const WASHER = piece("washer", { entity: "sensor.washer_operation_state", attached: ["binary_sensor.washer_door"] });
const RUN: StateOverlay = { "sensor.washer_operation_state": st("run"), "binary_sensor.washer_door": st("off", { device_class: "door" }) };
const READY: StateOverlay = { ...RUN, "sensor.washer_operation_state": st("ready") };
const FERN = piece("plant", { w: 40, h: 40, entity: "sensor.fern_moisture", minMoisture: 30 });
const DRY: StateOverlay = { "sensor.fern_moisture": st("14", { device_class: "moisture", unit_of_measurement: "%" }) };
const WET: StateOverlay = { "sensor.fern_moisture": st("48", { device_class: "moisture", unit_of_measurement: "%" }) };

describe("pieceDevice: a linked appliance or plant speaks for its entities", () => {
  it("has the main entity, the attached ones and its name; none without an entity", () => {
    expect(pieceDevice(piece("washer", { entity: "sensor.a", attached: ["sensor.b", 7 as never], name: "Washer" }))).toMatchObject({ entity: "sensor.a", attached: ["sensor.b"], name: "Washer", sym: "washer" });
    expect(pieceDevice(piece("fridge", { attached: ["binary_sensor.door"] }))).toMatchObject({ entity: "binary_sensor.door" });
    expect(pieceDevice(piece("dryer"))).toBeNull();
    expect(pieceDevice(piece("plant", { entity: "sensor.m", minMoisture: 33 }))).toMatchObject({ sym: "plant", min: 33 });
  });
  it("every linked symbol has one; a rug and a sofa with an entity do not", () => {
    for (const s of LINKED) expect(pieceDevice(piece(s, { entity: "sensor.x" })), s).not.toBeNull();
    expect(pieceDevice(piece("rug", { entity: "sensor.x" }))).toBeNull();
    expect(pieceDevice(piece("sofa", { entity: "sensor.x" }))).toBeNull();
  });
});

describe("an appliance on the plan", () => {
  it("is on while it runs, in 2D and 2.5D, and idle on ready", () => {
    for (const view of [undefined, "2.5d" as const]) {
      expect(groupOf(draw(WASHER, RUN, view)), `${view} run`).toMatch(/class="furn on[ "]/);
      expect(groupOf(draw(WASHER, READY, view)), `${view} ready`).not.toMatch(/ on[ "]/);
    }
    expect(pieceOn({ scale: 1, state: RUN }, WASHER)).toBe(true);
    expect(pieceOn({ scale: 1, state: READY }, WASHER)).toBe(false);
  });
  it("a main entity that is a switch and on is not 'running' for a washer, but is for a stove", () => {
    const on: StateOverlay = { "switch.x": st("on") };
    expect(pieceOn({ scale: 1, state: on }, piece("washer", { entity: "switch.x" }))).toBe(false);
    expect(pieceOn({ scale: 1, state: on }, piece("stove", { entity: "switch.x" }))).toBe(true);
  });
  it("an open door wears the alert class; closed does not", () => {
    const open: StateOverlay = { ...READY, "binary_sensor.washer_door": st("on", { device_class: "door" }) };
    expect(groupOf(draw(WASHER, open))).toMatch(/ alert/);
    expect(groupOf(draw(WASHER, open, "2.5d"))).toMatch(/ alert/);
    expect(groupOf(draw(WASHER, READY))).not.toMatch(/ alert/);
  });
  it("an unlinked washer is as before, and a linked one keeps the idle colour (no tv-blue data-linked)", () => {
    expect(groupOf(draw(piece("washer")))).toMatch(/class="furn"/);
    expect(groupOf(draw(WASHER, RUN))).toContain('data-linked="pc"'); // tappable, but not the tv's blue (.furn[data-linked=""])
    expect(groupOf(draw(piece("tv", { entity: "media_player.x" })))).toMatch(/data-linked(?!=)/);
  });
  it("classOf: a dead main entity is unavailable unless something else says it runs", () => {
    const dev = pieceDevice(piece("washer", { entity: "sensor.w", attached: ["sensor.w_power"] }))!;
    const o = (state: StateOverlay) => ({ scale: 1, state });
    expect(classOf(dev, o({ "sensor.w": st("unavailable") }))).toBe("unavailable");
    expect(classOf(dev, o({ "sensor.w": st("unavailable"), "sensor.w_power": st("300", { device_class: "power", unit_of_measurement: "W" }) }))).toBe("on");
  });
  it("Active lists a running washer and not an idle one", () => {
    const layout = (state: StateOverlay) => activeDevices({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: floorOf([WASHER]) } } as never, state as never).length;
    expect(layout(RUN)).toBe(1);
    expect(layout(READY)).toBe(0);
  });
});

describe("a plant on the plan", () => {
  it("a thirsty plant wears 'thirsty' and a glow, in 2D and 2.5D; one with enough water does not", () => {
    for (const view of [undefined, "2.5d" as const]) {
      const dry = draw(FERN, DRY, view);
      expect(groupOf(dry), `${view} dry`).toMatch(/ thirsty/);
      expect(dry, `${view} glow`).toContain('class="plant-glow"');
      const wet = draw(FERN, WET, view);
      expect(groupOf(wet), `${view} wet`).not.toMatch(/ thirsty/);
      expect(wet, `${view} no glow`).not.toContain("plant-glow");
    }
  });
  it("keeps its plant class and its own threshold (30 here, 20 by default)", () => {
    expect(groupOf(draw(FERN, DRY))).toContain("furn-plant");
    const at25: StateOverlay = { "sensor.fern_moisture": st("25", { device_class: "moisture", unit_of_measurement: "%" }) };
    expect(groupOf(draw(FERN, at25))).toMatch(/ thirsty/);
    expect(groupOf(draw({ ...FERN, minMoisture: undefined } as Furniture, at25))).not.toMatch(/ thirsty/);
  });
  it("is on only while thirsty, and Active lists it only then", () => {
    expect(pieceOn({ scale: 1, state: DRY }, FERN)).toBe(true);
    expect(pieceOn({ scale: 1, state: WET }, FERN)).toBe(false);
    const n = (state: StateOverlay) => activeDevices({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: floorOf([FERN]) } } as never, state as never).length;
    expect(n(DRY)).toBe(1);
    expect(n(WET)).toBe(0);
  });
  it("an unlinked plant has no glow and no data-linked", () => {
    const html = draw(piece("plant", { w: 40, h: 40 }), DRY);
    expect(html).not.toContain("plant-glow");
  });
  it("the glow is in the stylesheet with the keyframes of the car's, and a reduced-motion rule", async () => {
    const { FLOORPLAN_CSS } = await import("../../src/core/render");
    expect(FLOORPLAN_CSS).toMatch(/\.plant-glow/);
    expect(FLOORPLAN_CSS).toMatch(/--fp-plant-thirsty/);
    expect(/prefers-reduced-motion:reduce\)\{[^}]*plant-glow/.test(FLOORPLAN_CSS)).toBe(true);
  });
});

describe("--fp-plant-thirsty", () => {
  it("is set on every theme's own token line, and is a blue on each", () => {
    for (const th of THEMES) {
      const block = new RegExp(`\\n\\[data-theme="${th}"\\]\\{([^}]*)\\}`).exec(FLOORPLAN_CSS.replace(/,\[data-theme="[^"]+"\]\{/g, (m) => `\n${m.slice(1)}`))?.[1] ?? "";
      const hex = /--fp-plant-thirsty:(#[0-9a-f]{6})/i.exec(block)?.[1];
      expect(hex, th).toBeTruthy();
      const [r, , b] = [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16));
      expect(b, `${th} ${hex} is bluer than red`).toBeGreaterThan(r);
    }
  });
});
