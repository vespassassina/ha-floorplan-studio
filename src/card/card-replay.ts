import { html, nothing, render } from "lit";
import { mark, t, tn } from "../core/i18n";
import { DEFAULT_MOTION_FADE_S } from "../core";
import { entitiesOfDevice, entitiesOfDoor, moreInfoEntities } from "../core/attachments";
import { carEntities } from "../core/car-status";
import { coverActive } from "../core/cover";
import { doorRoomIndexes } from "../core/active";
import { doorStateOf } from "../core/door-state";
import { UI_ICONS } from "../core/icons";
import { roomAt } from "../core/render";
import type { Floor } from "../core/schema";
import { NO_ANSWER, STALE_PAGE } from "./load";
import { closePopup } from "./card-popup";
import { attentionOf } from "./card-overview";
import type { FloorplanStudioCard, Hass, HassEntity } from "./floorplan-studio-card";
import type { HistoryIndex } from "./replay/history";
import type { Onset } from "./replay/events";
import type { FilterState } from "./replay/filters";

// S39.2/S39.3: the history replay. The bar, the fetch and the clock live here; the parser and `stateAt` are a chunk of their own
// (replay/history.ts), loaded on the first Replay. The card draws the past through its one path: `_stateForRender()` and `_now()`
// answer from the replay while it is open, and nothing else in the render knows about it (CLAUDE.md finding 8).

export const DAY_MINUTES = 1440;
/** 24 hours of replay in 60 seconds of clock, at every window length (R2.5, item 11). */
const PLAY_MS_PER_MS = 1440;
/** A hidden tab stops its frames; the first frame back would jump hours. A step longer than this is a pause, not a leap. */
const MAX_STEP_MS = 500;
const FETCH_TIMEOUT_MS = 20000;
const NOTE_MS = 2000;

const FETCH_FAILED = mark("Could not load the history: {why}");
const TIMED_OUT = mark("no answer in 20 s");

type States = Record<string, HassEntity>;
interface FloorHistory { status: "loading" | "ready" | "error"; index?: HistoryIndex; onsets?: Onset[]; missing: number; why?: string; ids?: string[]; purgedFrom?: number | null; filter?: FilterState }
export interface ReplayState {
  /** The moment the bar opened: the end of the slider. */
  end: number;
  /** R2.5: the window's length in hours, one of the chunk's `WINDOWS`. The bar opens at 24 every time. */
  hours: number;
  /** Where the play head is, ms. `drawnT` is the moment last drawn, which moves by the minute while playing. */
  t: number;
  drawnT: number;
  playing: boolean;
  floors: Map<string, FloorHistory>;
  /** The replayed states last drawn, with the floor history they came from. */
  drawn: { floor: FloorHistory; states: States } | null;
  raf: number | null;
  last: number;
  note: boolean;
  noteTimer: ReturnType<typeof setTimeout> | null;
  info: boolean;
  /** What `overviewStates` made last, with the replayed and live states it was made from. */
  mix: { shown: States; live: Hass["states"]; out: Hass["states"] } | null;
  /** Focus still owed to the bar: the Replay button opened it, and the user has not moved on. */
  focus: boolean;
  /** R2.3: the strip's width in px, as last measured; the markers are clustered over it.  */
  width: number;
  /** The onset a button jump went to, ms: the status line speaks it while the moment on show is still that one (focus stays on the button, so `aria-valuetext` is never read). */
  said?: number;
}

type Lib = typeof import("./replay/history");
let lib: Lib | null = null;
/** The build puts the chunk's hashed file name here (vite.config.ts); unbuilt (vitest, dev) it stays a placeholder and the plain import is used. */
const CHUNK_FILE = "__FPREPLAY_CHUNK__";
let libTries = 0;
/** As the 3D chunk: a browser remembers a failed `import()` of one URL and never asks the network again, so each try after the first asks
 * for the same file under a new query. A failed load is not cached here, so closing the bar and opening it again is the retry. */
async function loadLib(): Promise<Lib> {
  if (lib) return lib;
  const n = libTries++;
  lib = n > 0 && /^floorplan-studio-replay-.+\.js$/.test(CHUNK_FILE)
    ? await import(/* @vite-ignore */ `${import.meta.url.split(/[?#]/)[0].replace(/[^/]*$/, "")}${CHUNK_FILE}?r=${n}`)
    : await import("./replay/history");
  return lib!;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s !== "") : []);
