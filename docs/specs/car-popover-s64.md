# Sprint 64: Card headroom (lazy dialogs) & rich car card popover

**Goals:**
1. **S64.1 (Card headroom):** Move the four modal dialog templates and handlers (`cover`, `vacuum`, `chooser`, `floor-off`) into a zero-import lazy chunk (`src/card/dialogs/index.ts` → `floorplan-studio-dialogs-<hash>.js`, `<= 4,000 B` gzip), freeing ~1.2–1.8 KB from `floorplan-studio-card.js` for S64 and S65.
2. **S64.2 (Rich car card popover):** Enhance tapping a `car` piece so `.fp-pop` loads a zero-import lazy chunk (`src/card/car/index.ts` → `floorplan-studio-car-<hash>.js`, `<= 5,000 B` gzip) rendering rich live vehicle telemetry and quick controls inside the popup while preserving 100% compatibility with existing `card-car.spec.ts` assertions (`.fp-pop`, car name, summary text, `More info` button, no main power switch).

**Card byte budget:** Net **decrease** in `floorplan-studio-card.js` gzip (`<= 138,000 B`), `0 B` added to all 9 `floorplan-studio-lang-*` chunks (`<= 5,000 B`).

---

## 1. S64.1 — Lazy dialogs chunk (`src/card/dialogs/index.ts`)
- Zero runtime imports (receives `html`, `nothing`, `t`, `OFF_GROUPS`, `OFF_GROUP_LABEL`, `floorOffCalls`, `fireEvent`, `callService`, `coverService` via deps).
- Loaded on first `openCoverDialog`, `openVacuumDialog`, `openChooserDialog`, or `openOffDialog` via `lazy(..., "__FPDIALOGS_CHUNK__", "dialogs")`.
- `dialogOpen(c)` and the four `open*Dialog` state flags stay synchronous on `FloorplanStudioCard` so double-tap guards and focus management are unchanged.
- Inlined by `scripts/card-source.mjs` alongside `overview` for `file://` Playwright harnesses.

## 2. S64.2 — Rich car popover (`src/card/car/index.ts`)
- Pure extractor `carDetails(entities: readonly string[], states: States): CarDetails` (never throws on malformed/missing states):
  - `level: { value: number; kind: "battery" | "fuel" } | null` — battery (`device_class === "battery"`) wins over fuel (`entity.includes("fuel")`).
  - `range: string | null` — first sensor with `device_class === "distance"`, unit `km`/`mi`, or entity id containing `range` (formatted with unit).
  - `charging: boolean`, `chargePower: string | null` (power sensor `W`/`kW` when > 0 or charging), `chargeEta: string | null` (sensor containing `charge_time`/`time_remaining`/`remaining` or `device_class === "duration"`/`"timestamp"`).
  - `openings: { entity: string; name: string; open: boolean; kind: "lock" | "opening" }[]` — every attached `lock.*` and `binary_sensor.*` (`door`, `window`, `opening`, `garage_door`), sorted with open/unlocked alerts first.
  - `controls: { entity: string; name: string; domain: "lock" | "climate" | "switch"; on: boolean; state: string }[]` — actionable attached controls (lock/unlock, climate/preheat, switch/charger).
- UI rendered inside `.fp-pop` (`.fp-car-pop`) when `subject.type === "car"` and `carMod` is loaded:
  - Battery / fuel progress bar (`.fp-car-bar`) with percentage + range readout.
  - Charging pill with power and ETA when present.
  - Status chips for doors, windows, trunk, and locks (open/unlocked highlighted with `--fp-open-door` / `--fp-warn`).
  - Quick controls (hidden in kiosk mode):
    - `lock.*`: **Lock** executes immediately; **Unlock** requires a 1-click inline confirm (`Confirm unlock` / `Cancel`) for safety.
    - `climate.*` / `switch.*`: toggles via `climate.turn_on`/`turn_off` or `switch.turn_on`/`turn_off`.
  - Per-entity quick `more-info` chips when not in kiosk mode.

## 3. Done criteria
1. `floorplan-studio-dialogs-<hash>.js` (`<= 4,000 B` gzip) and `floorplan-studio-car-<hash>.js` (`<= 5,000 B` gzip) have zero runtime imports, are wired in `vite.config.ts`, `scripts/build.mjs`, `scripts/card-source.mjs`, and `tests/card/size-budget.spec.ts`.
2. `floorplan-studio-card.js` gzip drops meaningfully below `138,000 B`.
3. `carDetails` unit tests cover battery/fuel, range, charging power/ETA, door/window/lock openings, controls, and hostile/empty states.
4. All existing `tests/card/card-car.spec.ts`, `tests/card/card-popup.spec.ts`, `tests/card/size-budget.spec.ts`, plus new Sprint 64 car popover tests pass with `npm run lint` and `npm test` green.
