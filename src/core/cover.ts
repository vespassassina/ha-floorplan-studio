// One rule for when a cover is "active". A cover is a garage door, a gate, a door, a curtain, a blind...; only the first
// three are a thing you want to notice standing open (Diego, 2026-10-03: curtains are covers, but not a garage door).
// The class comes from HA's `device_class` state attribute, read at render and never stored.
import type { StateOverlay } from "./render";

/**
 * Every device class HA gives a cover (homeassistant.components.cover.CoverDeviceClass), and whether it is active while
 * open, opening or closing. One entry per class, so a class HA adds does not count as active until someone says so
 * (finding 17); a class missing here, or no class at all, reads as a curtain: idle.
 */
export const COVER_CLASSES: Record<string, boolean> = {
  garage: true, gate: true, door: true,
  awning: false, blind: false, curtain: false, damper: false, shade: false, shutter: false, window: false,
};
const LIVE = new Set(["open", "opening", "closing"]);

/** Whether a cover with this state is active. Untrusted state (finding 1): anything unexpected is idle, never thrown on. */
export function coverActive(s: StateOverlay[string] | undefined): boolean {
  if (!s || !LIVE.has(s.state)) return false;
  const cls = s.attributes?.device_class;
  return typeof cls === "string" && Object.prototype.hasOwnProperty.call(COVER_CLASSES, cls) && COVER_CLASSES[cls];
}
