import { afterEach, describe, expect, it } from "vitest";
import { setCatalogue, t, tn } from "../../src/core/i18n";
import { LANGUAGES, currentLanguage, resolveLanguage, useLanguage } from "../../src/card/i18n";

// S37.5 (docs/DECISIONS.md, 2026-10-25): which language file `hass.language` picks, and how a text is looked up and filled.
// The codes in `resolveLanguage`'s cases are Home Assistant's own, from home-assistant/frontend `translationMetadata.json`
// (`pt-BR`, `zh-Hans`, `zh-Hant`, `es-419` are listed there) and `src/util/common-translation.ts` (the `zh-*` aliases).

afterEach(async () => { await useLanguage("en"); });

describe("resolveLanguage: exact code, then base, else English", () => {
  it.each([
    ["it", "it"], ["es", "es"], ["fr", "fr"], ["de", "de"], ["nl", "nl"], ["pl", "pl"], ["pt", "pt"],
    ["pt-BR", "pt-BR"], ["zh-Hans", "zh-Hans"],
  ])("%s is its own file (%s)", (code, file) => expect(resolveLanguage(code)).toBe(file));

  it("the exact code beats the base: pt-BR is not pt", () => expect(resolveLanguage("pt-BR")).toBe("pt-BR"));
  it("a regional code falls to its base: pt-PT is pt, es-419 is es, de-AT is de, fr-CA is fr", () => {
    expect(resolveLanguage("pt-PT")).toBe("pt");
    expect(resolveLanguage("es-419")).toBe("es");
    expect(resolveLanguage("de-AT")).toBe("de");
    expect(resolveLanguage("fr-CA")).toBe("fr");
  });
  it("case and underscores are forgiven: pt_br, ZH-HANS, IT", () => {
    expect(resolveLanguage("pt_br")).toBe("pt-BR");
    expect(resolveLanguage("ZH-HANS")).toBe("zh-Hans");
    expect(resolveLanguage("IT")).toBe("it");
  });
  it("HA's own spellings of Simplified Chinese are Simplified: zh-cn, zh-SG, zh-MY", () => {
    for (const c of ["zh-cn", "zh-CN", "zh-SG", "zh-my"]) expect(resolveLanguage(c), c).toBe("zh-Hans");
  });
  it("zh-Hant, and the Chinese HA calls Traditional, are English for now, not Simplified", () => {
    for (const c of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "zh"]) expect(resolveLanguage(c), c).toBeNull();
  });
  it("English, a language with no file, and junk are English", () => {
    for (const c of ["en", "en-GB", "ru", "ja", "nb", "", "  ", undefined, null, 5, {}, "-"]) expect(resolveLanguage(c), String(c)).toBeNull();
  });
  it("every language file named in LANGUAGES resolves to itself", () => {
    for (const k of Object.keys(LANGUAGES)) expect(resolveLanguage(k)).toBe(k);
  });
});

