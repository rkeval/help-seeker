// Browser side of the translations (needs core.js first). Used by the main page, verify.html and reset.html.
// Markup is translated with attributes, so forms are never rebuilt when the language changes (typed text stays):
//   data-i18n="key"              -> text content          data-i18n-placeholder / data-i18n-aria-label / data-i18n-title
//   data-max="100"               -> input limit counted in characters people see (grapheme clusters), not code units
// Code that builds text calls I18n.t(key, {named: params}); it never joins translated fragments into sentences.
(function () {
  "use strict";
  const core = window.HSI18n;
  let lang = core.DEFAULT_LANG, en = {}, messages = {}, translate = (k) => k;
  const listeners = [];

  const stored = () => { try { return core.normalizeChoice(localStorage.getItem(core.STORAGE_KEY)); } catch { return null; } };
  const remember = (code) => { try { localStorage.setItem(core.STORAGE_KEY, code); } catch { /* private mode etc.: just not remembered */ } };
  // First visit: the browser's preferred languages, in order; anything unsupported ends up English.
  const detect = () => core.negotiate(navigator.languages && navigator.languages.length ? Array.from(navigator.languages) : [navigator.language || ""]);

  const cache = {};
  async function load(code) {
    if (cache[code]) return cache[code];
    const res = await fetch(`/i18n/${code}.json`);
    if (!res.ok) throw new Error(`language file ${code} ${res.status}`);
    return (cache[code] = await res.json());
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = translate(el.dataset.i18n); });
    for (const [attr, prop] of [["placeholder", "placeholder"], ["aria-label", "aria-label"], ["title", "title"]]) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => el.setAttribute(prop, translate(el.getAttribute(`data-i18n-${attr}`))));
    }
    const title = document.querySelector("title[data-i18n]");
    if (title) document.title = translate(title.dataset.i18n);
  }

  async function setLang(code, { persist = false } = {}) {
    code = core.normalizeChoice(code) || core.DEFAULT_LANG;
    try {
      en = await load("en");
      messages = code === "en" ? en : await load(code);
    } catch (e) {
      console.warn("translations unavailable, showing English:", e.message); // network hiccup: stay usable in English
      code = "en"; messages = en;
    }
    lang = code;
    translate = core.createTranslator({ lang, messages, fallback: en });
    document.documentElement.lang = lang; // WCAG 3.1.1: the language of the page
    if (persist) remember(lang);
    apply();
    document.querySelectorAll("select.lang-select").forEach((s) => { s.value = lang; });
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
  }

  // The picker: autonyms (each language's own name), each option tagged with its own language so a screen reader pronounces it
  // properly (WCAG 3.1.2). The label text is translated; the control is a native <select>, so it is keyboard and touch friendly.
  function mountPicker(slot) {
    const label = document.createElement("label");
    label.className = "lang-pick";
    const span = document.createElement("span");
    span.dataset.i18n = "lang.label"; span.textContent = "Language";
    const sel = document.createElement("select");
    sel.className = "lang-select"; sel.id = "lang-select"; sel.name = "ui-language";
    for (const l of core.LANGS) {
      const o = document.createElement("option");
      o.value = l.code; o.lang = l.code; o.textContent = l.name;
      sel.append(o);
    }
    sel.value = lang;
    sel.addEventListener("change", () => setLang(sel.value, { persist: true }));
    label.append(span, sel);
    slot.append(label);
  }

  // Limits are in characters as people count them. An over-long paste is cut at a cluster boundary, never in the middle of one.
  document.addEventListener("input", (e) => {
    const el = e.target, max = Number(el && el.dataset && el.dataset.max);
    if (!max || e.isComposing || el.value.length <= max) return;
    const cut = core.truncateGraphemes(el.value, max);
    if (cut !== el.value) el.value = cut;
  });

  // The browser words its own "please fill in this field" bubbles in the browser's language, not the page's. Replace them
  // with ours so the message matches the language the person chose.
  document.addEventListener("invalid", (e) => {
    const el = e.target, v = el.validity;
    let key = null, params;
    if (v.valueMissing) key = "valid.required";
    else if (v.typeMismatch && el.type === "email") key = "valid.email";
    else if (v.patternMismatch) key = "valid.phone";
    else if (v.tooShort) { key = "valid.too_short"; params = { min: el.minLength }; }
    else if (v.rangeUnderflow || v.badInput || v.stepMismatch) key = "valid.number";
    if (key) el.setCustomValidity(translate(key, params));
  }, true);
  document.addEventListener("input", (e) => { if (e.target.setCustomValidity) e.target.setCustomValidity(""); });

  window.I18n = {
    init: async () => setLang(stored() || detect()),
    setLang, apply, mountPicker,
    t: (k, p) => translate(k, p),
    get lang() { return lang; },
    onChange: (fn) => listeners.push(fn),
    // Server error -> message in the current language. English keeps the server's own sentence (older and newer builds read the
    // same text); other languages use the code's translation and fall back to the server's English sentence if there is none.
    errorMessage(data, fallbackKey = "net.generic") {
      const code = data && data.code, own = data && data.error;
      if (lang !== "en" && code && messages["err." + code]) return translate("err." + code, data.params);
      return own || translate(fallbackKey);
    },
    rupees: (n) => core.formatRupees(lang, n),
    dateTime: (v) => core.formatDateTime(lang, v),
    // `lang="xx"` for user-written text in a script different from the screen language (WCAG 3.1.2); "" otherwise.
    langAttr: (text) => { const h = core.langHint(text, lang); return h ? ` lang="${h}"` : ""; },
    core,
  };
})();
