import type { Device, Door, Unlinked } from "../core";
import { entitiesOfDevice, entitiesOfDoor } from "../core";
import type { Hass } from "./floorplan-studio-card";

/** Device types a tap opens more-info for at once, never a toggle: a camera and a media player have none, and a battery, an inverter, a server or an access point is watched, not switched (S2.13). A vacuum is here too (S7.10), but its tap opens its own dialog, not more-info — see the `d.type === "vacuum"` branch below, checked before this set. S9.4: a speaker is a media_player device like `media`, and gets the same decision for the same reason — `media_player.toggle` is play/pause or power, never a clean on/off, so guessing which one the user meant is worse than always opening more-info. */
export const NO_TOGGLE: ReadonlySet<string> = new Set(["camera", "media", "speaker", "battery", "inverter", "server", "access_point", "person", "radar", "vacuum"]);

/** A pointer held this long or longer is a hold, opening more-info instead of toggling. */
export const HOLD_MS = 500;

/** S7.4: a pointer that moves further than this between down and up is a drag (a pan of the plan), not a tap. */
export const TAP_SLOP_PX = 6;

/** Home Assistant's own `fireEvent` shape: a bubbling, composed CustomEvent so it crosses the card's shadow boundary. */
export function fireEvent(el: EventTarget, type: string, detail?: unknown): void {
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** `hass.callService(domain, "toggle", { entity_id })`; the domain is the entity id's own prefix, not the device type (a plug's entity is `switch.*`). */
export function toggleEntity(hass: Hass | undefined, entityId: string): void {
  const domain = entityId.split(".")[0];
  if (!domain || !hass?.callService) return;
  hass.callService(domain, "toggle", { entity_id: entityId });
}

export interface DeviceActionsHost extends EventTarget {
  hass?: Hass;
}

/**
 * Wires tap and hold onto a rendered floor's `<svg>`: a tap toggles a device's entity, a hold of `HOLD_MS` or
 * more fires `hass-more-info` on `host` instead. A tap on a door with a `sensor` always fires `hass-more-info`
 * for that sensor (doors have no toggle; S2.3), never waiting out the hold delay. `getDevice(i)`/`getDoor(i)`
 * read fresh on every pointerdown, so a re-render between gestures is picked up.
 *
 * S11.3: the card's left panel binds this too, on its own element: a device row there is a `<button data-x>` with the same
 * index meaning, so a tap, a hold and the chooser are the one implementation, not a second one for rows.
 *
 * Device icons are `<g data-x>`, doors are `<line data-d>`, unlinked appliances are `<g data-u>` (S4.25); the
 * pointer can land on an inner element (an icon's `<path>`/`<circle>`, a door's `<title>`), so the real target is
 * resolved with `closest("g[data-x], line[data-d], g[data-u]")` (CLAUDE.md finding 3) rather than trusting
 * `e.target` itself. One gesture implementation serves all three, so they never drift apart.
 *
 * A door with a `cover` opens the confirm dialog through `openCoverDialog` (S2.7) instead of firing more-info,
 * even when the same door also carries a `sensor` — the dialog is the one behaviour a door with both resolves
 * to, since it is the only gesture here that acts on the real home, and the sensor's own state is still visible
 * on the door line itself (the `open`/`cover-open` classes render.ts already draws) without also needing
 * more-info. A camera or a media player has no toggle: a tap on either opens more-info at once, the same as a
 * sensor door (S2.5). A vacuum (S7.10) has no toggle either, but a tap opens `opts.openVacuumDialog` instead of
 * more-info, the same idea as a cover door's dialog: Start/Pause/Return to dock act on the real robot, so a tap
 * asks first rather than firing a service blind.
 *
 * S7.4: a press that moves more than `TAP_SLOP_PX` before release is a pan, not a tap: the gesture and its hold
 * timer are dropped. A second pointer down (a pinch) drops it too, and nothing fires until every pointer is up.
 *
 * No debounce: each pointerdown/pointerup pair is independent, so two quick taps toggle twice, not once
 * (S2.2 "Break it"). `openCoverDialog` itself is responsible for ignoring a second call while its dialog is
 * still open (S2.7 "Break it") — this function fires it on every completed tap regardless.
 *
 * S7.5: `opts.longPress` (default `true`) governs only the hold-opens-more-info timer on a toggling device. `false`
 * (kiosk mode) never starts that timer, so holding a light does nothing and releasing it still toggles like a plain
 * tap — a wall tablet has nobody who should reach a more-info dialog by holding a finger down. Every other gesture
 * (a plain tap, a door, a camera's always-more-info tap, the cover dialog) is unaffected: kiosk mode still acts.
 *
 * S10.4: wherever this function would have opened more-info for a device with no toggle (a camera, a radar, a
 * person...), or for a non-cover door's tap, it first asks `entitiesOfDevice`/`entitiesOfDoor`
 * (`../core/attachments.ts`) how many entities that object actually names. One (the common case, and every case
 * before S10.4 existed) still opens more-info on it directly, unchanged. More than one calls
 * `opts.openChooser(title, entities)` instead of guessing which one the person meant — a radar's own x/y target
 * pair, or a door with both a contact and a vibration sensor attached.
 *
 * S10.3-review fix (three corrections to the first S10.4 build, all from the same review):
 * 1. A *toggling* device (a heater, an ac, a light...) that names more than one entity now opens the chooser on
 *    a plain tap instead of toggling — guessing which entity a bare tap meant was exactly the problem S10.4 set
 *    out to fix, and a first pass left the toggle in place and put the chooser on the hold instead, backwards. A
 *    hold on such a device now opens more-info for the device's own entity, the same thing a hold did before
 *    S10.4 existed — the chooser now lives on the gesture that used to guess, not the one that always meant "tell
 *    me about this one specifically". A device naming exactly one entity is untouched: tap toggles, hold opens
 *    more-info, as before S10.4 and as still true today.
 * 2. A door with a `cover` still opens the confirm dialog on a plain tap, unchanged (`entitiesOfDoor` is never
 *    consulted for that tap, whatever else is attached — S2.7's existing rule). But its *hold* now starts a timer
 *    too, where a first pass returned before any timer began, so nothing else the door named (a sensor, a
 *    vibration sensor, a lock) was ever reachable by gesture on a door that also had a cover. The hold opens
 *    `entitiesOfDoor(door)` through the same one-entity-more-info/many-entities-chooser rule as everywhere else,
 *    `cover` now included in that list (`../core/attachments.ts`) precisely because this is the one place that
 *    reads it. In kiosk mode (`opts.longPress: false`) no hold timer ever starts, so such a door only ever opens
 *    the cover dialog — see docs/card.md.
 * 3. An unlinked appliance (`g[data-u]`, S4.25) had no gesture wired to it at all: `opts.getUnlinked` supplies it
 *    the same way `getDevice`/`getDoor` do, and a tap resolves through `entitiesOfDevice` on its `attached` list
 *    (an `Unlinked` has no `entity` of its own, so this is only ever that list) — one entity opens more-info, more
 *    than one the chooser, none does nothing. No toggle and no hold: an unlinked appliance names no on/off state
 *    of its own to guess at, so there is nothing a hold should do differently from a tap.
 */