describe("t and tn", () => {
  it("English is the key itself, placeholders filled, with no catalogue", () => {
    expect(t("Cancel")).toBe("Cancel");
    expect(t("Open {name}?", { name: "Garage" })).toBe("Open Garage?");
    expect(tn("{n} alert", "{n} alerts", 1)).toBe("1 alert");
    expect(tn("{n} alert", "{n} alerts", 0)).toBe("0 alerts");
    expect(tn("{n} alert", "{n} alerts", 5)).toBe("5 alerts");
  });
  it("a catalogue answers by the English key; a key it lacks stays English", () => {
    setCatalogue({ Cancel: "Annulla" }, "it");
    expect(t("Cancel")).toBe("Annulla");
    expect(t("Back")).toBe("Back");
  });
  it("a placeholder survives the translation and is filled once: a value holding {x} is not expanded", () => {
    setCatalogue({ "Open {name}?": "Aprire {name}?" }, "it");
    expect(t("Open {name}?", { name: "{name} {n}" })).toBe("Aprire {name} {n}?");
    expect(t("Open {name}?")).toBe("Aprire {name}?"); // no value: the placeholder stays as written
  });
  it("a name that is not own data of the catalogue is not looked up (__proto__, constructor)", () => {
    setCatalogue({}, "it");
    expect(t("__proto__")).toBe("__proto__");
    expect(t("constructor")).toBe("constructor");
    expect(tn("toString", "toStrings", 2)).toBe("toStrings");
  });
  it("plural forms follow the language's own rules: Polish has one, few, many", () => {
    setCatalogue({ "{n} alert": { one: "{n} alert-pl-one", few: "{n} alert-pl-few", many: "{n} alert-pl-many", other: "{n} alert-pl-other" } }, "pl");
    const word = (n: number) => tn("{n} alert", "{n} alerts", n).replace(/^\d+ /, "");
    expect([1, 2, 5, 12, 22, 25].map(word)).toEqual(["alert-pl-one", "alert-pl-few", "alert-pl-many", "alert-pl-many", "alert-pl-few", "alert-pl-many"]);
    expect(tn("{n} alert", "{n} alerts", 22)).toBe("22 alert-pl-few");
  });
  it("French counts 0 and 1 as one; Chinese has one form (a plain string)", () => {
    setCatalogue({ "{n} alert": { one: "{n} alerte", other: "{n} alertes" } }, "fr");
    expect([0, 1, 2].map((n) => tn("{n} alert", "{n} alerts", n))).toEqual(["0 alerte", "1 alerte", "2 alertes"]);
    setCatalogue({ "{n} alert": "{n} 个警报" }, "zh-Hans");
    expect(tn("{n} alert", "{n} alerts", 7)).toBe("7 个警报");
  });
  it("a plural entry with no text for the category falls to other, then to English", () => {
    setCatalogue({ "{n} alert": { other: "{n} X" } }, "fr");
    expect(tn("{n} alert", "{n} alerts", 1)).toBe("1 X");
    setCatalogue({ "{n} alert": {} }, "fr");
    expect(tn("{n} alert", "{n} alerts", 3)).toBe("3 alerts");
  });
});

describe("a context after a bar tells two meanings of one English word apart", () => {
  it("English reads the word without the context", () => {
    expect(t("Light|theme")).toBe("Light");
    expect(t("Open|openings")).toBe("Open");
  });
  it("a catalogue keys the whole text: the theme and the device get their own words", () => {
    setCatalogue({ "Light|theme": "Chiaro", Light: "Luce" }, "it");
    expect(t("Light|theme")).toBe("Chiaro");
    expect(t("Light")).toBe("Luce");
  });
  it("a context in a key the catalogue lacks never shows", () => {
    setCatalogue({ Other: "Altro" }, "it");
    expect(t("Open|openings")).toBe("Open");
  });
});

describe("useLanguage", () => {
  it("loads a language file and switches the words, and English switches back at once", async () => {
    expect(t("Cancel")).toBe("Cancel");
    expect(await useLanguage("de")).toBe(true);
    expect(currentLanguage()).toBe("de");
    expect(t("Cancel")).not.toBe("Cancel");
    expect(await useLanguage("de")).toBe(false); // already there
    await useLanguage("en-GB");
    expect(currentLanguage()).toBeNull();
    expect(t("Cancel")).toBe("Cancel");
  });
  it("asking for another language while one loads: the last ask wins", async () => {
    const first = useLanguage("it"), second = useLanguage("fr");
    await Promise.all([first, second]);
    expect(currentLanguage()).toBe("fr");
  });
  it("back to English while a language loads: English wins", async () => {
    const p = useLanguage("it");
    await useLanguage("en");
    await p;
    expect(currentLanguage()).toBeNull();
    expect(t("Cancel")).toBe("Cancel");
  });
  it("a language that fails to load leaves the words as they are and may be asked for again", async () => {
    const real = LANGUAGES.nl!;
    let calls = 0;
    LANGUAGES.nl = () => { calls++; return Promise.reject(new Error("offline")); };
    try {
      expect(await useLanguage("nl")).toBe(false);
      expect(currentLanguage()).toBeNull();
      expect(await useLanguage("nl")).toBe(false);
      expect(calls).toBe(2);
    } finally { LANGUAGES.nl = real; }
    expect(await useLanguage("nl")).toBe(true);
  });
});
