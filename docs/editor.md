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

- **Floor tabs** (`Ground`, `First`, ...) — switch floors. A new floor comes
  from Edit, Add floor: it starts with the outline and stairs of the first
  floor.
- **Filter: all (N)** — filters which device types are drawn, so a crowded
  plan can be thinned out while you work.
- **Add** — every drawable thing: openings (door, window, gap), a wall of a
  given kind, areas (zone, structure, stairs), furniture, an unlinked
  appliance icon, and (inside Home Assistant) entities from your instance.
  Device, inside Add, is the catalog of every device on this layout, placed
  or not.
- **Draw** — freehand outline/room drawing mode.
- **View** — how the plan looks while you work: the installed version at the
  top, then snap grid, measure grid, lengths, names, Show names and text,
  Preview night, theme, Re-center and Fit to window. The editor draws the plan
  flat only; 2.5D (and soon 3D) is a way to look, so it lives in the card.
  Everything here that is about looking, not editing, is in the card too:
  see "Studio and card" in `card.md` for the list, and for what is left out on
  purpose. A new view control needs a row there (a test checks).
- **Edit** — what changes the plan or Home Assistant: Add floor, the Home
  Assistant popover (inside Home Assistant), Group, plan rotation, Device
  colours, Trace image…
- **File** — Save, Open, Export, Reset.
- **Help** — a step-by-step guide in the side panel, for someone who has
  never used the editor before. It stays open while you work, so you can
  follow a step and do it without the guide getting in the way. Escape or
  its own Close button puts the side panel back to normal.
- **Undo / Redo** — one step per gesture; a drag that ends back where it
  started adds no step.
- **Status line** — right of Redo: what just happened ("Saved", "Edited",
  an error). A long message is cut with an ellipsis; hover it for the full
  text.

![The Add menu open: Openings, Wall and Areas submenus, then Furniture and Unlinked device selects.](img/editor-add-menu.png)

## Show names and text

View, Show names and text hides every room, zone and structure name and every
sensor value on the plan, leaving icons and state. It does
not touch the Names button (device names, off by default), the Lengths and
the measure grid, which are editor aids rather than plan text. It is not an undo step, is not saved in the layout and goes back to
shown on reload. The card's own switch is `labels: false` in its config.

## The side panel

Click anything on the plan — a room, a wall, a device, furniture, stairs — and
its panel replaces the default "Floor" panel on the right: what it is, its
fields, and a Delete button. Click empty canvas to go back to the floor panel.
Panels for entity-backed things (rooms with an area, devices) also show
Home Assistant context — the room's helpers and automations, a device's
more-info — where a writer is configured.

