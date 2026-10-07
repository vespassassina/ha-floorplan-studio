/** The keyboard shortcuts for the view, shared by the card and the editor so the two cannot drift apart: pure
 * decisions over a key event, no DOM state and no handlers. Each host decides when it is listening (the card:
 * focused or hovered; the editor: focus inside it) and what each action does. */

/** How far an arrow pans, as a share of the view's width. */
export const PAN_STEP = 0.1;

/** Left and Right pan the view (Diego, 2026-10-07; they used to turn it: the rotate buttons still do). */
export type ViewKey = "zoomIn" | "zoomOut" | "panLeft" | "panRight" | "reset";

/** Arrows and Space, plain or with Alt or Shift. Ctrl and Cmd belong to the browser and the OS (Cmd-Left is "back",
 * Ctrl-Arrow switches desktops), so a chord with either is never a view key. Auto-repeat is fine: holding an arrow
 * keeps zooming. */
export function viewKeyOf(ev: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): ViewKey | null {
  if (ev.ctrlKey || ev.metaKey) return null;
  switch (ev.key) {
    case "ArrowUp": return "zoomIn";
    case "ArrowDown": return "zoomOut";
    case "ArrowLeft": return "panLeft";
    case "ArrowRight": return "panRight";
    case " ": case "Spacebar": return "reset";
    default: return null;
  }
}

/** Cmd-S or Ctrl-S, with no other modifier. */
export function isSaveChord(ev: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === "s";
}

/** Controls that take arrow keys for themselves (a text box, a select, a range slider, a contenteditable region
 * such as the combo's filter box). A keystroke that starts in one is theirs. */
export function takesTyping(el: unknown): boolean {
  if (!(el instanceof Element)) return false;
  // The attribute as well as isContentEditable: it is the same fact, and jsdom (the unit tests) has no isContentEditable.
  if ((el instanceof HTMLElement && el.isContentEditable) || el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = el.tagName;
  if (tag === "SELECT" || tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  // A checkbox or a button-like input has no use for arrows; everything else (text, number, range, search ...) does.
  return !/^(checkbox|radio|button|submit|reset|image|file|color)$/.test((el as HTMLInputElement).type);
}

/** Controls that Space activates (a focused button, a summary, a link, an ARIA button, a checkbox). Space there is
 * theirs, not "reset view". */
export function takesSpace(el: unknown): boolean {
  if (!(el instanceof Element)) return false;
  if (takesTyping(el)) return true;
  if (el.tagName === "BUTTON" || el.tagName === "SUMMARY" || el.tagName === "A" || el.tagName === "INPUT") return true;
  const role = el.getAttribute("role");
  return role === "button" || role === "menuitem" || role === "checkbox" || role === "option" || role === "switch" || role === "tab";
}

/** Whether a key event is for the view at all, given where it started: `path[0]` is the real target even inside a
 * shadow root (`event.composedPath()`). Typing targets keep every key; Space also stays with anything it activates. */
export function viewKeyFor(ev: KeyboardEvent): ViewKey | null {
  if (ev.defaultPrevented || ev.isComposing) return null;
  const key = viewKeyOf(ev);
  if (!key) return null;
  const target = ev.composedPath()[0];
  if (takesTyping(target)) return null;
  if (key === "reset" && takesSpace(target)) return null;
  return key;
}
