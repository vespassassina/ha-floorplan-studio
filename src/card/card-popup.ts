import { carStatus, carText, type Device, deviceInfo, entitiesOfDevice, entitiesOfDoor, type Floor, moreInfoEntities, pieceDevice, relayText, SPIDER_MAX, spiderLayout, STACK_PX, stackGroups, stateText, type ThingRef, wattsOf } from "../core";
import { t } from "../core/i18n";
import { fireEvent, type TapTarget, thingKind, THINGS } from "./actions";
import { fanCaps, lampOp, lightCaps, type PopupOp, popupOp } from "./popup";
import { placeNear, type PopupSubject, popupTemplate, type SliderKind } from "./popup-ui";
import { holdActionOf, tapActionOf } from "./tap-action";
import type { Pt, View } from "./viewport";
import { coverService, dialogOpen, openChooserDialog, openCoverDialog } from "./card-dialogs";
import { TOGGLE_AT_ONCE } from "./card-overview";
import { popupInSheet, sheetTo } from "./card-sheet";
import type { FloorplanStudioCard } from "./floorplan-studio-card";

/** What index `i` of the shown floor is, as the gesture code names it. */
export function targetOf(c: FloorplanStudioCard, kind: "x" | "d" | "u" | "f", i: number): TapTarget | null {
  const f = c._floor();
  if (!f || !Number.isFinite(i)) return null;
  if (kind === "x") { const device = f.devices[i]; return device ? { device, index: i } : null; }
  // A linked piece speaks for its device (`pieceDevice`): the same name and state line as a device icon. `index` is the piece's, nothing reads it for a hover.
  if (kind === "f") { const m = f.furniture?.[i], device = m && pieceDevice(m); return device ? { device, index: i } : null; }
  if (kind === "d") { const door = f.doors[i]; return door ? { door, index: i } : null; }
  const unlinked = f.unlinked?.[i];
  return unlinked ? { unlinked, index: i } : null;
}

export function deviceSubject(c: FloorplanStudioCard, d: Device, name?: string): PopupSubject {
  const friendly = c._hass?.states[d.entity]?.attributes?.friendly_name;
  return {
    key: `d:${d.entity || d.id}`, type: d.type, entity: d.entity || undefined, entities: moreInfoEntities(d),
    ...(d.type === "light" && d.bound ? { lamp: d } : {}),
    name: name || d.name || (typeof friendly === "string" && friendly) || d.entity || d.id,
    powerEntity: d.power || (d.type === "plug" ? c._powerLinks()?.[d.entity] : undefined),
  };
}

/** The popup's (and the tooltip's) subject for a tap target; null when there is nothing to say or do. */
export function subjectOf(c: FloorplanStudioCard, t: TapTarget): PopupSubject | null {
  if ("device" in t) return deviceSubject(c, t.device);
  if ("door" in t) {
    const door = t.door, entities = entitiesOfDoor(door);
    return door.cover || entities.length ? { key: `o:${door.id}`, name: door.name, type: "door", entities, ...(door.cover ? { door } : {}) } : null;
  }
  const u = t.unlinked, entities = entitiesOfDevice(u);
  return { key: `u:${u.id}`, name: u.name ?? u.id, type: u.type, entities };
}

/** The one state line: the popup and the tooltip both print this. A door says its cover's state, else its first entity's. */
export function subjectText(c: FloorplanStudioCard, s: PopupSubject): string {
  const states = c._hass?.states, e = s.door?.cover || (s.door ? s.entities[0] : s.entity);
  if (!e) return "";
  // S22.1: a lamp lit only by its relay reads as the plan draws it, and names what keeps it on.
  const via = s.lamp ? relayText(s.lamp, states) : null;
  if (via) return via;
  // A car speaks for all its entities (tracker, charging, battery), not the main one alone: the same line as its chooser title.
  if (s.type === "car" && s.entity) { const line = carText(carStatus({ entity: s.entity, attached: s.entities }, states)); if (line) return line; }
  const w = s.powerEntity ? wattsOf(states?.[s.powerEntity]) : null;
  return stateText(s.type, states?.[e], w === null ? undefined : `${Math.round(w * 10) / 10} W`, e, c._format);
}

