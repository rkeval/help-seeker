const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../public/i18n/core.js");
const { SERVICES, AVAIL, ERROR_CODES } = require("../server/app");
const { createMailer } = require("../server/mail");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "public", "i18n");
const read = (f) => fs.readFileSync(f, "utf8");
const LANGS = core.CODES;
const OTHERS = LANGS.filter((l) => l !== "en");
const M = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(path.join(DIR, `${l}.json`)))]));
const SCRIPT = { hi: "Devanagari", mr: "Devanagari", bn: "Bengali", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", gu: "Gujarati", pa: "Gurmukhi" };
const forms = (v) => (typeof v === "object" ? Object.values(v) : [v]);
const placeholders = (v) => forms(v).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// Strings that legitimately look the same in every language (brand name, symbols).
const SAME_OK = new Set(["app.name"]);

test("the supported languages are exactly the ten we promise, named in their own script", () => {
  assert.deepEqual(core.CODES, ["en", "hi", "mr", "bn", "ta", "te", "kn", "ml", "gu", "pa"]);
  assert.deepEqual(Object.fromEntries(core.LANGS.map((l) => [l.code, l.name])), {
    en: "English", hi: "हिन्दी", mr: "मराठी", bn: "বাংলা", ta: "தமிழ்", te: "తెలుగు", kn: "ಕನ್ನಡ", ml: "മലയാളം", gu: "ગુજરાતી", pa: "ਪੰਜਾਬੀ",
  });
  assert.deepEqual(fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort(), LANGS.map((l) => `${l}.json`).sort());
});

for (const lang of OTHERS) {
  test(`${lang}: same keys as English, same {placeholders}, complete plural forms`, () => {
    const en = M.en, tr = M[lang];
    assert.deepEqual(Object.keys(en).filter((k) => !(k in tr)), [], "keys missing from " + lang);
    assert.deepEqual(Object.keys(tr).filter((k) => !(k in en)), [], "keys not in English");
    const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    for (const k of Object.keys(en)) {
      assert.equal(typeof tr[k], typeof en[k], `${k}: plural vs plain`);
      assert.deepEqual([...new Set(placeholders(tr[k]))].sort(), [...new Set(placeholders(en[k]))].sort(), `${k}: placeholders differ`);
      if (typeof en[k] === "object") for (const c of cats) assert.ok(typeof tr[k][c] === "string" && tr[k][c], `${k}: missing plural form "${c}"`);
      for (const s of forms(tr[k])) {
        assert.ok(s.trim() && s === s.trim(), `${k}: empty or padded`);
        assert.ok(!/[<>]/.test(s), `${k}: translations are text, never HTML`);
        assert.ok(!/\b(TODO|FIXME|XXX|lorem)\b/i.test(s), `${k}: placeholder text`);
        assert.equal(s, s.normalize("NFC"), `${k}: not NFC`);
        assert.ok(!/[०-९০-৯௦-௯౦-౯೦-೯൦-൯૦-૯੦-੯]/.test(s), `${k}: native digits (we show 0-9 everywhere)`);
      }
    }
  });

  test(`${lang}: nothing left in English, and every sentence is in the language's own script`, () => {
    const script = new RegExp(`\\p{Script=${SCRIPT[lang]}}`, "u");
    for (const [k, v] of Object.entries(M[lang])) {
      if (SAME_OK.has(k)) continue;
      forms(v).forEach((s, i) => {
        const en = forms(M.en[k])[Math.min(i, forms(M.en[k]).length - 1)];
        assert.notEqual(s, en, `${k}: identical to English (not translated)`);
        // Without the placeholders, the brand name and ₹ is there any text left? Then some of it must be in this language.
        const rest = s.replace(/\{\w+\}/g, "").replace(/Help Seeker/g, "");
        if (/\p{L}/u.test(rest)) assert.match(rest, script, `${k}: no ${SCRIPT[lang]} text in "${s}"`);
      });
    }
  });
}

test("text-expansion budget: short labels and buttons stay within ~60% of the English length (long strings may wrap, short ones sit in fixed-size controls)", () => {
  const WRAPS_ANYWAY = new Set(["dlg.title"]); // a heading, wraps over two lines
  const len = (s) => core.countGraphemes(s.replace(/\{\w+\}/g, ""));
  for (const lang of OTHERS) {
    for (const [k, v] of Object.entries(M.en)) {
      if (typeof v !== "string" || /^(err|email|valid)\./.test(k) || WRAPS_ANYWAY.has(k) || len(v) > 24) continue;
      assert.ok(len(M[lang][k]) <= len(v) * 1.6 + 3, `${lang} ${k}: ${len(v)} -> ${len(M[lang][k])} characters (${M[lang][k]})`);
    }
  }
});

test("service and availability names the API sends all have a translation in every language", () => {
  for (const l of LANGS) {
    for (const s of SERVICES) assert.ok(M[l]["service." + s], `${l}: service.${s}`);
    for (const a of AVAIL) assert.ok(M[l]["avail." + a], `${l}: avail.${a}`);
  }
  assert.equal(M.en["service.Cleaning"], "Cleaning"); // English display equals the stored value
});

test("every key used by the website and the app exists in English, and each file ends up used", () => {
  const files = [
    ...["index.html", "verify.html", "reset.html", "app.js", path.join("i18n", "web.js")].map((f) => path.join(ROOT, "public", f)),
    path.join(ROOT, "mobile", "App.tsx"),
    ...fs.readdirSync(path.join(ROOT, "mobile", "src", "screens")).map((f) => path.join(ROOT, "mobile", "src", "screens", f)),
    path.join(ROOT, "mobile", "src", "api.ts"), path.join(ROOT, "mobile", "src", "ui.tsx"),
  ];
  const used = new Set();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:\bt|tx|tr|translate|label)\(\s*"([\w.\- ]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="(\w+\.[\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/"((?:tab|nav|req|sort|filter|status|verifypage|reset|net|common|dlg|chat|auth|register|forgot|verify|profile|account|admin|hk|login|field|lang|flash|results|app\\.(?:name|title|tagline))\.[\w.]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in M.en) && !k.endsWith("."));
  assert.deepEqual(missing, []);
  // keys nobody uses are dead weight to translate; the only exceptions are the dynamic families
  const dynamic = /^(service|avail|err|email|status|valid)\./;
  const unused = Object.keys(M.en).filter((k) => !used.has(k) && !dynamic.test(k) && k !== "net.generic");
  assert.deepEqual(unused, []);
  // valid.* is used from web.js by key name
  for (const k of ["valid.required", "valid.email", "valid.phone", "valid.too_short", "valid.number"]) assert.ok(read(path.join(DIR, "web.js")).includes(k));
});

test("the phone app bundles a byte-identical copy of the shared files (run `npm run i18n:sync`)", () => {
  const dst = path.join(ROOT, "mobile", "src", "i18n", "shared");
  const { sharedFiles } = require("../scripts/sync-i18n.js");
  assert.deepEqual(fs.readdirSync(dst).sort(), sharedFiles());
  for (const f of sharedFiles()) assert.equal(read(path.join(dst, f)), read(path.join(DIR, f)), f + " is stale");
});

test("the three web pages declare a page language and load the shared translation scripts", () => {
  for (const f of ["index.html", "verify.html", "reset.html"]) {
    const html = read(path.join(ROOT, "public", f));
    assert.match(html, /^<!doctype html>\n<html lang="en">/, f);       // WCAG 3.1.1 (the script then sets the chosen language)
    assert.match(html, /<meta charset="utf-8">/, f);
    assert.match(html, /<script src="i18n\/core\.js"><\/script>\s*<script src="i18n\/web\.js"><\/script>/, f);
    assert.match(html, /<title data-i18n="[\w.]+">/, f);
  }
  const web = read(path.join(DIR, "web.js"));
  assert.match(web, /document\.documentElement\.lang = lang/);
  assert.match(web, /o\.lang = l\.code/);                                // each autonym is tagged with its own language (WCAG 3.1.2)
  assert.match(web, /sel\.name = "ui-language"/);
});

test("the style sheet names system fonts covering every script and gives non-Latin text more line height", () => {
  const css = read(path.join(ROOT, "public", "style.css"));
  for (const f of ["Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Gujarati", "Noto Sans Gurmukhi", "Nirmala UI"]) assert.ok(css.includes(`"${f}"`), f);
  assert.ok(!/@font-face|fonts\.googleapis/.test(css), "no web fonts are downloaded");
  assert.match(css, /html:not\(\[lang="en"\]\) body \{ line-height:1\.7/);
  assert.match(css, /min-height:44px/);                                   // touch target size
});

// ---------------------------------------------------------------------------------------------------------------------
test("Accept-Language negotiation: q-values, order, region and script fallback, junk", () => {
  const n = core.negotiate;
  assert.equal(n("hi-IN"), "hi");
  assert.equal(n("hi-IN,hi;q=0.9,en;q=0.8"), "hi");
  assert.equal(n("en-US,en;q=0.9,mr;q=0.8"), "en");
  assert.equal(n("fr-FR,fr;q=0.9,ta;q=0.5,en;q=0.4"), "ta");
  assert.equal(n("fr, mr;q=0.9, hi;q=0.5"), "mr");
  assert.equal(n("hi;q=0.2, ta;q=0.8"), "ta");            // q beats order
  assert.equal(n("hi;q=0, mr;q=0.1"), "mr");             // q=0 means "not acceptable"
  assert.equal(n("MR-in"), "mr");                         // case-insensitive
  assert.equal(n("bn-BD"), "bn"); assert.equal(n("ta-LK"), "ta"); assert.equal(n("pa-IN"), "pa");
  assert.equal(n("pa-Guru-IN"), "pa");
  assert.equal(n("pa-Arab-PK"), "en");                   // Shahmukhi is not Gurmukhi
  assert.equal(n("pa-PK"), "en");
  assert.equal(n("hi-Latn"), "en");                      // romanised Hindi is not Devanagari
  assert.equal(n("hi-Latn, mr"), "mr");
  assert.equal(n("*"), "en");
  assert.equal(n(""), "en"); assert.equal(n(undefined), "en"); assert.equal(n(null), "en"); assert.equal(n(42), "en");
  assert.equal(n("hi".repeat(600)), "en");               // over-long header is ignored
  assert.equal(n(["fr-CA", "gu-IN", "en"]), "gu");       // a device's ordered language list
  assert.equal(n([]), "en"); assert.equal(n(["zz", 5, null]), "en");
  for (const evil of ["'; DROP TABLE users; --", "<script>", "hi\r\nX: y", "../../etc", "ＨＩ", "én"]) assert.equal(n(evil), "en", evil);
  assert.equal(core.normalizeChoice("hi"), "hi");
  for (const v of ["HI", "hi-IN", "xx", "", null, undefined, 3, {}, "hi ", "__proto__", "constructor"]) assert.equal(core.normalizeChoice(v), null, String(v));
  assert.deepEqual(core.parseAcceptLanguage("hi;q=0.2, ta;q=0.8, en"), [{ tag: "en", q: 1 }, { tag: "ta", q: 0.8 }, { tag: "hi", q: 0.2 }]);
});

test("plural rules (CLDR): the right form per language, including languages that treat 0 as singular", () => {
  const form = (lang, n) => core.createTranslator({ lang, messages: M[lang] })("results.found", { n });
  const cat = (lang, n) => core.pluralCategory(lang, n);
  // English: only 1 is "one". Hindi, Bengali, Gujarati, Kannada, Punjabi: 0 and 1. Marathi, Tamil, Telugu, Malayalam: only 1.
  const zeroIsOne = { en: false, hi: true, bn: true, gu: true, kn: true, pa: true, mr: false, ta: false, te: false, ml: false };
  for (const [lang, z] of Object.entries(zeroIsOne)) {
    assert.equal(cat(lang, 0), z ? "one" : "other", `${lang} 0`);
    assert.equal(cat(lang, 1), "one", `${lang} 1`);
    assert.equal(cat(lang, 2), "other", `${lang} 2`);
    assert.equal(cat(lang, 5), "other", `${lang} 5`);
    assert.equal(cat(lang, 21), "other", `${lang} 21`);
    assert.equal(form(lang, 1), M[lang]["results.found"].one.replace("{n}", "1"), lang);
    assert.equal(form(lang, 5), M[lang]["results.found"].other.replace("{n}", "5"), lang);
    assert.equal(form(lang, 0), M[lang]["results.found"][z ? "one" : "other"].replace("{n}", "0"), lang);
  }
  assert.equal(form("en", 1), "1 housekeeper found");
  assert.equal(form("en", 0), "0 housekeepers found");
  assert.equal(form("en", 12), "12 housekeepers found");
  assert.equal(core.createTranslator({ lang: "en", messages: M.en })("hk.years", { n: 1 }), "1 yr");
  assert.equal(core.createTranslator({ lang: "en", messages: M.en })("hk.years", { n: 6 }), "6 yrs");
  assert.equal(core.createTranslator({ lang: "mr", messages: M.mr })("hk.years", { n: 1 }), "1 वर्ष");
  assert.equal(core.createTranslator({ lang: "mr", messages: M.mr })("hk.years", { n: 4 }), "4 वर्षे");
  // numbers inside messages use Indian grouping with Latin digits
  assert.equal(core.createTranslator({ lang: "en", messages: M.en })("results.found", { n: 1234567 }), "12,34,567 housekeepers found");
  // the built-in table (for phones without Intl.PluralRules) agrees with Intl for every language and a wide range of numbers
  for (const lang of LANGS) for (let n = 0; n <= 1000; n++) assert.equal(core.pluralCategory(lang, n, { forceFallback: true }), core.pluralCategory(lang, n), `${lang} ${n}`);
  // languages with more categories than ours work through the same engine; a missing form falls back to "other"
  const ru = core.createTranslator({ lang: "ru", messages: { k: { one: "{n} файл", few: "{n} файла", many: "{n} файлов", other: "{n} файла" } } });
  assert.deepEqual([1, 2, 5, 21, 22, 25, 11, 1.5].map((n) => ru("k", { n })), ["1 файл", "2 файла", "5 файлов", "21 файл", "22 файла", "25 файлов", "11 файлов", "1,5 файла"].map((s) => s.replace("1,5", "1.5")));
  const ar = core.createTranslator({ lang: "ar", messages: { k: { zero: "none", one: "one", two: "two", other: "many" } } });
  assert.deepEqual([0, 1, 2, 3].map((n) => ar("k", { n })), ["none", "one", "two", "many"]);
  const partial = core.createTranslator({ lang: "ru", messages: { k: { other: "{n} x" } } });
  assert.equal(partial("k", { n: 1 }), "1 x");
});

test("message formatting: named placeholders, one pass, user text is never re-interpreted, unknown keys fall back", () => {
  const t = core.createTranslator({ lang: "hi", messages: { a: "{name} ने {count} संदेश भेजे", b: "{x} {y}" }, fallback: { c: "english {z}" } });
  assert.equal(t("a", { count: 3, name: "{count}" }), "{count} ने 3 संदेश भेजे");       // value containing a placeholder is NOT expanded
  assert.equal(t("b", { x: "{y}", y: "$&" }), "{y} $&");
  assert.equal(t("b", { x: 1 }), "1 {y}");                                           // a missing parameter stays visible
  assert.equal(t("c", { z: "ok" }), "english ok");                                    // fallback language
  assert.equal(t("nope"), "nope");
  assert.equal(t("__proto__"), "__proto__");
  assert.equal(t("a", { name: "<img onerror=x>", count: 1 }), "<img onerror=x> ने 1 संदेश भेजे"); // callers escape/render as text; the engine adds no HTML
});

test("numbers, rupees and dates use Indian conventions with Latin digits in every language", () => {
  for (const lang of LANGS) {
    const r = core.formatRupees(lang, 150);
    assert.equal(r, "₹150", lang);
    assert.equal(core.formatRupees(lang, 150000), "₹1,50,000", lang);        // lakh grouping
    assert.equal(core.formatNumber(lang, 1234567), "12,34,567", lang);
    const d = core.formatDateTime(lang, "2026-03-09T14:05:00Z");
    assert.ok(d && !/[०-९০-৯௦-௯౦-౯೦-೯൦-൯૦-૯੦-੯]/.test(d), `${lang}: ${d}`);
    assert.match(d, /\d/);
  }
  assert.equal(core.formatDateTime("en", "not a date"), "");
  assert.notEqual(core.formatDateTime("hi", "2026-03-09T14:05:00Z"), core.formatDateTime("en", "2026-03-09T14:05:00Z")); // month names are localised
  assert.equal(core.formatRupees("zz", 5), "₹5"); // unknown language: English conventions, never throws
  // collation: locale-aware and accent/case-insensitive
  assert.deepEqual(["b", "a", "É", "e", "Z"].sort(core.collator("en").compare).slice(0, 2), ["a", "b"]);
  assert.ok(core.collator("hi").compare("अ", "ब") < 0);
});

test("Unicode: NFC for comparisons, grapheme clusters for counting and cutting (Intl.Segmenter and the fallback agree)", () => {
  assert.equal(core.nfc("é"), "é");
  assert.equal(core.nfc(undefined), "");
  const samples = { "क्षत्रिय": 3, "ਪੰਜਾਬੀ": 3, "മലയാളം": 4, "தமிழ்": 3, "ಕನ್ನಡ": 4, /* Kannada conjuncts are not joined by UAX #29 */ "తెలుగు": 3, "ગુજરાતી": 4, "বাংলা": 2, "abc": 3, "": 0, "नमस्ते": 3 };
  for (const [s, n] of Object.entries(samples)) {
    assert.equal(core.graphemes(s).length, n, `${s} (Intl.Segmenter)`);
    assert.deepEqual(core.graphemes(s, { forceFallback: true }), core.graphemes(s), `${s} (fallback)`);
    assert.equal(core.graphemes(s).join(""), s);
  }
  assert.equal(core.countGraphemes("क्षि".repeat(1000)), 1000);
  assert.equal(core.truncateGraphemes("क्षत्रिय", 2), "क्षत्रि");               // never splits a cluster
  assert.equal(core.truncateGraphemes("नमस्ते", 2), "नम");
  assert.equal(core.truncateGraphemes("abc", 5), "abc");
  assert.equal(core.truncateGraphemes("👍🏽👍🏽", 1), "👍🏽");
  assert.equal(core.truncateGraphemes(undefined, 3), "");
  for (const cut of [1, 2, 3, 4]) { const s = core.truncateGraphemes("ਪੰਜਾਬੀ ਭਾਸ਼ਾ", cut); assert.ok(!/^[ਾ-੍ੰੱ]/.test(s.slice(-1)) || s.length > 1); assert.equal(s, core.graphemes("ਪੰਜਾਬੀ ਭਾਸ਼ਾ").slice(0, cut).join("")); }
});

test("language hints for user-written text (WCAG 3.1.2): only unambiguous scripts that differ from the screen language", () => {
  assert.equal(core.langHint("வணக்கம்", "hi"), "ta");
  assert.equal(core.langHint("నమస్కారం", "en"), "te");
  assert.equal(core.langHint("ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "mr"), "pa");
  assert.equal(core.langHint("नमस्कार", "mr"), null);       // same script as the screen
  assert.equal(core.langHint("नमस्कार", "en"), "hi");
  assert.equal(core.langHint("hello", "hi"), null);          // Latin is not guessed
  assert.equal(core.langHint("", "hi"), null); assert.equal(core.langHint(undefined, "hi"), null);
  assert.equal(core.langHint("Hello வணக்கம் வணக்கம்", "en"), "ta");
});

test("every error code and email template exists, with the right placeholders", () => {
  for (const l of LANGS) {
    for (const code of ERROR_CODES) assert.ok(M[l]["err." + code], `${l}: err.${code}`);
    assert.deepEqual(placeholders(M[l]["email.verify.body"]).sort(), ["link", "name"]);
    assert.deepEqual(placeholders(M[l]["email.reset.body"]), ["link"]);
    assert.ok(!/[\r\n]/.test(M[l]["email.verify.subject"] + M[l]["email.reset.subject"]), `${l}: subject must be one line (header injection)`);
    assert.ok(M[l]["email.verify.body"].includes("\n\n{link}\n\n"));
  }
  assert.deepEqual(placeholders(M.en["err.field_too_long"]), ["max"]);
});

test("mail provider requests are UTF-8 JSON with the message language; non-ASCII subjects and bodies survive", async (t) => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200 }; };
  t.after(() => { globalThis.fetch = real; });
  const send = createMailer({ apiKey: "k", from: "Help Seeker <a@b.c>" });
  await send({ to: "x@y.z", subject: M.hi["email.verify.subject"], text: "नमस्ते 🙂\n\nhttps://x/verify.html?token=abc", lang: "hi" });
  assert.equal(seen.init.headers["Content-Type"], "application/json; charset=utf-8");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.subject, M.hi["email.verify.subject"]);
  assert.equal(body.text, "नमस्ते 🙂\n\nhttps://x/verify.html?token=abc");
  assert.deepEqual(body.headers, { "Content-Language": "hi" });
  assert.equal(Buffer.from(seen.init.body, "utf8").toString("utf8"), seen.init.body);   // round-trips as UTF-8
  await send({ to: "x@y.z", subject: "s", text: "t" });                                 // no language: no header
  assert.equal(JSON.parse(seen.init.body).headers, undefined);
});
