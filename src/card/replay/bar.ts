import type { html as Html, nothing as Nothing } from "lit";
import { neighbour, type Onset } from "./events";
import { clusters, motionBuckets, type Cluster, type TickGroup } from "./markers";
import { WINDOWS, dayAndTime, weekday } from "./window";

// S40.1: the open bar's markup. It lives in the replay chunk with the parser: a card that never replays does not carry it. The card
// (card-replay.ts) decides what each control does and what the message says; this file only draws them. It imports nothing at runtime: a
// chunk that imports the card's own modules makes the bundler move the card out of its entry file, so the card hands over what it draws with.

const PLAY = "M8,5.14V19.14L19,12.14L8,5.14Z";
const PAUSE = "M14,19H18V5H14M6,19H10V5H6V19Z";
const PREV = "M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z";
const NEXT = "M16,18H18V6H16M6,18L14.5,12L6,6V18Z";
const INFO = "M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";

export interface BarModel {
  /** The time on show, as the card's locale writes it. */
  shown: string;
  /** The slider's minute, 0 to `max`. */
  value: number;
  max: number;
  /** R2.5: the window's length in hours (one of `WINDOWS`); `max` is its minutes. */
  hours: number;
  ready: boolean;
  failed: boolean;
  playing: boolean;
  /** A tap landed while replaying: the line says "Replaying" for a moment. */
  note: boolean;
  info: boolean;
  /** How many entities of the floor have no history. */
  missing: number;
  /** What the card says of the fetch (loading, failed); empty once the history is there. The bar adds the note and the info line. */
  message: string;
  /** R2.3: the floor's onsets (none until the history is there), the window's end in ms (it is `max` minutes long) and the strip's width in px (0: not measured yet). */
  onsets?: readonly Onset[];
  end: number;
  width: number;
  /** R2.4: the moment on show in ms; the jumps go to the onset before or after it, and the value text names an onset that sits exactly on it. */
  at: number;
  /** The onset a button jump went to: while the thumb is still on it, the status line speaks the event. */
  said?: number;
  /** R2.5: when the reply begins, if the recorder had purged part of the window; `hass` gives the language and clock setting that write it. */
  purgedFrom?: number | null;
  hass?: Parameters<typeof dayAndTime>[1];
}
/** What the card draws with: lit's `html` and `nothing`, its translators, and the X's path. */
export interface BarTools { html: typeof Html; nothing: typeof Nothing; t(key: string, vars?: Record<string, string | number>): string; tn(one: string, other: string, n: number): string; close: string }
export interface BarHandlers { key(e: KeyboardEvent): void; play(): void; seek(minute: number): void; jump(ms: number): void; jumpBy(dir: 1 | -1): void; length(hours: number): void; info(): void; close(): void }

/** Colours only through `--fp-*`. The strip sits above the slider in the same column; its 8 px margins are the thumb's half width. */
const MARKER_CSS = `
.fp-rp-prev{grid-area:prev} .fp-rp-next{grid-area:next}
.fp-rp-head{grid-area:time;display:flex;align-items:center;gap:8px;min-width:0}
.fp-rp-len{display:inline-flex;gap:4px}
.fp-replay .fp-rp-len button{min-width:0;padding:0 8px;font-size:12px}
.fp-replay .fp-rp-len button[aria-pressed=true]{background:var(--fp-ink);color:var(--fp-room)}
@container (max-width:640px){.fp-rp-head{justify-content:space-between}}
.fp-rp-purge{position:absolute;left:0;top:-2px;bottom:-2px;border-radius:2px;background:var(--fp-idle);opacity:.6;pointer-events:none}
.fp-rp-track{grid-area:range;min-width:0;display:flex;flex-direction:column}
.fp-rp-strip{position:relative;height:8px;margin:10px 8px 2px}
.fp-rp-band{position:absolute;inset:0;display:flex;pointer-events:none}
.fp-rp-band i{flex:1;background:var(--fp-text)}
.fp-rp-tick{position:absolute;bottom:0;width:4px;margin-left:-2px;border-radius:2px;cursor:pointer}
.fp-rp-tick::before{content:"";position:absolute;inset:-4px -3px}
.fp-rp-t-lamp{background:var(--fp-dev-light)} .fp-rp-t-opening{background:var(--fp-open-door)} .fp-rp-t-alarm{background:var(--fp-danger)}
`;
/** The strip's tick colours, one variable per group (a test reads each in every theme). */
export const MARKER_VARS = ["--fp-dev-light", "--fp-open-door", "--fp-danger", "--fp-text"];

let memo: { onsets: readonly Onset[]; end: number; max: number; width: number; c: Cluster[]; b: number[] } | null = null;
/** Play repaints the bar every frame; the clusters change only with the onsets, the window or the width. */
function marked(m: BarModel, onsets: readonly Onset[]) {
  const start = m.end - m.max * 60000;
  if (!memo || memo.onsets !== onsets || memo.end !== m.end || memo.max !== m.max || memo.width !== m.width) memo = { onsets, end: m.end, max: m.max, width: m.width, c: clusters(onsets, start, m.end, m.width), b: motionBuckets(onsets, start, m.end) };
  return memo;
}

