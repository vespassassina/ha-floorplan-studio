# Plan

Epics, then sprints. A task is one outcome with one test. A sprint ends with a
working increment. Tick tasks as they close.

## Epics

- E1 Core: schema v2, migration, geometry, renderer, icons.
- E2 Editor: port the current editor onto the core; standalone build.
- E3 Card: live rendering and behaviours.
- E4 Integration and panel: load/save, HA-hosted editor, HACS release.
- E5 Content: furniture symbols, prompt, docs.

## Sprint 0 — in the current HomeFloorplan editor (done first, keeps momentum)

- [ ] S0.1 MDI icons for device types instead of polygons. Test: each type renders an `<path>` from the icon table.
- [ ] S0.2 Door and window get `sensor`; the editor panel offers unplaced contact entities. Test: selecting a sensor stores the entity id; the door draws orange when a preview flag is set.
- [ ] S0.3 Schema v2 fields (`id`, `area`, `sensor`, `version: 2`) written by the editor; v1 loads. Test: round-trip of the house layout is loss-free.

## Sprint 1 — core and standalone editor (E1, E2)

- [ ] S1.1 Repo scaffold: TypeScript, Lit, Vite, Vitest, ESLint, MIT, `demo/layout.json`. Test: `npm test` runs one passing test.
- [ ] S1.2 `core/schema.ts`: types, `validate()`, `migrate()` v1→v2. Test: the demo validates; a v1 fixture migrates to v2 and validates.
- [ ] S1.3 `core/geometry.ts`: snap, T-snap, stitch, merge, wall toggle, moved from the editor. Test: fixtures for each function.
- [ ] S1.4 `core/render.ts`: layout → SVG string, with a state overlay input. Test: snapshot of the demo render.
- [ ] S1.5 `core/icons.ts`: MDI paths for every device type and furniture symbol. Test: no type without an icon.
- [ ] S1.6 `editor/`: Lit shell around the core, same features as today. Test: Playwright places a device, saves, reopens.
- [ ] S1.7 Standalone build `dist/editor.html`, self-contained. Test: file opens from `file://` and round-trips the demo.

## Sprint 2 — card (E3)

- [ ] S2.1 `card/floorplan-studio-card.ts`: renders a floor from a layout given in config or from the integration. Test: renders the demo in a jsdom `hass` stub.
- [ ] S2.2 Light, switch, plug: state colour, tap toggles, hold opens more-info. Test: stub state change updates the icon class.
- [ ] S2.3 Contact sensor on door/window: orange when on. Test: state on → door has `open` class.
- [ ] S2.4 Motion fade from `last_changed`. Test: fake timers, opacity decays to 0 at `fade`.
- [ ] S2.5 Temp, humidity labels; climate bar colour; camera and media open more-info. Test: labels render the value with unit.
- [ ] S2.6 Room glow, floor switcher, unavailable style. Test: room tint when a light in it is on.
- [ ] S2.7 Cover on a door: confirm dialog then service call. Test: confirm → `cover.open_cover` called with the entity.

## Sprint 3 — integration, panel, release (E4)

- [ ] S3.1 `custom_components/floorplan_studio`: config flow, storage, websocket load/save. Test: pytest with `pytest-homeassistant-custom-component`.
- [ ] S3.2 Panel registration serving the editor; editor Load/Save via websocket. Test: dev container, acceptance criterion 3.
- [ ] S3.3 Editor pickers pull areas, devices, entities from `hass`, grouped by type then area; only unplaced entities offered. Test: stub registry → grouped list.
- [ ] S3.4 Card served as a Lovelace resource by the integration. Test: acceptance criterion 4.
- [ ] S3.5 `hacs.json`, versioned release, README install steps. Test: HACS validation action passes.

## Sprint 4 — content and docs (E5)

- [ ] S4.1 Furniture symbols: table, sofa, bed, cabinet, chair, sink, toilet, shower, bathtub, tv, computer, tree, patio wood, patio concrete, car. Test: each symbol renders and rotates.
- [ ] S4.2 `prompts/trace-from-photos.md` and README section. Test: acceptance criterion 6 on the maintainer's photos.
- [ ] S4.3 Docs: schema reference, card config, editor guide with screenshots, contributing. Test: link check.
- [ ] S4.4 Demo GIF and HACS default repository submission.

## Later, not planned

- Per-room presence heat map over a day.
- Import from ha-floorplan SVGs.
- Multi-layout (several houses).
