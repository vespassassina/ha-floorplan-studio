/** S26.6 (U19): one context-menu model. What a right-click offers on each kind of object, in the order of the Studio
 *  review (Exhibit 14). Pure: the caller reads the layout and passes `facts`; the host maps each `id` to an action. */

export const CTX_TARGETS = ["canvas", "room", "edge", "wall", "door", "opening", "stairs", "extra", "furn", "unl", "dev", "devs"] as const;
export type CtxTargetKind = (typeof CTX_TARGETS)[number];

export interface CtxFacts {
  /** The target (or the selection) is locked. */
  locked: boolean;
  /** The target is a light, or the selection holds one. */
  hasLight: boolean;
  /** How many objects the menu acts on. */
  count: number;
  /** Home Assistant is connected: the items that read its areas and entities need it. */
  ha: boolean;
}

export interface CtxItem { id: string; label: string; key?: string; disabled?: boolean }

const item = (id: string, label: string, extra: Partial<CtxItem> = {}): CtxItem => ({ id, label, ...extra });

export function ctxItems(target: CtxTargetKind, facts: CtxFacts): CtxItem[] {
  const lock = item("lock", facts?.locked === true ? "Unlock" : "Lock");
  const needHa = facts?.ha === true ? {} : { disabled: true };
  const del = item("delete", "Delete", { key: "Del" });
  const openings = [item("addDoor", "Add door"), item("addWindow", "Add window"), item("addOpening", "Add opening")];
  switch (target) {
    case "dev":
      return [item("rename", "Rename", { key: "F2" }), ...(facts?.hasLight === true ? [item("controlledBy", "Controlled by…")] : []),
        item("selectSameType", "Select same type"), item("hideType", "Hide this type"), lock, del];
    case "devs": {
      const n = Number.isFinite(facts?.count) && facts.count > 1 ? Math.floor(facts.count) : 0;
      return [...(facts?.hasLight === true ? [item("controlledBy", "Controlled by…")] : []), lock, n ? item("delete", `Delete ${n}`, { key: "Del" }) : del];
    }
    case "room":
      return [item("rename", "Rename", { key: "F2" }), item("placeFromArea", "Place devices from area…", needHa), item("selectInside", "Select devices inside"),
        item("toFront", "Bring to front"), item("toBack", "Send to back"), del];
    case "edge":
      return [item("kind", "Change type"), item("addPoint", "Add a point"), ...openings, del];
    case "wall":
      return [item("kind", "Change type"), ...openings, lock, del];
    case "door": case "opening": case "furn": case "unl":
      return [lock, del];
    case "stairs": case "extra":
      return [del];
    case "canvas":
      return [item("addDeviceHere", "Add device here…", needHa), item("selectAll", "Select all devices", { key: "Ctrl+A" }), item("zoomFit", "Zoom to fit")];
    default:
      return [];
  }
}