const text = (v: unknown): string[] => (typeof v === "string" && v ? [v] : []);

/** What the card has at hand beyond the layout: the plug-to-power-sensor links, and the registry with the live states, to find the
 * battery sensors behind a placed entity (the same sources `attention` reads). All optional; junk is skipped. */
export interface ReplayExtras {
  powerLinks?: Record<string, string>;
  registry?: Record<string, { device_id?: string | null } | undefined>;
  liveStates?: Record<string, { attributes?: Record<string, unknown> } | undefined>;
}

const ownOf = <T>(o: Record<string, T>, k: string): T | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** The battery entities that share an HA device with any of `placed`: what attention reads for a device with no battery of its own. */
function batteriesBehind(placed: ReadonlySet<string>, reg: ReplayExtras["registry"], states: ReplayExtras["liveStates"]): string[] {
  if (!reg || typeof reg !== "object" || !states || typeof states !== "object") return [];
  const devs = new Set<string>();
  for (const id of placed) { const d = ownOf(reg, id)?.device_id; if (typeof d === "string" && d) devs.add(d); }
  if (!devs.size) return [];
  const out: string[] = [];
  for (const id of Object.keys(reg)) {
    const d = ownOf(reg, id)?.device_id;
    if (typeof d !== "string" || !devs.has(d) || placed.has(id)) continue;
    if ((id.startsWith("sensor.") || id.startsWith("binary_sensor.")) && ownOf(states, id)?.attributes?.device_class === "battery") out.push(id);
  }
  return out;
}

/** S39.2, spec item 4: every entity the shown floor draws from. Layout data is untrusted, so junk is skipped, never thrown on.
 * Person `Device.room` is left out on purpose: person positions are a non-goal of the spec (DECISIONS, Sprint 39 review fixes). */
export function replayEntities(f: Floor, sunId: string, extras: ReplayExtras = {}): string[] {
  const out = new Set<string>([sunId]);
  const add = (list: unknown[]) => list.forEach((e) => { if (typeof e === "string" && e) out.add(e); });
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const links = extras.powerLinks && typeof extras.powerLinks === "object" ? extras.powerLinks : {};
  for (const d of list(f?.devices)) {
    if (!d || typeof d !== "object") continue;
    const dev = d as Floor["devices"][number];
    add(moreInfoEntities(dev)); // the entity, its `bound` relay and the attachments
    add(text(dev.power)); add(text(dev.motion));
    // A plug with no `power` of its own shows the sensor the card linked to it (`_powerLinks`).
    if (dev.type === "plug" && !dev.power && typeof dev.entity === "string") add(text(ownOf(links, dev.entity)));
  }
  for (const d of list(f?.doors)) if (d && typeof d === "object") add(entitiesOfDoor(d as Floor["doors"][number]));
  for (const u of list(f?.unlinked)) if (u && typeof u === "object") add(entitiesOfDevice(u as never));
  for (const m of list(f?.furniture)) {
    if (!m || typeof m !== "object") continue;
    add(text((m as { entity?: unknown }).entity)); // a tv, speaker or computer piece, and any piece that lights with its entity
    add(carEntities(m as never)); // a car's attached entities
  }
  for (const r of list(f?.rooms)) {
    if (!r || typeof r !== "object") continue;
    const room = r as Floor["rooms"][number];
    add(strings(room.temps)); add(strings(room.humidity)); add(strings(room.motion)); add(text(room.entity));
  }
  add(batteriesBehind(out, extras.registry, extras.liveStates));
  return [...out];
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** A formatter per language and setting: building one costs more than formatting with it, and play asks 24 times a second. */
function formatterFor(lang: string | undefined, tf: string | undefined): Intl.DateTimeFormat {
  const key = `${lang ?? ""}|${tf ?? ""}`;
  let f = formats.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", ...(tf === "12" ? { hour12: true } : tf === "24" ? { hour12: false, hourCycle: "h23" as const } : {}) };
    try { f = new Intl.DateTimeFormat(lang || undefined, opts); } catch { f = new Intl.DateTimeFormat(undefined, opts); }
    formats.set(key, f);
  }
  return f;
}

