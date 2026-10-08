import { layoutEntries } from "../../src/core/search";
import { migrate } from "../../src/core/migrate";
import type { Layout } from "../../src/core/schema";
import { isSearchChord, type FpSearch } from "../../src/card/search-box";
import stress from "../fixtures/stress-layout.json";

// S24.R3, from the Opus review's harness: an app host, a panel inside it, and the focusable plan host inside that, which
// binds the chord on itself (finding 6).
class XApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<x-panel id="panel"></x-panel>`;
  }
}
class XPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<div id="host" tabindex="0" style="width:420px;min-height:300px"><fp-search id="box"></fp-search><p class="plan">plan</p></div>`;
  }
}
customElements.define("x-panel", XPanel);
customElements.define("x-app", XApp);
const panel = document.getElementById("app")!.shadowRoot!.getElementById("panel")!;
const host = panel.shadowRoot!.getElementById("host")!;
const box = panel.shadowRoot!.getElementById("box") as FpSearch;
customElements.whenDefined("fp-search").then(() => {
  box.entries = layoutEntries(migrate(stress) as Layout, undefined);
  host.addEventListener("keydown", (ev) => { if (isSearchChord(ev)) { ev.preventDefault(); box.focus(); } });
  (window as unknown as { ready: boolean }).ready = true;
});
