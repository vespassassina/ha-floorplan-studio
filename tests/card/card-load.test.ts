import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";

// The card is built as "dev"; a stale-page test needs a real version to differ from.
vi.mock("../../src/card/version", () => ({ CARD_VERSION: "0.30.0" }));
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
// What websocket.py sends: load answers { layout }, an error is { code, message } (HA's websocket error shape).
const reply = (layout: unknown) => ({ layout });
const NOT_LOADED = { code: "not_loaded", message: "Floorplan Studio is not set up. Add it under Settings, Devices & services." };

type Conn = {
  sendMessagePromise: ReturnType<typeof vi.fn>;
  subscribeEvents: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
function conn(send: (m: { type: string }) => unknown): Conn {
  return {
    sendMessagePromise: vi.fn(async (m) => send(m)),
    subscribeEvents: vi.fn(async () => vi.fn()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}
const hassOf = (c: Conn, extra: Record<string, unknown> = {}) => ({ states: {}, themes: { darkMode: false }, connection: c, ...extra }) as never;
const loads = (c: Conn) => c.sendMessagePromise.mock.calls.filter(([m]) => m.type === "floorplan_studio/load");
async function mount(): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
const settle = async (el: FloorplanStudioCard) => { for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
const text = (el: FloorplanStudioCard) => el.shadowRoot!.textContent ?? "";

describe("card load from the websocket", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("a failed load shows the backend's own message, not the install hint", async () => {
    const c = conn((m) => (m.type === "floorplan_studio/load" ? Promise.reject(NOT_LOADED) : undefined));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(text(el)).toContain("Floorplan Studio is not set up. Add it under Settings, Devices & services.");
    expect(text(el)).not.toContain("install the Floorplan Studio integration");
  });

  it("an unknown command (no integration) keeps the install hint", async () => {
    const c = conn(() => Promise.reject({ code: "unknown_command", message: "Unknown command." }));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(text(el)).toContain("install the Floorplan Studio integration or set layout_url");
  });

  it("nothing saved yet says so and links to the Studio: the click navigates the HA way", async () => {
    const c = conn(() => reply(null));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c, { user: { is_admin: true } });
    await settle(el);
    expect(text(el)).toContain("No plan saved yet. Open Floorplan Studio in the sidebar to draw one.");
    const seen: string[] = [];
    const onLoc = () => seen.push(location.pathname);
    window.addEventListener("location-changed", onLoc);
    el.shadowRoot!.querySelector<HTMLAnchorElement>("a.fp-studio-link")!.click();
    window.removeEventListener("location-changed", onLoc);
    expect(seen).toEqual(["/floorplan-studio"]);
    history.pushState(null, "", "/");
  });

  it("a user who is not an admin sees the message without the link (the sidebar entry is admin only)", async () => {
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(conn(() => reply(null)), { user: { is_admin: false } });
    await settle(el);
    expect(text(el)).toContain("No plan saved yet");
    expect(el.shadowRoot!.querySelector("a.fp-studio-link")).toBeNull();
  });

  it("retries once on the next hass set after a failure, and then stops", async () => {
    let n = 0;
    const c = conn(() => (++n === 1 ? Promise.reject(NOT_LOADED) : n === 2 ? Promise.reject(NOT_LOADED) : reply(structuredClone(L))));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(loads(c)).toHaveLength(1);
    el.hass = hassOf(c); // HA sets hass on every state change
    await settle(el);
    expect(loads(c)).toHaveLength(2); // the one retry, which failed again
    for (let i = 0; i < 3; i++) { el.hass = hassOf(c); await settle(el); }
    expect(loads(c)).toHaveLength(2); // bounded: no loop
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
  });

  it("loads again when the connection is ready again, and then draws the plan", async () => {
    let n = 0;
    const c = conn(() => (++n === 1 ? Promise.reject({ code: 3, message: "Connection lost" }) : reply(structuredClone(L))));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    const ready = c.addEventListener.mock.calls.find(([name]) => name === "ready");
    expect(ready).toBeDefined();
    ready![1]();
    await settle(el);
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
    expect(c.removeEventListener).not.toHaveBeenCalled();
    el.remove();
    expect(c.removeEventListener).toHaveBeenCalledWith("ready", ready![1]); // not left behind on a removed card
  });

  it("a layout that fails validation on a page older than the server says to reload", async () => {
    const c = conn((m) => (m.type === "floorplan_studio/version" ? { version: "0.31.0" } : reply({ version: 2, north: "north", floors: {} })));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(text(el)).toContain("Floorplan Studio was updated. Reload this page.");
    expect(text(el)).not.toContain("north must be a number");
  });

  it("the same version keeps the plain reason", async () => {
    const c = conn((m) => (m.type === "floorplan_studio/version" ? { version: "0.30.0" } : reply({ version: 2, north: "north", floors: {} })));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(text(el)).toContain("north must be a number");
    expect(text(el)).not.toContain("Reload this page");
  });

  it("a version check that fails leaves the plain reason", async () => {
    const c = conn((m) => (m.type === "floorplan_studio/version" ? Promise.reject({ code: "unknown_command" }) : reply({ version: 2, north: "north", floors: {} })));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(text(el)).toContain("north must be a number");
  });
});

describe("card load is shared", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("cards on one connection share one load, each with a layout of its own", async () => {
    const c = conn(() => reply(structuredClone(L)));
    const a = await mount(), b = await mount();
    a.setConfig({}); b.setConfig({});
    const h = hassOf(c);
    a.hass = h; b.hass = h;
    await settle(a); await settle(b);
    expect(loads(c)).toHaveLength(1);
    expect(a.shadowRoot!.querySelector("svg")).not.toBeNull();
    expect(b.shadowRoot!.querySelector("svg")).not.toBeNull();
    expect((a as unknown as { _layout: unknown })._layout).not.toBe((b as unknown as { _layout: unknown })._layout);
  });

  it("a config change that keeps the source does not load again or lose the plan", async () => {
    const c = conn(() => reply(structuredClone(L)));
    const el = await mount();
    el.setConfig({ theme: "light" });
    el.hass = hassOf(c);
    await settle(el);
    el.setConfig({ theme: "slate" });
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull(); // no blank frame while a reload would run
    await settle(el);
    el.hass = hassOf(c);
    await settle(el);
    expect(loads(c)).toHaveLength(1);
  });

  it("a config change of the source loads afresh", async () => {
    const c = conn(() => reply(structuredClone(L)));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    el.setConfig({ layout: structuredClone(L), theme: "light" });
    await settle(el);
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="light"');
  });
});

describe("card follows a Studio save", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("subscribes to floorplan_studio_updated, reloads on the event, and unsubscribes when removed", async () => {
    const titles = ["Before", "After"];
    let n = 0;
    const c = conn(() => { const l = structuredClone(L); l.floors[Object.keys(l.floors)[0]!]!.title = titles[Math.min(n++, 1)]!; return reply(l); });
    const unsub = vi.fn();
    let onEvent: () => void = () => undefined;
    c.subscribeEvents.mockImplementation(async (cb: () => void) => { onEvent = cb; return unsub; });
    const el = await mount();
    el.setConfig({ floor: Object.keys(L.floors)[0]! });
    el.hass = hassOf(c);
    await settle(el);
    expect(c.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(c.subscribeEvents.mock.calls[0]![1]).toBe("floorplan_studio_updated");
    expect(el.shadowRoot!.innerHTML).toContain("Before");
    onEvent();
    await settle(el);
    expect(loads(c)).toHaveLength(2);
    expect(el.shadowRoot!.innerHTML).toContain("After");
    el.remove();
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("a card with its own layout does not subscribe", async () => {
    const c = conn(() => reply(null));
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = hassOf(c);
    await settle(el);
    expect(c.subscribeEvents).not.toHaveBeenCalled();
  });

  it("a user who may not subscribe (HA allows custom events to admins only) keeps a working card", async () => {
    const c = conn(() => reply(structuredClone(L)));
    c.subscribeEvents.mockRejectedValue({ code: "unauthorized", message: "Unauthorized" });
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
  });

  it("an unsubscribe that arrives after the card was removed still runs", async () => {
    const c = conn(() => reply(structuredClone(L)));
    const unsub = vi.fn();
    let resolve: (f: () => void) => void = () => undefined;
    c.subscribeEvents.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    el.remove();
    resolve(unsub);
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe("card follows a save through floorplan_studio/subscribe", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  // Shapes copied from custom_components/floorplan_studio/websocket.py `ws_subscribe`: the command is answered with a bare
  // result, then each save pushes an event whose payload is `{ rev }` (the JS library hands `msg.event` to the callback).
  // An older integration answers with HA's own error `{ code: "unknown_command", message: "Unknown command." }`.
  type SubConn = Conn & { subscribeMessage: ReturnType<typeof vi.fn> };
  function subConn(): { c: SubConn; push: (rev: number) => void; unsub: ReturnType<typeof vi.fn> } {
    const c = conn(() => reply(structuredClone(L))) as SubConn;
    let cb: (e: { rev: number }) => void = () => undefined;
    const unsub = vi.fn(() => { cb = () => undefined; }); // a real unsubscribe stops delivery
    c.subscribeMessage = vi.fn(async (f: (e: { rev: number }) => void) => { cb = f; return unsub; });
    return { c, push: (rev) => cb({ rev }), unsub };
  }

  it("one event is one reload, a hass update adds no second subscription, removal unsubscribes", async () => {
    const { c, push, unsub } = subConn();
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(c.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(c.subscribeMessage.mock.calls[0]![1]).toEqual({ type: "floorplan_studio/subscribe" });
    expect(c.subscribeEvents).not.toHaveBeenCalled();
    expect(loads(c)).toHaveLength(1);
    el.hass = hassOf(c, { states: { "light.a": {} } });
    el.hass = hassOf(c, { states: { "light.b": {} } });
    await settle(el);
    expect(c.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(loads(c)).toHaveLength(1);
    push(7);
    await settle(el);
    expect(loads(c)).toHaveLength(2);
    el.remove();
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
    push(8);
    await settle(el);
    expect(loads(c)).toHaveLength(2);
  });

  it("reconnecting the element subscribes again, once", async () => {
    const { c, unsub } = subConn();
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    el.remove();
    await settle(el);
    document.body.appendChild(el);
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(c.subscribeMessage).toHaveBeenCalledTimes(2);
  });

  it("an older integration (unknown_command) falls back to the bus event, and that still reloads", async () => {
    const { c } = subConn();
    c.subscribeMessage.mockRejectedValue({ code: "unknown_command", message: "Unknown command." });
    const unsub = vi.fn();
    let onEvent: () => void = () => undefined;
    c.subscribeEvents.mockImplementation(async (cb: () => void) => { onEvent = cb; return unsub; });
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(c.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(c.subscribeEvents.mock.calls[0]![1]).toBe("floorplan_studio_updated");
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
    onEvent();
    await settle(el);
    expect(loads(c)).toHaveLength(2);
    el.remove();
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("any other subscribe error keeps a working card and does not fall back", async () => {
    const { c } = subConn();
    c.subscribeMessage.mockRejectedValue({ code: "unauthorized", message: "Unauthorized" });
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf(c);
    await settle(el);
    expect(c.subscribeEvents).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
  });
});
