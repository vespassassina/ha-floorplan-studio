// S64.2: Lazy zero-import rich car popover chunk (`floorplan-studio-car-<hash>.js`).
// Renders inside `.fp-pop` when a car piece is tapped, adding 0 B of UI logic to the main card.
import type { html as Html } from "lit";

export const CAR_CHUNK = "fp-car-v1";

export type CarStates = Record<string, { state?: unknown; attributes?: unknown } | undefined> | null | undefined;

export interface CarOpening {
  entity: string;
  name: string;
  open: boolean;
  kind: "lock" | "opening";
}

export interface CarControl {
  entity: string;
  name: string;
  domain: "lock" | "climate" | "switch";
  on: boolean;
  state: string;
}

export interface CarDetails {
  level: { value: number; kind: "battery" | "fuel" } | null;
  range: string | null;
  charging: boolean;
  chargePower: string | null;
  chargeEta: string | null;
  openings: CarOpening[];
  controls: CarControl[];
}

const OPENINGS = new Set(["door", "window", "opening", "garage_door"]);
const CHARGING_WORDS = new Set(["charging", "charge_in_progress"]);

function readState(states: CarStates, e: string): { state: string; attrs: Record<string, unknown> } | null {
  try {
    const s = states && Object.prototype.hasOwnProperty.call(states, e) ? states[e] : undefined;
    if (!s || typeof s !== "object" || typeof s.state !== "string") return null;
    const a = s.attributes;
    return { state: s.state, attrs: a && typeof a === "object" ? (a as Record<string, unknown>) : {} };
  } catch { return null; }
}

const shortName = (e: string, attrs: Record<string, unknown>): string => {
  const fn = typeof attrs.friendly_name === "string" && attrs.friendly_name.trim() ? attrs.friendly_name.trim() : "";
  if (fn) return fn;
  const slug = e.slice(e.indexOf(".") + 1).replace(/_/g, " ");
  return slug ? slug[0]!.toUpperCase() + slug.slice(1) : e;
};

/** Pure telemetry & control extractor for a car's entities. Never throws on malformed or missing states. */
export function carDetails(entities: readonly string[], states: CarStates): CarDetails {
  let battery: number | null = null, fuel: number | null = null;
  let range: string | null = null;
  let charging = false;
  let chargePower: string | null = null;
  let chargeEta: string | null = null;
  const openings: CarOpening[] = [];
  const controls: CarControl[] = [];

  for (const e of entities) {
    if (typeof e !== "string" || !e.includes(".")) continue;
    const r = readState(states, e);
    if (!r) continue;
    const domain = e.slice(0, e.indexOf("."));
    const word = r.state.trim().toLowerCase();
    const dead = !word || word === "unknown" || word === "unavailable";
    const cls = typeof r.attrs.device_class === "string" ? r.attrs.device_class : "";
    const unit = typeof r.attrs.unit_of_measurement === "string" ? r.attrs.unit_of_measurement.trim() : "";
    const name = shortName(e, r.attrs);
    const num = dead ? NaN : Number(r.state.trim());

    if (domain === "binary_sensor") {
      if (cls === "battery_charging" && word === "on") charging = true;
      if (OPENINGS.has(cls) && !dead) openings.push({ entity: e, name, open: word === "on", kind: "opening" });
    } else if (domain === "lock") {
      const unlocked = word === "unlocked" || word === "open";
      if (!dead) {
        openings.push({ entity: e, name, open: unlocked, kind: "lock" });
        controls.push({ entity: e, name, domain: "lock", on: unlocked, state: word });
      }
    } else if (domain === "climate" && !dead) {
      controls.push({ entity: e, name, domain: "climate", on: word !== "off", state: word });
    } else if (domain === "switch" && !dead) {
      controls.push({ entity: e, name, domain: "switch", on: word === "on", state: word });
    } else if (domain === "sensor" && !dead) {
      if (CHARGING_WORDS.has(word)) charging = true;
      const lower = e.toLowerCase();
      if (battery === null && cls === "battery" && unit === "%" && Number.isFinite(num) && num >= 0 && num <= 100) {
        battery = Math.round(num);
      } else if (fuel === null && lower.includes("fuel") && unit === "%" && Number.isFinite(num) && num >= 0 && num <= 100) {
        fuel = Math.round(num);
      } else if (range === null && (cls === "distance" || unit === "km" || unit === "mi" || lower.includes("range")) && Number.isFinite(num) && num >= 0) {
        range = `${Math.round(num)}${unit ? ` ${unit}` : ""}`;
      } else if (chargePower === null && (cls === "power" || unit === "kW" || unit === "W") && Number.isFinite(num) && num > 0) {
        const kw = unit === "W" ? (num >= 1000 ? `${(num / 1000).toFixed(1)} kW` : `${Math.round(num)} W`) : `${Number(num.toFixed(1))} ${unit || "kW"}`;
        chargePower = kw;
      } else if (chargeEta === null && (cls === "duration" || /time_remaining|charge_time|remaining/.test(lower))) {
        chargeEta = unit ? `${r.state.trim()} ${unit}` : r.state.trim();
      }
    }
  }

  openings.sort((a, b) => Number(b.open) - Number(a.open));
  const level = battery !== null ? { value: battery, kind: "battery" as const } : fuel !== null ? { value: fuel, kind: "fuel" as const } : null;
  return { level, range, charging, chargePower, chargeEta, openings, controls };
}

