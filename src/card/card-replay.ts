import { html, nothing, render } from "lit";
import { mark, t, tn } from "../core/i18n";
import { DEFAULT_MOTION_FADE_S } from "../core";
import { entitiesOfDevice, entitiesOfDoor, moreInfoEntities } from "../core/attachments";
import type { Floor } from "../core/schema";
import { NO_ANSWER } from "./load";
import { closePopup } from "./card-popup";
import type { FloorplanStudioCard, Hass, HassEntity } from "./floorplan-studio-card";
import type { HistoryIndex } from "./replay/history";

// S39.2/S39.3: the history replay. The bar, the fetch and the clock live here; the parser and `stateAt` are a chunk of their own
// (replay/history.ts), loaded on the first Replay. The card draws the past through its one path: `_stateForRender()` and `_now()`
// answer from the replay while it is open, and nothing else in the render knows about it (CLAUDE.md finding 8).

const DAY_MS = 24 * 3600 * 1000;
export const DAY_MINUTES = 1440;
/** 24 hours in 60 seconds. */
const PLAY_MS_PER_MS = DAY_MS / 60000;
/** A hidden tab stops its frames; the first frame back would jump hours. A step longer than this is a pause, not a leap. */
const MAX_STEP_MS = 500;
const FETCH_TIMEOUT_MS = 20000;
const NOTE_MS = 2000;

const FETCH_FAILED = mark("Could not load the history: {why}");
const TIMED_OUT = mark("no answer in 20 s");

type States = Record<string, HassEntity>;
interface FloorHistory { status: "loading" | "ready" | "error"; index?: HistoryIndex; missing: number; why?: string }
export interface ReplayState {
  /** The moment the bar opened: the end of the slider. */
  end: number;
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
}

let lib: typeof import("./replay/history") | null = null;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s !== "") : []);
const text = (v: unknown): string[] => (typeof v === "string" && v ? [v] : []);

