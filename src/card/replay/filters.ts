import type { EventGroup, Filters, Onset } from "./events";
import { allows } from "./events";

// R2.6: the filter state of one floor's history, and what its buttons do (docs/specs/replay-2.md items 14, 15). It lives in the replay chunk: the card
// holds one of these per floor history and hands it a way to repaint, nothing more.

/** What is switched OFF (so a new group or room is on), whether the list is open, and what the list's buttons do. Sets are replaced on a toggle, never changed:
 * the bar's memo compares them by identity. */
export interface FilterState extends Filters {
  open: boolean;
  /** The filter button, as last clicked: Escape gives it focus back. */
  button?: HTMLElement;
  /** Opens or closes the list. `back`: Escape, so focus returns to the filter button. */
  show(open: boolean, back?: boolean): void;
  group(g: EventGroup): void;
  room(i: number): void;
}

const flip = <T>(set: ReadonlySet<T>, v: T): Set<T> => { const n = new Set(set); if (!n.delete(v)) n.add(v); return n; };

/** While the list is open a click anywhere outside it (the page, the plan, the rest of the bar) closes it. That is a `click`, hit-tested after the pointer is up,
 * so nothing has moved under the finger: closing is all it does (CLAUDE.md finding 22). The capture phase keeps a plan element that stops its click from
 * leaving the list open; the list and its own button are not "outside". A list left open when the bar closes or the length changes closes on the next click
 * anywhere and removes its listener then: the repaint it asks for lands on whatever bar is open, or none. */
export function newFilter(repaint: () => void): FilterState {
  let away: ((e: Event) => void) | null = null;
  const s: FilterState = {
    groups: new Set(), rooms: new Set(), open: false,
    show(open, back = false) {
      if (away) document.removeEventListener("click", away, true);
      away = null;
      s.open = open;
      if (open) document.addEventListener("click", away = (e) => { if (!e.composedPath().some((n) => n instanceof Element && n.matches(".fp-rp-menu, .fp-rp-filter"))) s.show(false); }, true);
      repaint();
      if (back) s.button?.focus();
    },
    group: (g) => { s.groups = flip(s.groups, g); repaint(); },
    room: (i) => { s.rooms = flip(s.rooms, i); repaint(); },
  };
  return s;
}

/** The predicate the jumps take: everything while there is no state yet. */
export const passes = (f: Filters | undefined) => (o: Onset): boolean => !f || allows(f, o);