/** S33.4: the card-wide tap and hold actions for the device icons of the plan and the 3D view. Read afresh per press, so `setConfig` needs no rebind. */
export function tapOpts(c: FloorplanStudioCard) {
  return {
    tapAction: () => tapActionOf(c._config.tap_action).action,
    holdAction: () => holdActionOf(c._config.hold_action).action,
    toggle: (t: TapTarget, at: { x: number; y: number }, from: Element | null) => tapToggle(c, t, at, from),
  };
}

/** `tap_action: toggle`: the popup's button, pressed for the person, but only for a plain on/off. A lock, cover or siren (and any other domain) opens the popup instead. ON, and a light's OFF, act at once; any other OFF opens the popup at its Confirm step (S14.2 stands). No button (a sensor, a camera, no state) is the popup as ever. */
export function tapToggle(c: FloorplanStudioCard, t: TapTarget, at: { x: number; y: number }, from: Element | null): void {
  const s = subjectOf(c, t), op = s ? subjectOp(c, s) : null;
  if (!s || !op || !s.entity || s.door || dialogOpen(c)) { openPopup(c, t, at, from); return; }
  if (op.confirm) {
    openPopup(c, t, at, from);
    if (c._popup?.s.key === s.key) { c._popup.confirming = true; c.requestUpdate(); }
    return;
  }
  if (!TOGGLE_AT_ONCE.has(s.entity.split(".")[0] ?? "")) { openPopup(c, t, at, from); return; } // a lock, a cover, a siren: a stray tap must not act
  hideTip(c);
  closePopup(c);
  runOp(c, s, op);
}

export function openPopup(c: FloorplanStudioCard, t: TapTarget, at: { x: number; y: number }, from: Element | null): void {
  const s = subjectOf(c, t);
  if (!s) return;
  openSubject(c, s, at, from);
  if (c._popup?.s === s) c._panTarget = "device" in t ? thingSel(c, t.piece ? "piece" : "device", t.index) : "door" in t ? thingSel(c, "door", t.index) : `svg g[data-u="${t.index}"]`;
}

/** The selector of a thing on the plan, as `_placePulse` finds it. */
export function thingSel(c: FloorplanStudioCard, what: ThingRef["what"], index: number): string {
  return what === "device" ? `svg g[data-x="${index}"]` : what === "piece" ? `svg g[data-f="${index}"]` : `svg line[data-d="${index}"]`;
}

/** Opens the popup, swaps it for another subject's, or closes it when the same subject is tapped again. Nothing is operated here. */
export function openSubject(c: FloorplanStudioCard, s: PopupSubject, at: { x: number; y: number }, from: Element | null): void {
  if (c._replay) { c._replayGuard().onReplay(); return; } // S39 review B1: the popup's button would act on the present
  if (dialogOpen(c)) return;
  hideTip(c);
  if (c._popup?.s.key === s.key) { closePopup(c); return; }
  c._popup = { s, x: at.x, y: at.y, opener: from, confirming: false, draft: null };
  sheetTo(c, "half"); // S31.8: on a phone the popup is the Device level
  c.requestUpdate();
}

export function closePopup(c: FloorplanStudioCard): void {
  if (!c._popup) return;
  c._popupReturn = c._popup.opener;
  c._popup = null;
  c.requestUpdate();
}

export function foldSpider(c: FloorplanStudioCard): void {
  if (!c._spider) return;
  c._spider = null;
  c.requestUpdate();
}

