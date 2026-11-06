import { describe, expect, it } from "vitest";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioEditor } from "../../src/editor/editor-app";

// Opus review of B53.10-B53.13: addFurniture brought the spawn point into view, not where a wall mirror really lands (snapped to the
// nearest wall, up to 80 cm away). The view must frame the piece as placed, with the 100 cm margin ensureVisible keeps.
const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0, rotate: 0, catalog: [],
  floors: { ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [{ id: "r", name: "R", area: "", kind: "room", pts: [[0, 0], [1000, 0], [1000, 800], [0, 800]], wk: ["wall", "wall", "wall", "wall"] }], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] } },
}) as unknown as Layout;

describe("addFurniture: the view follows the piece where it landed", () => {
  it("a mirror that snaps to the top wall from 60 cm below it brings the wall's side into view, with the margin", () => {
    const el = new FloorplanStudioEditor();
    document.body.appendChild(el);
    el.layout = layout();
    el.st.planLocked = false;
    el.st.sel = { t: "room", i: 0 }; // a selected room: the piece spawns at `addAt`, else its middle
    el.addAt = [500, 60];
    el.st.views.ground = { x: 100, y: -60, w: 800, h: 600 }; // shows the spawn point and its margin, but not the margin above the wall
    el.addFurniture("mirror");
    const m = el.st.f.furniture[0];
    expect(m.y, "it snapped to the wall").toBeLessThan(20);
    expect(el.st.view.y, "the margin above the piece is in view").toBeLessThanOrEqual(m.y - m.h / 2 - 100 + 1e-6);
    el.remove();
  });
});
