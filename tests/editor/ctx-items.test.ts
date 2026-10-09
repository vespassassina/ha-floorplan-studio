import { describe, expect, it } from "vitest";
import { CTX_TARGETS, ctxItems, type CtxFacts, type CtxTargetKind } from "../../src/editor/ctx-items";

// S26.6 (U19): one context-menu model. Pure: the caller passes the facts, the module returns the ordered items.
const base: CtxFacts = { locked: false, hasLight: false, count: 1, ha: true };
const ids = (t: CtxTargetKind, f: Partial<CtxFacts> = {}) => ctxItems(t, { ...base, ...f }).map((i) => i.id);

describe("ctxItems", () => {
  it("lists the twelve targets, and every one has a non-empty list", () => {
    expect([...CTX_TARGETS].sort()).toEqual(["canvas", "dev", "devs", "door", "edge", "extra", "furn", "opening", "room", "stairs", "unl", "wall"]);
    for (const t of CTX_TARGETS) expect(ctxItems(t, base).length, t).toBeGreaterThan(0);
  });
  it("every list but the canvas ends in Delete", () => {
    for (const t of CTX_TARGETS) {
      const last = ctxItems(t, base).at(-1)!;
      if (t === "canvas") expect(last.id).not.toBe("delete");
      else expect(last.id, t).toBe("delete");
    }
  });
  it("ids are unique within a list and labels never say Fix", () => {
    for (const t of CTX_TARGETS) for (const f of [base, { ...base, locked: true, hasLight: true, ha: false, count: 20 }]) {
      const items = ctxItems(t, f);
      expect(new Set(items.map((i) => i.id)).size, t).toBe(items.length);
      for (const i of items) expect(i.label, `${t}/${i.id}`).not.toMatch(/fix/i);
    }
  });
  it("Lock follows facts.locked, wherever it is offered", () => {
    for (const t of CTX_TARGETS) {
      const a = ctxItems(t, { ...base, locked: false }).find((i) => i.id === "lock");
      const b = ctxItems(t, { ...base, locked: true }).find((i) => i.id === "lock");
      expect(!!a, t).toBe(!!b);
      if (a) { expect(a.label).toBe("Lock"); expect(b!.label).toBe("Unlock"); }
    }
    expect(ids("dev")).toContain("lock");
    expect(ids("wall")).toContain("lock");
    expect(ids("room")).not.toContain("lock");
  });
  it("Controlled by only with a light", () => {
    expect(ids("dev", { hasLight: false })).not.toContain("controlledBy");
    expect(ids("dev", { hasLight: true })).toContain("controlledBy");
    expect(ids("devs", { hasLight: false })).not.toContain("controlledBy");
    expect(ids("devs", { hasLight: true, count: 20 })).toContain("controlledBy");
    for (const t of CTX_TARGETS) if (t !== "dev" && t !== "devs") expect(ids(t, { hasLight: true }), t).not.toContain("controlledBy");
  });
  it("device order follows the review", () => {
    expect(ids("dev", { hasLight: true })).toEqual(["rename", "controlledBy", "selectSameType", "hideType", "lock", "delete"]);
    expect(ids("dev")).toEqual(["rename", "selectSameType", "hideType", "lock", "delete"]);
  });
  it("several devices: Controlled by, Lock, Delete n", () => {
    const items = ctxItems("devs", { ...base, hasLight: true, count: 20 });
    expect(items.map((i) => i.id)).toEqual(["controlledBy", "lock", "delete"]);
    expect(items.at(-1)!.label).toBe("Delete 20");
    expect(ctxItems("dev", base).at(-1)!.label).toBe("Delete");
  });
  it("room order follows the review", () => {
    expect(ids("room")).toEqual(["rename", "placeFromArea", "selectInside", "toFront", "toBack", "delete"]);
  });
  it("wall and edge", () => {
    expect(ids("edge")).toEqual(["kind", "addPoint", "addDoor", "addWindow", "addOpening", "delete"]);
    expect(ids("wall")).toEqual(["kind", "addDoor", "addWindow", "addOpening", "lock", "delete"]);
  });
  it("canvas", () => {
    expect(ids("canvas")).toEqual(["addDeviceHere", "selectAll", "zoomFit"]);
  });
  it("items that need Home Assistant are disabled without it, and enabled with it", () => {
    const dis = (t: CtxTargetKind, id: string, ha: boolean) => ctxItems(t, { ...base, ha }).find((i) => i.id === id)?.disabled;
    expect(dis("room", "placeFromArea", false)).toBe(true);
    expect(dis("room", "placeFromArea", true)).toBeFalsy();
    expect(dis("canvas", "addDeviceHere", false)).toBe(true);
    expect(dis("canvas", "addDeviceHere", true)).toBeFalsy();
  });
  it("junk facts never throw", () => {
    for (const t of [...CTX_TARGETS, "nope" as CtxTargetKind]) {
      expect(() => ctxItems(t, { locked: NaN as unknown as boolean, hasLight: undefined as unknown as boolean, count: NaN, ha: null as unknown as boolean })).not.toThrow();
    }
    expect(ctxItems("nope" as CtxTargetKind, base)).toEqual([]);
    expect(ctxItems("devs", { ...base, count: NaN }).at(-1)!.label).toBe("Delete");
  });
});