/** The devices whose discs overlap device `i`'s on screen and are drawn at this detail level, `i` included; fewer than two when it stands alone. */
export function stackOf(c: FloorplanStudioCard, i: number): number[] {
  const f = c._floor(), fit = c._fit, v = c._current(), svg = c.shadowRoot?.querySelector("svg.fp-zoomable");
  if (!f || !fit || !v || !svg || !(c._px > 0) || !(v.w > 0)) return [];
  const unit = 1 / (c._px * (fit.w / v.w));
  const ids: number[] = [], spots: Pt[] = [];
  f.devices.forEach((d, j) => {
    const g = svg.querySelector<SVGGElement>(`g[data-x="${j}"]`);
    if (!g || getComputedStyle(g).display === "none") return; // not drawn: layer hidden, or idle at far
    ids.push(j);
    spots.push("a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]);
  });
  const at = ids.indexOf(i);
  if (at < 0) return [];
  const group = stackGroups(spots, STACK_PX * unit).find((g) => g.includes(at)) ?? [];
  // Overlaps chain, so a packed grid is one group of dozens and its ring would be wider than the card: the tapped device and its nearest neighbours.
  const near = group.length > SPIDER_MAX ? [...group].sort((a, b) => Math.hypot(spots[a][0] - spots[at][0], spots[a][1] - spots[at][1]) - Math.hypot(spots[b][0] - spots[at][0], spots[b][1] - spots[at][1])).slice(0, SPIDER_MAX).sort((a, b) => a - b) : group;
  return near.map((k) => ids[k]);
}

/** The tap of a device icon asks here first. A tap on a stack opens its ring and is handled; a tap on a ring member, or on a lone device, is not (it acts as ever). */
export function tapStack(c: FloorplanStudioCard, i: number): boolean {
  if (c._spider?.includes(i)) return false;
  const members = stackOf(c, i);
  if (members.length < 2) return false;
  closePopup(c);
  c._spider = members;
  c._spiderFloor = c._floorKey();
  c.requestUpdate();
  return true;
}

/** The ring's spots for `renderFloor`, or none. The ring is a fixed size on screen (`spiderLayout`), kept inside the view. */
export function spiderSpots(c: FloorplanStudioCard, f: Floor, fit: View, box: View, rotate: unknown): { i: number; at: Pt }[] | undefined {
  if (c._spider && c._spiderFloor !== c._floorKey()) c._spider = null;
  if (!c._spider || !(c._px > 0) || !(box.w > 0)) return undefined;
  const ids = c._spider.filter((i) => i < f.devices.length);
  const spots = ids.map((i) => { const d = f.devices[i]; return "a" in d ? ([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] as Pt) : ([d.x, d.y] as Pt); });
  // A turned plan is rotated after the drawing, so its view box is not in the drawing's frame: no clamp then.
  const room = rotate ? { x: -1e9, y: -1e9, w: 2e9, h: 2e9 } : box;
  const at = spiderLayout(spots, 1 / (c._px * (fit.w / box.w)), room);
  return at.length ? ids.map((i, j) => ({ i, at: at[j] })) : undefined;
}

/** A press on the plan that is not on a member of the open ring folds it. Escape does the same (`_onViewKey`). */
export function bindSpider(c: FloorplanStudioCard, svg: Element): () => void {
  const onDown = (e: Event) => {
    if (!c._spider) return;
    const g = (e.target as Element | null)?.closest?.("g[data-x]");
    if (g && c._spider.includes(Number(g.getAttribute("data-x")))) return;
    foldSpider(c);
  };
  svg.addEventListener("pointerdown", onDown);
  return () => svg.removeEventListener("pointerdown", onDown);
}

export function levelOf(c: FloorplanStudioCard, kind: SliderKind, a: Record<string, unknown> | undefined): number | null {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (kind === "b") { const b = n(a?.brightness); return b === null ? null : Math.max(1, Math.min(100, Math.round((b / 255) * 100))); }
  if (kind === "s") { const v = n(a?.percentage); return v === null ? null : Math.max(0, Math.min(100, Math.round(v))); }
  if (kind === "t") return n(a?.color_temp_kelvin);
  const hs = a?.hs_color;
  const h = Array.isArray(hs) ? n(hs[0]) : null;
  return h === null ? null : Math.round(h);
}

export function subjectOp(c: FloorplanStudioCard, s: PopupSubject): PopupOp | null {
  if (s.door) return null;
  return s.lamp ? lampOp(s.lamp, c._hass?.states) : popupOp(s.type, s.entity, c._hass?.states[s.entity ?? ""]?.state);
}

/** The popup's markup: floating at the end of the card, or (`inSheet`) as the bottom sheet's Device level. Each caller asks for its place and gets nothing from the other. */
export function popupMarkup(c: FloorplanStudioCard, inSheet = false) {
  const p = c._popup;
  if (!p || inSheet !== popupInSheet(c)) return null;
  const s = p.s, st = c._hass?.states[s.entity ?? ""], op = subjectOp(c, s);
  const light = op !== null && s.entity?.startsWith("light.") && st?.state !== "off" ? true : op !== null && s.entity?.startsWith("light.");
  const caps = light ? lightCaps(st?.attributes) : null;
  const fan = op !== null && s.entity?.startsWith("fan.") ? fanCaps(st?.attributes) : null;
  const level = (k: SliderKind) => {
    const now = levelOf(c, k, st?.attributes);
    return p.draft && p.draft.kind === k && p.draft.from === now ? p.draft.value : now;
  };
  return popupTemplate({
    subject: s, text: subjectText(c, s), op, confirming: p.confirming, kiosk: c._kiosk(), caps, fan,
    info: c._kiosk() || !(s.entity ?? s.entities[0]) ? [] : deviceInfo((s.entity ?? s.entities[0])!, { ...c._hass, states: c._stateForRender() }, c._format),
    doorLabel: s.door?.cover ? (coverService(c, s.door) === "close_cover" ? t("Close") : t("Open")) : null,
    level: { b: caps?.brightness ? level("b") : null, s: fan ? level("s") : null, t: caps?.temp ? level("t") : null, h: caps?.hue ? level("h") : null },
    act: () => popupAct(c),
    cancel: () => { if (c._popup) { c._popup.confirming = false; c.requestUpdate(); } },
    more: () => popupMore(c),
    key: (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePopup(c); } },
    slide: (kind, value, commit) => popupSlide(c, kind, value, commit),
    inSheet,
  });
}

