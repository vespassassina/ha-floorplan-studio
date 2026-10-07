import { describe, it, expect } from "vitest";
import { render } from "lit";
import { DEVICE_TYPES } from "../../src/core/schema";
import { POPULAR_TYPES, TYPE_LABELS, typeMenu, typeOptions } from "../../src/editor/panels";

// S18.14: the device type menu. Popular on top, a separator, the rest A to Z by the label the menu shows.
describe("the device type menu", () => {
  it("names the popular types in Diego's order, then the rest A to Z by label", () => {
    const m = typeMenu();
    expect(m.popular.map(([t]) => t)).toEqual(["light", "switch", "motion", "contact", "temp", "speaker", "tv"]);
    const labels = m.rest.map(([, l]) => l);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
    expect(labels[0]).toBe("3D printer"); // a digit sorts before a letter
  });
  it("shows every DEVICE_TYPES member exactly once, whatever the split (finding 17)", () => {
    const all = typeMenu();
    const seen = [...all.popular, ...all.rest].map(([t]) => t);
    expect([...seen].sort()).toEqual([...DEVICE_TYPES].sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(TYPE_LABELS.map(([t]) => t).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of POPULAR_TYPES) expect(DEVICE_TYPES).toContain(t);
  });
  it("offers siren and alarm, in the A to Z block", () => {
    const rest = typeMenu().rest.map(([t]) => t);
    expect(rest).toContain("siren");
    expect(rest).toContain("alarm");
  });
  it("keeps a subset's own members and drops the separator when one block is empty", () => {
    const sub = TYPE_LABELS.filter(([t]) => ["tv", "heater", "light", "boiler"].includes(t));
    const m = typeMenu(sub);
    expect(m.popular.map(([t]) => t)).toEqual(["light", "tv"]);
    expect(m.rest.map(([t]) => t)).toEqual(["boiler", "heater"]);
    const host = document.createElement("div");
    render(typeOptions(sub, "tv"), host);
    expect(host.querySelectorAll("hr")).toHaveLength(1);
    render(typeOptions(sub.filter(([t]) => t === "heater")), host);
    expect(host.querySelectorAll("hr")).toHaveLength(0);
  });
  it("renders popular, one hr, then the rest, and selects the current type", () => {
    const host = document.createElement("select");
    render(typeOptions(TYPE_LABELS, "siren"), host);
    const kids = [...host.children].map((c) => (c.tagName === "HR" ? "---" : (c as HTMLOptionElement).value));
    expect(kids.slice(0, 7)).toEqual(["light", "switch", "motion", "contact", "temp", "speaker", "tv"]);
    expect(kids[7]).toBe("---");
    expect(kids.filter((k) => k === "---")).toHaveLength(1);
    expect(kids).toHaveLength(DEVICE_TYPES.length + 1);
    expect((host.querySelector("option[selected]") as HTMLOptionElement)?.value).toBe("siren");
  });
});