export interface CarCardState {
  key: string;
  status: "loading" | "ready" | "failed";
  el?: HTMLElement;
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** S78: validates `config.car_cards[entity]` from untrusted card YAML. Never throws; rejects prototype keys and missing `type`. */
export function carCardConfigOf(carCards: unknown, entity: string | null | undefined): Record<string, unknown> | null {
  if (!entity || typeof entity !== "string" || RESERVED_KEYS.has(entity)) return null;
  if (!carCards || typeof carCards !== "object" || Array.isArray(carCards)) return null;
  if (!Object.prototype.hasOwnProperty.call(carCards, entity)) return null;
  const raw = (carCards as Record<string, unknown>)[entity];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const typ = (raw as Record<string, unknown>).type;
  if (typeof typ !== "string" || !typ.trim()) return null;
  return raw as Record<string, unknown>;
}

export interface CarPopoverDeps {
  html: typeof Html;
  nothing: unknown;
  kiosk: boolean;
  confirmEntity: string | null;
  setConfirm: (entity: string | null) => void;
  callService: (domain: string, service: string, data: Record<string, unknown>) => void;
  carCards?: unknown;
  mainEntity?: string | null;
  hass?: unknown;
  carCardState?: CarCardState | null;
  setCarCardState?: (s: CarCardState | null) => void;
  warnOnce?: (msg: string) => void;
}

const CAR_CSS = `
.fp-car-custom{margin:2px 0 4px;min-width:240px;max-width:360px}
.fp-car-pop{display:flex;flex-direction:column;gap:6px;margin:2px 0 4px;font-size:12px}
.fp-car-meter{display:flex;flex-direction:column;gap:3px}
.fp-car-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px}
.fp-car-bar{height:7px;border-radius:999px;background:color-mix(in srgb,var(--fp-idle) 35%,transparent);overflow:hidden}
.fp-car-fill{height:100%;border-radius:999px;background:var(--fp-dev-car,#2e9e66);transition:width .2s}
.fp-car-fill.low{background:var(--fp-warn,#d97706)}
.fp-car-chips{display:flex;flex-wrap:wrap;gap:4px}
.fp-car-chip{padding:2px 7px;border-radius:999px;font-size:11px;border:1px solid color-mix(in srgb,var(--fp-idle) 60%,transparent);background:var(--fp-bg)}
.fp-car-chip.alert{border-color:var(--fp-open-door,#e05252);color:var(--fp-open-door,#e05252);font-weight:600}
.fp-car-chip.chg{border-color:var(--fp-dev-car,#2e9e66);color:var(--fp-dev-car,#2e9e66);font-weight:600}
.fp-car-ctrls{display:flex;flex-wrap:wrap;gap:5px}
.fp-car-btn{min-height:32px;padding:0 10px;border-radius:7px;border:1px solid var(--fp-idle);background:var(--fp-bg);color:var(--fp-ink);font:12px/1.2 var(--fp-font,system-ui,sans-serif);cursor:pointer}
.fp-car-btn.on{border-color:var(--fp-primary);background:color-mix(in srgb,var(--fp-primary) 14%,var(--fp-bg));font-weight:600}
.fp-car-btn.warn{border-color:var(--fp-open-door,#e05252);background:var(--fp-open-door,#e05252);color:#fff;font-weight:600}
@media (pointer:coarse){.fp-car-btn{min-height:44px;min-width:44px}}
`;

export interface CarCardHost {
  _config: { car_cards?: unknown };
  _hass?: unknown;
  _carConfirm: string | null;
  _carCard: CarCardState | null;
  _carCardWarned: boolean;
  _kiosk(): boolean;
  _stateForRender(): CarStates;
  requestUpdate(): void;
}

/** Host adapter inside the lazy car chunk so the main card passes `c` directly with minimal bytes. */
export function renderCarCard(
  c: CarCardHost,
  tools: { html: typeof Html; nothing: unknown; callService: (domain: string, service: string, data: Record<string, unknown>) => void },
  entities: readonly string[],
  mainEntity?: string | null,
): unknown {
  return renderCarPopover(
    {
      ...tools,
      kiosk: c._kiosk(),
      confirmEntity: c._carConfirm,
      setConfirm: (entity) => { c._carConfirm = entity; c.requestUpdate(); },
      carCards: c._config.car_cards,
      mainEntity,
      hass: c._hass,
      carCardState: c._carCard,
      setCarCardState: (s) => { c._carCard = s; c.requestUpdate(); },
      warnOnce: (msg) => { if (!c._carCardWarned) { c._carCardWarned = true; console.warn(msg); } },
    },
    entities,
    c._stateForRender(),
  );
}

export function renderCarPopover(d: CarPopoverDeps, entities: readonly string[], states: CarStates): unknown {
  const { html, nothing } = d;
  const customCfg = carCardConfigOf(d.carCards, d.mainEntity);
  if (customCfg && d.setCarCardState) {
    let key = String(d.mainEntity ?? "");
    try { key += `:${JSON.stringify(customCfg)}`; } catch { /* ignore */ }
    const cur = d.carCardState;
    if (cur?.key === key) {
      if (cur.status === "ready" && cur.el) {
        try { (cur.el as unknown as { hass?: unknown }).hass = d.hass; } catch { /* ignore */ }
        return html`<style>${CAR_CSS}</style><div class="fp-car-custom" data-car-custom>${cur.el}</div>`;
      }
      if (cur.status === "loading") return nothing;
      // status === "failed" -> fall through to built-in rich car popover
    } else {
      const w = globalThis as unknown as { loadCardHelpers?: () => Promise<{ createCardElement(cfg: Record<string, unknown>): HTMLElement | Promise<HTMLElement> }> };
      if (typeof w.loadCardHelpers !== "function") {
        d.warnOnce?.("floorplan-studio-card: car_cards requires Home Assistant loadCardHelpers; using built-in car popover.");
        d.setCarCardState({ key, status: "failed" });
      } else {
        const st: CarCardState = { key, status: "loading" };
        d.setCarCardState(st);
        void w.loadCardHelpers().then((h) => h.createCardElement(customCfg)).then((el) => {
          if (!el || el.tagName === "HUI-ERROR-CARD") throw new Error("Card element failed to load");
          try { (el as unknown as { hass?: unknown }).hass = d.hass; } catch { /* ignore */ }
          d.setCarCardState?.({ key, status: "ready", el });
        }).catch((err) => {
          d.warnOnce?.(`floorplan-studio-card: car_cards could not render "${String(customCfg.type)}": ${String((err as { message?: unknown })?.message ?? err)}`);
          d.setCarCardState?.({ key, status: "failed" });
        });
        return nothing;
      }
    }
  }
  const info = carDetails(entities, states);
  if (!info.level && !info.range && !info.charging && !info.openings.length && !info.controls.length) return d.nothing;

  const actCtrl = (c: CarControl) => {
    if (c.domain === "lock") {
      if (!c.on) {
        if (d.confirmEntity !== c.entity) { d.setConfirm(c.entity); return; }
        d.setConfirm(null);
        d.callService("lock", "unlock", { entity_id: c.entity });
      } else {
        d.setConfirm(null);
        d.callService("lock", "lock", { entity_id: c.entity });
      }
      return;
    }
    d.setConfirm(null);
    d.callService(c.domain, c.on ? "turn_off" : "turn_on", { entity_id: c.entity });
  };

  return html`<style>${CAR_CSS}</style><div class="fp-car-pop" data-car-pop>
    ${info.level || info.range ? html`<div class="fp-car-meter">
      <div class="fp-car-row">
        <span>${info.level ? `${info.level.kind === "fuel" ? "Fuel" : "Battery"} ${info.level.value}%` : ""}</span>
        <span>${info.range ?? ""}</span>
      </div>
      ${info.level ? html`<div class="fp-car-bar" role="progressbar" aria-valuenow=${info.level.value} aria-valuemin="0" aria-valuemax="100"><div class=${`fp-car-fill${info.level.value <= 20 ? " low" : ""}`} style=${`width:${info.level.value}%`}></div></div>` : nothing}
    </div>` : nothing}
    ${info.charging || info.chargePower || info.chargeEta ? html`<div class="fp-car-chips">
      <span class="fp-car-chip chg">${["Charging", info.chargePower, info.chargeEta].filter(Boolean).join(" · ")}</span>
    </div>` : nothing}
    ${info.openings.length ? html`<div class="fp-car-chips">
      ${info.openings.map((o) => html`<span class=${`fp-car-chip${o.open ? " alert" : ""}`} data-car-open=${o.entity}>${o.name}: ${o.kind === "lock" ? (o.open ? "Unlocked" : "Locked") : (o.open ? "Open" : "Closed")}</span>`)}
    </div>` : nothing}
    ${!d.kiosk && info.controls.length ? html`<div class="fp-car-ctrls">
      ${info.controls.map((c) => d.confirmEntity === c.entity
        ? html`<button type="button" class="fp-car-btn warn" data-car-confirm=${c.entity} @click=${() => actCtrl(c)}>Confirm unlock</button><button type="button" class="fp-car-btn" @click=${() => d.setConfirm(null)}>Cancel</button>`
        : html`<button type="button" class=${`fp-car-btn${c.on ? " on" : ""}`} data-car-ctrl=${c.entity} @click=${() => actCtrl(c)}>${c.domain === "lock" ? (c.on ? `Lock ${c.name}` : `Unlock ${c.name}`) : `${c.name}: ${c.on ? "On" : "Off"}`}</button>`)}
    </div>` : nothing}
  </div>`;
}