/** The popup's one button. A cover door's opens the card's confirm dialog; a turn OFF (not a light's) first turns the button into its confirm; anything else is one service call. */
export function popupAct(c: FloorplanStudioCard): void {
  const p = c._popup;
  if (!p) return;
  if (p.s.door?.cover) {
    const door = p.s.door;
    closePopup(c);
    openCoverDialog(c, door);
    return;
  }
  const op = subjectOp(c, p.s);
  if (!op || !p.s.entity) return;
  if (op.confirm && !p.confirming) { p.confirming = true; c.requestUpdate(); return; }
  runOp(c, p.s, op);
  closePopup(c);
}

/** G11: the one way the card calls a service. Home Assistant rejects a call it cannot make (no such service, entity gone, no right to);
 *  that is caught and shown in HA's own toast (`hass-notification`) instead of an unhandled rejection nobody sees. */
export function callService(c: FloorplanStudioCard, domain: string, service: string, data?: Record<string, unknown>): void {
  if (c._replay) { c._replayGuard().onReplay(); return; } // S39 review B1: nothing acts from the past, whichever button got here
  const call = c._hass?.callService;
  if (!call) return;
  const failed = (e: unknown) => {
    const m = e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : typeof e === "string" ? e : t("the call failed");
    fireEvent(c, "hass-notification", { message: `${domain}.${service}: ${m}` });
  };
  try { Promise.resolve(call.call(c._hass, domain, service, data)).catch(failed); } catch (e) { failed(e); }
}

/** The one call (or the calls of a relay-lit lamp's Turn off) a popup button makes. */
export function runOp(card: FloorplanStudioCard, s: PopupSubject, op: PopupOp): void {
  if (op.calls) for (const c of op.calls) callService(card, c.domain, c.service, c.data);
  else callService(card, op.domain, op.service, { entity_id: s.entity });
}

export function popupMore(c: FloorplanStudioCard): void {
  const p = c._popup;
  if (!p) return;
  closePopup(c);
  if (p.s.entities.length > 1) openChooserDialog(c, p.s.name, p.s.entities);
  else if (p.s.entities.length === 1) fireEvent(c, "hass-more-info", { entityId: p.s.entities[0]! });
}

