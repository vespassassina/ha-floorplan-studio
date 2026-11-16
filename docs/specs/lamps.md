# Sprint 62 — Lamps That Look the Part

Seven distinct lamp kinds (`floor`, `desk`, `strip`, `ceiling`, `spot`, `pole`, `flood`), each with its own top-down/2.5D symbol, its own light emission, and its own 3D geometry and floor pool/cone. Lights without a `lamp` block keep the existing plain bulb icon and soft aura.

## 1. Schema & Validation (`src/core/schema.ts`)

- `LAMP_KINDS = ["floor", "desk", "strip", "ceiling", "spot", "pole", "flood"] as const`
- `LampSpec`:
  ```ts
  export interface LampSpec {
    kind: LampKind;
    /** `floor` (default 150, 40–300 cm) and `pole` (default 80, 20–300 cm). */
    height?: number;
    /** `strip` length in cm (default 150, 20–1000 cm). Oriented by `Device.rot`. */
    length?: number;
    /** `ceiling` diameter in cm (default 40, 10–200 cm). */
    diameter?: number;
    /** `flood` beam angle in degrees (default 60, 15–160°). Oriented by `Device.rot`. */
    angle?: number;
    /** `flood` reach in cm (default 300, 50–1000 cm). */
    reach?: number;
  }
  ```
- Added as optional `lamp?: LampSpec` on `Device`.
- **No schema version bump**: older cards ignore `d.lamp`; layouts without `d.lamp` render identically to before.
- **`validateLayout` rules**:
  - `d.lamp` is allowed only when `d.type === "light"`.
  - `d.lamp.kind` must be one of `LAMP_KINDS`.
  - Any present numeric parameter (`height`, `length`, `diameter`, `angle`, `reach`) must be finite and within its kind's valid range.
- **Defaults (`LAMP_DEFAULTS`)**:
  - `floor`: `height = 150` cm (`40..300`)
  - `desk`: fixed size
  - `strip`: `length = 150` cm (`20..1000`), oriented by `d.rot ?? 0`
  - `ceiling`: `diameter = 40` cm (`10..200`)
  - `spot`: fixed size
  - `pole`: `height = 80` cm (`20..300`)
  - `flood`: `angle = 60`° (`15..160`), `reach = 300` cm (`50..1000`), aimed along `d.rot ?? 0` (`0°` = screen-up / `-90°`)

## 2. Lazy Lamp Chunk (`src/card/lamp/index.ts`)

- Built as `floorplan-studio-lamp-<hash>.js` (<= 10,000 B gzip, zero runtime imports from `card/` or `core/`).
- Keeps `floorplan-studio-card.js` within its `138,000 B` gzip budget.
- Loaded lazily by the card **only** when the active layout contains at least one `light` device with `d.lamp`. Layouts without `d.lamp` never request the chunk.
- Studio imports `src/card/lamp/index.ts` directly so lamp symbols and handles render immediately.

## 3. 2D & 2.5D Rendering

- **Lit emission** (drawn in the flat aura pass before walls, doors, furniture, and icons; follows `--fp-aura` / `rgb_color`, `--fp-dev-opacity` / brightness, `fxScale(d)`, and room wall clipping via `roomAt`):
  - `floor`: soft radial pool (`1.0 × LIGHT_REACH × fxScale`).
  - `desk`: soft compact pool (`0.7 × LIGHT_REACH × fxScale`).
  - `ceiling`: soft overhead pool (`1.1 × LIGHT_REACH × fxScale`), mounted at the holding room's ceiling height (falling back to floor `height` outside rooms).
  - `strip`: elongated capsule/line glow of `length` rotated by `d.rot ?? 0`.
  - `spot`: small hard-edged circle (`38 × fxScale` radius) with steep falloff, mounted at ceiling height.
  - `pole`: wide soft pool on the ground (`1.4 × LIGHT_REACH × fxScale`).
  - `flood`: directional sector/cone (`angle` degrees, `reach × fxScale` cm, aimed along `d.rot ?? 0`), clipped at the holding/ahead room walls via `<clipPath>` (matching camera cones).