export function bindDeviceActions(
  svg: Element,
  host: DeviceActionsHost,
  getDevice: (index: number) => Device | undefined,
  getDoor?: (index: number) => Door | undefined,
  openCoverDialog?: (door: Door) => void,
  opts?: {
    longPress?: boolean;
    openVacuumDialog?: (device: Device) => void;
    openChooser?: (title: string, entities: string[]) => void;
    getUnlinked?: (index: number) => Unlinked | undefined;
    /** What a press lands on, when the DOM cannot say (the 3D view picks with a ray): an element that carries `data-x`,
     *  `data-d` or `data-u`, or null. Replaces the lookup of the event's target. */
    resolve?: (e: PointerEvent) => Element | null;
  },
): () => void {
  const longPress = opts?.longPress !== false;
  const openVacuumDialog = opts?.openVacuumDialog;
  const openChooser = opts?.openChooser;
  const getUnlinked = opts?.getUnlinked;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let entityId: string | null = null;
  let action: "toggle" | "more-info" | "cover-dialog" | "vacuum-dialog" | "chooser" | null = null;
  let coverDoor: Door | null = null;
  let vacuumDevice: Device | null = null;
  let chooserTitle: string | null = null;
  let chooserEntities: string[] | null = null;
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
    entityId = null;
    action = null;
    coverDoor = null;
    vacuumDevice = null;
    chooserTitle = null;
    chooserEntities = null;
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
    const target = opts?.resolve ? opts.resolve(pe) : (e.target as Element | null)?.closest('g[data-x], button[data-x], line[data-d], g[data-u]');
    if (!target) return;

    if (target.tagName === "line") {
      const i = Number(target.getAttribute("data-d"));
      const door = Number.isFinite(i) ? getDoor?.(i) : undefined;
      if (!door) return;
      if (door.cover) {
        // Dialog wins on tap: see the function doc above for why a door with both sensor and cover goes here.
        // S10.3-review fix 2: a hold still starts, so the door's other entities (cover included, now that
        // entitiesOfDoor lists it) are reachable by gesture even though the tap always goes to the dialog.
        held = false;
        coverDoor = door;
        action = "cover-dialog";
        clearTimer();
        if (longPress) {
          const ents = entitiesOfDoor(door);
          const title = door.name;
          timer = setTimeout(() => {
            held = true;
            timer = null;
            if (ents.length > 1) openChooser?.(title, ents);
            else if (ents.length === 1) fireEvent(host, "hass-more-info", { entityId: ents[0]! });
          }, HOLD_MS);
        }
        return;
      }
      const doorEnts = entitiesOfDoor(door);
      if (doorEnts.length === 0) return; // no sensor, vibration or lock: nothing to do
      held = false;
      if (doorEnts.length === 1) {
        entityId = doorEnts[0]!;
        action = "more-info";
      } else {
        chooserTitle = door.name;
        chooserEntities = doorEnts;
        action = "chooser";
      }
      clearTimer();
      return;
    }

    if (target.hasAttribute("data-u")) {
      // S10.3-review fix 3: an unlinked appliance has no toggle and no hold, only a tap resolved the same
      // one-entity-more-info/many-entities-chooser way as everywhere else in this function.
      const i = Number(target.getAttribute("data-u"));
      const u = Number.isFinite(i) ? getUnlinked?.(i) : undefined;
      if (!u) return;
      const ents = entitiesOfDevice(u);
      if (ents.length === 0) return; // nothing attached: nothing to do
      held = false;
      if (ents.length === 1) {
        entityId = ents[0]!;
        action = "more-info";
      } else {
        chooserTitle = u.name ?? u.id;
        chooserEntities = ents;
        action = "chooser";
      }
      clearTimer();
      return;
    }

    const i = Number(target.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;

    if (d.type === "vacuum") {
      // Checked ahead of NO_TOGGLE (which also lists vacuum, for readers of that set): a vacuum's tap opens its
      // own dialog, never more-info.
      held = false;
      vacuumDevice = d;
      action = "vacuum-dialog";
      clearTimer();
      return;
    }

    if (NO_TOGGLE.has(d.type)) {
      // None of these has a toggle: a tap opens more-info right away, the same as a sensor door above (S2.5, S2.13).
      // S10.4: more than one entity (a radar with targets, say) opens the chooser instead of guessing.
      held = false;
      const ents = entitiesOfDevice(d);
      if (ents.length > 1) {
        chooserTitle = d.name ?? d.entity;
        chooserEntities = ents;
        action = "chooser";
      } else {
        entityId = ents[0] ?? d.entity;
        action = "more-info";
      }
      clearTimer();
      return;
    }

    // S10.3-review fix 1: a toggling device (a heater, an ac...) that names more than one entity opens the
    // chooser on the plain tap instead of toggling — a bare tap is exactly the gesture that used to guess which
    // entity was meant, so it is the one S10.4 exists to fix. A hold on such a device opens more-info for the
    // device's own entity, the same thing a hold always did before S10.4 existed. A device naming exactly one
    // entity falls through unchanged: tap toggles, hold opens more-info.
    held = false;
    const ents = entitiesOfDevice(d);
    if (ents.length > 1) {
      chooserTitle = d.name ?? d.entity;
      chooserEntities = ents;
      action = "chooser";
      clearTimer();
      if (longPress) {
        const ownEntity = d.entity;
        timer = setTimeout(() => {
          held = true;
          timer = null;
          if (ownEntity) fireEvent(host, "hass-more-info", { entityId: ownEntity });
        }, HOLD_MS);
      }
      return;
    }

    entityId = d.entity;
    action = "toggle";
    clearTimer();
    if (longPress) {
      timer = setTimeout(() => {
        held = true;
        timer = null;
        if (entityId) fireEvent(host, "hass-more-info", { entityId });
      }, HOLD_MS);
    }
  };

  const onMove = (e: Event) => {
    if (action === null && timer === null) return;
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
    const wasHeld = held, id = entityId, act = action, door = coverDoor, vacuum = vacuumDevice;
    const cTitle = chooserTitle, cEntities = chooserEntities;
    clearTimer();
    if (!wasHeld) {
      if (act === "toggle" && id) toggleEntity(host.hass, id);
      else if (act === "more-info" && id) fireEvent(host, "hass-more-info", { entityId: id });
      else if (act === "cover-dialog" && door) openCoverDialog?.(door);
      else if (act === "vacuum-dialog" && vacuum) openVacuumDialog?.(vacuum);
      else if (act === "chooser" && cEntities) openChooser?.(cTitle ?? "", cEntities);
    }
    held = false;
    entityId = null;
    action = null;
    coverDoor = null;
    vacuumDevice = null;
    chooserTitle = null;
    chooserEntities = null;
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