/** HH:MM in the user's language, as 24 or 12 hour by HA's own setting (`locale.time_format`: "12", "24", else the language decides). */
export function replayTime(ms: number, hass: { language?: string; locale?: { language?: string; time_format?: string } } | undefined): string {
  return formatterFor(hass?.language ?? hass?.locale?.language, hass?.locale?.time_format).format(ms);
}

/** The bar's keys over the slider's minutes (0 is the window's start, `max` the moment of opening). The steps come from the window's row in the chunk (`window.ts`); the defaults are the 24 h bar's. null: not a key of the bar. */
export function keyMinute(key: string, v: number, arrow = 5, max = DAY_MINUTES, page = 60): number | null {
  const to = (m: number) => Math.min(max, Math.max(0, m));
  switch (key) {
    case "ArrowRight": case "ArrowUp": return to(v + arrow);
    case "ArrowLeft": case "ArrowDown": return to(v - arrow);
    case "PageUp": return to(v + page);
    case "PageDown": return to(v - page);
    case "Home": return 0;
    case "End": return max;
    default: return null;
  }
}

/** Whether the plan would look the same: the same entities with the same state, time and attribute object (the parser carries one
 * attribute object per row, so identity is the right test and a deep compare is not needed). */
export function sameStates(a: States | undefined, b: States | undefined): boolean {
  if (!a || !b) return a === b;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => { const x = a[k], y = b[k]; return !!y && x.state === y.state && x.last_changed === y.last_changed && x.attributes === y.attributes; });
}

/** The reply, or a rejection `{ code: "timeout" }` after `ms`. The timer is always cleared. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject({ code: "timeout", message: TIMED_OUT }), ms);
    p.then((v) => { globalThis.clearTimeout(timer); resolve(v); }, (e) => { globalThis.clearTimeout(timer); reject(e); });
  });
}

const startOf = (r: ReplayState): number => r.end - r.hours * 3600000;
const minuteOf = (r: ReplayState, ms: number): number => Math.min(r.hours * 60, Math.max(0, Math.round((ms - startOf(r)) / 60000)));

/** Replay is offered with a connection to ask, a layout to draw, and not in kiosk (spec item 1). */
export function canReplay(c: FloorplanStudioCard): boolean {
  return !c._kiosk() && !!c._layout && !!c._hass?.connection?.sendMessagePromise;
}

/** `focus`: the Replay button opened it, so the bar hands focus to Play once the history is there (`paintBar`). The flag lives on the bar, so a bar closed by anything leaves none behind. */
export function openReplay(c: FloorplanStudioCard, focus = false): void {
  if (c._replay || !canReplay(c)) return;
  closePopup(c);
  const end = Date.now();
  c._replay = { end, hours: 24, t: end, drawnT: end, playing: false, floors: new Map(), drawn: null, raf: null, last: 0, note: false, noteTimer: null, info: false, mix: null, focus, width: 0 };
  c._syncTimer(); // the motion fade follows the replayed moment now, not the clock
  c.requestUpdate();
}

/** Cards whose Replay button takes focus after the next paint: the X or Escape closed the bar. */
const focusBack = new WeakSet<FloorplanStudioCard>();

/** `back`: the X and Escape give focus back to the button that opened the bar. */
export function closeReplay(c: FloorplanStudioCard, back = false): void {
  const r = c._replay;
  if (!r) return;
  if (back) focusBack.add(c);
  stopFrames(r);
  if (r.noteTimer !== null) globalThis.clearTimeout(r.noteTimer);
  c._replay = null;
  r.floors.forEach((fh) => fh.filter?.show(false)); // an open list holds a click listener on the document
  c._syncTimer();
  c.requestUpdate();
}

function stopFrames(r: ReplayState): void {
  if (r.raf !== null) globalThis.cancelAnimationFrame(r.raf);
  r.raf = null;
}

const floorHistory = (c: FloorplanStudioCard): FloorHistory | undefined => {
  const key = c._floorKey();
  return key ? c._replay?.floors.get(key) : undefined;
};

/** After every render: the first time a floor is on show while the bar is open, one call for its entities (spec item 4). */
export function syncReplay(c: FloorplanStudioCard): void {
  const r = c._replay, key = c._floorKey(), f = c._floor();
  paintBar(c);
  if (focusBack.delete(c)) {
    c.shadowRoot!.querySelector<HTMLElement>(".fp-rp-open")?.focus();
  }
  if (!r || !key || !f || r.floors.has(key)) return;
  const fh: FloorHistory = { status: "loading", missing: 0 };
  r.floors.set(key, fh);
  void fetchFloor(c, r, fh, f);
}