A plug's panel has a Power sensor picker: the `sensor.*` of device class
`power` that measures it. A plug is active only while that sensor reads 2 W or
more. Placing a plug (Add, a room's area, the catalog) fills the picker when its
Home Assistant device has exactly one power sensor; with two or none it stays
empty and you pick. Empty also means the card looks for the sibling itself at
runtime. One pick is one undo step; picking the same sensor again is none.

![The Living light selected: its panel shows type, entity, rotation, and what powers it.](img/editor-device-panel.png)

### Heights

Every height is optional, in cm (0 to 1000). The field shows the default as
its placeholder; clearing it removes the value, so the default applies again.
Junk is refused with the reason.

- **Floor** — height (storey, 250) and slab (floor thickness, 25).
- **Room** — ceiling height (the floor's).
- **Wall** — height (by kind: a fence 110, an edge or boundary 0, a wall the
  storey).
- **Door** and **Opening** — height and sill (a door 210 from 0, a window 120
  from 90, an opening 210 from 0).
- **Furniture** and **unlinked appliance** — height (by symbol or type).
- **Device** — mount height, where the real object hangs (by type). A stem to
  it shows in the card's 2.5D from 100 cm up. A heater bar is drawn as a box whose top is
  this height (default 70 cm, under a window sill); a TV panel's bottom is it
  (default 100 cm; 30 cm when it stands free); a speaker's cabinet is a fixed
  20 x 20 x 30 cm and ignores it, but its icon rides it: 30 cm (the top of the
  cabinet) by default, or the height you set.

Stairs take the floor's height as their rise, and a structure line is flat.
A stair has a Direction select: Auto (shown with what it resolves to on this
floor), Up, Down, Up and down. Auto removes the field. Pick Up and down for
stacked stairs on a middle floor, Down where a flight only leads below.

A device's panel shows one extra field for a few types:

- **Person** — a "Room sensor" field, below the entity field: point it at a
  second entity (a BLE room-presence sensor) whose state, or `area_id`/`area`
  attribute, names one of your rooms, and the card glides the icon there. It
  refuses the person's own entity, since that isn't a room sensor.
- **mmWave radar** — a "Targets" field: add or remove `x`/`y` entity pairs,
  one row per tracked target, each pointing at the two sensors an ESPHome
  LD2450 (or similar) exposes for that target.
- **Vacuum** — nothing extra; point `entity` at the `vacuum.*` entity. There
  is no field for the robot's position, since most integrations expose that
  as a camera or a proprietary blob, not coordinates.

## What Floorplan Studio made in Home Assistant

Inside Home Assistant, Edit, Home Assistant opens a small popover (drag it
by its head, close it with the X or Escape) listing every helper,
automation and area the editor created, labelled `floorplan-studio`, across
the whole instance. Click a name to open the item where Home Assistant edits
it: a helper's dialog, the automation editor, the area page. Remove deletes
it from Home Assistant after a confirmation; the plan is not touched either
way. The button is disabled while there is nothing to list.

## Placing a room's devices at once

Select a room linked to a Home Assistant area and the panel shows "Place N
Home Assistant devices" when the area has entities the plan does not show
yet. It opens a popup: one row per entity with a tick, and a chip per type
to narrow the list. Only what the plan has an icon for is offered: lights,
switches, plugs, sensors with a temperature, humidity, motion, contact or
vibration class, cameras, covers and the like. A device with several motion,
occupancy or presence sensors (one per zone) gets a row for each, named to tell
them apart; placing one leaves the others offered. The same rule holds in
Add, Device and the room menu's "Add device from". A `group` whose members are
all motion sensors counts as a motion sensor and is offered; any other group is
left out, with power, energy, illuminance and battery readings, scripts and
people. Untick what
you do not want and press Place: the ticked rows land on free spots in the
room, one undo step, ready to drag to their real place.

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
   panel — a filterable combo box: type part of a name, entity id or
   room/domain to narrow the list. An entity already on the plan is never
   offered twice (its own stays). Attaching a placed entity to a door's
   sensors/locks/cover, a heater's TRVs or temperature sensors, an ac's
   linked entities, or an unlinked item's list pulls its icon off the plan in
   the same step — it is now shown through what it is attached to, and
   `Device` no longer offers it either: an attached entity is in use, not
   unplaced, so it can't be placed a second time next to what already reads
   it. Detach it again (Remove, or clear the cover) and it goes back to
   `Device`, not back onto the plan.
   **Room sensors.** A room's panel has a *Sensors* section: temperature,
   humidity and motion pickers, the same as a door's contact sensors. Each lists
   only its own kind of entity (a `sensor` of class temperature or humidity; a
   `binary_sensor` of class motion, occupancy or presence) and none another room
   already owns, at most 20 per list. A pick is one undo step and also removes a
   loose icon of that entity; Remove (a round red X, named "Remove <sensor>" for
   screen readers) only detaches. The add menu is grouped "<floor> · <room>":
   the room being edited first, then its floor's other rooms, then the other
   floors in layout order, entities with no room last in each floor, and typing
   still filters by the heading. A loose temperature,
   humidity or motion icon that sits inside a room shows **Attach to room** in
   its panel: one click adds its entity to the smallest room (never a zone)
   that holds it and deletes the icon, one undo step. The button is disabled,
   with the reason beside it, when the icon is outside every room, has no
   entity, or is already on the room's list. A layout that holds both an icon
   and the room entry (hand-edited) keeps drawing the icon in the editor, and
   its panel says "Attached to <room>".
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

The same text is in the editor under Help, step "Moving things and
snapping". The side panel no longer repeats it.

## Looking around: buttons, keys and memory

Beside the zoom buttons (`+`, `-`, `0`) are **Rotate view left** and **Rotate
view right**: 45 degrees a press, animated (about 0.35 s a step, none with
`prefers-reduced-motion`). The turn is added to the plan's own rotation (Edit,
Rotate the plan) and is only a way of looking. It is not in the layout, not in
a saved file and not an undo step. A zoomed view keeps its centre and zoom as
it turns; a view that shows the whole floor is refitted. `0` is **Reset
view**: the whole floor, the plan upright.

| Key | Does |
|---|---|
| Up / Down arrow | zoom in / out |
| Left / Right arrow | turn the view left / right, 45 degrees |
| Space | Reset view |
| Cmd/Ctrl+S | Save, the same as the Save button |
| Ctrl/Cmd+Z, Shift for redo; Delete | as before |

Precedence, first match wins:

1. **Cmd/Ctrl+S** goes first and works everywhere in the editor, a text box
   included. The browser's own save-page dialog
   never opens. Shift+Ctrl+S is left to the browser. An empty plan is not
   written: the status line says there is nothing to save.
2. **Typing wins over the view keys.** In a text box, number box, text area,
   select, range slider or editable text (the combo filter box included), the
   arrows and Space are the field's. Space on a focused button, summary, link
   or checkbox presses it. Arrows on a focused button turn or zoom the view.
3. The view keys work with or without a
   selection. There is no arrow nudge of a selection, so nothing competes
   with them. **Alt+arrows** are the same keys.
4. Keys are heard on the editor only, not on the page: a second editor or any
   other input on the page is not touched. Delete, Backspace, Escape and
   Ctrl/Cmd+Z are unchanged.

The editor remembers how you look, per browser, under
`floorplan-studio:view` in `localStorage`: the floor on show, the names toggle, the turn, and the zoom and centre of every floor that
is not shown whole. Theme, grid, measure grid, Preview night and Help already
had keys of their own. It is saved 150 ms after the last touch, and when the
tab is hidden or closed. The plan itself is not in it: a plan that is edited,
opened or reset keeps the view. An older entry that names a 2.5D view, a tilt or a wall mode is read without them and opens flat. A floor the layout does not have is ignored,
a field that does not parse is dropped on its own, and a browser that blocks
storage just forgets. A floor the host asks for (`floor` on the element) wins
over the remembered floor. Reset view clears the zoom and turn.

## Rotation

A device or a piece of furniture turns from its panel's rotation buttons —
30°, 45°, 60° or 90° per click, a direction toggle, and Reset to 0. There is
no free-text angle field: every angle the UI can produce is already wrapped
into `[0, 360)`. (A hand-edited layout file can still carry an angle outside
that range — the file loader normalises it on open, same treatment as an
out-of-range furniture size.)

## Preview night

View, Preview night toggles the same dark overlay the card shows after
sunset: every room and outdoor area darkens, and a room with a light on
stays clear. The editor has no live lights, so with the preview on every
room is dark. It's a browser preference, not part of the layout — it is
never saved with the plan and never becomes an undo step.

## Trace over a scan

Edit, Trace image… opens a small panel at the bottom left of the plan.

1. **Load image…** takes a PNG, JPEG or WebP: a scan, a photo of the
   estate agent's plan, an architect's drawing. It is shrunk to 2000 px on
   the long side and stored with the floor, then placed over the outline (or
   the middle of the view on a blank floor) at half opacity.
2. **Scale…**: click two points on the image whose real distance you know, a
   wall you have measured, say. Type that distance in cm and Apply. The image
   is resized so the two points are that far apart; its height follows.
3. Draw the outline and the rooms over it as usual. While the image is shown,
   room fills are see-through, so a room you have drawn does not hide the
   scan under it.
4. **Opacity** and **Show** change how much of it you see; **Remove image**
   drops it. Each change is one undo step.

Only the editor shows the image. The card never draws it, though Save keeps it
with the plan (up to 4 MB). File, Export leaves it out unless you tick
**Include trace image**, so a file you hand to an assistant stays small.

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
