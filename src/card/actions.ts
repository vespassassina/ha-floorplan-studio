import type { Device } from "../core";
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
 * Wires tap and hold onto a rendered floor's `<svg>`: a tap toggles the entity under the pointer, a hold of
 * `HOLD_MS` or more fires `hass-more-info` on `host` instead. `getDevice(i)` reads the device at `data-x="i"`
 * fresh on every pointerdown, so a re-render between gestures is picked up.
 *
 * Device icons are `<g data-x>`; the pointer can land on an inner `<path>` or the halo `<circle>`, so the real
 * target is resolved with `closest("g[data-x]")` (CLAUDE.md finding 3) rather than trusting `e.target` itself.
 *
 * No debounce: each pointerdown/pointerup pair is independent, so two quick taps toggle twice, not once
 * (S2.2 "Break it").
 */
export function bindDeviceActions(svg: SVGSVGElement, host: DeviceActionsHost, getDevice: (index: number) => Device | undefined): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let entityId: string | null = null;

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
  };

  const onDown = (e: Event) => {
    const g = (e.target as Element | null)?.closest('g[data-x]');
    if (!g) return;
    const i = Number(g.getAttribute("data-x"));
    const d = Number.isFinite(i) ? getDevice(i) : undefined;
    if (!d) return;
    held = false;
    entityId = d.entity;
    clearTimer();
    timer = setTimeout(() => {
      held = true;
      timer = null;
      if (entityId) fireEvent(host, "hass-more-info", { entityId });
    }, HOLD_MS);
  };

  const onUp = () => {
    const wasHeld = held, id = entityId;
    clearTimer();
    if (!wasHeld && id) toggleEntity(host.hass, id);
    held = false;
    entityId = null;
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
