# Sprint 48 — History and readability on the card

## Goal
Make sensor readings, multi-sensor trends, and plan visuals easier to read directly on the card while keeping the main bundle within its gzip budget:
1. **Value icon on `other`**: opt-in `"value"` gauge icon and live reading label on `Device.type === "other"`, not a new `DeviceType`.
2. **History chart**: popup history chart for a room's or device's sensors in a zero-import lazy chunk (`floorplan-studio-history-<hash>.js`) sharing Replay 2's `fetchHistory`.
3. **Plan legend**: lazy zero-import overlay (`floorplan-studio-legend-<hash>.js`) opened from the `⋯` menu explaining glow/fill, rings/waves, and Attention colours.

## 1. Value icon on `other`
- Schema (`src/core/schema.ts`): `OTHER_ICONS = ["value"] as const`, `OtherIcon = "value"`, optional `Device.icon?: OtherIcon`.
- Validation: allowed only when `d.type === "other"` and `d.icon === "value"`.
- Rendering (`src/core/icons.ts`, `src/core/render.ts`):
  - `VALUE_ICON` (MDI `mdiGauge`, Apache 2.0) replaces `DEVICE_ICONS.other` when `d.type === "other" && d.icon === "value"`.
  - Prints `<text class="val">` beneath/beside the icon: `"–"` for empty/`unknown`/`unavailable`, numeric values with optional `unit_of_measurement` formatted through `formatState`, and short strings truncated to 14 chars (`slice(0, 13) + "…"`).
- Studio (`src/editor/panels.ts`): shows an **Icon** selector (`#vicon`) under Identity when `d.type === "other"` and deletes `icon` when changing away from `"other"`.

## 2. History chart (`src/card/history/index.ts`)
- Zero runtime imports (`{ html, nothing, t }` passed at call time); marker constant `HISTORY_CHUNK = "fp-history-v1"`.
- Opened from:
  - **Device popup** (`History` button in `popup-ui.ts` / `card-popup.ts`) for the device's entities + optional attached `powerEntity`.
  - **Room Overview** (`History` button in `overview/panel.ts`) for the room's sensors (`temps`, `humidity`, `power`, `water`, plus `temp`/`humidity`/`other` room devices).
- Shares Replay 2's lazy `fetchHistory` via `fetchHistoryFor(c, entityIds, hours)` exported from `src/card/card-replay.ts`.
- Supports `6 h`, `24 h`, and `7 d` window switching with stale-request cancellation, loading/error/empty states, multi-series numeric polylines (downsampled to <= 120 points, per-series min/max/latest legend), and discrete state timeline bars.
- Budget: <= 6,000 bytes gzipped, zero runtime imports.

## 3. Plan legend (`src/card/legend/index.ts`)
- Zero runtime imports; marker constant `LEGEND_CHUNK = "fp-legend-v1"`.
- Opened from the Overview panel (`Legend` button `.fp-ov-legend` in `overview/panel.ts`).
- Explains theme-driven SVG swatches (using `--fp-*` CSS vars only) across three groups: **Glow**, **Rings**, and **Attention**.
- Budget: <= 4,000 bytes gzipped, zero runtime imports.