/** S39.2, spec item 4: every entity the shown floor draws from. Layout data is untrusted, so junk is skipped, never thrown on. */
export function replayEntities(f: Floor, sunId: string): string[] {
  const out = new Set<string>([sunId]);
  const add = (list: unknown[]) => list.forEach((e) => { if (typeof e === "string" && e) out.add(e); });
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  for (const d of list(f?.devices)) {
    if (!d || typeof d !== "object") continue;
    const dev = d as Floor["devices"][number];
    add(moreInfoEntities(dev)); // the entity, its `bound` relay and the attachments
    add(text(dev.power)); add(text(dev.motion));
  }
  for (const d of list(f?.doors)) if (d && typeof d === "object") add(entitiesOfDoor(d as Floor["doors"][number]));
  for (const u of list(f?.unlinked)) if (u && typeof u === "object") add(entitiesOfDevice(u as never));
  for (const r of list(f?.rooms)) {
    if (!r || typeof r !== "object") continue;
    const room = r as Floor["rooms"][number];
    add(strings(room.temps)); add(strings(room.humidity)); add(strings(room.motion)); add(text(room.entity));
  }
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

/** The bar's keys over the slider's minutes (0 is 24 h ago, 1440 is the moment of opening). null: not a key of the bar. */
export function keyMinute(key: string, v: number): number | null {
  const to = (m: number) => Math.min(DAY_MINUTES, Math.max(0, m));
  switch (key) {
    case "ArrowRight": case "ArrowUp": return to(v + 5);
    case "ArrowLeft": case "ArrowDown": return to(v - 5);
    case "PageUp": return to(v + 60);
    case "PageDown": return to(v - 60);
    case "Home": return 0;
    case "End": return DAY_MINUTES;
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

const startOf = (r: ReplayState): number => r.end - DAY_MS;
const minuteOf = (r: ReplayState, ms: number): number => Math.min(DAY_MINUTES, Math.max(0, Math.round((ms - startOf(r)) / 60000)));

/** Replay is offered with a connection to ask, a layout to draw, and not in kiosk (spec item 1). */
export function canReplay(c: FloorplanStudioCard): boolean {
  return !c._kiosk() && !!c._layout && !!c._hass?.connection?.sendMessagePromise;
}

export function openReplay(c: FloorplanStudioCard): void {
  if (c._replay || !canReplay(c)) return;
  closePopup(c);
  const end = Date.now();
  c._replay = { end, t: end, drawnT: end, playing: false, floors: new Map(), drawn: null, raf: null, last: 0, note: false, noteTimer: null, info: false };
  c._syncTimer(); // the motion fade follows the replayed moment now, not the clock
  c.requestUpdate();
}

export function closeReplay(c: FloorplanStudioCard): void {
  const r = c._replay;
  if (!r) return;
  stopFrames(r);
  if (r.noteTimer !== null) globalThis.clearTimeout(r.noteTimer);
  c._replay = null;
  c._syncTimer();
  c.requestUpdate();
}

/** The card left the page: stop the frames and the note, keep the place. */
export function pauseReplay(c: FloorplanStudioCard): void {
  const r = c._replay;
  if (!r) return;
  r.playing = false;
  stopFrames(r);
  if (r.noteTimer !== null) { globalThis.clearTimeout(r.noteTimer); r.noteTimer = null; r.note = false; }
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
  if (!r || !key || !f || r.floors.has(key)) return;
  const fh: FloorHistory = { status: "loading", missing: 0 };
  r.floors.set(key, fh);
  void fetchFloor(c, r, fh, f);
}

async function fetchFloor(c: FloorplanStudioCard, r: ReplayState, fh: FloorHistory, f: Floor): Promise<void> {
  const ids = replayEntities(f, c._sunId());
  try {
    const conn = c._hass?.connection;
    if (!conn) throw { message: t(NO_ANSWER) };
    lib ??= await import("./replay/history");
    const reply = await withTimeout(conn.sendMessagePromise<unknown>(lib.historyRequest(ids, startOf(r), r.end)), FETCH_TIMEOUT_MS);
    fh.index = lib.parseHistory(reply, ids);
    const sun = c._sunId();
    fh.missing = ids.filter((id) => id !== sun && !fh.index!.has(id)).length;
    fh.status = "ready";
  } catch (e) {
    fh.status = "error";
    const m = (e as { message?: unknown } | null)?.message;
    fh.why = typeof m === "string" && m ? m : t(NO_ANSWER);
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

/** `_stateForRender()` while the bar is open: the states last drawn, for the floor on show. */
export function replayStates(c: FloorplanStudioCard): Hass["states"] | undefined {
  const r = c._replay;
  if (!r) return undefined;
  const fh = floorHistory(c);
  if (r.drawn && r.drawn.floor === fh) return r.drawn.states;
  const at = statesAt(c, r.drawnT); // a floor switched to: its history at the moment on show
  if (at) r.drawn = at;
  return at?.states;
}

/** Whether a minute alone can change the picture: a motion fade still running, or the sheet's ages ("since 3 min"). Otherwise the
 * plan is not drawn again for it, and only the bar's own time moves. */
function minuteMatters(c: FloorplanStudioCard, at: { states: States } | undefined, ms: number): boolean {
  if (c._activeListVisible()) return true;
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
  const dt = r.last ? Math.min(MAX_STEP_MS, Math.max(0, ts - r.last)) : 0;
  r.last = ts;
  r.t = Math.min(r.end, r.t + dt * PLAY_MS_PER_MS);
  if (r.t >= r.end) { r.playing = false; r.raf = null; show(c, r, r.end, true); paintBar(c); return; }
  show(c, r, r.t);
  r.raf = globalThis.requestAnimationFrame((n) => step(c, n));
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

/** The bar's keys live on the bar, not on `window` (CLAUDE.md finding 6): the host only decides what each key does. */
function onKey(c: FloorplanStudioCard, ev: KeyboardEvent): void {
  const r = c._replay;
  if (!r || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const onButton = (ev.composedPath()[0] as Element | undefined)?.tagName === "BUTTON";
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
  if (ev.key === "Escape") { stop(); closeReplay(c); return; }
  if (onButton) return; // Space and Enter on a button are the button's own
  if (ev.key === " " || ev.key === "Spacebar") { stop(); togglePlay(c, r); return; }
  if (floorHistory(c)?.status !== "ready") return;
  const m = keyMinute(ev.key, minuteOf(r, r.drawnT));
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

const PLAY = "M8,5.14V19.14L19,12.14L8,5.14Z";
const PAUSE = "M14,19H18V5H14M6,19H10V5H6V19Z";
const INFO = "M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";
const icon = (path: string) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;

/** The place of the bar in the card's template. Its contents are painted by `paintBar`, on their own, so a minute of play need not draw the plan. */
export function replayBar(c: FloorplanStudioCard) {
  return c._replay ? html`<div class="fp-rp-wrap"></div>` : nothing;
}

function paintBar(c: FloorplanStudioCard): void {
  const wrap = c.shadowRoot?.querySelector<HTMLElement>(".fp-rp-wrap");
  if (wrap && c._replay) render(barView(c, c._replay), wrap);
}

function barView(c: FloorplanStudioCard, r: ReplayState) {
  const fh = floorHistory(c), ready = fh?.status === "ready";
  const shown = replayTime(r.drawnT, c._hass), value = minuteOf(r, r.drawnT);
  const message = fh?.status === "error" ? t(FETCH_FAILED, { why: fh.why ?? t(NO_ANSWER) })
    : !ready ? t("Loading history…")
    : r.note ? t("Replaying")
    : r.info ? tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", fh!.missing)
    : "";
  return html`<div class="fp-replay" role="group" aria-label=${t("Replay")} aria-busy=${ready || fh?.status === "error" ? "false" : "true"} @keydown=${(e: KeyboardEvent) => onKey(c, e)}>
    <span class="fp-rp-time">${shown}</span>
    <button type="button" class="fp-rp-play" aria-label=${r.playing ? t("Pause") : t("Play")} title=${r.playing ? t("Pause") : t("Play")} ?disabled=${!ready} @click=${() => togglePlay(c, r)}>${icon(r.playing ? PAUSE : PLAY)}</button>
    <input type="range" class="fp-rp-range" min="0" max=${DAY_MINUTES} step="1" .value=${String(value)} ?disabled=${!ready} aria-label=${t("Replay time")} aria-valuetext=${shown}
      @input=${(e: Event) => seek(c, r, startOf(r) + Number((e.target as HTMLInputElement).value) * 60000)}>
    ${ready ? html`<button type="button" class="fp-rp-info" aria-label=${tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", fh!.missing)} aria-pressed=${r.info ? "true" : "false"} title=${tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", fh!.missing)} @click=${() => { r.info = !r.info; paintBar(c); }}>${icon(INFO)}</button>` : nothing}
    <button type="button" class="fp-rp-live" @click=${() => closeReplay(c)}>${t("Live")}</button>
    <span class="fp-rp-msg" role="status">${message}</span>
  </div>`;
}

/** The stylesheet of the bar. Colours only through `--fp-*`. Under 640 px of card the time sits above the slider. */
export const REPLAY_CSS = `
    .fp-rp-wrap { grid-area: bar; container-type: inline-size; min-width: 0; z-index: 3; }
    .fp-replay { box-sizing: border-box; display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; grid-template-areas: "time play range info live" "msg msg msg msg msg"; align-items: center; column-gap: 8px; padding: 6px 8px; font: 13px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-room); border-top: 1px solid var(--fp-idle); }
    .fp-rp-time { grid-area: time; min-width: 4.5em; font-variant-numeric: tabular-nums; font-weight: 600; }
    .fp-rp-play { grid-area: play; } .fp-rp-range { grid-area: range; min-width: 0; width: 100%; } .fp-rp-info { grid-area: info; } .fp-rp-live { grid-area: live; }
    .fp-rp-msg { grid-area: msg; min-height: 0; color: var(--fp-text); }
    .fp-rp-msg:empty { display: none; }
    .fp-replay button { font: inherit; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 999px; min-width: 32px; min-height: 32px; padding: 0 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .fp-replay button:disabled { opacity: 0.5; cursor: default; }
    .fp-replay button svg { width: 18px; height: 18px; display: block; }
    .fp-replay input[type=range] { accent-color: var(--fp-ink); }
    @container (max-width: 640px) { .fp-replay { grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "time time time time" "play range info live" "msg msg msg msg"; } }
`;
