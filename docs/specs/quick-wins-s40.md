# Quick wins from a field report: Sprint 40

Status: draft, 2026-10-29, waits for Diego's yes. Plan: `docs/PLAN.md`, Sprint 40.

## Why

A user's field report (2026-10-29) asked for five things. Diego, the same day: "Quick wins first", plus his own
request: "can we have a replay button at the bottom (where the replay bar would be) if i click the button replay bar
shows and i can use it. then a X button to close the replay bar."

This sprint takes the four small ones. The rest (trace image on the card, a combined history chart, temperature range
warnings, a generic value sensor) wait for a later sprint.

## Goal

1. Replay is one tap away. Its bar closes with an X.
2. A trace image can be moved and turned to line up with the walls.
3. A device icon can open another dashboard view.
4. Add device finds a single entity of a hub by that entity's own name.

## Non-goals

- The trace image on the card. The card still never draws it, and the server still never sends it to the card.
- A chart inside the card. A device's view link is how a history graph is reached for now.
- A new card config key (the surface freeze in the Sprint 41 outline). The replay button needs none.
- Changing what Add device lists while the search box is empty.

## Behaviour

### A. Replay button and X (card)

1. **The button.** While the card can replay (`canReplay`: `hass` with a connection, a layout, not kiosk) and the bar is
   closed, a slim button sits where the bar would sit, under the plan. It shows the history icon and "Replay"
   (translated); under 640 px, the icon alone with the same accessible name. It does not change the plan's height by
   more than the button's own row (32 px). It is never shown in kiosk mode, in the Studio or in the standalone page.
2. **Open.** A tap on it opens the bar exactly as ⋯ > Replay does (`openReplay`). The button is replaced by the bar, and
   the bar's play button takes focus.
3. **The X.** The bar's "Live" text button becomes an X button with the accessible name and tooltip "Close replay"
   (translated). It does what Live did: closes the bar and shows the live plan. Escape still closes it. The slider's
   end still is the live plan (DECISIONS 2026-10-28).
4. **Back.** After closing, the button is there again and takes focus.
5. **Menu.** ⋯ > Replay stays, first in the menu.

### B. Move and turn the trace image (editor)

6. **Move.** The Trace image panel gets a Move toggle while an image is loaded and shown. While Move is on, dragging
   anywhere on the image moves it (`x`, `y`); walls, rooms and devices take no clicks. One drag is one undo step; a
   drag that ends where it started is none.
7. **Nudge.** While Move is on, the arrow keys move the image 1 cm, with Shift 10 cm. Each key press is one undo step,
   the editor host owns the keys (finding 6), and they never reach the plan's own selection.
8. **Turn.** The panel gets a Rotation field in degrees, -180 to 180, 0.1 steps, that sets `rot` about the image's
   top-left corner as the schema already says. One change is one undo step; an unchanged value is none.
9. **Leave.** Move turns off when the panel closes, the image is hidden or removed, Scale starts, or Escape is pressed.
   The status bar says "Move: drag the image, arrows nudge it" while it is on.

### C. A device opens a dashboard view (card and editor)

10. **Schema.** A device may have `view`: a path inside Home Assistant, such as `/lovelace/terrace`. It must start with
    one `/`, not `//`, hold no `:` before the first `/`, no whitespace or control characters, and be at most 200
    characters. `validate` refuses anything else with a message that says so (finding 1). An older card ignores it.
11. **Tap.** A tap on a device with `view` navigates there the way Home Assistant does (`history.pushState`, then a
    `location-changed` event), whatever the card's `tap_action`. Hold keeps its own action. While replaying, a tap
    still does nothing (S39 item 9).
12. **Editor.** The device panel gets a "Dashboard view" text field under the entity, with a placeholder
    `/lovelace/…`. An invalid path shows the validator's message under the field and is not written. Empty removes
    the key. One change is one undo step.
13. **Popup.** Not changed. The popup is reached by hold when the hold action is more-info, or from Attention.

### D. Single entities in Add device (editor)

14. **Search.** While the search box holds text, Add device also lists every unplaced, unattached entity whose own name
    or entity id matches, under its own name, in a group "Entities" at the end. Its small line is its type and its HA
    device's name. An entity that is already a device row is not listed twice.
15. **Placing.** A pick places that entity, typed by `typeForEntity`, exactly as the device panel's entity field would
    place it. After that, the entity's HA device leaves the device rows as today, but its other unplaced entities
    stay findable by search.
16. **Empty search.** Unchanged: one row per HA device.
17. **Size.** With 400 matches, the group shows the first 50 and a line "50 of 400. Type more to narrow it."

## Acceptance criteria

Each has a test that fails with the feature removed (finding 4), written first (finding 5).

1. Playwright: a card with a stubbed connection shows the Replay button under the plan; a real mouse click on it opens
   the bar; the bar's play button has focus. In kiosk mode the button is absent. (A1, A2)
2. Playwright: the X closes the bar, the plan is live, and the button is back with focus; Escape does the same. The X's
   accessible name is "Close replay". (A3, A4)
3. Playwright: the card's height with the button differs from the height without it by at most 32 px, at 1280 and
   380 wide. (A1)
4. Unit: every new string is in all ten catalogues; the raw-English lint passes. (A1, A3, B9, C12, D14, D17)
5. Playwright: with Move on, a real mouse drag of 100 px moves the trace's `x` by the matching cm; one undo restores it;
   a drag back to the start adds no undo step. A wall under the image was not selected. (B6)
6. Playwright: with Move on, ArrowRight moves `x` by 1, Shift+ArrowRight by 10, each one undo step; with Move off, the
   arrows do what they did before. (B7)
7. Playwright: the Rotation field sets `rot`; the image's computed transform turns; the same value again adds no undo
   step. (B8)
8. Playwright: Move turns off on Escape, on Scale, on Hide and on Remove. (B9)
9. Unit: `validate` accepts `/lovelace/terrace`, `/dashboard-x/0`, and refuses `//evil.com`, `javascript:alert(1)`,
   `https://x`, `lovelace`, a path with a space or a newline, 201 characters, a number, an object; it never throws.
   (C10)
10. Playwright: a tap on a device with `view` pushes that path and fires one `location-changed`; a device without it
    still opens the popup; hold still does the hold action; during a replay the tap does nothing. (C11)
11. Playwright: the device panel writes `view`, refuses `//x` with the message, and removes the key when emptied; each
    change is one undo step. (C12)
12. Unit and Playwright: an HA device with 137 sensor entities, one named "Innen Temperatur": searching "innen" or its
    entity id lists that entity under Entities with its own name; a pick places it as `temp` with that entity; the
    device's other entities still match the search afterwards. (D14, D15)
13. Unit: with the search empty, the list is identical to today's for the demo HA data. (D16)
14. Unit: 400 matching entities show 50 rows and the count line. (D17)
15. Shots: the card with the button and with the open bar, both themes, 1280 and 380 wide; the editor's trace panel
    with Move on. Looked at. (all)
