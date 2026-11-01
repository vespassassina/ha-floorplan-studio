import { describe, expect, it } from "vitest";
import { GATE_ENTITIES, GATE_ROWS, gateFixture } from "./replay-gate-fixture";
import { fetchHistory } from "../../src/card/replay/history";
import { onsets } from "../../src/card/replay/events";
import { coverActive } from "../../src/core/cover";
import { doorStateOf } from "../../src/core/door-state";
import { doorRoomIndexes } from "../../src/core/active";
import { roomAt } from "../../src/core/render";

// R2.7: the gate's fixture has the size the spec names and goes through the real fetch, parse and index. The shape it copies is
// described at the top of replay-gate-fixture.ts (finding 21).
const END = Date.UTC(2026, 9, 28, 12), START = END - 7 * 86400000;
const g = gateFixture(START / 1000, END / 1000);

describe("the 7-day gate fixture", () => {
  it("has 180,000 rows over 93 entities, rows in time order, the first at the start", () => {
    expect(g.rows).toBe(GATE_ROWS);
    expect(Object.keys(g.reply)).toHaveLength(GATE_ENTITIES);
    expect(Object.values(g.reply).reduce((n, r) => n + r.length, 0)).toBe(GATE_ROWS);
    for (const rows of Object.values(g.reply)) {
      expect(rows[0].lu).toBe(START / 1000);
      for (let i = 1; i < rows.length; i++) expect(rows[i].lu).toBeGreaterThanOrEqual(rows[i - 1].lu);
    }
  });
  it("is the same bytes every time", () => {
    expect(JSON.stringify(gateFixture(START / 1000, END / 1000).reply)).toBe(JSON.stringify(g.reply));
  });
  it("is two calls' shapes: attributes on every row of a light, on the first row only of a sensor", () => {
    expect(g.reply["light.l0"].every((r) => r.a)).toBe(true);
    expect(g.reply["sensor.power"].filter((r) => r.a)).toHaveLength(1);
  });
  it("parses through fetchHistory and indexes with events in every group", async () => {
    const index = await fetchHistory((m) => Promise.resolve(Object.fromEntries(m.entity_ids.map((id) => [id, g.reply[id]]))), g.asked, START, END);
    expect([...index.values()].reduce((n, r) => n + r.length, 0)).toBe(GATE_ROWS);
    const o = onsets(index, g.floor, { doorStateOf, coverActive, roomAt, doorRooms: doorRoomIndexes });
    for (const group of ["lamp", "motion", "opening"]) expect(o.some((e) => e.group === group), group).toBe(true);
    expect(o.some((e) => e.kind === "door" && e.rooms?.length), "a door with its rooms").toBe(true);
    expect(o.some((e) => e.group === "motion" && e.rooms?.length), "a motion onset with its room").toBe(true);
  });
});
