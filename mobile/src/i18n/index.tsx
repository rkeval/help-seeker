import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import core, { type Translator } from "./core";
import { MESSAGES } from "./messages";

export { core };

const make = (lang: string): Translator => core.createTranslator({ lang, messages: MESSAGES[lang] ?? MESSAGES.en, fallback: MESSAGES.en });

// The current translator, also readable outside React (the network layer builds its error messages with it).
let current: Translator = make(core.DEFAULT_LANG);
export const tr = ((key: string, params?: Record<string, string | number>) => current(key, params)) as Translator;
Object.defineProperty(tr, "lang", { get: () => current.lang });

/** Server error -> message in the current language. English keeps the server's own sentence; other languages use the code's
 *  translation and fall back to the server's English sentence (then a generic message). */
export function errorMessage(data: { error?: string; code?: string; params?: Record<string, number> } | undefined, fallbackKey = "net.generic") {
  const code = data?.code;
  const key = code ? "err." + code : "";
  if (current.lang !== "en" && key && MESSAGES[current.lang]?.[key]) return current(key, data?.params);
  return data?.error || current(fallbackKey);
}

interface Ctx {
  lang: string;
  t: Translator;
  setLang: (code: string) => void;
  /** "service.Cleaning" -> localized name; unknown values (a service added on the server later) are shown as they are. */
  label: (prefix: "service." | "avail.", value: string) => string;
  rupees: (n: number) => string;
  dateTime: (v: string) => string;
}
const I18nContext = createContext<Ctx | null>(null);
export const useI18n = () => {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n outside I18nProvider");
  return c;
};

const deviceLanguage = () => {
  try { return core.negotiate(getLocales().map((l) => l.languageTag)); } catch { return core.DEFAULT_LANG; }
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string | null>(null);

  // First run: the phone's language list (unsupported -> English). Afterwards: whatever the person chose, remembered on the phone.
  useEffect(() => {
    (async () => {
      let chosen: string | null = null;
      try { chosen = core.normalizeChoice(await AsyncStorage.getItem(core.STORAGE_KEY)); } catch { /* storage unavailable */ }
      const code = chosen ?? deviceLanguage();
      current = make(code);
      setLangState(code);
    })();
  }, []);

  const setLang = useCallback((code: string) => {
    const next = core.normalizeChoice(code);
    if (!next) return;
    current = make(next);
    setLangState(next);
    AsyncStorage.setItem(core.STORAGE_KEY, next).catch(() => { /* not remembered; still applied */ });
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!lang) return null;
    const t = make(lang);
    return {
      lang, t, setLang,
      label: (prefix, v) => { const k = prefix + v; const x = t(k); return x === k ? v : x; },
      rupees: (n) => core.formatRupees(lang, n),
      dateTime: (v) => core.formatDateTime(lang, v),
    };
  }, [lang, setLang]);

  if (!value) return null; // a few milliseconds while the saved choice is read
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
