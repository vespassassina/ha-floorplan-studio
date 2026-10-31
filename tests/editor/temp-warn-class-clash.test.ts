import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor } from "../../src/core/schema";
import { renderFloor } from "../../src/core/render";

// S42 review (finding 8): the studio draws the plan in the same shadow root as its own stylesheet, so a class the warning
// adds must not also be an editor class. `.tw` was the outline tree's twisty, at opacity .75: the studio's wash would
// have been fainter than the card's.
const classes = (svg: string) => new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter(Boolean));

describe("the temperature warning's classes", () => {
  it("are none of the editor's own classes", () => {
    const f = structuredClone(demo.floors.ground) as unknown as Floor;
    const warn = { [String(f.rooms[0]!.id)]: "hot", [String(f.rooms[1]!.id)]: "cold" } as const;
    const added = new Set<string>();
    for (const heat of ["off", "temperature"] as const) {
      const base = classes(renderFloor(f, { scale: 1, heat }));
      for (const c of classes(renderFloor(f, { scale: 1, heat, tempWarn: warn }))) if (!base.has(c)) added.add(c);
    }
    expect(added.size, "the warning adds classes").toBeGreaterThanOrEqual(4);
    const editorCss = readFileSync("src/editor/editor-app.ts", "utf8");
    for (const c of added) expect(new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])`).test(editorCss), `.${c} is also an editor class`).toBe(false);
  });
});
