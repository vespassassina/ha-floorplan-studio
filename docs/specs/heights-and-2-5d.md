# Heights and the 2.5D view

Status: agreed with Diego 2026-10-02 (start with 2.5D; 3D later). Supersedes
the "3D, isometric views" non-goal in `docs/SPEC.md`: 2.5D is now in scope.

## Goal

The plan can be shown flat (2D, today) or with depth (2.5D, later 3D). Every
solid thing has a height, with a sensible default, so a layout with no height
at all still looks right. An assistant reading a floor-plan image can fill the
heights in.

## Model (all optional, all cm, schema stays version 2)

Defaults live in one file, `src/core/heights.ts`, with one resolver per
question. Nothing else hard-codes a height.

| Field | Where | Default | Meaning |
|---|---|---|---|
| `height` | `Floor` | 250 | Wall and ceiling height of the storey. |
| `slab` | `Floor` | 25 | Floor-slab thickness between storeys. Elevation of a floor = sum of the lower floors' `height + slab`, in `floors` key order. |
| `height` | `Room` | the floor's | Ceiling height of one room (a lower bathroom, a double-height hall). Its walls take it. |
| `height` | `Wall` | the floor's, or the room's | A fence or low wall. Kind defaults: `fence` 110, `edge` 0 (a curb, flat), `boundary` 0 (drawn line, no wall), `wall` and `external` the storey height. |
| `height`, `sill` | `Door` | door/glass: 210, sill 0. window: height 120, sill 90. sealed: 210, sill 0 | `height` is the opening's own height; its top is `sill + height`. |
| `height`, `sill` | `Opening` | 210, 0 | Same. |
| `height` | `Furniture` | by symbol (`FURNITURE_HEIGHTS`) | Top of the piece above the floor. |
| `height` | `Unlinked` | by type (`UNLINKED_HEIGHTS`) | Top of the appliance. |
| `z` | `Device` | by type (`DEVICE_Z`) | Mount height of the icon's real object: a ceiling light 250, a switch 120, a plug 30, a heater 0 to 60. |
| `height` | `Stairs` | the floor's | Rise. Implicit; not stored. |
| `height` | `Extra` | 0 | Flat outline, no height. |

A value outside 0 to 1000 is invalid. A missing value is never written back
by the editor: defaults are read, not stored, so changing a default later
changes old plans.

## View

`view: "2d" | "2.5d"` (later `"3d"`): a card option, a card toolbar dropdown
and an editor View menu entry. Default `2d`.

2.5D is a vertical oblique projection: the floor stays true to the plan, a
point at height h is drawn `h * RISE` up and `h * SKEW` sideways. Floor-level
things (icons, tap targets, rooms) keep their plan position, so tap and
pointer hit-testing do not change. In the editor 2.5D is a preview: handles
and drawing are off, and a line says "Switch to 2D to edit."

## Order of work

1. Heights in the model, validation, migration, docs, the assistant prompts,
   and editor fields (this task).
2. 2.5D drawing in `renderFloor`, the `view` option, the dropdown.
3. Later: 3D.
