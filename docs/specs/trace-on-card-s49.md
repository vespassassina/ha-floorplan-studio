# Sprint 49 — Trace on the card

## Goal
Allow each floor's Studio trace image to be shown under the rendered plan on dashboard cards when explicitly enabled in the layout (`Trace.card`), while remaining off by default and adding zero card YAML config keys (preserving the surface freeze).

## 1. Schema (`src/core/schema.ts`)
- Add optional `card?: boolean` to `Trace` (off when omitted or `false`; writers omit `card` when not `true` so existing layouts remain unchanged).
- `validate()`: reject any `t.card !== undefined && typeof t.card !== "boolean"` with `${at} trace card must be true or false`.
- `migrate()`: preserves `trace` (including `card` when valid).

## 2. Card & Core Rendering (`src/core/render.ts`, `src/card/floorplan-studio-card.ts`)
- When `f.trace?.on === true && f.trace?.card === true`:
  - `FloorplanStudioCard` passes `trace: true` to `renderFloor(...)` and adds the `tracing` class to the plan `<svg>` (in 2D and 2.5D; 3D ignores trace).
  - Otherwise (`card` absent/`false` or `on` `false`), `trace: false` is passed and no `<image class="trace">` is emitted.
- `FLOORPLAN_CSS` includes `image.trace{pointer-events:none}` (so the underlay never intercepts clicks or hovers) and `svg.tracing .room{fill-opacity:.4}` (shared by both Studio and card).
- `FloorplanStudioCardConfig` is unchanged (no card YAML key added).

## 3. Integration WebSocket (`custom_components/floorplan_studio/websocket.py`)
- `_trace_for_card(floor)`: returns `True` iff `floor.get("trace")` is a dict with `on is True` and `card is True`.
- `_without_trace(layout)`: keeps `f["trace"]` only on floors where `_trace_for_card(f)` is `True`; strips `"trace"` from every other floor without mutating stored data.
- Result: `floorplan_studio/load` without `with_trace: True` (or for non-admin tablets) receives only traces explicitly marked to show on the card (`on: True` and `card: True`). Admin Studio loads (`with_trace: True` and `is_admin`) continue receiving all stored traces.

## 4. Studio UI (`src/editor/editor-trace.ts`, `src/editor/state.ts`)
- `EditorState.setTrace(t)` persists `card: true` only when `t.card === true`, omitting `card` otherwise, in one undo step.
- `loadTrace()` does not carry `card: true` onto a newly loaded or replaced image (off by default).
- In `traceView()`, add checkbox `#traceCard` (**Show on card**) below `#traceOn`:
  - Disabled when `!t.on`.
  - When `t.on && t.card === true`, displays `#traceCardHint`: `"Sent to every tablet viewing this plan."`
  - Toggling it calls `setTrace(...)` in a single undo step.