/** A slider moving only changes the number shown; its release (`change`) is the one `light.turn_on` (a fan's speed: `fan.set_percentage`), so dragging never floods Home Assistant. */
export function popupSlide(c: FloorplanStudioCard, kind: SliderKind, value: number, commit: boolean): void {
  const p = c._popup, entity = p?.s.entity;
  if (!p || !entity || !Number.isFinite(value)) return;
  const a = c._hass?.states[entity]?.attributes;
  p.draft = { kind, value, from: levelOf(c, kind, a) };
  if (commit) {
    if (kind === "s") {
      callService(c, "fan", "set_percentage", { entity_id: entity, percentage: Math.max(0, Math.min(100, value)) });
      c.requestUpdate();
      return;
    }
    const hs = a?.hs_color, sat = Array.isArray(hs) && typeof hs[1] === "number" && Number.isFinite(hs[1]) ? hs[1] : 100;
    const data = kind === "b" ? { brightness_pct: value } : kind === "t" ? { color_temp_kelvin: value } : { hs_color: [value, sat] };
    callService(c, "light", "turn_on", { entity_id: entity, ...data });
  }
  c.requestUpdate();
}

/** After every render: the popup sits near where it was tapped, inside the card; focus goes to its button when it opens and back to what opened it when it closes. */
export function syncPopup(c: FloorplanStudioCard): void {
  const key = c._popup?.s.key ?? null, el = c.shadowRoot?.querySelector<HTMLElement>(".fp-pop") ?? null;
  if (c._popup && el && !popupInSheet(c)) {
    const o = c._popup.opener;
    placeNear(el, c, c._popup.x, c._popup.y, 14, o?.isConnected && o.matches(".fp-active-row, fp-search") ? besideRect(c, o) : null);
  }
  if (key === c._popupFocusKey) return;
  c._popupFocusKey = key;
  if (key && el) (el.querySelector<HTMLElement>(".fp-pop-do") ?? el.querySelector<HTMLElement>(".fp-pop-more"))?.focus({ preventScroll: true });
  else if (!key) {
    if (dialogOpen(c)) { c._popupReturn = null; return; } // the dialog took focus; it hands it back itself
    const back = c._popupReturn as HTMLElement | null;
    c._popupReturn = null;
    (back?.isConnected ? back : c).focus({ preventScroll: true });
  }
}

/** Where a popup opened from the sheet stands beside: the opener's height, the sheet's sides, so it clears the sheet's
 *  border and padding as well as the row or the search box (S24.8). */
export function besideRect(c: FloorplanStudioCard, o: Element): DOMRect {
  const r = o.getBoundingClientRect(), sheet = o.closest(".fp-active")?.getBoundingClientRect();
  return sheet ? new DOMRect(sheet.left, r.top, sheet.width, r.height) : r;
}

/** Hover on the plan (mouse only; a finger has the popup). The tooltip follows the pointer over an icon, a door or an appliance and goes when it leaves, is pressed or the page scrolls. */
export function bindHover(c: FloorplanStudioCard, svg: Element): () => void {
  const move = (e: Event) => {
    const pe = e as PointerEvent;
    if (pe.pointerType !== "mouse" || pe.buttons || c._popup) { hideTip(c); return; }
    const el = (pe.target as Element | null)?.closest?.(THINGS);
    const kind = el ? thingKind(el) : "u";
    const t = el ? targetOf(c, kind, Number(el.getAttribute(`data-${kind}`))) : null;
    if (t && el) showTip(c, t, pe.clientX, pe.clientY, el);
    else hideTip(c);
  };
  const hide = () => hideTip(c);
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("pointerdown", hide);
  return () => {
    svg.removeEventListener("pointermove", move);
    svg.removeEventListener("pointerleave", hide);
    svg.removeEventListener("pointerdown", hide);
    hideTip(c);
  };
}

