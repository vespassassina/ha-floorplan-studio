import { t } from "../core/i18n";
import type { Device, Door, Furniture, Unlinked } from "../core";
import { carEntities, carMain, carStatus, carText, entitiesOfDevice, entitiesOfDoor, isViewPath, pieceDevice, playerOf } from "../core";
import type { Hass } from "./floorplan-studio-card";
import type { HoldAction, TapAction } from "./tap-action";

/** Device types a tap opens more-info for at once, never a toggle: a camera and a media player have none, and a battery, an inverter, a server or an access point is watched, not switched (S2.13). A vacuum is here too (S7.10), but its tap opens its own dialog, not more-info — see the `d.type === "vacuum"` branch below, checked before this set. S9.4: a speaker is a media_player device like `media`, and gets the same decision for the same reason — `media_player.toggle` is play/pause or power, never a clean on/off, so guessing which one the user meant is worse than always opening more-info. */
export const NO_TOGGLE: ReadonlySet<string> = new Set(["camera", "media", "speaker", "battery", "inverter", "server", "access_point", "person", "radar", "vacuum", "alarm", "temp", "humidity", "motion", "contact", "vibration", "car"]);
// S19.E4: `temp` is watched, never switched: the popup button follows the entity's domain, so a temp device on a climate or switch entity offered "Turn off".
// S21.2: humidity, motion, contact and vibration are sensors with the same flaw; they join it.

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
export type TapTarget = { device: Device; index: number; piece?: true } | { door: Door; index: number } | { unlinked: Unlinked; index: number };

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
/** Home Assistant's own `navigate`: push, then tell its router. Used for the Studio link and a device's `view` (S40.3); a path that is not one (`isViewPath`) goes nowhere. */
export function openView(path: unknown): void {
  if (!isViewPath(path)) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

export function bindDeviceActions(
  svg: Element,
  host: DeviceActionsHost,
  getDevice: (index: number) => Device | undefined,
  getDoor?: (index: number) => Door | undefined,
  opts?: {
    longPress?: boolean;
    openVacuumDialog?: (device: Device) => void;
    /** `line` is read at every render of the chooser, so its title follows the state (a car's `carText`). */
    openChooser?: (title: string, entities: string[], line?: () => string) => void;
    openPopup?: (target: TapTarget, at: { x: number; y: number }, from: Element | null) => void;
    getUnlinked?: (index: number) => Unlinked | undefined;
    /** A linked furniture piece (`g[data-f][data-linked]`, `pieceDevice`) by its index in the floor's `furniture`. */
    getPiece?: (index: number) => Furniture | undefined;
    /** S25.5: asked on the tap of a device icon, before its popup. True means the tap was a stack's and the host fanned it out; nothing else happens. */
    stack?: (index: number) => boolean;
    /** S33.4: the card's `tap_action` and `hold_action`, read afresh on every press, for device icons only (a door, an appliance and a linked piece keep what they do). Absent is `popup` and `more-info`. */
    tapAction?: () => TapAction;
    holdAction?: () => HoldAction;
    /** S33.4: what `tap_action: toggle` does for a device. The card decides: it acts at once, or opens the popup (already at Confirm turn off for a non-light that is on). */
    toggle?: (t: TapTarget, at: { x: number; y: number }, from: Element | null) => void;
    /** What a press lands on, when the DOM cannot say (the 3D view picks with a ray): an element that carries `data-x`,
     *  `data-d` or `data-u`, or null. Replaces the lookup of the event's target. */
    resolve?: (e: PointerEvent) => Element | null;
    /** S39.3: true while the card replays the past. A tap then acts on nothing and calls `onReplay`; a hold does nothing. */
    replaying?: () => boolean;
    onReplay?: () => void;
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
    const target = opts?.resolve ? opts.resolve(pe) : (e.target as Element | null)?.closest('g[data-x], button[data-x], line[data-d], g[data-u], g[data-f][data-linked], g[data-cam]');
    if (!target) return;
    if (opts?.replaying?.()) { arm(() => opts.onReplay?.()); return; }
    const at = { x: startX, y: startY };
    const popupFrom = (el: Element) => (el.tagName === "BUTTON" ? el : null);
    const popup = (t: TapTarget) => () => opts?.openPopup?.(t, at, popupFrom(target));

    if (target.tagName === "line") {
      const i = Number(target.getAttribute("data-d"));
      const door = Number.isFinite(i) ? getDoor?.(i) : undefined;
      if (!door) return;
      const ents = entitiesOfDoor(door);
      if (!door.cover && ents.length === 0) return; // no sensor, vibration, lock or cover: nothing to do
      arm(popup({ door, index: i }), moreInfoOf(door.name, ents));
      return;
    }

    // S16.3: a camera's thumbnail (2D, 2.5D and the 3D overlay) opens the camera's more-info, tap or hold; kiosk never reaches Home Assistant's dialog.
    if (target.hasAttribute("data-cam")) {
      const entityId = getDevice(Number(target.getAttribute("data-cam")))?.entity;
      if (entityId && longPress) arm(() => fireEvent(host, "hass-more-info", { entityId }));
      return;
    }
    // A linked tv, speaker or computer piece is its device here, and a tv or speaker has no toggle: a tap or a hold is the entity's own more-info, no popup (as an unlinked appliance with a player).
    if (target.hasAttribute("data-f")) {
      // S35.6 (spec C8, Q4): kiosk never reaches Home Assistant's dialog, and `longPress: false` is kiosk's flag, so a linked piece does nothing there.
      if (!longPress) return;
      const i = Number(target.getAttribute("data-f"));
      const m = Number.isFinite(i) ? opts?.getPiece?.(i) : undefined;
      // A car: a tap is the card's popup (name, `carText`, More info), a hold the chooser (main first, then `attached`).
      if (m?.symbol === "car") {
        const main = carMain(m), d = pieceDevice(m);
        if (!main || !d) return;
        const ents = carEntities(m);
        arm(popup({ device: d, index: i, piece: true }), () => (ents.length > 1 ? opts?.openChooser?.(m.name || t("Car"), ents, () => carText(carStatus(m, host.hass?.states))) : fireEvent(host, "hass-more-info", { entityId: main })));
        return;
      }
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
      // Kiosk (`longPress: false`) never reaches Home Assistant's dialog, so such an appliance does nothing there, as a linked piece.
      if (player) { if (longPress) arm(moreInfoOf(u.name ?? u.id, [player]), moreInfoOf(u.name ?? u.id, [player])); return; }
      const ents = entitiesOfDevice(u);
      if (ents.length === 0) return; // nothing attached: nothing to say
      arm(popup({ unlinked: u, index: i }), moreInfoOf(u.name ?? u.id, ents));
      return;
    }

    const i = Number(target.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;
    // S25.5: a tap on a stack of devices fans it out first, whatever the device would do on its own.
    const solo = (act: () => void) => () => { if (!opts?.stack?.(i)) act(); };
    // Kiosk: `tap_action: more-info` from YAML falls back to the popup, which has no More info link there.
    const asked = opts?.tapAction?.() ?? "popup", tapA = !longPress && asked === "more-info" ? "popup" : asked, holdA = opts?.holdAction?.() ?? "more-info";
    const own = d.entity;
    const info = own ? () => fireEvent(host, "hass-more-info", { entityId: own }) : undefined;
    // `none` still arms a hold, doing nothing: the release of a long press must not turn into a tap.
    const onHold = holdA === "none" ? () => undefined : info;
    // S40.3: a device with a `view` opens it on a tap, whatever the card's tap_action says; hold keeps its own. Kiosk never leaves the dashboard.
    // Checked here and again in `openView`, because the layout is untrusted.
    if (longPress && isViewPath(d.view)) { arm(solo(() => openView(d.view)), onHold); return; } // read again on release
    const tt: TapTarget = { device: d, index: i };
    const asPopup = popup(tt);
    if (d.type === "vacuum") {
      // S33.4: a vacuum has no toggle; `popup` and `toggle` open its own dialog, which is the question: the robot is never started by a bare tap.
      arm(solo(tapA === "none" ? () => undefined : tapA === "more-info" && info ? info : () => opts?.openVacuumDialog?.(d)), holdA === "none" ? onHold : undefined);
      return;
    }
    // A media player has its own, better panel: a tap is its more-info, as for a speaker or TV placed as an appliance (Diego, 2026-10-07).
    if (own?.startsWith("media_player.")) { if (longPress) arm(solo(tapA === "none" ? () => undefined : info!), onHold); return; }
    // The stack comes first for every tap action (`solo`): overlapped icons stay reachable, and a tap that fans a stack out toggles nothing.
    const act = tapA === "none" ? () => undefined : tapA === "more-info" && info ? info : tapA === "toggle" && opts?.toggle ? () => opts.toggle!(tt, at, popupFrom(target)) : asPopup;
    arm(solo(act), onHold);
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
