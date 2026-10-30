import { describe, it, expect } from "vitest";
import { validate, isViewPath, VIEW_MAX, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";

// S40.3, spec C10 (docs/specs/quick-wins-s40.md, criterion 9): a device may name a dashboard view, a path inside Home Assistant. A layout file is
// untrusted input (CLAUDE.md finding 1): validate refuses a bad path with a message and never throws, and migrate drops what validate would refuse.
const dev = (extra: Record<string, unknown> = {}) => ({ id: "d1", type: "light", entity: "light.kitchen", x: 100, y: 100, ...extra });
const layoutOf = (d: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [d], furniture: [], unlinked: [] } } });
const errorsOf = (d: unknown): string[] => { const r = validate(layoutOf(d)); return r.ok ? [] : r.errors; };
const deviceOf = (l: Layout) => l.floors.Ground.devices[0] as unknown as Record<string, unknown>;

const GOOD = ["/lovelace/terrace", "/dashboard-x/0", "/lovelace", "/", "/lovelace/a?x=1#top", "/a.b/c", "/x/..y", "/x/y.", "/a?next=/../b", "/a/.../b", `/${"a".repeat(VIEW_MAX - 1)}`];
const BAD: [string, unknown][] = [
  ["protocol-relative //evil.com", "//evil.com"],
  ["javascript: scheme", "javascript:alert(1)"],
  ["https scheme", "https://x"],
  ["no leading slash", "lovelace"],
  ["a space", "/lovelace/my view"],
  ["a newline", "/lovelace/a\nb"],
  ["a tab", "/lovelace/a\tb"],
  ["a control character", "/lovelace/a\u0007b"],
  ["a no-break space", "/lovelace/a b"],
  ["a backslash (a browser reads /\\ as //)", "/\\evil.com"],
  ["201 characters", `/${"a".repeat(VIEW_MAX)}`],
  ["a dot segment that leaves //evil.com behind", "/..//evil.com"],
  ["a dot segment /.//x", "/.//x"],
  ["dot segments /a/../..//x", "/a/../..//x"],
  ["a leading dot segment /./x", "/./x"],
  ["a trailing dot segment", "/lovelace/.."],
  ["an encoded dot segment", "/%2e%2E//evil.com"],
  ["empty", ""],
  ["a number", 5],
  ["an object", { path: "/x" }],
  ["an array", ["/x"]],
  ["null", null],
  ["true", true],
];

describe("device view: validate", () => {
  it("accepts a path inside Home Assistant, and none at all", () => {
    expect(errorsOf(dev())).toEqual([]);
    for (const view of GOOD) expect(errorsOf(dev({ view })), view).toEqual([]);
  });
  it("refuses everything else with a message that names the device and the rule", () => {
    for (const [why, view] of BAD) {
      const errors = errorsOf(dev({ view }));
      expect(errors, why).toHaveLength(1);
      expect(errors[0], why).toMatch(/d1 view must be a path inside Home Assistant that starts with one \//);
    }
  });
  it("never throws, even on a getter that throws or a symbol", () => {
    const hostile = dev();
    Object.defineProperty(hostile, "view", { enumerable: true, get() { throw new Error("boom"); } });
    expect(() => validate(layoutOf(hostile))).not.toThrow();
    expect(errorsOf(hostile)).toHaveLength(1);
    expect(() => validate(layoutOf(dev({ view: Symbol("x") })))).not.toThrow();
    expect(errorsOf(dev({ view: Symbol("x") }))).toHaveLength(1);
  });
  it("isViewPath is the one rule the card and the editor share", () => {
    for (const v of GOOD) expect(isViewPath(v), v).toBe(true);
    for (const [why, v] of BAD) expect(isViewPath(v), why).toBe(false);
  });
});

describe("device view: migrate", () => {
  it("keeps a good path and drops a bad one, the device with it", () => {
    for (const view of GOOD) expect(deviceOf(migrate(layoutOf(dev({ view })))).view, view).toBe(view);
    for (const [why, view] of BAD) {
      const out = migrate(layoutOf(dev({ view })));
      expect("view" in deviceOf(out), why).toBe(false);
      expect(deviceOf(out).id).toBe("d1");
      expect(validate(out).ok, why).toBe(true);
    }
  });
});
