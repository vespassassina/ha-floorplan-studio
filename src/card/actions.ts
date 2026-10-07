import type { Device, Door, Furniture, Unlinked } from "../core";
import { entitiesOfDevice, entitiesOfDoor, pieceDevice, playerOf } from "../core";
import type { Hass } from "./floorplan-studio-card";

/** Device types a tap opens more-info for at once, never a toggle: a camera and a media player have none, and a battery, an inverter, a server or an access point is watched, not switched (S2.13). A vacuum is here too (S7.10), but its tap opens its own dialog, not more-info — see the `d.type === "vacuum"` branch below, checked before this set. S9.4: a speaker is a media_player device like `media`, and gets the same decision for the same reason — `media_player.toggle` is play/pause or power, never a clean on/off, so guessing which one the user meant is worse than always opening more-info. */
export const NO_TOGGLE: ReadonlySet<string> = new Set(["camera", "media", "speaker", "battery", "inverter", "server", "access_point", "person", "radar", "vacuum", "alarm"]);

/** What a press on the plan can land on that is its own thing and never a room pick: a device icon, a door, an unlinked appliance, a linked furniture piece. */
export const THINGS = "g[data-x], line[data-d], g[data-u], g[data-f][data-linked]";
/** The letter of `THINGS`' attribute an element carries: `x` device, `d` door, `f` linked piece, else `u`. */
export const thingKind = (el: Element): "x" | "d" | "u" | "f" => (el.hasAttribute("data-x") ? "x" : el.hasAttribute("data-d") ? "d" : el.hasAttribute("data-f") ? "f" : "u");

/** A pointer held this long or longer is a hold, opening more-info instead of toggling. */
export const HOLD_MS = 500;

/** S7.4: a pointer that moves further than this between down and up is a drag (a pan of the plan), not a tap. */
export const TAP_SLOP_PX = 6;

