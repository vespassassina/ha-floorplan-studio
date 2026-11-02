import { html } from "lit";
import { live } from "./live-keep";
import type { PanelCtx } from "./panels";
import { compact, parseShown, rangeProblem, toShown, type TempUnit } from "./temp-range-ops";

/**
 * S42.5: the temperature range fields, in the user's unit (HA's `unit_system`), stored in °C to 0.1. Empty means unset. A value that
 * `validate` would refuse (min above max, a gap under 1 °C, out of -50..100, a hold that is not whole minutes 0..120) is not written:
 * the status line says what, why and that the old value was kept, and the box goes back to it.
 */
const HOLD_DEFAULT = 5;

type Apply = (value: number | undefined) => string; // "" when it was taken, else the reason it was not

function field(c: PanelCtx, label: string, id: string, cur: number | undefined, opts: { disabled?: boolean; title?: string; placeholder?: string; hold?: boolean }, apply: Apply) {
  const unit: TempUnit = c.tempUnit ?? "°C";
  const shown = cur === undefined ? "" : String(opts.hold ? cur : toShown(cur, unit));
  const kept = shown === "" ? "The field stays empty." : `Kept ${shown}.`;
  const on = (e: Event) => {
    const raw = (e.target as HTMLInputElement).value;
    const p = opts.hold ? parseHold(raw) : parseShown(raw, unit);
    const why = p.ok ? apply(p.c) : `"${raw.trim()}" is not ${opts.hold ? "a number of minutes" : "a temperature"}.`;
    if (why) c.say(`${why} ${kept}`);
    c.refresh();
  };
  return html`<label for=${id} title=${opts.title ?? ""}>${label}</label><input id=${id} type="text" inputmode="decimal" ?disabled=${opts.disabled} placeholder=${opts.placeholder ?? ""} title=${opts.title ?? ""} .value=${live(shown)} @change=${on}>`;
}

const parseHold = (raw: string): { ok: true; c: number | undefined } | { ok: false } => {
  const s = raw.trim();
  if (s === "") return { ok: true, c: undefined };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { ok: true, c: n } : { ok: false };
};

/** The reason a range cannot be written, or "" and the write done. `write` returns whether the layout changed. */
function tryRange(c: PanelCtx, next: object, house: boolean, write: () => boolean): string {
  const why = rangeProblem(compact(next), house);
  if (why) return `${why}.`;
  c.edited?.(write());
  return "";
}

/** Layout settings, in the floor panel: the house min, max and hold. */
export function houseRangePanel(c: PanelCtx) {
  const unit = c.tempUnit ?? "°C", cur = c.st.layout.tempRange ?? {};
  const set = (key: "min" | "max" | "hold"): Apply => (v) => tryRange(c, { ...cur, [key]: v }, true, () => c.st.setHouseRange({ [key]: v }));
  return html`
    ${field(c, `house min (${unit})`, "hrmin", cur.min, { title: "Colder than this warns" }, set("min"))}
    ${field(c, `house max (${unit})`, "hrmax", cur.max, { title: "Warmer than this warns" }, set("max"))}
    ${field(c, "hold (minutes)", "hrhold", cur.hold, { hold: true, placeholder: String(HOLD_DEFAULT), title: "Minutes a reading stays out before the room warns" }, set("hold"))}`;
}

/** Room panel: "Use house range", and the room's own min and max when it is off. */
export function roomRangePanel(c: PanelCtx, i: number) {
  const unit = c.tempUnit ?? "°C", own = c.st.f.rooms[i].tempRange;
  const set = (key: "min" | "max"): Apply => (v) => tryRange(c, { ...own, [key]: v }, false, () => c.st.setRoomRange(i, { ...own, [key]: v }));
  return html`<label title="Off, with both fields empty, this room never warns"><input type="checkbox" id="rtrUse" .checked=${live(!own)} @change=${(e: Event) => c.edited?.(c.st.setRoomRange(i, (e.target as HTMLInputElement).checked ? null : {}))}> Use house range</label>
    ${field(c, `min (${unit})`, "rtrmin", own?.min, { disabled: !own }, set("min"))}
    ${field(c, `max (${unit})`, "rtrmax", own?.max, { disabled: !own }, set("max"))}`;
}
