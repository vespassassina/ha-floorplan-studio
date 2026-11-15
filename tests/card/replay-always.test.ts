import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, Hass } from "../../src/card/floorplan-studio-card";
import { IDLE_MS, isReplaying, replayAlways, replayStates } from "../../src/card/card-replay";
import { openSubject } from "../../src/card/card-popup";
import { html, nothing, render } from "lit";
import { barView, type BarModel } from "../../src/card/replay/bar";
import { t, tn } from "../../src/core/i18n";

const L = demo as unknown as Layout;
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();

function mkConn(historyRows: Record<string, unknown[]> = {}) {
  const sent: { type: string; [k: string]: unknown }[] = [];
  const conn = {
    sent,
    sendMessagePromise: vi.fn(async (m: { type: string; entity_ids?: string[] }) => {
      sent.push(m);
      if (m.type === "history/history_during_period") {
        const out: Record<string, unknown[]> = {};
        for (const id of m.entity_ids ?? []) if (historyRows[id]) out[id] = historyRows[id];
        return out;
      }
      return {};
    }),
    subscribeEvents: vi.fn(async () => vi.fn()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return conn;
}

async function mountCard(config: Record<string, unknown>, conn = mkConn(), liveStates: Record<string, unknown> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground", theme: "light", active_list: false, ...config } as never);
  el.hass = { states: liveStates as Hass["states"], themes: { darkMode: false }, locale: { language: "en", time_format: "24" }, connection: conn } as unknown as Hass;
  for (let i = 0; i < 200; i++) {
    await el.updateComplete;
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    await new Promise((r) => (typeof setImmediate === "function" ? setImmediate(r) : Promise.resolve().then(r)));
    if (config.replay !== "always" || el.shadowRoot!.querySelector("input.fp-rp-range")) break;
  }
  return el;
}

describe("replayAlways and isReplaying (B56.1)", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

  it("replayAlways is true only for replay: 'always' with connection, layout, and non-kiosk", () => {
    const conn = mkConn();
    const base = { _kiosk: () => false, _layout: L, _hass: { connection: conn }, _config: { replay: "always" } } as unknown as FloorplanStudioCard;
    expect(replayAlways(base)).toBe(true);
    for (const bad of [undefined, null, false, true, "on", "off", "yes", 123, {}]) {
      expect(replayAlways({ ...base, _config: { replay: bad } } as unknown as FloorplanStudioCard)).toBe(false);
    }
    expect(replayAlways({ ...base, _kiosk: () => true } as unknown as FloorplanStudioCard)).toBe(false);
    expect(replayAlways({ ...base, _layout: null } as unknown as FloorplanStudioCard)).toBe(false);
    expect(replayAlways({ ...base, _hass: {} } as unknown as FloorplanStudioCard)).toBe(false);
  });

  it("isReplaying is false when replay is null or sitting idle at live, and true once moved into the past", () => {
    expect(isReplaying({ _replay: null } as unknown as FloorplanStudioCard)).toBe(false);
    expect(isReplaying({ _replay: { idle: true } } as unknown as FloorplanStudioCard)).toBe(false);
    expect(isReplaying({ _replay: { idle: false } } as unknown as FloorplanStudioCard)).toBe(true);
  });
});

describe("barView with always: true (B56.1)", () => {
  const base: BarModel = {
    shown: "12:00", value: 1440, max: 1440, hours: 24,
    ready: false, failed: false, playing: false, note: false, info: false, missing: 0,
    message: "", end: NOW, width: 1000, at: NOW,
  };
  const handlers = { key() {}, play() {}, seek() {}, info() {}, close() {}, jump() {}, jumpBy() {}, length() {} };
  const draw = (m: Partial<BarModel>) => {
    const host = document.createElement("div");
    render(barView({ html, nothing, t, tn, close: "M0,0" }, { ...base, ...m }, handlers), host);
    return host;
  };

  it("keeps the range slider enabled at idle and renders a Live button", () => {
    const h = draw({ always: true, idle: true });
    expect(h.querySelector<HTMLInputElement>("input.fp-rp-range")!.disabled).toBe(false);
    const btn = h.querySelector<HTMLButtonElement>("button.fp-rp-close")!;
    expect(btn.textContent!.trim()).toBe("Live");
    expect(btn.getAttribute("aria-label")).toBe("Live");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("ordinary Replay keeps the range disabled before history loads and renders Close replay", () => {
    const h = draw({ always: false, idle: false });
    expect(h.querySelector<HTMLInputElement>("input.fp-rp-range")!.disabled).toBe(true);
    const btn = h.querySelector<HTMLButtonElement>("button.fp-rp-close")!;
    expect(btn.getAttribute("aria-label")).toBe("Close replay");
  });
});

describe("replay: always card lifecycle (B56.1)", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

  const historyCalls = (conn: ReturnType<typeof mkConn>) => conn.sent.filter((m) => m.type === "history/history_during_period");

  it("shows the bar at live with no history fetch, fetches on seek back, returns on Live, and keeps non-'always' on the Replay button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    vi.setSystemTime(NOW);
    const s = (h: number, m = 0) => (NOW - ((12 - h) * 60 - m) * 60000) / 1000;
    const conn = mkConn({
      "light.demo_kitchen": [
        { s: "off", a: {}, lu: s(12) - 86400 },
        { s: "on", lu: s(9) },
        { s: "off", lu: s(10) },
      ],
    });
    const el = await mountCard({ replay: "always" }, conn, {
      "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date(NOW).toISOString() },
    });
    // Bar visible at now, idle: true, zero history calls
    const bar = el.shadowRoot!.querySelector(".fp-replay");
    expect(bar).not.toBeNull();
    expect(el._replay?.always).toBe(true);
    expect(el._replay?.idle).toBe(true);
    expect(historyCalls(conn)).toHaveLength(0);
    expect(el._replayGuard().replaying()).toBe(false);
    expect(el.shadowRoot!.querySelector<HTMLElement>(".fp-rp-msg")!.textContent).toBe("");

    // Live device popup opens even though bar is visible
    openSubject(el, { key: "x:0", entity: "light.demo_kitchen", entities: ["light.demo_kitchen"], name: "Kitchen", type: "light" }, { x: 10, y: 10 }, null);
    expect(el._popup?.s.entity).toBe("light.demo_kitchen");
    el._closePopup();

    // Drag/seek slider back to 09:30 -> triggers fetch and enters replay
    const range = el.shadowRoot!.querySelector<HTMLInputElement>("input.fp-rp-range")!;
    expect(range.disabled).toBe(false);
    range.value = String(21 * 60 + 30); // 12:00 yesterday + 21h30 = 09:30 today
    range.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;

    expect(historyCalls(conn).length).toBeGreaterThan(0);
    expect(el._replay?.idle).toBe(false);
    expect(el._replayGuard().replaying()).toBe(true);
    expect(replayStates(el)?.["light.demo_kitchen"]?.state).toBe("on");

    // During replay, tapping device shows "Replaying" note instead of opening popup
    openSubject(el, { key: "x:0", entity: "light.demo_kitchen", entities: ["light.demo_kitchen"], name: "Kitchen", type: "light" }, { x: 10, y: 10 }, null);
    expect(el._popup).toBeNull();
    expect(el._replay?.note).toBe(true);

    // Click Live button -> returns to live, bar stays, taps work again
    const liveBtn = el.shadowRoot!.querySelector<HTMLButtonElement>("button.fp-rp-close")!;
    expect(liveBtn.textContent!.trim()).toBe("Live");
    liveBtn.click();
    await el.updateComplete;
    expect(el._replay?.idle).toBe(true);
    expect(el._replayGuard().replaying()).toBe(false);
    expect(replayStates(el)).toBeUndefined();

    // Seek back again, touch at 4m50s, verify it does not expire yet, then wait 5m with no touch -> returns to live on its own
    range.value = String(21 * 60 + 30);
    range.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    expect(el._replay?.idle).toBe(false);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 10_000);
    expect(el._replay?.idle).toBe(false);
    // Touch resets 5-minute countdown
    range.value = String(21 * 60);
    range.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 10_000);
    expect(el._replay?.idle).toBe(false);

    await vi.advanceTimersByTimeAsync(11_000);
    await el.updateComplete;
    expect(el._replay?.idle).toBe(true);
    expect(el._replayGuard().replaying()).toBe(false);
  });

  it("keeps the Replay button for any replay value other than 'always'", async () => {
    const conn = mkConn();
    const el = await mountCard({ replay: "yes" }, conn);
    expect(el._replay).toBeNull();
    expect(el.shadowRoot!.querySelector("button.fp-rp-open")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".fp-replay")).toBeNull();
  });
});
