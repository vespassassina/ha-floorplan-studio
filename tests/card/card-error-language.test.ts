import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";
import { useLanguage } from "../../src/card/i18n";

// S38.6 (docs/PLAN.md): a stored error is translated when it is drawn, so a language change (a hass update, no new error) changes
// its words. Before, the card stored the translated text and the old language stayed on screen until the error was set again.
const hassOf = (language: string, connection?: unknown) => ({ states: {}, themes: { darkMode: false }, language, ...(connection ? { connection } : {}) }) as never;
const settle = async (el: FloorplanStudioCard) => { for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
const text = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector("p.msg")?.textContent ?? "(no message)";
async function mount(): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("S38.6 a stored error follows the language", () => {
  afterEach(async () => { document.body.innerHTML = ""; vi.restoreAllMocks(); await useLanguage("en"); });

  it("a layout the card rejects: English first, then German after a hass update with no new error", async () => {
    const layout = structuredClone(demo) as any;
    layout.floors.ground.rooms[0].pts[1] = [1.7e308, 0];
    const el = await mount();
    el.setConfig({ layout } as never);
    el.hass = hassOf("en");
    await settle(el);
    expect(text(el)).toMatch(/The plan could not be used: .*10000000 cm/);
    el.hass = hassOf("de");
    await settle(el);
    expect(text(el)).toContain("Der Plan ist nicht nutzbar:");
    expect(text(el)).not.toContain("The plan could not be used");
  });

  it("a failed websocket load follows the language, and a payload in the reason is letters, not markup (finding 2)", async () => {
    // Shape of HA's websocket error: { code, message } (home-assistant-js-websocket); the card's own tests (card-load.test.ts) use it too.
    const payload = '"><script>window.__pwned=1</script>';
    const conn = { sendMessagePromise: vi.fn(async () => { throw { code: "failed", message: payload }; }), subscribeEvents: vi.fn(async () => vi.fn()), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const el = await mount();
    el.setConfig({});
    el.hass = hassOf("en", conn);
    await settle(el);
    expect(text(el)).toContain(`Could not load the plan: ${payload}`);
    el.hass = hassOf("de", conn);
    await settle(el);
    expect(text(el)).toContain(`Der Plan konnte nicht geladen werden: ${payload}`);
    expect(el.shadowRoot!.querySelector("p.msg script")).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it("a layout error whose reason holds markup renders as letters in German", async () => {
    const layout = structuredClone(demo) as any;
    layout.floors = { '"><script>window.__pwned=1</script>': 5 };
    const el = await mount();
    el.setConfig({ layout } as never);
    el.hass = hassOf("en");
    await settle(el);
    el.hass = hassOf("de");
    await settle(el);
    expect(text(el)).toContain("Der Plan ist nicht nutzbar:");
    expect(el.shadowRoot!.querySelector("p.msg script")).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
});