async function fetchFloor(c: FloorplanStudioCard, r: ReplayState, fh: FloorHistory, f: Floor): Promise<void> {
  const ids = replayEntities(f, c._sunId(), { powerLinks: c._powerLinks(), registry: c._hass?.entities, liveStates: c._hass?.states });
  const start = startOf(r); // the window this call was made for; a length chosen meanwhile drops `fh` from the map, so a late reply lands on an object nobody reads
  try {
    const conn = c._hass?.connection;
    if (!conn) throw { message: t(NO_ANSWER) };
    // A chunk that will not load is a page older than the server, or a lost network: the words of the 3D and form chunks, not the browser's.
    const h = await loadLib().catch(() => { throw { message: t(STALE_PAGE) }; });
    if (c._replay === r) paintBar(c); // the chunk is here: the bar's full markup replaces its shell
    // Each call has its own timeout: a second call that never answers fails the floor though the first did.
    fh.index = await h.fetchHistory((m) => withTimeout(conn.sendMessagePromise<unknown>(m), FETCH_TIMEOUT_MS), ids, start, r.end);
    fh.ids = ids;
    fh.purgedFrom = h.purgedFrom(fh.index, start);
    fh.onsets = h.onsets(fh.index, f, { doorStateOf, coverActive, roomAt, doorRooms: doorRoomIndexes });
    const sun = c._sunId();
    fh.missing = ids.filter((id) => id !== sun && !fh.index!.has(id)).length;
    fh.status = "ready";
  } catch (e) {
    fh.status = "error";
    const m = (e as { message?: unknown; code?: unknown } | null)?.message;
    // Our own timeout carries the English key; the reasons Home Assistant gives are its own words.
    fh.why = (e as { code?: unknown } | null)?.code === "timeout" ? t(TIMED_OUT) : typeof m === "string" && m ? m : t(NO_ANSWER);
  }
  if (c._replay === r) c.requestUpdate();
}

/** What a state looks like to the frontend's own formatters: they read `entity_id`. */
function asHassStates(raw: States): States {
  const out: States = Object.create(null);
  for (const id of Object.keys(raw)) out[id] = { ...raw[id], entity_id: id, last_updated: raw[id].last_changed } as HassEntity;
  return out;
}

/** The states of the shown floor at `ms`, or undefined while there is no history to read (loading, failed): the plan is live then. */
function statesAt(c: FloorplanStudioCard, ms: number): { floor: FloorHistory; states: States } | undefined {
  const fh = floorHistory(c);
  if (!lib || fh?.status !== "ready" || !fh.index) return undefined;
  return { floor: fh, states: asHassStates(lib.stateAt(fh.index, ms)) };
}

/** `_stateForRender()` while the bar is open: the states last drawn, for the floor on show. Undefined is live: at the end of the slider the
 * plan is the live one, not the recorder's version of now (the recorder keeps fewer attributes than the live state, a lamp's colour for
 * one), so `_stateForRender`, `_now`, the motion timer and the sun all read their live source there. */
export function replayStates(c: FloorplanStudioCard): Hass["states"] | undefined {
  const r = c._replay;
  if (!r || r.drawnT >= r.end) return undefined;
  const fh = floorHistory(c);
  if (r.drawn && r.drawn.floor === fh) return r.drawn.states;
  const at = statesAt(c, r.drawnT); // a floor switched to: its history at the moment on show
  if (at) r.drawn = at;
  return at?.states;
}

/** The states attention reads (alert badges, the Overview's items): the shown floor as it was, every other floor as it is. Attention runs
 * over all floors and the replay holds the shown floor only; an alarm upstairs now must not vanish because the ground floor is in the past.
 * An entity of the shown floor with no row at that moment is absent, as on the plan. */
export function overviewStates(c: FloorplanStudioCard): Hass["states"] | undefined {
  const live = c._hass?.states, r = c._replay, shown = replayStates(c), ids = floorHistory(c)?.ids;
  if (!r || !live || !shown || !ids) return live;
  if (r.mix && r.mix.shown === shown && r.mix.live === live) return r.mix.out;
  const out: Hass["states"] = { ...live };
  for (const id of ids) { if (shown[id]) out[id] = shown[id]; else delete out[id]; }
  r.mix = { shown, live, out };
  return out;
}

