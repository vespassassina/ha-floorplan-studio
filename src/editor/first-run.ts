import { css, html } from "lit";

/** What the first-run choice needs from the editor. */
export interface FirstRunCtx {
  /** Whether Home Assistant's areas are at hand. Without them the areas choice is off. */
  hasAreas: boolean;
  /** Whether Home Assistant is connected at all: it decides which reason the disabled button gives. */
  hasHa: boolean;
  demo: () => void;
  areas: () => void;
  blank: () => void;
}

/**
 * S37.1: three doors on a blank plan, shown only while the host says nothing was saved (the panel, on a `{ layout: null }`
 * reply). No explaining text: the areas choice says in its tooltip why it is off. Colours come from the editor's `--fp-*` variables.
 */
export function firstRunView(c: FirstRunCtx) {
  return html`<div class="firstrun" role="group" aria-label="Start">
    <button class="btn" id="frDemo" @click=${c.demo}>Load the demo</button>
    <button class="btn" id="frAreas" ?disabled=${!c.hasAreas} title=${c.hasAreas ? "One room per Home Assistant area, with its devices" : c.hasHa ? "Home Assistant has no areas yet" : "Needs Home Assistant: no areas to read here"} @click=${c.areas}>Start from your Home Assistant areas</button>
    <button class="btn" id="frBlank" @click=${c.blank}>Blank</button>
  </div>`;
}

export const firstRunCss = css`
  .firstrun{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;display:flex;flex-direction:column;gap:8px;width:min(22em,calc(100% - 32px));padding:16px;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3)}
  .firstrun .btn{padding:10px 12px;font-size:1em;text-align:center}
`;
