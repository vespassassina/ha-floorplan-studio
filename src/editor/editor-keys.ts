import { doViewKey, setAlt } from "./editor-view";
import { isSaveChord, isSearchChord, takesTyping, viewKeyFor } from "../card/view-keys";
import { saveByKey } from "./editor-file";
import type { FpSearch } from "../card/search-box";
import { alignKeyDo, closeAlign } from "./editor-align";
import { cancelTraceScale, toggleTrace, traceKeyDo } from "./editor-trace";
import { closeLink, undo } from "./editor-actions";
import { cancelDeviceDrag, cancelTraceDrag, drawnDevices, selectDevices } from "./editor-pointer";
import { closeAddDev, closeCtxMenu, closePlace, closeScene, toggleDevCols, toggleHa, toggleInstallCode } from "./editor-popups";
import { finishDraw, placeTyped, stopDraw } from "./editor-draw";
import { DRAW_HINT } from "./editor-kit";
import { type Floor, polys, removePoint, worktopIndex } from "../core";
import { removeDevices } from "./bulk";
import { polyPts } from "./state";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- the keyboard, focus and window events ---------------------------------------------------------------

export const onKeyUp = (ed: FloorplanStudioEditor, ev: KeyboardEvent) => { if (ev.key === "Alt") setAlt(ed, false); };

export const onBlur = (ed: FloorplanStudioEditor) => setAlt(ed, false);

