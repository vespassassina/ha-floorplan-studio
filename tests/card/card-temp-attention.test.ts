import { afterEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";
import { useLanguage } from "../../src/card/i18n";

// S42.3 (docs/specs/temp-range.md, decision 12): the Overview lists a room that warns, "Kitchen 27.4 °C, above 26". The card's
// `_tempWarn` is what S42.4 will fill from the onset memory; here it is set by hand. The row's tap is in card-temp-attention.spec.ts.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-31T09:30:15Z" });
const settle = async (el: FloorplanStudioCard) => { for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };

async function mount(roomName: string, language: string, warn: Record<string, "hot" | "cold">) {
  await useLanguage(language); // the catalogue is a lazy chunk: load it before the first draw
  const layout = structuredClone(demo) as any;
  layout.tempRange = { min: 17, max: 26 };
  Object.assign(layout.floors.ground.rooms[1], { name: roomName, temps: ["sensor.k"] }); // room-ground-2
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout, floor: "ground" } as never);
  el._tempWarn = warn;
  el.hass = { states: { "sensor.k": st("27.4", { unit_of_measurement: "°C" }) }, themes: { darkMode: false }, language } as never;
  await settle(el);
  return el;
}
const rows = (el: FloorplanStudioCard) => [...el.shadowRoot!.querySelectorAll(".fp-ov-attn .fp-active-row")].map((r) => ({ name: r.querySelector(".fp-ov-name")!.textContent, state: r.querySelector(".fp-row-state")!.textContent!.trim() }));

describe("S42.3 the Overview lists a room that is out of range", () => {
  afterEach(async () => { document.body.innerHTML = ""; await useLanguage("en"); });

  it("English: the room's name, then its reading and the bound", async () => {
    const el = await mount("Kitchen", "en", { "room-ground-2": "hot" });
    expect(rows(el)).toEqual([{ name: "Kitchen", state: "27.4 °C, above 26" }]);
  });

  it("German: the same row in German words", async () => {
    const el = await mount("Küche", "de", { "room-ground-2": "hot" });
    expect(rows(el)).toEqual([{ name: "Küche", state: "27.4 °C, über 26" }]);
  });

  it("without a warning the room is not listed", async () => {
    const el = await mount("Kitchen", "en", {});
    expect(rows(el).filter((r) => r.name === "Kitchen")).toEqual([]);
  });

  it("a room name is text, never markup (finding 2)", async () => {
    const name = '"><script>window.__pwned=1</script>';
    const el = await mount(name, "en", { "room-ground-2": "hot" });
    expect(rows(el)[0]!.name).toBe(name);
    expect(el.shadowRoot!.querySelector(".fp-ov-attn script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