- **Symbols**:
  - `floor`: weighted base disc, 2.5D stem lift scaled by `height`, and shade ring.
  - `desk`: compact base, angled arm, and shade.
  - `strip`: linear emitter bar of `length` cm in plan units rotated by `d.rot ?? 0`.
  - `ceiling`: circle of `diameter` cm in plan units with inner diffuser ring.
  - `spot`: recessed/track can with inner lens dot.
  - `pole`: outdoor post base + lantern cap with 2.5D stem lift scaled by `height`.
  - `flood`: projector housing aimed along `d.rot ?? 0` with emitter lens.

## 4. 3D Rendering (`src/core/live-build.ts`, `src/core/scene-build.ts`, `src/card/three/`)

- **Shapes** (static per scene build, zero per-frame cost):
  - `floor`: base disc + vertical pole (`height`) + shade frustum/cylinder.
  - `desk`: compact base + angled stem + shade at `z` (default 75 cm).
  - `strip`: thin glowing bar of `length` rotated by `d.rot` at `z`.
  - `ceiling`: flat diffuser disc/cylinder of `diameter` at room/floor ceiling height.
  - `spot`: compact recessed/track cylinder at ceiling height.
  - `pole`: outdoor post of `height` + top lantern cap.
  - `flood`: projector head aimed along `d.rot` at `z` (default 220 cm).
- **Pools & Cones** (`src/card/three/fx.ts`):
  - `floor`, `desk`, `ceiling`, `pole`: circular floor pools (`0.7×`, `1.0×`, `1.1×`, `1.4× POOL_REACH × scale`), ray-clipped to room walls when inside a room.
  - `spot`: tight, high-centre-intensity floor pool (`0.35 × POOL_REACH × scale`).
  - `strip`: elongated capsule floor pool along `length` and `rot`.
  - `flood`: directional cone floor pool (`angle`°, `reach × scale` cm, aimed along `rot`), ray-clipped to room walls with zero per-frame cost.

## 5. Studio Editing (`src/editor/`)

- `devicePanel` (`src/editor/panels.ts`): when `d.type === "light"`, shows **Lamp kind** (`#vlamp`) with `Default (bulb)` and the 7 kinds, plus kind-specific numeric fields showing defaults as placeholders:
  - `floor`, `pole`: `height (cm)` (`#vlampH`)
  - `strip`: `length (cm)` (`#vlampLen`)
  - `ceiling`: `diameter (cm)` (`#vlampDia`)
  - `flood`: `cone angle (°)` (`#vlampAng`), `reach (cm)` (`#vlampReach`)
  - Changing `d.type` away from `"light"` removes `d.lamp` in the same undo step.
- Plan drag handles (`src/editor/editor-overlay.ts` + drag handler):
  - `strip`: end handle to drag `length` and `rot`.
  - `ceiling`: edge handle to drag `diameter`.
  - `flood`: tip handle to drag `reach` and `rot`.
  - One undo step per drag.

## 6. Acceptance Criteria

1. All 7 kinds render distinct symbols and distinct light emissions in 2D, 2.5D, and 3D; lights without `lamp` remain unchanged.
2. `ceiling` and `spot` mount at room ceiling height (falling back to floor height outside rooms).
3. `flood` cone clips at room walls in 2D/2.5D/3D and respects `angle`, `reach`, and `rot`.
4. `floorplan-studio-card.js` stays `<= 138,000 B` gzip; `floorplan-studio-lamp-<hash>.js` is `<= 10,000 B` gzip with zero imports from `card/` or `core/` and is never fetched when a layout has no `lamp`.
5. Studio edits (panel fields + plan drag handles) validate cleanly and record one undo step per edit/drag.
