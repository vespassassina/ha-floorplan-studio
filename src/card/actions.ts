import type { Device, Door } from "../core";
import type { Hass } from "./floorplan-studio-card";

/** Device types a tap opens more-info for at once, never a toggle: a camera and a media player have none, and a battery, an inverter, a server or an access point is watched, not switched (S2.13). */
const NO_TOGGLE: ReadonlySet<string> = new Set(["camera", "media", "battery", "inverter", "server", "access_point", "person", "radar"]);

/** A pointer held this long or longer is a hold, opening more-info instead of toggling. */
export const HOLD_MS = 500;

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
 * Device icons are `<g data-x>`, doors are `<line data-d>`; the pointer can land on an inner element (an icon's
 * `<path>`/`<circle>`, a door's `<title>`), so the real target is resolved with
 * `closest("g[data-x], line[data-d]")` (CLAUDE.md finding 3) rather than trusting `e.target` itself. One gesture
 * implementation serves both, so devices and doors never drift apart.
 *
 * A door with a `cover` opens the confirm dialog through `openCoverDialog` (S2.7) instead of firing more-info,
 * even when the same door also carries a `sensor` — the dialog is the one behaviour a door with both resolves
 * to, since it is the only gesture here that acts on the real home, and the sensor's own state is still visible
 * on the door line itself (the `open`/`cover-open` classes render.ts already draws) without also needing
 * more-info. A camera or a media player has no toggle: a tap on either opens more-info at once, the same as a
 * sensor door (S2.5).
 *
 * No debounce: each pointerdown/pointerup pair is independent, so two quick taps toggle twice, not once
 * (S2.2 "Break it"). `openCoverDialog` itself is responsible for ignoring a second call while its dialog is
 * still open (S2.7 "Break it") — this function fires it on every completed tap regardless.
 */
export function bindDeviceActions(
  svg: SVGSVGElement,
  host: DeviceActionsHost,
  getDevice: (index: number) => Device | undefined,
  getDoor?: (index: number) => Door | undefined,
  openCoverDialog?: (door: Door) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let entityId: string | null = null;
  let action: "toggle" | "more-info" | "cover-dialog" | null = null;
  let coverDoor: Door | null = null;

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
  };

  const onDown = (e: Event) => {
    const target = (e.target as Element | null)?.closest('g[data-x], line[data-d]');
    if (!target) return;

    if (target.tagName === "line") {
      const i = Number(target.getAttribute("data-d"));
      const door = Number.isFinite(i) ? getDoor?.(i) : undefined;
      if (door?.cover) {
        // Dialog wins on tap: see the function doc above for why a door with both sensor and cover goes here.
        held = false;
        coverDoor = door;
        action = "cover-dialog";
        clearTimer();
        return;
      }
      if (!door?.sensors?.length) return; // neither sensor nor cover: nothing to do
      held = false;
      entityId = door.sensors[0]; // several may be attached (S4.24); more-info opens the first
      action = "more-info";
      clearTimer();
      return;
    }

    const i = Number(target.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;

    if (NO_TOGGLE.has(d.type)) {
      // None of these has a toggle: a tap opens more-info right away, the same as a sensor door above (S2.5, S2.13).
      held = false;
      entityId = d.entity;
      action = "more-info";
      clearTimer();
      return;
    }

    held = false;
    entityId = d.entity;
    action = "toggle";
    clearTimer();
    timer = setTimeout(() => {
      held = true;
      timer = null;
      if (entityId) fireEvent(host, "hass-more-info", { entityId });
    }, HOLD_MS);
  };

  const onUp = () => {
    const wasHeld = held, id = entityId, act = action, door = coverDoor;
    clearTimer();
    if (!wasHeld) {
      if (act === "toggle" && id) toggleEntity(host.hass, id);
      else if (act === "more-info" && id) fireEvent(host, "hass-more-info", { entityId: id });
      else if (act === "cover-dialog" && door) openCoverDialog?.(door);
    }
    held = false;
    entityId = null;
    action = null;
    coverDoor = null;
  };

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", reset);
  svg.addEventListener("pointerleave", reset);

  return () => {
    reset();
    svg.removeEventListener("pointerdown", onDown);
    svg.removeEventListener("pointerup", onUp);
    svg.removeEventListener("pointercancel", reset);
    svg.removeEventListener("pointerleave", reset);
  };
}
