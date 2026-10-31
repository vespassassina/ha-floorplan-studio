// The sheet's late-click guard (CLAUDE.md finding 22), fed the event shapes each engine really sends. Shapes from a Playwright
// probe in Chromium, WebKit and Firefox (Opus re-check of S41): Chromium gives each touch a new pointer id and the click carries
// it; WebKit's tap is a touch press with id 0 and a mouse click with id 1; Firefox gives every touch id 0.
import { describe, expect, test } from "vitest";
import { onCardDown, onSheetClick, onSheetDown } from "../../src/card/card-sheet";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

const card = () => ({ _outsidePress: null }) as unknown as FloorplanStudioCard;
const down = (pointerId: number) => ({ pointerId }) as PointerEvent;
/** A press in the sheet: the host's capture listener runs first, then the sheet's, as in the composed path. */
const pressInSheet = (c: FloorplanStudioCard, id: number) => { onCardDown(c, down(id)); onSheetDown(c); };
/** True when the click got through to the control. */
function click(c: FloorplanStudioCard, init: { detail?: number; pointerId?: number }): boolean {
  let stopped = false;
  const e = { detail: init.detail ?? 1, ...(init.pointerId === undefined ? {} : { pointerId: init.pointerId }),
    stopPropagation: () => { stopped = true; }, preventDefault: () => undefined } as unknown as MouseEvent;
  onSheetClick(c, e);
  return !stopped;
}

describe("sheet guard", () => {
  test("Chromium: the room tap's late click is dropped; the next finger tap in the sheet counts", () => {
    const c = card();
    onCardDown(c, down(7)); // the finger on the room, outside the sheet
    expect(click(c, { pointerId: 7 }), "the late click").toBe(false);
    pressInSheet(c, 8);
    expect(click(c, { pointerId: 8 })).toBe(true);
  });
  test("WebKit: a finger tap in the sheet counts although its click carries the mouse id", () => {
    const c = card();
    pressInSheet(c, 0);
    expect(click(c, { pointerId: 1 })).toBe(true);
    onCardDown(c, down(0)); // a room tap; its compatibility click has id 1, so a late one is let through, never a real tap lost
    expect(click(c, { pointerId: 1 })).toBe(true);
  });
  test("Firefox: every touch is id 0, and the late click is still dropped", () => {
    const c = card();
    onCardDown(c, down(0));
    expect(click(c, { pointerId: 0 })).toBe(false);
    pressInSheet(c, 0);
    expect(click(c, { pointerId: 0 })).toBe(true);
  });
  test("a keyboard click, a click with no pointer id, and a click before any press all count", () => {
    const c = card();
    expect(click(c, { pointerId: 3 }), "no press yet").toBe(true);
    onCardDown(c, down(3));
    expect(click(c, { detail: 0, pointerId: 3 }), "Enter, or el.click()").toBe(true);
    expect(click(c, {}), "Safari before 17.4: a plain MouseEvent").toBe(true);
  });
});
