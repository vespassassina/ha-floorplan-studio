import { afterEach, describe, expect, it } from "vitest";
import { setCatalogue, t, tn } from "../../src/core/i18n";
import { useLanguage } from "../../src/card/i18n";
import { carText, type CarStatus } from "../../src/core/car-status";
import { layersSummary } from "../../src/core/layers";
import { popupOp } from "../../src/card/popup";

// S37 review fixes (docs/DECISIONS.md, 2026-10-25, "S37 review fixes"): one English word, one meaning per key; no translated
// word is lower-cased; every count goes through tn.

afterEach(async () => { setCatalogue(null); await useLanguage("en"); });

const home = { place: "home", charging: false, level: null, alert: false } as CarStatus;

describe("one key per meaning", () => {
  it("English reads as it did: the context after the bar is stripped", () => {
    expect(carText(home)).toBe("Home");
    expect(t("Area|size")).toBe("Area");
    expect(t("Home")).toBe("Home");
  });
  it("the car at home and the breadcrumb root are two keys: Polish says 'W domu' for the car, 'Dom' for the house", async () => {
    await useLanguage("pl");
    expect(carText(home)).toBe("W domu");
    expect(t("Home")).toBe("Dom");
  });
  it("Chinese: the car is 在家, the breadcrumb root is 家", async () => {
    await useLanguage("zh-Hans");
    expect(carText(home)).toBe("在家");
    expect(t("Home")).toBe("家");
  });
  it("the room's size is a surface, the HA area name is an area", async () => {
    await useLanguage("pl");
    expect(t("Area|size")).toBe("Powierzchnia");
    expect(t("Area")).toBe("Obszar");
    await useLanguage("de");
    expect(t("Area|size")).toBe("Fläche");
    expect(t("Area")).toBe("Bereich");
  });
  it("Polish 'Nothing on' means nothing is switched on, not that nothing works", async () => {
    await useLanguage("pl");
    expect(t("Nothing on")).toBe("Nic nie jest włączone");
  });
});

describe("a translated word is never lower-cased", () => {
  it("the layer in a sentence is the catalogue's own form (a German noun keeps its capital)", () => {
    setCatalogue({ "lights|layer": "Leuchten", "furniture|layer": "Möbel" });
    expect(layersSummary(["lights"])).toBe("Layers: Leuchten hidden");
    expect(layersSummary(["furniture"])).toBe("Layers: Möbel hidden");
  });
  it("English keeps the lower-case layer names", () => {
    expect(layersSummary(["computing"])).toBe("Layers: computers and network hidden");
  });
  it("a row's confirm text is a whole phrase from the catalogue", () => {
    setCatalogue({ "Confirm unlock": "Entsperren bestätigen", "Confirm open": "Öffnen bestätigen", "Confirm lock": "Sperren bestätigen" });
    expect(popupOp("lock", "lock.door", "locked")!.ask).toBe("Entsperren bestätigen");
    expect(popupOp("lock", "lock.door", "unlocked")!.ask).toBe("Sperren bestätigen");
    expect(popupOp("cover", "cover.blind", "closed")!.ask).toBe("Öffnen bestätigen");
  });
});

describe("counts are plural-aware", () => {
  /** The words around the number: the number is filled either way, so it must not count as a difference. */
  const words = (key: string, n: number) => tn(key, key, n).replace(String(n), "#");
  it("Polish chips change with the count", async () => {
    await useLanguage("pl");
    expect(words("{n} heating", 2)).not.toBe(words("{n} heating", 5));
    expect(words("{n} playing", 2)).not.toBe(words("{n} playing", 5));
    expect(words("{n} other", 2)).not.toBe(words("{n} other", 5));
  });
  it("French says masqué for one and masqués for more", async () => {
    await useLanguage("fr");
    expect(tn("Layers: {n} of {total} hidden", "Layers: {n} of {total} hidden", 1, { total: 11 })).toBe("Calques : 1 sur 11 masqué");
    expect(layersSummary(["lights", "climate"])).toContain("masqués");
  });
});

// S37 review re-check: every layer word is a plural noun, so the adjective that says hidden or shown is plural too. It sits
// before the colon, where it agrees with "layers" and not with a name it cannot know the gender of.
describe("the layer summary agrees with its plural noun", () => {
  const cases: [string, string, string][] = [
    ["fr", "Calques masqués : {layer}", "Calques affichés : seulement {layer}"],
    ["es", "Capas ocultas: {layer}", "Capas visibles: solo {layer}"],
    ["it", "Livelli nascosti: {layer}", "Livelli visibili: solo {layer}"],
    ["pt", "Camadas ocultas: {layer}", "Camadas visíveis: só {layer}"],
    ["pt-BR", "Camadas ocultas: {layer}", "Camadas visíveis: só {layer}"],
    ["pl", "Warstwy: ukryto {layer}", "Warstwy: widoczne tylko {layer}"],
  ];
  for (const [lang, hidden, only] of cases) {
    it(lang, async () => {
      await useLanguage(lang);
      expect(t("Layers: {layer} hidden", { layer: "{layer}" })).toBe(hidden);
      expect(t("Layers: only {layer} shown", { layer: "{layer}" })).toBe(only);
    });
  }
});
