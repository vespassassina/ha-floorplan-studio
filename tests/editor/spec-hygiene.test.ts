import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Undo and Redo sit in the toolbar, not in File. An open menu's box hangs below its button and covers whatever
// wraps under it. On the CI runner's wider system font the toolbar wraps at 1280 px and Undo lands under File, so
// 66 tests that opened File "to reach" Undo timed out with "subtree intercepts pointer events" (the fix: do not
// open a menu you do not use). This reads the specs, since no local font reproduces the wrap by default.
const dir = "tests/editor";
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));

describe("e2e specs", () => {
  it("never open a menu on the line before they click Undo or Redo", () => {
    const bad: string[] = [];
    for (const f of specs) {
      const lines = readFileSync(`${dir}/${f}`, "utf8").split("\n");
      lines.forEach((l, i) => {
        const opens = /\bmenu\(page, "(File|Edit|View|Add|Floors)"\)/.test(l);
        if (!opens || /close it/.test(l)) return; // a menu opened to close another one is the one exception
        const rest = l.slice(l.search(/\bmenu\(page/)).replace(/^menu\(page, "[A-Za-z]+"\);?/, "") + "\n" + (lines[i + 1] ?? "");
        if (/(#(undo|redo)"\)|undoBtn\(page\))\.click\(|undoOnce\(/.test(rest)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
    expect(bad, "open a menu only to use it; Undo is not in any menu").toEqual([]);
  });
});
