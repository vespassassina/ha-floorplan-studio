# Backlog & Product Ideas

New ideas go here before being specced into `docs/PLAN.md`.

## Studio Precision, Palette & Fullscreen (Planned S84–S87)
- **S84 — Straighten walls & merge collinear segments:** Simplify jagged imported walls and snap edges to `0°/90°` (with optional `45°` / `30°/60°`), moving coincident corners together.
- **S85 — Exact corner angle tool:** Show live interior angle at a selected corner with presets (`90°`, `45°`, `60°`, `120°`, `135°`, `180°`) and custom degree input.
- **S86 — Multi-floor alignment by external walls & stairwells:** Match external wall angle + stairwell pivot to the floor below, plus 1-click Copy Perimeter / Copy Stairs from floor below.
- **S87 — Draggable Studio icon tool palette & Fullscreen mode:** Compact movable 8-tool icon rail in Studio + true Fullscreen pop-out for both Studio and Card.

## Outdoor Realism, Garden Structures & Roof Floor (Proposed S88–S93)
- **S88 — City / street lights:** Ambient outdoor light sources (no HA entity required; auto-on at night) with colour presets (`sodium`, `warm_led`, `cool_led`, `neon`, custom hex), configurable pole height and reach in 2D and 3D.
- **S89 — Living hedges & multi-colour fences:** Thick grass/foliage `hedge` wall kind (textured green in 2D, organic foliage mass in 3D with sun shadows) + upgraded slatted/post-and-rail `fence` with colour swatches.
- **S90 — Carports, pergolas & extensible sun covers (awnings):**
  - `carport` / `pergola` structure with configurable pole layout (e.g. house-wall attached + 4 poles on long side) and translucent polycarbonate / wood / metal roof (lets car underneath stay visible and clickable in 2D & 3D).
  - `awning` (extensible sun cover) attached to an exterior wall, dynamically extending/retracting with HA `cover.*` `current_position` and casting shade.
- **S91 — Garden houses / sheds / gazebos:** Dedicated outdoor building object with pitched/flat roof, overhang, wall/roof colours, optional door/window and HA entity link (renders with closed roof in 3D).
- **S92 — Roof floor, roof shapes & roof fixtures:** Dedicated `roof` floor kind (larger/overhanging floors below) supporting `gable`, `hip`, `shed`, `flat`, and mixed flat+pitched sections, plus `skylight` (lucernario, HA-linkable), `chimney`, and `solar_panel` arrays (linkable to PV production sensors).
- **S93 — Aerial / Google Maps / Drone photo import for Roof:** Guided aerial photo trace + 2-point scale + wall-below alignment for tracing roofs and solar layouts directly from satellite or drone imagery.

## Earlier Deferred Ideas
- **Multiple layouts (several houses / buildings):** Layout switcher in HA storage, Studio, and card YAML.
- **Studio UI translation (i18n):** Translate Studio menus and panels into the 9 card languages.
- **Mobile phone quick-room bar:** Compact horizontal room-chip bar on `< 520 px` screens for effortless one-thumb room zoom.
- **Dreame vacuum live position & trail:** 2-point calibration from `camera.<dreame>_map` (`vacuum_position`, `charger_position`, `map_id`) once a real state dump is supplied.
