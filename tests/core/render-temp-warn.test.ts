import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, THEMES, renderFloor, type RenderOpts } from "../../src/core/render";
import type { Layout } from "../../src/core/schema";

// S42.2 (spec docs/specs/temp-range.md, decisions 11 and 13, criterion 5): renderFloor draws the warning from `RenderOpts.tempWarn`.
// One draw path (finding 8): the card and the studio get the same markup.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const ground = demo.floors.ground!;
const id0 = ground.rooms[0]!.id, id1 = ground.rooms[1]!.id;
const wash = (html: string) => [...html.matchAll(/<polygon class="tw tw-(hot|cold)" data-tw="(\d+)"[^>]*\/>/g)].map((m) => [m[2], m[1]]);
const ring = (html: string) => [...html.matchAll(/<polygon class="tr tr-(hot|cold)" data-tr="(\d+)"[^>]*\/>/g)].map((m) => [m[2], m[1]]);
const roomClass = (html: string, i: number) => new RegExp(`<polygon data-r="${i}" class="([^"]*)"`).exec(html)?.[1] ?? "";

describe("the wash", () => {
  it("tints each warned room in its own colour class, on the room and as a wash over its fill", () => {
    const h = renderFloor(ground, { scale: 1, tempWarn: { [id0]: "hot", [id1]: "cold" } });
    expect(wash(h)).toEqual([["0", "hot"], ["1", "cold"]]);
    expect(roomClass(h, 0).split(" ")).toContain("temp-hot");
    expect(roomClass(h, 1).split(" ")).toContain("temp-cold");
    expect(roomClass(h, 2)).not.toMatch(/temp-/);
    expect(ring(h)).toEqual([]);
  });
  it("draws the wash straight after its room, under the walls", () => {
    const h = renderFloor(ground, { scale: 1, tempWarn: { [id0]: "hot" } });
    expect(h.indexOf('data-tw="0"')).toBeGreaterThan(h.indexOf('data-r="0"'));
    expect(h.indexOf('data-tw="0"')).toBeLessThan(h.indexOf('data-r="1"'));
  });
});

describe("under the temperature heat map", () => {
  const o: RenderOpts = { scale: 1, heat: "temperature", tempWarn: { [id0]: "hot", [id1]: "cold" } };
  it("the wash gives way to a steady border, drawn after the walls", () => {
    const h = renderFloor(ground, o);
    expect(wash(h)).toEqual([]);
    expect(ring(h)).toEqual([["0", "hot"], ["1", "cold"]]);
    expect(roomClass(h, 0).split(" ")).toContain("temp-hot");
    expect(h.indexOf('data-tr="0"')).toBeGreaterThan(h.lastIndexOf("data-e="));
  });
  it("the humidity heat map does not colour by temperature, so the wash stays", () => {
    const h = renderFloor(ground, { ...o, heat: "humidity" });
    expect(wash(h)).toEqual([["0", "hot"], ["1", "cold"]]);
    expect(ring(h)).toEqual([]);
  });
});

describe("omitted or junk is the markup as it was", () => {
  const base: RenderOpts[] = [{ scale: 0.5 }, { scale: 1, view: "2.5d", night: true, roomGlow: true }, { scale: 1, heat: "temperature" }, { scale: 1, theme: "light", labels: false }];
  const junk: unknown[] = [undefined, null, 5, "hot", true, [], ["hot"], {}, { nope: "hot" }, { [id0]: "warm" }, { [id0]: 1 }, { [id0]: null }, { [id0]: "Hot" }, Object.create({ [id0]: "hot" }), { "><script>": "hot" }];
  it("over every option set and every junk value", () => {
    for (const o of base) {
      const plain = renderFloor(ground, o);
      for (const tempWarn of junk) expect(renderFloor(ground, { ...o, tempWarn } as never), JSON.stringify([o, tempWarn])).toBe(plain);
      expect(plain).not.toMatch(/temp-|data-tw|data-tr/);
    }
  });
  it("an id the floor does not have draws nothing, and a hostile room id is never written into the markup", () => {
    const evil = structuredClone(ground);
    evil.rooms[0]!.id = '"><script>alert(1)</script>';
    const h = renderFloor(evil, { scale: 1, tempWarn: { [evil.rooms[0]!.id]: "hot", ghost: "cold" } });
    expect(h).not.toContain("<script");
    expect(wash(h)).toEqual([["0", "hot"]]);
  });
});

describe("the colours (finding 17)", () => {
  // Every rule whose last selector is `sel`, joined: a theme's tokens and its extras are separate blocks.
  const block = (sel: string) => [...FLOORPLAN_CSS.matchAll(new RegExp(`${sel.replace(/[[\]]/g, "\\$&")}\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join(";");
  it("every theme names --fp-hot and --fp-cold; ha dark too", () => {
    const sels = [...THEMES.map((t) => `[data-theme="${t}"]`), '[data-theme="ha"][data-mode="dark"]'];
    for (const s of sels) {
      const b = block(s);
      expect(b, s).toMatch(/--fp-hot:#[0-9a-f]{6}/i);
      expect(b, s).toMatch(/--fp-cold:#[0-9a-f]{6}/i);
    }
  });
  it("the default (blueprint, no theme attribute) has them too", () => {
    expect(block(":host,.fp")).toMatch(/--fp-hot:/);
  });
});
