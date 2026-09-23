# The editor

Draw your home, floor by floor, and attach it to Home Assistant — walls,
rooms, doors, stairs, furniture, devices. Runs two places, same code:

- **Inside Home Assistant**, as a sidebar panel — draws, saves straight to
  `.storage`, and (where a writer is configured) reads and writes Home
  Assistant itself: areas, entities, helpers, groups, automations.
- **Standalone**, as `dist/editor.html` — open it directly from disk
  (`file://`), no server, no Home Assistant. Draws and exports/imports JSON
  files; nothing about Home Assistant is available here.

![The editor with the demo house loaded: toolbar across the top, the plan in the middle, the floor panel on the right.](img/editor-overview.png)

## The toolbar

Left to right:

- **Floor tabs** (`Ground`, `First`, ... plus `+`) — switch floors, or add a
  new one. A new floor starts with an outline and the first flight of stairs.
- **Devices: all (N)** — filters which device types are drawn, so a crowded
  plan can be thinned out while you work.
- **Names** — toggles room/device name labels.
- **Add** — every drawable thing: openings (door, window, gap), a wall of a
  given kind, areas (zone, structure, stairs), furniture, an unlinked
  appliance icon, and (inside Home Assistant) entities from your instance.
- **Draw** — freehand outline/room drawing mode.
- **Device** — the catalog of every device on this layout, placed or not.
- **View** — the installed version at the top, then grid, measure marks, plan
  rotation, theme.
- **File** — Save, Open, Export, Reset.
- **Help** — a step-by-step guide in the side panel, for someone who has
  never used the editor before. It stays open while you work, so you can
  follow a step and do it without the guide getting in the way. Escape or
  its own Close button puts the side panel back to normal.
- **Undo / Redo** — one step per gesture; a drag that ends back where it
  started adds no step.

![The Add menu open: Openings, Wall and Areas submenus, then Furniture and Unlinked device selects.](img/editor-add-menu.png)

## The side panel

Click anything on the plan — a room, a wall, a device, furniture, stairs — and
its panel replaces the default "Floor" panel on the right: what it is, its
fields, and a Delete button. Click empty canvas to go back to the floor panel.
Panels for entity-backed things (rooms with an area, devices) also show
Home Assistant context — the room's helpers and automations, a device's
more-info — where a writer is configured.

![The Living light selected: its panel shows type, entity, rotation, and what powers it.](img/editor-device-panel.png)

## Drawing a house

1. **Draw the outline.** `Draw` starts freehand outline drawing; click each
   corner, double-click (or click the first corner again) to close it.
2. **Split it into rooms.** Draw a room the same way, snapped to the outline
   and to other rooms — a room's own edges default to `wall`.
3. **Doors and windows.** `Add → Openings` places one on the nearest wall
   within 15 cm; drag it along the wall afterwards.
4. **Stairs, zones, structures.** `Add → Areas`. A zone has no wall edges (it
   can't — `wk` is forced to `boundary` throughout); a structure can.
5. **Furniture and devices.** `Add → Furniture` places a symbol you can move,
   resize and rotate. `Add → Entities` (inside Home Assistant) or
   `Device → <unplaced item>` places something tied to a real entity.
6. **Attach an entity.** Select a device, pick it from the entity field in its
   panel. An entity already on the plan is never offered twice (its own
   stays).
7. **Save.** `File → Save` inside Home Assistant writes to `.storage`
   straight away. `File → Export` (either mode) downloads the JSON.

## Snapping and editing

A corner jumps onto another corner, a wall, or lines up with a neighbour.
Hold **Alt** while dragging to move freely, ignoring every snap. Drag a wall
to move it together with the corners on either end; hold **Shift** while
dragging a corner or a wall to move just that one, detached from its
neighbours. Drag a room, zone or stairs by its middle to move the whole
shape. **Delete** removes whatever is selected — corner, wall, door, opening,
device, furniture or stairs. **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+Shift+Z**
redoes. Scroll to zoom; pan by dragging the background, or drag anywhere with
the middle button, right button, or Ctrl/Cmd held.

## Rotation

A device or a piece of furniture turns from its panel's rotation buttons —
30°, 45°, 60° or 90° per click, a direction toggle, and Reset to 0. There is
no free-text angle field: every angle the UI can produce is already wrapped
into `[0, 360)`. (A hand-edited layout file can still carry an angle outside
that range — the file loader normalises it on open, same treatment as an
out-of-range furniture size.)

## Starting from photos instead

If you'd rather not draw the outline by hand, an AI assistant can trace it
from photos or an architect's drawing and hand you back a `layout.json` to
open here and correct. See the README's ["Start from photos or architect
drawings"](../README.md#start-from-photos-or-architect-drawings) section.

## Layout files

The editor's Open and Reset both run every file through the same `validate()`
the card uses — a file that doesn't pass is rejected with the reason, and
nothing on screen changes. A layout is [schema v2](schema.md); an older v1
file is migrated on open automatically. Because a layout file is something
anyone (or an LLM) can hand you, it's treated as untrusted: a missing field
gets a sane default, an out-of-range value gets clamped or wrapped rather
than crashing the load, and only `validate()` itself is the strict gate that
decides whether the result is usable.