export const onKey = (ed: FloorplanStudioEditor, ev: KeyboardEvent) => {
  if (ed.narrow) return; // S37.3: the editor is hidden; a key must not act on what the person cannot see
  if (ev.key === "Alt") setAlt(ed, true);
  // Cmd/Ctrl+S is Save from anywhere in the editor, a text box included; the browser's own save-page dialog never opens.
  if (isSaveChord(ev) && !ev.defaultPrevented && !ev.isComposing) { ev.preventDefault(); saveByKey(ed); return; }
  // S24.5: Cmd/Ctrl+K from anywhere in the editor, "/" from anywhere but a text field, goes to the search box.
  if (isSearchChord(ev)) { ev.preventDefault(); ed.renderRoot.querySelector<FpSearch>("#search")?.focus(); return; }
  if (alignKeyDo(ed, ev)) return;
  if (traceKeyDo(ed, ev)) return; // S40.2
  const vk = viewKeyFor(ev);
  if (vk) { doViewKey(ed, vk, ev); return; }
  // S22.5: Escape closes an open toolbar menu first, and does nothing else on that press. Ahead of the input check,
  // since Filter holds checkboxes and Add holds selects. Focus goes back to the menu's own button.
  if (ev.key === "Escape" && !ev.defaultPrevented && ed.closeMenuByKey()) { ev.preventDefault(); return; }
  const t = ev.composedPath()[0] as HTMLElement | undefined;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); undo(ed, !ev.shiftKey); return; }
  // S26.10: Ctrl/Cmd+A selects every drawn device on the floor.
  if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === "a" && !ed.draw && !ed.aligning && !takesTyping(t)) {
    ev.preventDefault();
    const is = drawnDevices(ed);
    if (is.length) { selectDevices(ed, is); ed.requestUpdate(); }
    return;
  }
  // S26.13: "?" opens Help from the plan, never from a text field (the input check above, and `takesTyping` for the rest).
  if (ev.key === "?" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !takesTyping(t)) { ev.preventDefault(); ed.toggleHelp(); return; }
  // Escape cancels a drag of devices before anything else: Help, Place and the rest must not swallow it while the plan is being dragged.
  if (ev.key === "Escape" && (ed.drag?.type === "devs" || ed.drag?.type === "dev")) { ev.preventDefault(); cancelDeviceDrag(ed); return; }
  if (ev.key === "Escape" && ed.drag?.type === "trace") { ev.preventDefault(); cancelTraceDrag(ed); return; }
  if (ev.key === "Escape" && ed.ctxMenu) { ev.preventDefault(); closeCtxMenu(ed); return; }
  if (ev.key === "Escape" && ed.devColsPos) { ev.preventDefault(); toggleDevCols(ed); return; }
  if (ev.key === "Escape" && ed.haPos) { ev.preventDefault(); toggleHa(ed); return; }
  if (ev.key === "Escape" && ed.sceneDraft) { ev.preventDefault(); closeScene(ed); return; }
  if (ev.key === "Escape" && ed.st.helpOpen) { /* Help covers the mode, so it goes first */ ev.preventDefault(); ed.toggleHelp(); return; }
  if (ev.key === "Escape" && ed.asideMode === "place") { ev.preventDefault(); closePlace(ed); return; }
  if (ev.key === "Escape" && ed.asideMode === "align") { ev.preventDefault(); closeAlign(ed); return; }
  if (ev.key === "Escape" && ed.asideMode === "link") { ev.preventDefault(); closeLink(ed); return; }
  if (ev.key === "Escape" && ed.asideMode === "add") { ev.preventDefault(); closeAddDev(ed); return; }
  if (ev.key === "Escape" && ed.installCodeOpen) { ev.preventDefault(); toggleInstallCode(ed); return; }
  if (ev.key === "Escape" && ed.traceScale) { ev.preventDefault(); cancelTraceScale(ed); return; }
  if (ev.key === "Escape" && ed.traceMove) { ev.preventDefault(); ed.traceMove = false; ed.requestUpdate(); return; } // S40.2: ends Move first
  if (ev.key === "Escape" && ed.traceOpen) { ev.preventDefault(); toggleTrace(ed); return; }
  if (ed.draw) {
    // Draw mode owns these keys: Delete must not remove the item that was selected before.
    // S26.12: digits, a dot and an m type a length; Enter places it, Backspace and Escape take it back before they act on the points.
    const dr = ed.draw;
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && dr.points.length && dr.type(ev.key)) { ev.preventDefault(); ed.requestUpdate(); }
    else if (ev.key === "Enter" && dr.typed) { ev.preventDefault(); placeTyped(ed); }
    else if (ev.key === "Enter") { ev.preventDefault(); finishDraw(ed); }
    else if (ev.key === "Escape" && dr.typed) { ev.preventDefault(); dr.typed = ""; ed.status = DRAW_HINT; ed.requestUpdate(); }
    else if (ev.key === "Escape") { ev.preventDefault(); stopDraw(ed, "Drawing cancelled"); }
    else if (ev.key === "Backspace" && dr.typed) { ev.preventDefault(); dr.untype(); ed.requestUpdate(); }
    else if (ev.key === "Backspace") { ev.preventDefault(); dr.backspace(); ed.requestUpdate(); }
    return;
  }
  // S26.10: Escape drops a marquee in progress, else the selection.
  if (ev.key === "Escape") {
    if (ed.drag?.type === "marquee") { ev.preventDefault(); ed.drag = null; ed.requestUpdate(); }
    else if (ed.st.sel) { ev.preventDefault(); ed.st.sel = null; ed.requestUpdate(); }
    return;
  }
  if (ev.key !== "Delete" && ev.key !== "Backspace") return;
  if (ed.aligning) return; // Review 29: Align is read-only, so nothing is deleted from under it
  const s = ed.st.sel;
  if (!s) return;
  const del = (fn: (f: Floor) => Floor | void) => { ed.commit(fn); ed.st.sel = null; ed.requestUpdate(); };
  if (s.t === "devs") { const is = s.is; del((f) => removeDevices(f, is)); return; } // S26.11: one undo step for the lot
  if (s.t === "door") del((f) => { f.doors.splice(s.i, 1); });
  else if (s.t === "opening") del((f) => { f.openings.splice(s.i, 1); });
  else if (s.t === "dev") del((f) => { f.devices.splice(s.i, 1); });
  else if (s.t === "wall") del((f) => { f.walls.splice(s.i, 1); });
  else if (s.t === "extra") del((f) => { f.extras.splice(s.i, 1); });
  else if (s.t === "furn") del((f) => { f.furniture.splice(s.i, 1); });
  else if (s.t === "unl") del((f) => { f.unlinked.splice(s.i, 1); });
  else if (s.t === "stairs") del((f) => { f.stairs.splice(s.i, 1); });
  else if (s.t === "v" && "poly" in s.ref && worktopIndex(s.ref.poly) !== null) {
    // B54.3: a worktop corner goes alone, never below 3 (removePoint refuses; the commit then leaves no undo step), and the piece stays selected so its handles stay.
    const { poly, j } = s.ref;
    const steps = ed.st.hist.length;
    ed.commit((f) => removePoint(f, poly, j));
    if (ed.st.hist.length === steps) ed.status = "No corner removed: a worktop holds at least 3 corners";
    ed.st.sel = { t: "furn", i: worktopIndex(poly)! }; ed.requestUpdate();
  }
  else if (s.t === "v" && "poly" in s.ref && (polyPts(ed.st.f, s.ref.poly)?.length ?? 0) > 3) {
    const { poly, j } = s.ref;
    del((f) => { const P = polys(f).find((x) => x.id === poly); if (P) { P.pts.splice(j, 1); P.room?.wk.splice(j, 1); P.room?.wc?.splice(j, 1); if (poly === "o") { f.owk?.splice(j, 1); f.owc?.splice(j, 1); } } });
  }
};

