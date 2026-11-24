# Sprint 65: Wall-tablet & mobile kiosk polish

**Goal:** Make wall-mounted tablets and mobile kiosks self-maintaining with idle auto-return, a wake-safe screensaver/dim overlay, and an optional clock + weather header chip.

**Card byte budget:** Stay well under `138,000 B` gzip (`floorplan-studio-card.js` starts Sprint 65 at `137,159 B` gzip, `841 B` headroom) and `0 B` added to all 9 `floorplan-studio-lang-*` chunks.

---

## 1. Config keys (approved by Diego 2026-11-24; logged in `docs/DECISIONS.md`)
- `idle_return?: number` — seconds of inactivity (`5..86400`; invalid/non-positive = off) before the card closes popups, dialogs, overlays, and room selection, resets view zoom/pan/rotation, and switches back to the default floor.
- `idle_dim?: number` — seconds of inactivity (`5..86400`; invalid/non-positive = off) before the card shows a dim screensaver overlay (`.fp-screensaver`) with large `HH:MM` clock and optional weather summary.
- `header_clock?: boolean` — when `true`, shows a compact `HH:MM` + weather temperature/condition chip (reading `this._weatherId()`, default `weather.home`, omitting weather gracefully if unavailable). Shown inside `.fp-head` in normal mode and as a compact `.fp-kiosk-clock` pill in `kiosk: true` mode.

## 2. Behaviour & safety rules
- **Activity reset:** `pointerdown`, `pointermove` (throttled), `wheel`, and `keydown` on the card reset both idle timers.
- **Wake-safe screensaver:** Tapping/clicking/pressing a key while `.fp-screensaver` is shown consumes the event (`preventDefault` + `stopPropagation`) and wakes the display without toggling any underlying device or room.
- **Clock refresh:** A single lightweight `30 s` interval runs only when `header_clock` is true or `.fp-screensaver` is active, and is cleared on `disconnectedCallback`.
- **Untrusted config / states:** Non-numeric, `NaN`, `Infinity`, or `< 5` values for `idle_return` / `idle_dim` disable the feature silently; missing or malformed `weather.*` state renders the clock alone without throwing.

## 3. Done criteria
1. `docs/DECISIONS.md` and `tests/card/surface-freeze.test.ts` record `idle_return`, `idle_dim`, and `header_clock`.
2. Pure unit tests (`tests/card/kiosk-polish.test.ts`) verify `parseIdleSec`, `formatClock`, `formatWeatherChip`, and hostile/empty inputs.
3. Playwright tests (`tests/card/kiosk-polish.spec.ts`) verify:
   - `idle_return` closes popup, resets zoom, and returns to default floor after idle.
   - `idle_dim` dims the card after idle, shows clock + weather, and first tap wakes without firing any service call or opening a device popup.
   - `header_clock: true` shows clock + weather in both normal header and `kiosk: true` mode.
4. `npm run lint`, `npm test`, `tests/card/size-budget.spec.ts`, `tests/card/surface-freeze.test.ts`, and `tests/card/kiosk-polish.spec.ts` all pass.