/** Whether a minute alone can change the picture: a motion fade still running, or the sheet's ages ("since 3 min"). Otherwise the
 * plan is not drawn again for it, and only the bar's own time moves. */
function minuteMatters(c: FloorplanStudioCard, at: { states: States } | undefined, ms: number): boolean {
  // The sheet prints an age ("12 min") only on an Attention row; with none, a minute changes nothing on it.
  const a = c._activeListVisible() ? attentionOf(c) : null;
  if (a && (a.items.length || a.unavailable.length)) return true;
  const f = c._floor(), fadeMs = (c._config.fade ?? DEFAULT_MOTION_FADE_S) * 1000;
  if (!f || !at || !(fadeMs > 0)) return false;
  const ids = [...f.devices.filter((d) => d.type === "motion").map((d) => d.entity), ...f.rooms.flatMap((r) => r.motion ?? [])];
  return ids.some((id) => {
    const s = at.states[id];
    if (!s || s.state === "on") return false;
    const age = ms - Date.parse(s.last_changed);
    return age < fadeMs + 60000; // one minute past the end, so the last, faded frame is drawn
  });
}

/** Moves to the moment `ms`. The plan is drawn when the replayed states changed, or the minute changed and something in the picture reads
 * the minute; the bar's time is painted either way. At most once per call, so once per frame. */
function show(c: FloorplanStudioCard, r: ReplayState, ms: number, force = false): void {
  const at = statesAt(c, ms);
  const minute = Math.floor(ms / 60000) !== Math.floor(r.drawnT / 60000);
  const changed = force || r.drawn?.floor !== at?.floor || !sameStates(at?.states, r.drawn?.states);
  if (!changed && !minute) return;
  r.drawnT = ms;
  if (changed) r.drawn = at ?? null;
  if (changed || minuteMatters(c, at, ms)) c.requestUpdate();
  else paintBar(c);
}

function seek(c: FloorplanStudioCard, r: ReplayState, ms: number): void {
  r.t = Math.min(r.end, Math.max(startOf(r), ms));
  show(c, r, r.t, true);
}

function step(c: FloorplanStudioCard, ts: number): void {
  const r = c._replay;
  if (!r || !r.playing) return;
  // A floor switched to while playing has no history yet (or none): the play head would run on live states. Stop; Play is the user's.
  if (floorHistory(c)?.status !== "ready") { r.playing = false; r.raf = null; paintBar(c); return; }
  const dt = r.last ? Math.min(MAX_STEP_MS, Math.max(0, ts - r.last)) : 0;
  r.last = ts;
  r.t = Math.min(r.end, r.t + dt * PLAY_MS_PER_MS);
  if (r.t >= r.end) { r.playing = false; r.raf = null; show(c, r, r.end, true); paintBar(c); return; }
  show(c, r, r.t);
  r.raf = globalThis.requestAnimationFrame((n) => step(c, n));
}

/** R2.5: another length. The moment on show stays if it lies inside the new window, else goes to its start (`seek` clamps); the end stays the moment the
 * bar opened. Every floor's history is dropped and the shown one asked again by `syncReplay`, so only the newest length's is kept. */
function setHours(c: FloorplanStudioCard, r: ReplayState, hours: number): void {
  if (hours === r.hours) return;
  r.hours = hours;
  r.playing = false; // the head would run on a floor with no history until the new reply is in; Play is the user's
  r.floors.clear();
  seek(c, r, r.t);
}

function togglePlay(c: FloorplanStudioCard, r: ReplayState): void {
  if (r.playing) { r.playing = false; stopFrames(r); paintBar(c); return; }
  if (floorHistory(c)?.status !== "ready") return;
  if (r.t >= r.end) seek(c, r, startOf(r)); // from the end, again from the beginning
  r.playing = true;
  r.last = 0;
  r.raf = globalThis.requestAnimationFrame((n) => step(c, n));
  paintBar(c);
}

