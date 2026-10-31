import type { html as Html, nothing as Nothing } from "lit";
import type { Onset } from "./events";
import { clusters, motionBuckets, type Cluster, type TickGroup } from "./markers";

// S40.1: the open bar's markup. It lives in the replay chunk with the parser: a card that never replays does not carry it. The card
// (card-replay.ts) decides what each control does and what the message says; this file only draws them. It imports nothing at runtime: a
// chunk that imports the card's own modules makes the bundler move the card out of its entry file, so the card hands over what it draws with.

const PLAY = "M8,5.14V19.14L19,12.14L8,5.14Z";
const PAUSE = "M14,19H18V5H14M6,19H10V5H6V19Z";
const INFO = "M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z";

export interface BarModel {
  /** The time on show, as the card's locale writes it. */
  shown: string;
  /** The slider's minute, 0 to `max`. */
  value: number;
  max: number;
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
}
/** What the card draws with: lit's `html` and `nothing`, its translators, and the X's path. */
export interface BarTools { html: typeof Html; nothing: typeof Nothing; t(key: string): string; tn(one: string, other: string, n: number): string; close: string }
export interface BarHandlers { key(e: KeyboardEvent): void; play(): void; seek(minute: number): void; jump(ms: number): void; info(): void; close(): void }

/** Colours only through `--fp-*`. The strip sits above the slider in the same column; its 8 px margins are the thumb's half width. */
const MARKER_CSS = `
.fp-rp-track{grid-area:range;min-width:0;display:flex;flex-direction:column}
.fp-rp-strip{position:relative;height:8px;margin:10px 8px 2px}
.fp-rp-band{position:absolute;inset:0;display:flex;pointer-events:none}
.fp-rp-band i{flex:1;background:var(--fp-text)}
.fp-rp-tick{position:absolute;bottom:0;width:4px;margin-left:-2px;border-radius:2px;cursor:pointer}
.fp-rp-tick::before{content:"";position:absolute;inset:-4px -1px}
.fp-rp-t-lamp{background:var(--fp-dev-light)} .fp-rp-t-opening{background:var(--fp-open-door)} .fp-rp-t-alarm{background:var(--fp-danger)}
`;
/** The strip's tick colours, one variable per group (a test reads each in every theme). */
export const MARKER_VARS = ["--fp-dev-light", "--fp-open-door", "--fp-danger", "--fp-text"];

let memo: { onsets: readonly Onset[]; end: number; width: number; c: Cluster[]; b: number[] } | null = null;
/** Play repaints the bar every frame; the clusters change only with the onsets, the window or the width. */
function marked(m: BarModel, onsets: readonly Onset[]) {
  const start = m.end - m.max * 60000;
  if (!memo || memo.onsets !== onsets || memo.end !== m.end || memo.width !== m.width) memo = { onsets, end: m.end, width: m.width, c: clusters(onsets, start, m.end, m.width), b: motionBuckets(onsets, start, m.end) };
  return memo;
}

export function barView({ html, nothing, t, tn, close }: BarTools, m: BarModel, h: BarHandlers) {
  const icon = (path: string) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;
  const counts = (n: Record<TickGroup, number>) => [tn("{n} lamp", "{n} lamps", n.lamp), tn("{n} door or window", "{n} doors or windows", n.opening), tn("{n} alarm", "{n} alarms", n.alarm)].filter((_, i) => n[(["lamp", "opening", "alarm"] as const)[i]]);
  const strip = () => {
    const onsets = m.onsets ?? [], { c, b } = marked(m, onsets), total = { lamp: 0, opening: 0, alarm: 0 }, sensors = new Set<string>();
    for (const o of onsets) { if (o.group === "motion") sensors.add(o.entity); else total[o.group]++; }
    const parts = [...counts(total), ...(sensors.size ? [tn("motion on {n} sensor", "motion on {n} sensors", sensors.size)] : [])];
    const top = Math.max(1, ...b);
    return html`<div class="fp-rp-strip" role="img" aria-label=${parts.join(", ") || t("No events")}>
      <div class="fp-rp-band">${b.map((n) => html`<i style="opacity:${n ? (0.2 + (0.8 * n) / top).toFixed(2) : 0}"></i>`)}</div>
      ${c.map((k) => html`<span class="fp-rp-tick fp-rp-t-${k.group}" style="left:${k.x.toFixed(1)}px;height:${k.height}px" title=${counts(k.n).join(", ")} @click=${() => h.jump(k.first.t)}></span>`)}
    </div>`;
  };
  const none = tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", m.missing), play = m.playing ? t("Pause") : t("Play");
  return html`<div class="fp-replay" role="group" tabindex="-1" aria-label=${t("Replay")} aria-busy=${m.ready || m.failed ? "false" : "true"} @keydown=${h.key}>
    <span class="fp-rp-time">${m.shown}</span>
    <button type="button" class="fp-rp-play" aria-label=${play} title=${play} ?disabled=${!m.ready} @click=${h.play}>${icon(m.playing ? PAUSE : PLAY)}</button>
    <style>${MARKER_CSS}</style>
    <div class="fp-rp-track">${m.ready ? strip() : nothing}
    <input type="range" class="fp-rp-range" min="0" max=${m.max} step="1" .value=${String(m.value)} ?disabled=${!m.ready} aria-label=${t("Replay time")} aria-valuetext=${m.shown}
      @input=${(e: Event) => h.seek(Number((e.target as HTMLInputElement).value))}></div>
    ${m.ready ? html`<button type="button" class="fp-rp-info" aria-label=${none} aria-pressed=${m.info ? "true" : "false"} title=${none} @click=${h.info}>${icon(INFO)}</button>` : nothing}
    <button type="button" class="fp-rp-close" aria-label=${t("Close replay")} title=${t("Close replay")} @click=${h.close}>${icon(close)}</button>
    <span class="fp-rp-msg" role="status">${m.message || (m.note ? t("Replaying") : m.info ? none : "")}</span>
  </div>`;
}