/** What happened at an onset, for the value text ("21:14, door opened"). */
export function eventSaid(t: BarTools["t"], o: Onset): string {
  return o.group === "lamp" ? t("light on") : o.group === "motion" ? t("motion") : o.group === "alarm" ? t("alarm")
    : o.kind === "cover" ? t("cover opened") : o.kind === "lock" ? t("unlocked") : t("door opened");
}

export function barView({ html, nothing, t, tn, close }: BarTools, m: BarModel, h: BarHandlers) {
  const icon = (path: string) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;
  const counts = (n: Record<TickGroup, number>) => [tn("{n} lamp", "{n} lamps", n.lamp), tn("{n} door or window", "{n} doors or windows", n.opening), tn("{n} alarm", "{n} alarms", n.alarm)].filter((_, i) => n[(["lamp", "opening", "alarm"] as const)[i]]);
  const strip = () => {
    const start = m.end - m.max * 60000, onsets = m.onsets ?? [], { c, b } = marked(m, onsets), total = { lamp: 0, opening: 0, alarm: 0 }, sensors = new Set<string>();
    for (const o of onsets) { if (o.group === "motion") sensors.add(o.entity); else total[o.group]++; }
    const parts = [...counts(total), ...(sensors.size ? [tn("motion on {n} sensor", "motion on {n} sensors", sensors.size)] : [])];
    const top = Math.max(1, ...b);
    return html`<div class="fp-rp-strip" role="img" aria-label=${parts.join(", ") || t("No events")}>
      ${m.purgedFrom ? html`<div class="fp-rp-purge" style="width:${Math.min(100, Math.max(0, +(((m.purgedFrom - start) / (m.max * 600)).toFixed(1))))}%"></div>` : nothing}
      <div class="fp-rp-band">${b.map((n) => html`<i style="opacity:${n ? (0.1 + (0.4 * n) / top).toFixed(2) : 0}"></i>`)}</div>
      ${c.map((k) => html`<span class="fp-rp-tick fp-rp-t-${k.group}" style="left:${k.x.toFixed(1)}px;height:${k.height}px" title=${counts(k.n).join(", ")} @click=${() => h.jump(k.first.t)}></span>`)}
    </div>`;
  };
  const shown = m.hours > 24 ? `${weekday(m.at, m.hass)} ${m.shown}` : m.shown;
  const onset = m.onsets?.find((o) => o.t === m.at), text = onset ? `${shown}, ${eventSaid(t, onset)}` : shown;
  const go = (dir: 1 | -1, cls: string, name: string, path: string) => html`<button type="button" class=${cls} aria-label=${name} title=${name} ?disabled=${!m.ready || !neighbour(m.onsets ?? [], m.at, dir)} @click=${() => h.jumpBy(dir)}>${icon(path)}</button>`;
  const none = tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", m.missing), play = m.playing ? t("Pause") : t("Play");
  return html`<div class="fp-replay" role="group" tabindex="-1" aria-label=${t("Replay")} aria-busy=${m.ready || m.failed ? "false" : "true"} @keydown=${h.key}>
    <div class="fp-rp-head"><span class="fp-rp-time">${shown}</span>
    <div class="fp-rp-len" role="group" aria-label=${t("Window")}>${WINDOWS.map((w) => html`<button type="button" aria-pressed=${w.hours === m.hours ? "true" : "false"} @click=${() => h.length(w.hours)}>${t("{n} h", { n: w.hours })}</button>`)}</div></div>
    ${go(-1, "fp-rp-prev", t("Previous event"), PREV)}
    <button type="button" class="fp-rp-play" aria-label=${play} title=${play} ?disabled=${!m.ready} @click=${h.play}>${icon(m.playing ? PAUSE : PLAY)}</button>
    ${go(1, "fp-rp-next", t("Next event"), NEXT)}
    <style>${MARKER_CSS}</style>
    <div class="fp-rp-track">${m.ready ? strip() : nothing}
    <input type="range" class="fp-rp-range" min="0" max=${m.max} step="1" .value=${String(m.value)} ?disabled=${!m.ready} aria-label=${t("Replay time")} aria-valuetext=${text}
      @input=${(e: Event) => h.seek(Number((e.target as HTMLInputElement).value))}></div>
    ${m.ready ? html`<button type="button" class="fp-rp-info" aria-label=${none} aria-pressed=${m.info ? "true" : "false"} title=${none} @click=${h.info}>${icon(INFO)}</button>` : nothing}
    <button type="button" class="fp-rp-close" aria-label=${t("Close replay")} title=${t("Close replay")} @click=${h.close}>${icon(close)}</button>
    <span class="fp-rp-msg" role="status">${m.message || (m.note ? t("Replaying") : m.said === m.at && onset ? text : m.info ? [none, m.purgedFrom ? t("History is kept from {when}", { when: dayAndTime(m.purgedFrom, m.hass) }) : ""].filter(Boolean).join(". ") : "")}</span>
  </div>`;
}