/** Home Assistant's own `fireEvent` shape: a bubbling, composed CustomEvent so it crosses the card's shadow boundary. */
export function fireEvent(el: EventTarget, type: string, detail?: unknown): void {
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

export interface DeviceActionsHost extends EventTarget {
  hass?: Hass;
}

/** What a tap on a plan icon, a door or an appliance lands on, for the popup (S14.2): the thing itself and its index on the shown floor. */
export type TapTarget = { device: Device; index: number } | { door: Door; index: number } | { unlinked: Unlinked; index: number };

/**
 * Wires tap and hold onto a rendered floor's `<svg>` (and the 3D view's host, and the Active panel's rows).
 *
 * S14.2: a tap never operates anything. On a device icon, a door or an unlinked appliance it calls `opts.openPopup(target,
 * at)`, where `at` is the pointer's client position; the card draws a small popup there with the name, the state, one button
 * for the default operation (`popupOp`, popup.ts) and More info. A hold of `HOLD_MS` or more fires `hass-more-info` on `host`
 * for the device's own entity instead (a door's entities go through the one-entity-more-info/chooser rule below). `getDevice(i)`
 * / `getDoor(i)` read fresh on every pointerdown, so a re-render between gestures is picked up.
 *
 * Two taps stay as they were: a vacuum opens its own dialog (`openVacuumDialog`, S7.10: Start/Pause/Return act on the real robot,
 * so it already asks first), and a door with a `cover` opens the confirm dialog from the popup's button, not from the tap.
 *
 * Device icons are `<g data-x>`, doors `<line data-d>`, unlinked appliances `<g data-u>`; the pointer can land on an inner element,
 * so the real target is `closest("g[data-x], button[data-x], line[data-d], g[data-u]")` (CLAUDE.md finding 3). The 3D view cannot
 * say that from the DOM, so `opts.resolve` tells what its ray hit.
 *
 * S7.4: a press that moves more than `TAP_SLOP_PX` before release is a pan, not a tap; a second pointer (a pinch) drops it too.
 * No debounce: each pointerdown/pointerup pair is independent. S7.5: `opts.longPress: false` (kiosk) never starts the hold timer.
 * S10.4: a hold on a door or an appliance that names several entities opens `opts.openChooser(title, entities)` instead of
 * guessing. A hold on a device opens its own entity's more-info (the popup's More info link is the chooser's way in).
 */
export function bindDeviceActions(
  svg: Element,
  host: DeviceActionsHost,
  getDevice: (index: number) => Device | undefined,
  getDoor?: (index: number) => Door | undefined,
  opts?: {
    longPress?: boolean;
    openVacuumDialog?: (device: Device) => void;
    openChooser?: (title: string, entities: string[]) => void;
    openPopup?: (target: TapTarget, at: { x: number; y: number }, from: Element | null) => void;
    getUnlinked?: (index: number) => Unlinked | undefined;
    /** A linked furniture piece (`g[data-f][data-linked]`, `pieceDevice`) by its index in the floor's `furniture`. */
    getPiece?: (index: number) => Furniture | undefined;
    /** What a press lands on, when the DOM cannot say (the 3D view picks with a ray): an element that carries `data-x`,
     *  `data-d` or `data-u`, or null. Replaces the lookup of the event's target. */
    resolve?: (e: PointerEvent) => Element | null;
  },
): () => void {
  const longPress = opts?.longPress !== false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let tap: (() => void) | null = null;
  let startX = 0, startY = 0;
  /** Pointers currently down on the svg; more than one is a pinch, which is never a tap. */
  const down = new Set<number | undefined>();
  let multi = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const reset = () => {
    clearTimer();
    held = false;
    tap = null;
  };
  /** Arms the gesture: `onTap` runs on a clean release, `onHold` once the press has lasted `HOLD_MS` (and then the release does nothing). */
  const arm = (onTap: () => void, onHold?: () => void) => {
    held = false;
    tap = onTap;
    clearTimer();
    if (longPress && onHold) {
      timer = setTimeout(() => {
        held = true;
        timer = null;
        onHold();
      }, HOLD_MS);
    }
  };
  const moreInfoOf = (title: string, ents: string[]) => () => {
    if (ents.length > 1) opts?.openChooser?.(title, ents);
    else if (ents.length === 1) fireEvent(host, "hass-more-info", { entityId: ents[0]! });
  };

  const onDown = (e: Event) => {
    const pe = e as PointerEvent;
    // A primary pointer means no other of its kind is down: drop any id whose pointerup never reached us, so
    // one lost event cannot leave every later tap read as half a pinch.
    if (pe.isPrimary) {
      down.clear();
      multi = false;
    }
    down.add(pe.pointerId);
    if (down.size > 1 || multi) {
      multi = true;
      reset();
      return;
    }
    startX = pe.clientX ?? 0;
    startY = pe.clientY ?? 0;
    const target = opts?.resolve ? opts.resolve(pe) : (e.target as Element | null)?.closest('g[data-x], button[data-x], line[data-d], g[data-u], g[data-f][data-linked]');
    if (!target) return;
    const at = { x: startX, y: startY };
    const popup = (t: TapTarget) => () => opts?.openPopup?.(t, at, target.tagName === "BUTTON" ? target : null);

    if (target.tagName === "line") {
      const i = Number(target.getAttribute("data-d"));
      const door = Number.isFinite(i) ? getDoor?.(i) : undefined;
      if (!door) return;
      const ents = entitiesOfDoor(door);
      if (!door.cover && ents.length === 0) return; // no sensor, vibration, lock or cover: nothing to do
      arm(popup({ door, index: i }), moreInfoOf(door.name, ents));
      return;
    }

    // A linked tv, speaker or computer piece is its device here, and a tv or speaker has no toggle: a tap or a hold is the entity's own more-info, no popup (as an unlinked appliance with a player).
    if (target.hasAttribute("data-f")) {
      const i = Number(target.getAttribute("data-f"));
      const m = Number.isFinite(i) ? opts?.getPiece?.(i) : undefined;
      const own = m && pieceDevice(m)?.entity;
      if (own) arm(moreInfoOf(own, [own]), moreInfoOf(own, [own]));
      return;
    }

    if (target.hasAttribute("data-u")) {
      const i = Number(target.getAttribute("data-u"));
      const u = Number.isFinite(i) ? opts?.getUnlinked?.(i) : undefined;
      if (!u) return;
      const player = playerOf(u);
      // A speaker or TV with a media player stands in for it: a tap or a hold is the player's own more-info, no popup.
      if (player) { arm(moreInfoOf(u.name ?? u.id, [player]), moreInfoOf(u.name ?? u.id, [player])); return; }
      const ents = entitiesOfDevice(u);
      if (ents.length === 0) return; // nothing attached: nothing to say
      arm(popup({ unlinked: u, index: i }), moreInfoOf(u.name ?? u.id, ents));
      return;
    }

    const i = Number(target.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;
    if (d.type === "vacuum") {
      // Its tap opens its own dialog, which is the question: the robot is never started by a bare tap.
      arm(() => opts?.openVacuumDialog?.(d));
      return;
    }
    const own = d.entity;
    // A media player has its own, better panel: a tap is its more-info, as for a speaker or TV placed as an appliance (Diego, 2026-10-07).
    if (own?.startsWith("media_player.")) { arm(() => fireEvent(host, "hass-more-info", { entityId: own }), () => fireEvent(host, "hass-more-info", { entityId: own })); return; }
    arm(popup({ device: d, index: i }), own ? () => fireEvent(host, "hass-more-info", { entityId: own }) : undefined);
  };

  const onMove = (e: Event) => {
    if (tap === null && timer === null) return;
    const pe = e as PointerEvent;
    if (Math.hypot((pe.clientX ?? 0) - startX, (pe.clientY ?? 0) - startY) > TAP_SLOP_PX) reset();
  };

  const onUp = (e: Event) => {
    down.delete((e as PointerEvent).pointerId);
    if (multi) {
      if (!down.size) multi = false;
      reset();
      return;
    }
    const wasHeld = held, act = tap;
    reset();
    if (!wasHeld && act) act();
  };

  /** A pointer that is cancelled or leaves the svg will not send its pointerup here: forget it along with the gesture. */
  const onGone = (e: Event) => {
    down.delete((e as PointerEvent).pointerId);
    if (!down.size) multi = false;
    reset();
  };

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onGone);
  svg.addEventListener("pointerleave", onGone);

  return () => {
    reset();
    svg.removeEventListener("pointerdown", onDown);
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", onUp);
    svg.removeEventListener("pointercancel", onGone);
    svg.removeEventListener("pointerleave", onGone);
  };
}
