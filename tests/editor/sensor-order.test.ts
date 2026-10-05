import { describe, it, expect } from "vitest";
import type { CatalogEntry, Layout } from "../../src/core/schema";
import { groupSensorChoices } from "../../src/editor/sensor-order";

// Three floors, the edited room (Study) is the LAST room of the SECOND floor, and the catalog lists it last too.
const room = (name: string) => ({ name });
const layout = {
  floors: {
    ground: { title: "Ground", rooms: [room("Hall"), room("Kitchen")] },
    first: { title: "First floor", rooms: [room("Bedroom"), room("Bath"), room("Study")] },
    attic: { title: "Attic", rooms: [room("Loft")] },
  },
} as unknown as Layout;
const e = (entity: string, floor: string, rm: string): CatalogEntry => ({ id: entity, floor, room: rm, type: "temp", name: entity, entity });
const catalog = [
  e("t.loft", "attic", "Loft"), e("t.hall", "ground", "Hall"), e("t.kitchen", "ground", "Kitchen"), e("t.nowhere", "ground", ""),
  e("t.bath", "first", "Bath"), e("t.bed", "first", "Bedroom"), e("t.study", "first", "Study"), e("t.bed2", "first", "Bedroom"),
];

describe("groupSensorChoices", () => {
  it("puts the edited room first, then its floor, then other floors in layout order", () => {
    const out = groupSensorChoices(layout, catalog, "first", "Study");
    const groups = [...new Set(out.map((o) => o.group))];
    expect(groups).toEqual([
      "First floor · Study", "First floor · Bedroom", "First floor · Bath",
      "Ground · Hall", "Ground · Kitchen", "Ground · No room", "Attic · Loft",
    ]);
  });
  it("keeps the incoming order inside a group, and groups are contiguous", () => {
    const out = groupSensorChoices(layout, catalog, "first", "Study");
    expect(out.filter((o) => o.group === "First floor · Bedroom").map((o) => o.entry.entity)).toEqual(["t.bed", "t.bed2"]);
    expect(out.map((o) => o.entry.entity)).toEqual(["t.study", "t.bed", "t.bed2", "t.bath", "t.hall", "t.kitchen", "t.nowhere", "t.loft"]);
  });
  it("sends entities with no known floor or room to the end without throwing", () => {
    const odd = [{ ...e("t.ha", "", ""), id: "x" }, e("t.stale", "gone", "Old"), e("t.hall", "ground", "Hall"), { ...e("t.ha2", "", "Den") }];
    const out = groupSensorChoices(layout, odd, "first", "Study");
    expect(out[0].group).toBe("Ground · Hall");
    expect(out.slice(1).map((o) => o.group).sort()).toEqual(["Den", "Elsewhere", "Old"]);
  });
  it("a roomless selection or an empty room name never matches roomless entries as 'the edited room'", () => {
    const out = groupSensorChoices(layout, [e("t.nowhere", "first", ""), e("t.bed", "first", "Bedroom")], "first", "");
    expect(out[0].group).toBe("First floor · Bedroom");
  });
});
