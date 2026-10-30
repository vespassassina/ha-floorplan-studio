import type { html as Html, nothing as Nothing } from "lit";

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
}
/** What the card draws with: lit's `html` and `nothing`, its translators, and the X's path. */
export interface BarTools { html: typeof Html; nothing: typeof Nothing; t(key: string): string; tn(one: string, other: string, n: number): string; close: string }
export interface BarHandlers { key(e: KeyboardEvent): void; play(): void; seek(minute: number): void; info(): void; close(): void }

export function barView({ html, nothing, t, tn, close }: BarTools, m: BarModel, h: BarHandlers) {
  const icon = (path: string) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} fill="currentColor"/></svg>`;
  const none = tn("{n} entity on this floor has no history", "{n} entities on this floor have no history", m.missing), play = m.playing ? t("Pause") : t("Play");
  return html`<div class="fp-replay" role="group" tabindex="-1" aria-label=${t("Replay")} aria-busy=${m.ready || m.failed ? "false" : "true"} @keydown=${h.key}>
    <span class="fp-rp-time">${m.shown}</span>
    <button type="button" class="fp-rp-play" aria-label=${play} title=${play} ?disabled=${!m.ready} @click=${h.play}>${icon(m.playing ? PAUSE : PLAY)}</button>
    <input type="range" class="fp-rp-range" min="0" max=${m.max} step="1" .value=${String(m.value)} ?disabled=${!m.ready} aria-label=${t("Replay time")} aria-valuetext=${m.shown}
      @input=${(e: Event) => h.seek(Number((e.target as HTMLInputElement).value))}>
    ${m.ready ? html`<button type="button" class="fp-rp-info" aria-label=${none} aria-pressed=${m.info ? "true" : "false"} title=${none} @click=${h.info}>${icon(INFO)}</button>` : nothing}
    <button type="button" class="fp-rp-close" aria-label=${t("Close replay")} title=${t("Close replay")} @click=${h.close}>${icon(close)}</button>
    <span class="fp-rp-msg" role="status">${m.message || (m.note ? t("Replaying") : m.info ? none : "")}</span>
  </div>`;
}
