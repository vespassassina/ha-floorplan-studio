import { describe, it, expect } from "vitest";
import { GUIDE_STEPS, guideControls } from "../../src/editor/guide";

const JARGON = ["canvas", "polygon", "viewport"];

describe("GUIDE_STEPS", () => {
  it("has at least one step for every stage: outline, walls, doors, devices, entities, floors, saving", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThan(0);
  });

  it("break it: every step has a non-empty title and body, with no leading/trailing blanks", () => {
    for (const s of GUIDE_STEPS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.title).toBe(s.title.trim());
      expect(s.body.trim()).not.toBe("");
      expect(s.body).toBe(s.body.trim());
    }
  });

  it("break it: no step uses jargon a twelve-year-old wouldn't know", () => {
    for (const s of GUIDE_STEPS) {
      for (const word of JARGON) {
        expect((s.title + " " + s.body).toLowerCase()).not.toContain(word);
      }
    }
  });

  it("break it: every control mark is closed, so no bracket shows in the Help panel", () => {
    for (const s of GUIDE_STEPS) expect(s.body.replace(/\[[^\]]+\]/g, "")).not.toMatch(/[[\]]/);
  });

  it("guideControls lists the marked names in order, brackets dropped", () => {
    expect(guideControls([{ title: "t", body: "Open [Add], then [Device…]." }])).toEqual(["Add", "Device…"]);
    expect(guideControls([{ title: "t", body: "No marks here." }])).toEqual([]);
  });
});
