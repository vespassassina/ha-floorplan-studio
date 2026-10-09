export interface GuideStep { title: string; body: string }

/** The view keys, for the Help panel's controls table. The same keys the card takes (`view-keys.ts`). */
export const CONTROLS: { keys: string; does: string }[] = [
  { keys: "Arrow keys", does: "Pan the view up, down, left and right" },
  { keys: "+  and  -", does: "Zoom in and out" },
  { keys: "[  and  ]", does: "Turn the plan 45 degrees left and right" },
  { keys: "Space", does: "Reset the view: the whole floor, upright" },
  { keys: "Alt + drag", does: "Move a corner or a wall freely, without snapping" },
  { keys: "Enter", does: "Close the shape you are drawing" },
  { keys: "Escape", does: "Cancel drawing, close a menu" },
  { keys: "Delete", does: "Remove the selected item" },
  { keys: "Cmd/Ctrl + Z", does: "Undo (add Shift to redo)" },
  { keys: "Cmd/Ctrl + S", does: "Save the plan" },
];

/** S26.18: the key behind each toolbar item that has one. `Mod` is Cmd on a Mac, Ctrl elsewhere. */
export const MENU_KEYS = { undo: "Mod+Z", redo: "Mod+Shift+Z", save: "Mod+S", fit: "Space" } as const;

/** A chord as the person reads it: `Mod+Shift+Z` is ⇧⌘Z on a Mac and Ctrl+Shift+Z elsewhere. */
export function chordLabel(chord: string, mac: boolean): string {
  const parts = chord.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return chord.trim() || "?";
  if (!mac) return parts.map((p) => (p === "Mod" ? "Ctrl" : p)).join("+");
  const sym: Record<string, string> = { Shift: "⇧", Mod: "⌘", Alt: "⌥" };
  const mods = ["Alt", "Shift", "Mod"].filter((m) => parts.includes(m)).map((m) => sym[m]).join("");
  const rest = parts.filter((p) => !(p in sym)).join("");
  return `${mods}${rest}` || "?";
}

/** A control the guide names is written `[Label]`: the Help panel shows it bold, and a test checks the editor has it. */
export const CONTROL_MARK = /\[([^\]]+)\]/g;
/** A body as the reader sees it: the marks dropped, the names kept. */
export const plainBody = (body: string) => body.replace(CONTROL_MARK, "$1");
/** Every `[Label]` the guide names, in order of appearance. */
export function guideControls(steps: readonly GuideStep[] = GUIDE_STEPS): string[] {
  return steps.flatMap((s) => [...s.body.matchAll(CONTROL_MARK)].map((m) => m[1]));
}

/**
 * The Help panel's steps, in order. Plain words for someone who has never seen the tool: say what they click and
 * what they will see happen, never "canvas", "polygon" or "viewport".
 */
export const GUIDE_STEPS: GuideStep[] = [
  { title: "Unlock the plan", body: "A plan with rooms opens locked, so nothing moves by mistake. Click [Plan locked] at the top to unlock it, then you can change walls, rooms, doors and furniture. Names, colours and devices can be changed either way." },
  { title: "Draw the outside wall", body: "Open [Draw], then [Areas], then [Draw outline]. Click each corner of your home in order, going around the outside." },
  { title: "Close the outline", body: "Click back on the very first corner you placed, or press Enter. The shape fills in grey once it is closed. If it looks wrong, press Escape and start over." },
  { title: "Add the walls inside", body: "Open [Draw], then [Wall], and pick a kind, such as [Internal wall]. Click one end of the wall, then the other end. Keep clicking to add more walls. Press Escape when you are done." },
  { title: "Moving things and snapping", body: "Corners jump to other corners, snap onto other walls and line up with their neighbours. Hold Alt while dragging to move freely. Drag a wall to move it with its neighbours; hold Shift while dragging a corner or a wall to move it alone. Drag a room, zone or stairs by the middle to move it. Delete removes what is selected. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes. Scroll to zoom. Drag the background to look around, or drag anywhere with the middle button, the right button or Ctrl/Cmd held." },
  { title: "Add doors and windows", body: "Open [Add], then [Openings], then [Door] or [Window]. It lands on the wall nearest the middle of the view. Drag it along the wall to put it in place." },
  { title: "Add rooms, zones and stairs", body: "To draw a room, open [Draw], then [Areas], then [Draw room], and click each corner, as for the outline. [Draw zone] works the same way. For a ready-made one, open [Add], then [Areas], then [Zone] or [Stairs], and drag it into place. Stairs go on every floor." },
  { title: "Add furniture", body: "Open [Add], then [Furniture], and pick a piece. It appears on the plan. Drag it where you want it, and use its panel to turn it." },
  { title: "Add a device", body: "Open [Add], then [Device…], and pick one from the list. It lands on the plan; drag it where it belongs. For something Home Assistant does not know, open [Add], then [Unlinked device], and pick a type instead." },
  { title: "Attach it to Home Assistant", body: "Click the device you placed. Its panel opens on the right. Pick its entity in [Home Assistant entity], so the plan shows its real state." },
  { title: "Add another floor", body: "Open [Edit], then [Add floor], and type a name for the new floor. Click a floor's tab at the top to switch floors." },
  { title: "Save your plan", body: "Press Cmd/Ctrl+S, or open [File], then [Save]. Inside Home Assistant this keeps your plan for next time. In a plain browser window, use [Export…] to download a copy." },
];
