# Scene designer

Diego, 2026-10-07. Build the scenes of a room in the studio, with a popup, instead of one select per light.

## Goal

A room's custom scenes are made in a popup: pick the devices, set each one, name the scene, save. Colours can come from a palette or a picture. Home Assistant (Hue) scenes are listed beside them.

## Non-goals

- Editing a Hue scene itself. Hue scenes live on the bridge; HA can only run them. The studio lists them and offers them to a room, as today.
- Copying a Hue scene into a custom one (Diego: use them as they are).
- Saving scenes into HA (`scenes.yaml`). Later, on his word.
- A separate custom card for scenes.

## Decisions

- **Where scenes live:** the layout, on the room (`room.scenes`), as today. One schema change: a `SceneItem` may also set `volume`, `source` and other per-domain fields (S-D4), all optional, so an older card ignores them.
- **Popup, not panel:** opened from the room panel's "Scenes" section by "New scene" or the edit button on a scene row. One undo step per Save, none for Cancel.
- **Live preview:** off by default. A "Try it" button sends the scene to the real devices (writer only), and "Restore" puts back what was there before.
- **Palette and image:** done in the browser, no network. An image is drawn to a small canvas, the dominant colours found by a fixed-seed k-means (so the same picture gives the same scene). Colours are spread over the lights, brightest to the largest area.
- **Device types in scenes:** `light`, `switch`, `fan`, `cover`, `climate`, `media_player`. One list of what each type may set, one function that turns an item into service calls (`customCalls`). A type not in the list is ignored, never an error.

## Acceptance criteria

1. The room panel's Scenes section lists HA scenes (marked), then custom scenes, each with Edit and Delete for custom ones.
2. "New scene" and Edit open a popup with the room's devices; each row sets on/off, brightness, colour temperature or colour (lights), and the fields of its type.
3. A name is required; Save is refused with the reason when it is empty. Cancel changes nothing.
4. Palette: choose 2-6 colours, press Apply, lights get them. Image: choose a file, press Apply. The same input gives the same result. A file that is not an image is refused with a message.
5. Try / Restore need a writer and say so when there is none.
6. The card runs every item type through `customCalls`; a tap sends exactly the calls the popup showed.
7. Every layout with scenes still passes `validate`; junk items are dropped, not thrown on (finding 1).

## Sprint 17 (0.18.0): scene designer

| Task | Outcome | Test |
|---|---|---|
| S17.1 | Room panel sections collapse and remember it (editor) | click folds, reload keeps |
| S17.2 | `SceneItem` fields per type; `customCalls` for fan, cover, climate, media_player | unit per type, junk dropped |
| S17.3 | Scene designer popup: devices, on/off, brightness, kelvin, colour, name, Save/Cancel | Playwright, real mouse, one undo step |
| S17.4 | Scenes list in the room panel: HA scenes marked, custom Edit/Delete | Playwright |
| S17.5 | Palette apply (pure `spreadColours`) | unit, deterministic |
| S17.6 | Image apply (pure `dominantColours` + canvas read) | unit on pixel arrays, Playwright with a fixture picture |
| S17.7 | Try / Restore | unit with a fake writer |