/** A button (panel Delete, a menu item) keeps focus on itself and may vanish or hide: hand focus back so Ctrl+Z and Delete keep working. */
export const onButtonClick = (ed: FloorplanStudioEditor, ev: Event) => {
  const el = ev.composedPath()[0] as Element;
  // "+" hands focus to its own input; helpClose hands focus to the #help toggle button (toggleHelp);
  // addDevBtn hands focus to the panel's own search box (openAddDev), same reason.
  if (el.closest?.("button") && !el.closest("#addFloor") && !el.closest("#helpClose") && !el.closest("#addDevBtn")) ed.focus({ preventScroll: true });
};

/** Keys only reach a focused editor, so a highlighted selection must mean Delete works: clear it when focus leaves for good. */
export const onFocusOut = (ed: FloorplanStudioEditor, ev: FocusEvent) => {
  const next = ev.relatedTarget as Node | null;
  if (next && (next === ed || ed.contains(next))) return; // into the panel or a menu (retargeted to this host)
  if (ed.narrow) return; // S37.3: hiding the editor blurs what was focused in it; that is not the person leaving the selection
  const src = ev.composedPath()[0], sel = ed.st.sel;
  setTimeout(() => {
    if (ed.narrow) return;
    if (ed.st.sel !== sel) return; // something was selected since: that is not the selection that lost focus
    if (src instanceof Node && !src.isConnected) return; // the focused control was replaced by a new panel, not left
    if (!document.hasFocus()) return; // the window lost focus; the user comes back to the same selection
    if (ed.st.sel) { ed.st.sel = null; ed.requestUpdate(); }
  }, 0);
};

/** A press outside an open menu closes it at once. A drag on the plan never ends in a click on the plan, so `onWindowClick`
 * alone left the menu open over the toolbar (and over Undo) after a device was moved. */
export const onWindowPointerDown = (ed: FloorplanStudioEditor, ev: PointerEvent) => {
  const path = ev.composedPath();
  ed.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
    if (!path.includes(m)) { m.open = false; closeSubs(ed, m); }
  });
};

export const onWindowClick = (ed: FloorplanStudioEditor, ev: MouseEvent) => {
  const path = ev.composedPath();
  if (ed.ctxMenu && !path.some((n) => (n as Element).classList?.contains?.("ctxmenu"))) closeCtxMenu(ed);
  if (ed.viewMenu && !path.some((n) => (n as Element).id === "viewCtx")) { ed.viewMenu = null; ed.requestUpdate(); }
  ed.renderRoot.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
    if (!path.includes(m)) { m.open = false; closeSubs(ed, m); }
    else if ((path[0] as Element).closest?.("button:not(.keep)")) { m.open = false; closeSubs(ed, m); } // .keep: a stepper, several clicks in a row
  });
};

/** S4.11: a submenu (Add's Openings/Wall/Areas) is nested `<details class="sub">`, so it keeps its own open state even while its
 * root menu is hidden. Whenever the root closes, collapse any submenu inside it too, so reopening the root starts collapsed. */
export function closeSubs(ed: FloorplanStudioEditor, root: ParentNode) {
  root.querySelectorAll<HTMLDetailsElement>("details.sub[open]").forEach((s) => { s.open = false; });
}
