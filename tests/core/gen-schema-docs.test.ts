import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const run = () => execFileSync("node", [resolve("scripts/gen-schema-docs.mjs")], { encoding: "utf8" });

describe("scripts/gen-schema-docs.mjs", () => {
  it("emits one section per commented declaration, comment as prose then the real TS as a code block", () => {
    const out = run();
    expect(out).toContain("## Furniture");
    expect(out).toContain("`name` is a plan name");
    expect(out).toContain("export interface Furniture { id: string; symbol: FurnitureSymbol;");
  });

  it("break it: a multi-line interface (Floor) stops at its own closing brace, not the next declaration's comment or body", () => {
    const out = run();
    const floor = out.slice(out.indexOf("## Floor"), out.indexOf("## CatalogEntry"));
    expect(floor).toContain("export interface Floor {");
    expect(floor).toContain("furniture: Furniture[]; unlinked: Unlinked[];");
    expect(floor).not.toContain("CatalogEntry");
    expect(floor).not.toContain("isObj"); // the helper right after Layout in the source file
  });

  it("break it: a brace-free multi-line union (FurnitureSymbol) is not captured — schema.ts has no comment on it, so it is skipped, same as every undocumented type alias", () => {
    const out = run();
    expect(out).not.toContain("## FurnitureSymbol");
  });

  it("is valid, non-empty markdown starting with the generated-file warning", () => {
    const out = run();
    expect(out.startsWith("# Layout schema v2")).toBe(true);
    expect(out).toContain("Never hand-edit this file");
  });
});
