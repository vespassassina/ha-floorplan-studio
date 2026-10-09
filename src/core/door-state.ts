import type { Door } from "./schema";
import type { StateOverlay } from "./render";

/** What the live state says about a door or window. The 2D line and the 2.5D wall face both read this, so they cannot disagree. */
export interface DoorState {
  /** A contact sensor is on, or a smart lock was left unlocked: the opening is drawn open, red. */
  open: boolean;
  /** S24.3 (G3): a contact sensor is on. The facts and Attention say "Open" for this alone. */
  contact: boolean;
  /** S24.3 (G3): a smart lock was left unlocked. The facts and Attention say "Unlocked", never "Open". */
  unlocked: boolean;
  /** A vibration sensor is on: the same red, solid. */
  alarm: boolean;
  /** The door's own cover (a garage opener, a shutter) is open: drawn in the cover's colour. Never on a window or glass door: there `cover` is curtains. */
  cover: boolean;
  /** S25.D1: every sensor says `off`, or a lock says `locked` (a locked door is shut); and no sensor is on and no lock is unlocked or jammed. Only then is a door or glass door drawn shut; any other state, or none, is a hole in the wall. */
  closed: boolean;
}

/**
 * Several contact sensors may be attached; the door reads open if any one does, and the same for a lock left unlocked
 * (Diego, 2026-09-28: an unlocked door or window is the same security state as an open one). Unavailable and unknown
 * are none of these: a dead sensor never paints an opening red. State is untrusted; a missing entry reads closed.
 */
export function doorStateOf(d: Door, state: StateOverlay | undefined): DoorState {
  const on = (list: unknown, want: string) => Array.isArray(list) && list.some((e) => typeof e === "string" && state?.[e]?.state === want);
  const curtain = d.kind === "window" || d.kind === "glass" || d.kind === "slit" || d.kind === "fullwindow";
  const contact = on(d.sensors, "on"), unlocked = on(d.locks, "unlocked"), locked = on(d.locks, "locked"), jammed = on(d.locks, "jammed");
  const shut = Array.isArray(d.sensors) && d.sensors.length > 0 && d.sensors.every((e) => typeof e === "string" && state?.[e]?.state === "off");
  return {
    closed: (shut || locked) && !unlocked && !jammed && !contact,
    open: contact || unlocked, // the plan draws both red; only the words tell them apart
    contact,
    unlocked,
    alarm: on(d.vibration, "on"),
    cover: !curtain && typeof d.cover === "string" && state?.[d.cover]?.state === "open",
  };
}