/** R2.4: to the previous or next onset; a jump pauses play, and with none that way nothing happens, play included. */
function jumpBy(c: FloorplanStudioCard, r: ReplayState, dir: 1 | -1, said = false): void {
  const fh = floorHistory(c), o = lib?.neighbour(fh?.onsets ?? [], r.drawnT, dir, lib.passes(fh?.filter));
  if (!o) return;
  r.playing = false;
  stopFrames(r);
  r.said = said ? o.t : undefined;
  seek(c, r, o.t);
}

/** The bar's keys live on the bar, not on `window` (CLAUDE.md finding 6): the host only decides what each key does. */
function onKey(c: FloorplanStudioCard, ev: KeyboardEvent): void {
  const r = c._replay;
  if (!r || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const onButton = (ev.composedPath()[0] as Element | undefined)?.tagName === "BUTTON";
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
  // The filter list is the innermost thing open: Escape closes it first, the bar on the next press.
  const menu = floorHistory(c)?.filter;
  if (ev.key === "Escape") { stop(); if (menu?.open) menu.show(false, true); else closeReplay(c, true); return; }
  if (ev.shiftKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) { stop(); jumpBy(c, r, ev.key === "ArrowLeft" ? -1 : 1, onButton); return; }
  if (onButton) return; // Space and Enter on a button are the button's own
  if (ev.key === " ") { stop(); togglePlay(c, r); return; }
  if (floorHistory(c)?.status !== "ready") return;
  const w = lib!.windowOf(r.hours); // the history is ready, so the chunk is here
  const m = keyMinute(ev.key, minuteOf(r, r.drawnT), w.arrow, w.hours * 60, w.page);
  if (m === null) return;
  stop();
  seek(c, r, startOf(r) + m * 60000);
}

/** A tap while replaying acts on nothing; the bar says why for a moment (spec item 9). */
export function replayTap(c: FloorplanStudioCard): void {
  const r = c._replay;
  if (!r) return;
  r.note = true;
  if (r.noteTimer !== null) globalThis.clearTimeout(r.noteTimer);
  r.noteTimer = globalThis.setTimeout(() => { r.note = false; r.noteTimer = null; paintBar(c); }, NOTE_MS);
  paintBar(c);
}

const HISTORY = `${UI_ICONS.reset}M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8Z`; // the restore ring (already in the card) and MDI history's hand

/** The place of the bar in the card's template. Its contents are painted by `paintBar`, on their own, so a minute of play need not draw the plan. */
export function replayBar(c: FloorplanStudioCard) {
  if (c._replay) return html`<div class="fp-rp-wrap"></div>`;
  // S40.1: while the bar is closed, a slim button where it will sit. The label is the icon's name under 640 px (CSS hides the word).
  return canReplay(c) ? html`<div class="fp-rp-wrap fp-rp-idle"><button type="button" class="fp-rp-open" title=${t("Replay")} @click=${() => openReplay(c, true)}>${c._icon(HISTORY)}<span class="fp-rp-word">${t("Replay")}</span></button></div>` : nothing;
}

function paintBar(c: FloorplanStudioCard): void {
  const wrap = c.shadowRoot?.querySelector<HTMLElement>(".fp-rp-wrap");
  const r = c._replay;
  if (!wrap || !r) return;
  const held = wrap.contains(c.shadowRoot!.activeElement);
  render(barView(c, r), wrap);
  // A jump button that reaches its end goes disabled under the finger; focus on it would leave the bar's keys (Escape, Shift+arrows) without a target.
  const now = c.shadowRoot!.activeElement as HTMLButtonElement | null;
  if (held && (!now || now.disabled)) wrap.querySelector<HTMLElement>(".fp-replay")?.focus();
  // The markers are clustered over the strip's width, which only the page knows: measure, and draw again if it moved. A resize draws the card again, which comes here.
  const width = wrap.querySelector<HTMLElement>(".fp-rp-strip")?.clientWidth ?? 0;
  if (width !== r.width) { r.width = width; render(barView(c, r), wrap); }
  // The Replay button opened the bar: focus waits on the play button, which is disabled until the history is there. Meanwhile the bar
  // itself holds it (so Escape works); a failed fetch leaves the X.
  if (!r.focus) return;
  // away: the user moved on while it loaded, and that choice stays: inside the card on something else, or on a field elsewhere on the page.
  // With no focus in the card's own root, only the body is "nowhere" (no document body at all counts as away, the safe side); the card may sit in nested shadow roots, so the page's active element is a host, not the card.
  const st = floorHistory(c)?.status, at = c.shadowRoot!.activeElement, away = at ? !wrap.contains(at) : document.activeElement !== document.body;
  if (away || st === "ready" || st === "error") r.focus = false;
  if (!away) wrap.querySelector<HTMLElement>(st === "ready" ? ".fp-rp-play" : st === "error" ? ".fp-rp-close" : ".fp-replay")?.focus();
}

function barView(c: FloorplanStudioCard, r: ReplayState) {
  const fh = floorHistory(c), ready = fh?.status === "ready", failed = fh?.status === "error";
  const shown = replayTime(r.drawnT, c._hass);
  const message = failed ? t(FETCH_FAILED, { why: fh.why ?? t(NO_ANSWER) })
    : !ready ? t("Loading history…")
    : "";
  const close = () => closeReplay(c, true), key = (e: KeyboardEvent) => onKey(c, e);
  // The full bar is drawn by the replay chunk (replay/bar.ts). Until it is there, a shell with the way out and the message.
  if (!lib) return html`<div class="fp-replay" role="group" tabindex="-1" aria-label=${t("Replay")} @keydown=${key}><button type="button" class="fp-rp-close" aria-label=${t("Close replay")} @click=${close}>${c._icon(UI_ICONS.close)}</button><span class="fp-rp-msg" role="status">${message}</span></div>`;
  return lib.barView({ html, nothing, t, tn, close: UI_ICONS.close }, { shown, value: minuteOf(r, r.drawnT), max: r.hours * 60, hours: r.hours, purgedFrom: fh?.purgedFrom, hass: c._hass, ready, failed, playing: r.playing, note: r.note, info: r.info, missing: fh?.missing ?? 0, message, onsets: fh?.onsets, filter: fh && (fh.filter ??= lib.newFilter(() => paintBar(c))), rooms: c._floor()?.rooms, end: r.end, width: r.width, at: r.drawnT, said: r.said },
    { key, close, play: () => togglePlay(c, r), seek: (m) => seek(c, r, startOf(r) + m * 60000), jump: (ms) => seek(c, r, ms), jumpBy: (d) => jumpBy(c, r, d, true), length: (h) => setHours(c, r, h), info: () => { r.info = !r.info; r.said = undefined; paintBar(c); } });
}

/** The stylesheet of the bar. Colours only through `--fp-*`. Under 640 px of card the time sits above the slider. */
export const REPLAY_CSS = `
    .fp-rp-wrap { grid-area: bar; container-type: inline-size; min-width: 0; z-index: 3; }
    .fp-replay { box-sizing: border-box; display: grid; grid-template-columns: auto auto auto auto minmax(0, 1fr) auto auto; grid-template-areas: "time prev play next range info close" "msg msg msg msg msg msg msg"; align-items: center; column-gap: 8px; padding: 6px 8px; font: 13px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border-top: 1px solid var(--fp-idle); }
    .fp-rp-time { grid-area: time; min-width: 4.5em; font-variant-numeric: tabular-nums; font-weight: 600; }
    .fp-rp-play { grid-area: play; } .fp-rp-range { min-width: 0; width: 100%; } .fp-rp-info { grid-area: info; } .fp-rp-close { grid-area: close; }
    .fp-rp-msg { grid-area: msg; min-height: 0; color: var(--fp-text); }
    .fp-rp-msg:empty { display: none; }
    .fp-replay button, .fp-rp-open { font: inherit; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 999px; min-width: 32px; min-height: 32px; padding: 0 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .fp-replay button:disabled { opacity: 0.5; cursor: default; }
    .fp-replay button svg, .fp-rp-open svg { width: 18px; height: 18px; display: block; }
    .fp-rp-idle { padding: 0 8px; } .fp-rp-open { gap: 6px; font: 13px/1.3 var(--fp-font, system-ui, sans-serif); }
    .fp-replay input[type=range] { accent-color: var(--fp-ink); }
    @container (max-width: 640px) { .fp-rp-word { display: none; } .fp-replay { grid-template-columns: auto auto auto minmax(0, 1fr) auto auto; grid-template-areas: "time time time time time time" "prev play next range info close" "msg msg msg msg msg msg"; } }
`;
