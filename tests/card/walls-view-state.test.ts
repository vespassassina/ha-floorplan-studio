import { describe, expect, it } from "vitest";
import { parseStoredView } from "../../src/card/view-state";
import { WALLS_MODES } from "../../src/core/solids";

const isView = (v: unknown) => v === "2d" || v === "2.5d";
const parse = (raw: unknown) => parseStoredView(raw, isView, ["light"]);

describe("parseStoredView: walls (storage is untrusted)", () => {
  it("keeps every mode in WALLS_MODES", () => {
    for (const m of WALLS_MODES) expect(parse({ walls: m }), m).toEqual({ walls: m });
  });
  it("drops anything else on its own and keeps the good fields", () => {
    for (const junk of ["", "FULL", "Cut", "tall", " full", "__proto__", "constructor", 1, null, true, ["full"], { full: 1 }]) {
      expect(parse({ walls: junk, labels: false }), JSON.stringify(junk)).toEqual({ labels: false });
    }
  });
  it("round-trips through the JSON string", () => {
    for (const m of WALLS_MODES) expect(parse(JSON.stringify({ v: 1, walls: m, tilt: 0.3 }))).toEqual({ walls: m, tilt: 0.3 });
  });
});
