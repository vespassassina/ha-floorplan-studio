import { FLOORPLAN_CSS } from "../../src/core/render";
import { layoutEntries } from "../../src/core/search";
import { migrate } from "../../src/core/migrate";
import type { Layout } from "../../src/core/schema";
import { isSearchChord, type FpSearch } from "../../src/card/search-box";
import stress from "../fixtures/stress-layout.json";

// The theme tokens come from the plan's own stylesheet (`[data-theme=...]`), as they do in both apps.
const style = document.createElement("style");
style.textContent = `${FLOORPLAN_CSS} body{margin:0;font:14px system-ui,sans-serif} #host{padding:16px;width:420px;min-height:520px;background:var(--fp-bg);color:var(--fp-ink)}`;
document.head.appendChild(style);

const w = window as unknown as { picks: unknown[]; closes: number; ready: boolean };
w.picks = [];
w.closes = 0;
const host = document.getElementById("host")!;
const box = document.getElementById("box") as FpSearch;
box.entries = layoutEntries(migrate(stress) as Layout, undefined);
host.addEventListener("keydown", (ev) => { if (isSearchChord(ev)) { ev.preventDefault(); box.focus(); } });
host.addEventListener("fp-pick", (ev) => { const e = ev as CustomEvent; w.picks.push({ detail: e.detail, bubbles: e.bubbles, composed: e.composed }); });
host.addEventListener("fp-close", () => { w.closes++; });
customElements.whenDefined("fp-search").then(() => { w.ready = true; });
