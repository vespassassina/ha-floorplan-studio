import { afterEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";
import { useLanguage } from "../../src/card/i18n";

// S38.8 (docs/PLAN.md): the device <title> names its type in the card's language. The Studio passes no `tr` and stays English.
// Real card, real catalogue (finding 21: the German words come from src/card/i18n/de.ts, not from a stub).
const PAYLOAD = '"><script>window.__pwned=1</script>';
const hassOf = (language: string) => ({ states: {}, themes: { darkMode: false }, language }) as never;
const settle = async (el: FloorplanStudioCard) => { for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
const titles = (el: FloorplanStudioCard) => [...el.shadowRoot!.querySelectorAll("svg g[data-x] > title")].map((n) => n.textContent ?? "");
async function mount(language: string): Promise<FloorplanStudioCard> {
  const layout = structuredClone(demo) as any;
  const light = layout.floors.ground.devices.find((d: any) => d.type === "light");
  light.name = PAYLOAD;
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout, floor: "ground" } as never);
  el.hass = hassOf(language);
  await settle(el);
  return el;
}

describe("S38.8 device titles follow the language", () => {
  afterEach(async () => { document.body.innerHTML = ""; vi.restoreAllMocks(); await useLanguage("en"); });

  it("German: the type reads the German word (Licht), not the English id", async () => {
    const el = await mount("de");
    const all = titles(el);
    expect(all.some((t) => t.startsWith("Licht: ")), JSON.stringify(all)).toBe(true);
    expect(all.some((t) => t.startsWith("light: "))).toBe(false);
  });

  it("English: the title reads as it always did (the type id)", async () => {
    const el = await mount("en");
    expect(titles(el).some((t) => t.startsWith("light: "))).toBe(true);
  });

  it("a name that holds markup stays letters in the title, in English and in German (finding 2)", async () => {
    for (const lang of ["en", "de"]) {
      const el = await mount(lang);
      expect(titles(el).some((t) => t.includes(PAYLOAD)), lang).toBe(true);
      expect(el.shadowRoot!.querySelector("svg script"), lang).toBeNull();
      expect((window as any).__pwned).toBeUndefined();
      document.body.innerHTML = "";
    }
  });
});
