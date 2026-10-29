// Help Seeker internationalisation core. ONE file shared by the server (emails, language negotiation), the website
// (loaded with <script>) and the phone app (copied to mobile/src/i18n/ by `npm run i18n:sync`; a test fails if the copy drifts).
//
// Standards used (see README, "Languages"): BCP 47 / ISO 639 language codes, Accept-Language q-values and region/script
// fallback, CLDR plural rules via Intl.PluralRules, named message placeholders, Intl number/currency/date formatting with
// Latin digits, Unicode NFC for comparisons and grapheme-cluster counting for length limits.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HSI18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // `name` is the autonym (the language's own name in its own script, as CLDR lists it) so people can find their language
  // whatever language the screen is currently in. `script` is the ISO 15924 script their text is written in.
  const LANGS = [
    { code: "en", name: "English", script: "Latn" },
    { code: "hi", name: "हिन्दी", script: "Deva" },
    { code: "mr", name: "मराठी", script: "Deva" },
    { code: "bn", name: "বাংলা", script: "Beng" },
    { code: "ta", name: "தமிழ்", script: "Taml" },
    { code: "te", name: "తెలుగు", script: "Telu" },
    { code: "kn", name: "ಕನ್ನಡ", script: "Knda" },
    { code: "ml", name: "മലയാളം", script: "Mlym" },
    { code: "gu", name: "ગુજરાતી", script: "Gujr" },
    { code: "pa", name: "ਪੰਜਾਬੀ", script: "Guru" },
  ];
  const CODES = LANGS.map((l) => l.code);
  const DEFAULT_LANG = "en";
  const STORAGE_KEY = "hs-lang";

  // Only an exact, lower-case code from the allow-list is ever accepted as a stored/explicit choice.
  const normalizeChoice = (v) => (typeof v === "string" && CODES.includes(v) ? v : null);

  // ---------- language negotiation (RFC 9110 Accept-Language + BCP 47 fallback) ----------
  const TAG_RE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8}){0,6}$/;

  // "hi-IN,en;q=0.8,*;q=0.1" -> [{tag:"hi-IN", q:1}, {tag:"en", q:0.8}]; malformed parts are dropped, q=0 means "not acceptable".
  function parseAcceptLanguage(header) {
    if (typeof header !== "string" || header.length > 1000) return [];
    const out = [];
    header.split(",").slice(0, 30).forEach((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      if (!TAG_RE.test(tag.trim())) return;
      let q = 1;
      for (const p of params) {
        const m = /^\s*q\s*=\s*([01](?:\.\d{0,3})?)\s*$/i.exec(p);
        if (m) q = Number(m[1]); else return void (q = -1);
      }
      if (q > 0) out.push({ tag: tag.trim(), q, i });
    });
    return out.sort((a, b) => b.q - a.q || a.i - b.i).map(({ tag, q }) => ({ tag, q }));
  }

  // One BCP 47 tag -> a supported code, or null. Region is ignored (hi-IN -> hi). A script that contradicts the language
  // (hi-Latn = romanised Hindi, pa-Arab / pa-PK = Shahmukhi) is not served, because we only have the standard script.
  function matchTag(tag) {
    if (typeof tag !== "string" || !TAG_RE.test(tag)) return null;
    const parts = tag.toLowerCase().split("-");
    const lang = LANGS.find((l) => l.code === parts[0]);
    if (!lang) return null;
    const script = parts.slice(1).find((p) => /^[a-z]{4}$/.test(p));
    if (script && script !== lang.script.toLowerCase()) return null;
    if (lang.code === "pa" && parts.includes("pk")) return null;
    return lang.code;
  }

  // header string (Accept-Language) or array of tags (device locale list) -> supported code, default English.
  function negotiate(input) {
    const tags = Array.isArray(input) ? input : parseAcceptLanguage(input).map((x) => x.tag);
    for (const t of tags) {
      const m = matchTag(typeof t === "string" ? t : "");
      if (m) return m;
    }
    return DEFAULT_LANG;
  }

  // ---------- plural rules (CLDR) ----------
  // Intl.PluralRules is used where present. The table is the CLDR rule for integers for our ten languages, used when a
  // runtime has no PluralRules; a test proves both agree. Note Hindi, Bengali, Gujarati, Kannada and Punjabi treat 0 as "one".
  const FALLBACK_PLURAL = {
    en: (n) => (n === 1 ? "one" : "other"),
    hi: (n) => (n === 0 || n === 1 ? "one" : "other"),
    bn: (n) => (n === 0 || n === 1 ? "one" : "other"),
    gu: (n) => (n === 0 || n === 1 ? "one" : "other"),
    kn: (n) => (n === 0 || n === 1 ? "one" : "other"),
    pa: (n) => (n === 0 || n === 1 ? "one" : "other"),
    mr: (n) => (n === 1 ? "one" : "other"),
    ta: (n) => (n === 1 ? "one" : "other"),
    te: (n) => (n === 1 ? "one" : "other"),
    ml: (n) => (n === 1 ? "one" : "other"),
  };
  const ruleCache = {};
  function pluralCategory(lang, n, { forceFallback = false } = {}) {
    if (!forceFallback && typeof Intl !== "undefined" && Intl.PluralRules) {
      try { return (ruleCache[lang] = ruleCache[lang] || new Intl.PluralRules(lang)).select(n); } catch { /* use table */ }
    }
    return (FALLBACK_PLURAL[lang] || FALLBACK_PLURAL.en)(Number(n));
  }

  // ---------- message formatting ----------
  // A message is a string with named {placeholders}, or an object of CLDR plural forms {one, other, ...} chosen by params.n.
  // Placeholders are replaced in ONE pass, so a value that itself contains "{x}" (a name, a chat message) is never expanded.
  // Sentences are never built from translated fragments: word order is each translation's own business.
  function interpolate(template, params, lang) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => {
      if (!params || !Object.prototype.hasOwnProperty.call(params, k)) return m;
      const v = params[k];
      return typeof v === "number" ? formatNumber(lang, v) : String(v);
    });
  }

  function createTranslator({ lang, messages, fallback }) {
    const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined); // "__proto__" is not a message
    const t = (key, params) => {
      let msg = own(messages, key);
      if (msg === undefined) msg = own(fallback, key);
      if (msg === undefined) return key;
      if (typeof msg === "object" && msg !== null) {
        const cat = pluralCategory(lang, Number(params && params.n));
        msg = msg[cat] !== undefined ? msg[cat] : msg.other;
      }
      return interpolate(msg, params, lang);
    };
    t.lang = lang;
    return t;
  }

  // ---------- numbers, money, dates (Intl, Latin digits by default) ----------
  // Locale "<lang>-IN-u-nu-latn": Indian region conventions (lakh/crore grouping, ₹) with Western digits 0-9. Several of our
  // languages would otherwise default to native digits (Bengali, Marathi...); we keep 0-9 because rates, phone numbers and
  // dates are read together with numbers typed on a keyboard and shown by banks and UPI apps in 0-9.
  const localeFor = (lang) => `${CODES.includes(lang) ? lang : DEFAULT_LANG}-IN-u-nu-latn`;
  // Numbers and rupees always use the Indian English pattern: for Marathi, Bengali and others the "Latin digits" variant of their
  // own locale falls back to Western grouping (150,000), whereas Indian readers expect lakh grouping (1,50,000). The sign is
  // placed before the amount in every Indian language.
  const NUMBER_LOCALE = "en-IN-u-nu-latn";
  function formatNumber(lang, n) {
    try { return new Intl.NumberFormat(NUMBER_LOCALE).format(n); } catch { return String(n); }
  }
  function formatRupees(lang, n) {
    try {
      return new Intl.NumberFormat(NUMBER_LOCALE, { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    } catch { return "₹" + n; }
  }
  function formatDateTime(lang, value, opts) {
    const d = new Date(value);
    if (isNaN(d)) return "";
    try { return new Intl.DateTimeFormat(localeFor(lang), opts || { dateStyle: "medium", timeStyle: "short" }).format(d); }
    catch { return d.toLocaleString(); }
  }
  // For lists the client sorts by a name (none today; the server orders results): locale-aware, accent/case-insensitive.
  function collator(lang) {
    try { return new Intl.Collator(localeFor(lang), { sensitivity: "base", numeric: true }); }
    catch { return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }; }
  }

  // ---------- Unicode text helpers ----------
  const nfc = (s) => { const x = String(s ?? ""); try { return x.normalize("NFC"); } catch { return x; } };

  // Virama (halant) of the scripts whose conjuncts Unicode's grapheme rules (UAX #29, rule GB9c) keep together: Devanagari, Bengali,
// Gujarati, Oriya, Telugu, Malayalam. Gurmukhi, Tamil and Kannada are not in that rule, so Intl.Segmenter splits there too.
const VIRAMAS = new Set([0x94d, 0x9cd, 0xacd, 0xb4d, 0xc4d, 0xd4d]);
  let markRe;
  try { markRe = new RegExp("^[\\p{M}\\u200C\\u200D\\uFE00-\\uFE0F]$", "u"); } catch { markRe = null; }
  // Grapheme clusters ("user-perceived characters"): क्ष, ਪੰ, ക്ഷ are ONE each though they are several code points.
  function graphemes(s, { forceFallback = false } = {}) {
    s = String(s ?? "");
    if (!forceFallback && typeof Intl !== "undefined" && Intl.Segmenter) {
      try { return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (x) => x.segment); } catch { /* fall back */ }
    }
    const out = [];
    let prev = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (out.length && ((markRe && markRe.test(ch)) || VIRAMAS.has(prev) || (ch === "\n" && prev === 13))) out[out.length - 1] += ch;
      else out.push(ch);
      prev = cp;
    }
    return out;
  }
  const countGraphemes = (s) => graphemes(s).length;
  // Cuts to at most `max` characters WITHOUT splitting a cluster (never leaves a dangling vowel sign or virama).
  function truncateGraphemes(s, max) {
    s = String(s ?? "");
    if (s.length <= max) return s; // a cluster is at least one code unit, so this is always within the limit
    const g = graphemes(s);
    return g.length <= max ? s : g.slice(0, max).join("");
  }

  // Which language is this user-written text in? Only when the script says so unambiguously and it differs from the screen
  // language, so assistive technology can switch voice (WCAG 3.1.2). Latin text is not guessed (English? romanised Hindi?).
  const SCRIPT_TESTS = [["Deva", /[ऀ-ॿ]/g], ["Beng", /[ঀ-৿]/g], ["Guru", /[਀-੿]/g], ["Gujr", /[઀-૿]/g],
    ["Taml", /[஀-௿]/g], ["Telu", /[ఀ-౿]/g], ["Knda", /[ಀ-೿]/g], ["Mlym", /[ഀ-ൿ]/g]];
  function langHint(text, uiLang) {
    let best = null, bestN = 0;
    for (const [script, re] of SCRIPT_TESTS) {
      const n = (String(text ?? "").match(re) || []).length;
      if (n > bestN) { best = script; bestN = n; }
    }
    if (!best) return null;
    const ui = LANGS.find((l) => l.code === uiLang);
    if (ui && ui.script === best) return null;
    const l = LANGS.find((x) => x.script === best);
    return l ? l.code : null; // Devanagari -> hi (Marathi text is flagged hi: close enough for choosing a voice)
  }

  return {
    LANGS, CODES, DEFAULT_LANG, STORAGE_KEY, normalizeChoice,
    parseAcceptLanguage, matchTag, negotiate,
    pluralCategory, FALLBACK_PLURAL, interpolate, createTranslator,
    localeFor, formatNumber, formatRupees, formatDateTime, collator,
    nfc, graphemes, countGraphemes, truncateGraphemes, langHint,
  };
});
