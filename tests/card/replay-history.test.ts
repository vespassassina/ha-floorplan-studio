import { describe, expect, it } from "vitest";
import { REPLAY_CHUNK, historyRequest, parseHistory, stateAt } from "../../src/card/replay/history";

// Shape of the reply, copied from Home Assistant core (checked 2026-10-28, branch dev):
//  - homeassistant/components/history/websocket_api.py: `history/history_during_period` answers with the result of
//    `get_significant_states`, an object { [entity_id]: CompressedState[] } with no wrapper.
//  - homeassistant/components/recorder/models/state.py (`row_to_compressed_state`): a row is { s, a?, lu, lc? }; `a` is left
//    out under no_attributes; `lc` is left out when it equals `lu`; both times are float seconds since the epoch.
//  - homeassistant/const.py: COMPRESSED_STATE_STATE "s", _ATTRIBUTES "a", _LAST_CHANGED "lc", _LAST_UPDATED "lu".

const T = (s: number) => s * 1000;
const ASKED = ["light.a", "sensor.b", "binary_sensor.c"];

const REPLY = {
  "light.a": [
    { s: "off", a: { brightness: 10 }, lu: 1000.5 },
    { s: "on", a: { brightness: 200 }, lu: 2000, lc: 1999 },
    { s: "off", lu: 3000 }, // no `a`: keeps the brightness of the row before
  ],
  "sensor.b": [{ s: "21.5", a: { unit: "C" }, lu: 1500, lc: 1400 }],
  "binary_sensor.c": [
    // Junk and unsorted: only the two valid rows stay, in time order.
    { s: "on", a: { x: 1 }, lu: 2500 },
    null,
    {},
    { s: "off", lu: "x" },
    { s: "off", lu: NaN },
    { s: 5, lu: 10 },
    { s: "off", lu: 1200 },
  ],
};

describe("parseHistory", () => {
  it("reads three entities, drops junk rows and sorts by lu", () => {
    const idx = parseHistory(REPLY, ASKED);
    expect([...idx.keys()].sort()).toEqual([...ASKED].sort());
    const c = idx.get("binary_sensor.c")!;
    expect(c.map((r) => r.state)).toEqual(["off", "on"]);
    expect(c.map((r) => r.lu)).toEqual([1200, 2500]);
    expect(idx.get("light.a")!).toHaveLength(3);
  });

  it("drops a time that is finite but past what a Date can hold, and stateAt never throws on the rest (B2)", () => {
    // new Date(1e20 * 1000).toISOString() throws RangeError; the limit is 8.64e12 seconds either way.
    const idx = parseHistory({
      "light.a": [{ s: "on", lu: 100, lc: 1e20 }, { s: "off", lu: -1e20 }, { s: "on", lu: 8.64e12 + 1 }, { s: "on", lu: 200, lc: -8.64e12 - 1 }],
    }, ["light.a"]);
    expect(idx.get("light.a")!.map((r) => [r.lu, r.lc])).toEqual([[100, 100], [200, 200]]); // bad lc is lc = lu; bad lu rows are gone
    expect(() => stateAt(idx, T(1e9))).not.toThrow();
    expect(stateAt(idx, T(150))["light.a"].last_changed).toBe(new Date(T(100)).toISOString());
  });

  it("gives an empty index for __proto__, constructor, a number, null, an array, a string", () => {
    const evil = JSON.parse('{"__proto__":[{"s":"on","lu":1}],"constructor":[{"s":"on","lu":1}]}');
    expect(parseHistory(evil, ["__proto__", "constructor"]).size).toBe(0);
    for (const bad of [5, null, undefined, "x", [], true]) expect(parseHistory(bad, ASKED).size).toBe(0);
  });

  it("drops an entity that was not asked for", () => {
    const idx = parseHistory({ "light.a": [{ s: "on", lu: 1 }], "light.other": [{ s: "on", lu: 1 }] }, ["light.a"]);
    expect([...idx.keys()]).toEqual(["light.a"]);
  });

  it("drops an entity whose list is not an array or has no valid row", () => {
    const idx = parseHistory({ "light.a": { s: "on", lu: 1 }, "sensor.b": [null, 3] }, ASKED);
    expect(idx.size).toBe(0);
  });
});

describe("stateAt", () => {
  const idx = parseHistory(REPLY, ASKED);

  it("is empty before every row", () => {
    expect(stateAt(idx, T(1000))).toEqual({});
  });

  it("takes the first row at its time, even by a fraction", () => {
    const s = stateAt(idx, T(1000.5));
    expect(Object.keys(s)).toEqual(["light.a"]);
    expect(s["light.a"].state).toBe("off");
    expect(s["light.a"].attributes).toEqual({ brightness: 10 });
  });

  it("takes the last row before t, one entity per its own rows", () => {
    const s = stateAt(idx, T(2100));
    expect(s["light.a"].state).toBe("on");
    expect(s["light.a"].attributes).toEqual({ brightness: 200 });
    expect(s["sensor.b"].state).toBe("21.5");
    expect(s["binary_sensor.c"].state).toBe("off");
  });

  it("takes a row exactly on its time, not the one before", () => {
    const s = stateAt(idx, T(2500));
    expect(s["binary_sensor.c"].state).toBe("on");
    expect(s["light.a"].state).toBe("on");
  });

  it("carries attributes forward over a row without them", () => {
    const s = stateAt(idx, T(3000));
    expect(s["light.a"].state).toBe("off");
    expect(s["light.a"].attributes).toEqual({ brightness: 200 });
  });

  it("holds the last row after the end", () => {
    const s = stateAt(idx, T(9e6));
    expect(s["light.a"].state).toBe("off");
    expect(s["binary_sensor.c"].state).toBe("on");
  });

  it("gives last_changed from lc as ISO, and from lu when lc is missing or not finite", () => {
    const s = stateAt(idx, T(2100));
    expect(s["light.a"].last_changed).toBe(new Date(T(1999)).toISOString());
    expect(s["binary_sensor.c"].last_changed).toBe(new Date(T(1200)).toISOString()); // lc missing: lu of the "off" row
    const odd = parseHistory({ "light.a": [{ s: "on", lu: 50, lc: "z" }] }, ["light.a"]);
    expect(stateAt(odd, T(60))["light.a"].last_changed).toBe(new Date(T(50)).toISOString());
  });

  it("starts attributes at {} when no row has any", () => {
    const i = parseHistory({ "light.a": [{ s: "on", lu: 5 }] }, ["light.a"]);
    expect(stateAt(i, T(6))["light.a"].attributes).toEqual({});
  });
});

describe("historyRequest", () => {
  it("builds the websocket message with unique, sorted ids", () => {
    const m = historyRequest(["sensor.b", "light.a", "sensor.b"], T(1000), T(2000));
    expect(m).toEqual({
      type: "history/history_during_period",
      start_time: new Date(T(1000)).toISOString(),
      end_time: new Date(T(2000)).toISOString(),
      entity_ids: ["light.a", "sensor.b"],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    });
  });
});

it("has a marker only this module carries", () => {
  expect(REPLAY_CHUNK).toBe("fp-replay-v1");
});