/** Shows (or moves) the tooltip for `t` at the client point (x, y). The text is worked out when the target changes, not on every move. `el` is the plan's element, which gets `aria-describedby`. */
export function showTip(c: FloorplanStudioCard, t: TapTarget, x: number, y: number, el: Element | null): void {
  const tip = c.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
  const s = tip ? subjectOf(c, t) : null;
  if (!tip || !s) { hideTip(c); return; }
  if (s.key !== c._tipKey) {
    hideTip(c);
    (tip.firstElementChild as HTMLElement).textContent = s.name;
    (tip.lastElementChild as HTMLElement).textContent = subjectText(c, s);
    tip.hidden = false;
    c._tipKey = s.key;
    c._tipTarget = t;
    c._tipHost = c.getBoundingClientRect();
    if (el) {
      const kind = thingKind(el);
      c._tipSel = `[data-${kind}="${el.getAttribute(`data-${kind}`)}"]`;
      holdTipEl(c, el);
    }
  }
  c._tipAt = el || c._tipSel ? { x, y } : null;
  const h = c._tipHost!, w = tip.offsetWidth, ht = tip.offsetHeight;
  const left = Math.max(4, Math.min(h.width - w - 4, x - h.left + 12));
  const below = y - h.top + 18;
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(below + ht > h.height - 4 ? Math.max(4, y - h.top - ht - 10) : below)}px)`;
}

/** The plan's element under the tooltip: it points at the tooltip and its own `<title>` is held back, so the browser's tooltip does not sit under ours. */
export function holdTipEl(c: FloorplanStudioCard, el: Element): void {
  el.setAttribute("aria-describedby", "fp-tip");
  const title = el.querySelector(":scope > title");
  if (title) { el.removeChild(title); c._tipTitle = { el, title }; }
  c._tipEl = el;
}

/** After every render: a state change while the tooltip is up rewrites its text, and the plan's elements, drawn again by that render, get the same treatment as the first (the new `<title>` out, `aria-describedby` on). The subject gone from the plan hides it. */
export function syncTip(c: FloorplanStudioCard): void {
  const tip = c.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
  if (c._tipKey === null || !tip) return;
  const s = c._tipTarget ? subjectOf(c, c._tipTarget) : null;
  if (!s || s.key !== c._tipKey) { hideTip(c); return; }
  (tip.firstElementChild as HTMLElement).textContent = s.name;
  (tip.lastElementChild as HTMLElement).textContent = subjectText(c, s);
  if (c._tipSel) {
    const el = c.shadowRoot?.querySelector(`svg ${c._tipSel}`) ?? null;
    if (!el) { hideTip(c); return; }
    if (el !== c._tipEl) { c._tipTitle = null; holdTipEl(c, el); } // the old element and its title are gone with the old drawing
    // A zoom or a turn moves the icon from under a pointer that did not move, and no pointermove follows: a tooltip names what is under the pointer.
    const at = c._tipAt, top = at ? c.shadowRoot?.elementFromPoint(at.x, at.y)?.closest(THINGS) ?? null : el;
    if (top !== el) { hideTip(c); return; }
  }
}

export function hideTip(c: FloorplanStudioCard): void {
  if (c._tipKey === null) return;
  c._tipKey = null;
  c._tipTarget = null;
  c._tipSel = null;
  c._tipAt = null;
  const tip = c.shadowRoot?.querySelector<HTMLElement>(".fp-tip");
  if (tip) tip.hidden = true;
  c._tipEl?.removeAttribute("aria-describedby");
  c._tipEl = null;
  const t = c._tipTitle;
  c._tipTitle = null;
  if (t?.el.isConnected && !t.el.querySelector(":scope > title")) t.el.prepend(t.title);
}

/** A pointer went down somewhere: a popup closes unless the press was in it or on something that decides for itself (an icon, a door, an Active row, the 3D view: those open, swap or close it on their own tap). */
export function onOutsideDown(c: FloorplanStudioCard, e: Event): void {
  if (!c._popup) return;
  for (const n of e.composedPath()) {
    // Only what is in this card's own shadow tree counts as inside: an icon of another card must close this card's popup.
    if (n instanceof Element && n.getRootNode() === c.shadowRoot && (n.classList.contains("fp-pop") || n.classList.contains("fp-bottom") || n.classList.contains("fp-3d") || n.matches(`${THINGS}, button[data-x], [data-pop]`))) return;
  }
  closePopup(c);
}
