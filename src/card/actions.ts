import type { Device, Door } from "../core";
import type { Hass } from "./floorplan-studio-card";

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
 * A door with a `cover` but no `sensor` fires nothing yet: S2.7 adds the confirm dialog for it. A camera or a
 * media player has no toggle: a tap on either opens more-info at once, the same as a sensor door (S2.5).
 *
 * No debounce: each pointerdown/pointerup pair is independent, so two quick taps toggle twice, not once
 * (S2.2 "Break it").
 */
export function bindDeviceActions(
  svg: SVGSVGElement,
  host: DeviceActionsHost,
  getDevice: (index: number) => Device | undefined,
  getDoor?: (index: number) => Door | undefined,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let entityId: string | null = null;
  let action: "toggle" | "more-info" | null = null;

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
  };

  const onDown = (e: Event) => {
    const target = (e.target as Element | null)?.closest('g[data-x], line[data-d]');
    if (!target) return;

    if (target.tagName === "line") {
      const i = Number(target.getAttribute("data-d"));
      const door = Number.isFinite(i) ? getDoor?.(i) : undefined;
      if (!door?.sensor) return; // no sensor: nothing to open more-info for yet (a cover-only door is S2.7)
      held = false;
      entityId = door.sensor;
      action = "more-info";
      clearTimer();
      return;
    }

    const i = Number(target.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;

    if (d.type === "camera" || d.type === "media") {
      // Neither has a toggle: a tap opens more-info right away, the same as a sensor door above (S2.5).
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
    const wasHeld = held, id = entityId, act = action;
    clearTimer();
    if (!wasHeld && id) {
      if (act === "toggle") toggleEntity(host.hass, id);
      else if (act === "more-info") fireEvent(host, "hass-more-info", { entityId: id });
    }
    held = false;
    entityId = null;
    action = null;
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
