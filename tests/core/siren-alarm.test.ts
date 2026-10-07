import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { DEVICE_TYPES, validate, type DeviceType, type Layout } from "../../src/core/schema";
import { typeForEntity, type HaData } from "../../src/core/ha";
import { DEVICE_ICONS, DEVICE_TYPE_LABELS } from "../../src/core/icons";
import { DEVICE_COLOURS, FLOORPLAN_CSS, renderFloor, type StateOverlay } from "../../src/core/render";
import { ACTIVE_LIST_RULE, activeDevices, colorVarFor } from "../../src/core/active";
import { CATEGORY_OF } from "../../src/core/categories";
import { ROOM_ROW_TAP } from "../../src/core/room-info";
import { NO_TOGGLE } from "../../src/card/actions";
import { popupOp } from "../../src/card/popup";

// S18.14: `siren` and `alarm` are real device types, each a decision in every per-type table (finding 17).
type Ent = HaData["entities"][number];
const ent = (id: string, domain: string, dc?: string): Ent => ({ id, name: id, domain, dc });
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-07T10:00:00Z" });
const ground = (demo as unknown as Layout).floors.ground;
const draw = (type: string, entity: string, state: string) =>
  renderFloor({ ...structuredClone(ground), devices: [{ id: `${type}-x`, type, entity, x: 400, y: 300 }] } as never, { scale: 0.5, now: Date.parse("2026-10-07T10:00:05Z"), fade: 10, state: { [entity]: st(state) } as StateOverlay });
const group = (html: string) => html.match(/<g data-x="0"[^>]*>.*?<\/g>/s)![0];

describe("siren and alarm are device types", () => {
  it("are members of DEVICE_TYPES, once", () => {
    for (const t of ["siren", "alarm"]) expect(DEVICE_TYPES.filter((x) => x === t), t).toHaveLength(1);
  });
  it("validate accepts them and migrate keeps them; a made-up type still fails", () => {
    for (const t of ["siren", "alarm"]) {
      const l = structuredClone(demo) as any; l.floors.ground.devices.push({ id: "x1", type: t, entity: "x.y", x: 10, y: 10 });
      expect(validate(l).ok, t).toBe(true);
      expect(migrate(l).floors.ground.devices.at(-1)?.type, t).toBe(t);
    }
    const bad = structuredClone(demo) as any; bad.floors.ground.devices.push({ id: "x1", type: "klaxon", entity: "x.y", x: 10, y: 10 });
    expect(validate(bad).ok).toBe(false);
  });
  it("siren.* is a siren and alarm_control_panel.* is an alarm, not other or media", () => {
    expect(typeForEntity(ent("siren.hall", "siren"))).toBe("siren");
    expect(typeForEntity(ent("alarm_control_panel.home", "alarm_control_panel"))).toBe("alarm");
  });
  it("every table decides them: icon, label, colour, category, list rule, tap", () => {
    for (const t of ["siren", "alarm"] as DeviceType[]) {
      expect(DEVICE_ICONS[t], t).toMatch(/^M/);
      expect(DEVICE_TYPE_LABELS[t], t).toBeTruthy();
      expect(DEVICE_COLOURS[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(CATEGORY_OF[t], t).toBe("security");
      expect(ACTIVE_LIST_RULE[t], t).toBe("on");
      expect(ROOM_ROW_TAP[t], t).toBe("more-info");
    }
    expect(DEVICE_ICONS.siren).not.toBe(DEVICE_ICONS.alarm);
    expect(DEVICE_ICONS.siren).not.toBe(DEVICE_ICONS.other);
    expect(DEVICE_ICONS.alarm).not.toBe(DEVICE_ICONS.other);
  });
  it("a siren tap offers on/off for a siren entity; an alarm never toggles, it opens more-info", () => {
    expect(NO_TOGGLE.has("alarm")).toBe(true);
    expect(NO_TOGGLE.has("siren")).toBe(false);
    expect(popupOp("alarm", "alarm_control_panel.home", "armed_away")).toBeNull();
    expect(popupOp("siren", "siren.hall", "on")).toMatchObject({ domain: "siren" });
  });
  it("a siren is on when its entity is on and wears the danger colour; its rings still come from the siren domain", () => {
    const on = group(draw("siren", "siren.hall", "on"));
    expect(on).toContain("dev-siren on");
    expect(on).toContain("siren-ring");
    expect(group(draw("siren", "siren.hall", "off"))).toContain("dev-siren off");
    expect(group(draw("siren", "siren.hall", "off"))).not.toContain("siren-ring");
    expect(FLOORPLAN_CSS).toMatch(/\.dev-siren\.on\{--fp-dev:var\(--fp-danger\)\}/);
  });
  it("an alarm is on while armed or triggered, off when disarmed, and wears the danger colour", () => {
    for (const s of ["armed_home", "armed_away", "armed_night", "arming", "pending", "triggered"]) expect(group(draw("alarm", "alarm_control_panel.home", s)), s).toContain("dev-alarm on");
    expect(group(draw("alarm", "alarm_control_panel.home", "disarmed"))).toContain("dev-alarm off");
    expect(group(draw("alarm", "alarm_control_panel.home", "unavailable"))).toContain("dev-alarm unavailable");
    expect(FLOORPLAN_CSS).toMatch(/\.dev-alarm\.on\{--fp-dev:var\(--fp-danger\)\}/);
  });
  it("the Active list shows an armed alarm and a sounding siren with the danger token, and not a disarmed one", () => {
    const l = { ...structuredClone(demo), floors: { f: { ...structuredClone(ground), devices: [
      { id: "a", type: "alarm", entity: "alarm_control_panel.home", x: 0, y: 0 }, { id: "s", type: "siren", entity: "siren.hall", x: 10, y: 0 },
    ] } } } as unknown as Layout;
    const items = activeDevices(l, { "alarm_control_panel.home": st("armed_away"), "siren.hall": st("on") });
    expect(items.map((i) => i.entity).sort()).toEqual(["alarm_control_panel.home", "siren.hall"]);
    for (const i of items) expect(i.colorVar).toBe("--fp-danger");
    expect(activeDevices(l, { "alarm_control_panel.home": st("disarmed"), "siren.hall": st("off") })).toEqual([]);
    expect(colorVarFor({ id: "s", type: "siren", entity: "siren.hall", x: 0, y: 0 } as never, undefined)).toBe("--fp-danger");
  });
});
