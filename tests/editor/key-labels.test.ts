import { describe, expect, it } from "vitest";
import { MENU_KEYS, chordLabel } from "../../src/editor/guide";

// S26.18 (Studio review U22): the key a menu item shows, written for the platform.
describe("chordLabel", () => {
  it.each([
    ["Mod+Z", true, "⌘Z"], ["Mod+Z", false, "Ctrl+Z"],
    ["Mod+Shift+Z", true, "⇧⌘Z"], ["Mod+Shift+Z", false, "Ctrl+Shift+Z"],
    ["Mod+S", true, "⌘S"], ["Mod+S", false, "Ctrl+S"],
    ["Space", true, "Space"], ["Space", false, "Space"],
  ])("%s on mac=%s is %s", (chord, mac, want) => expect(chordLabel(chord, mac)).toBe(want));

  it("never returns an empty label, whatever the chord", () => {
    for (const c of ["", "+", "Mod+", "Shift", "  "]) for (const mac of [true, false]) expect(chordLabel(c, mac)).not.toBe("");
  });

  it("names a key for the four items that have one, and each label differs between Undo and Redo", () => {
    expect(Object.keys(MENU_KEYS).sort()).toEqual(["fit", "redo", "save", "undo"]);
    expect(chordLabel(MENU_KEYS.undo, false)).not.toBe(chordLabel(MENU_KEYS.redo, false));
  });
});
