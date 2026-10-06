import { describe, expect, it } from "vitest";
import { DEVICE_TYPES } from "../../src/core/schema";
import { CATEGORIES, CATEGORY_OF, groupByCategory } from "../../src/core/categories";

describe("S14.6 device categories", () => {
  it("every DEVICE_TYPE is assigned to exactly one listed category (a new type fails here until it is placed)", () => {
    const ids = new Set(CATEGORIES.map((c) => c.id));
    for (const t of DEVICE_TYPES) {
      expect(ids.has(CATEGORY_OF[t]), `${t} has no category`).toBe(true);
    }
    expect(Object.keys(CATEGORY_OF).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it("every category has a label and at least one type; ids are unique", () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(DEVICE_TYPES.some((t) => CATEGORY_OF[t] === c.id), c.id).toBe(true);
    }
  });

  it("the order is fixed: lights, climate, security, media first", () => {
    expect(CATEGORIES.slice(0, 4).map((c) => c.id)).toEqual(["lights", "climate", "security", "media"]);
  });

  it("groups in category order, not input order, keeps row order inside a group and drops empty categories", () => {
    const items = [
      { type: "tv", n: 1 }, { type: "camera", n: 2 }, { type: "ac", n: 3 }, { type: "light", n: 4 }, { type: "heater", n: 5 }, { type: "light", n: 6 },
    ] as const;
    const g = groupByCategory([...items]);
    expect(g.map((x) => x.id)).toEqual(["lights", "climate", "security", "media"]);
    expect(g[0].items.map((i) => i.n)).toEqual([4, 6]);
    expect(g[1].items.map((i) => i.n)).toEqual([3, 5]); // input order inside the group
  });

  it("an empty list is no groups; an unknown type (untrusted input) lands in 'other', never throws", () => {
    expect(groupByCategory([])).toEqual([]);
    const g = groupByCategory([{ type: "nope" as never }]);
    expect(g.map((x) => x.id)).toEqual(["other"]);
  });
});
