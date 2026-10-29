# Help Seeker

Find a housekeeper (cleaning, dishwashing, cooking, laundry, elder care…). Website + Android/iPhone app + Node backend on Postgres.

## How it works
- **Households** create an account, search housekeepers (service, city, max rate, availability) and send a contact request.
- **Housekeepers** create an account, fill in a profile, and accept or decline incoming requests.
- A housekeeper's phone number is hidden until they **accept** your request; after that you can leave a 1–5★ review.
- Public search never exposes phone numbers or emails.
- New accounts must **confirm their email** (link valid 24 hours). Until then a user can sign in and browse, but households can't contact anyone, and housekeepers stay out of search results and can't answer requests. Completing a password reset also confirms the address.
- **Messages:** once a housekeeper accepts a request, the household and the housekeeper can message each other inside it (plain text, up to 1,000 characters, 20 per minute per person). The Requests tab shows how many messages are new. New messages appear within a few seconds while a conversation is open; there are no push or email notifications yet.
- Password reset by emailed link; users can permanently delete their account (profile, requests and reviews go with it).

Mobile app: [`mobile/`](mobile/README.md) (Expo / React Native, same API).

## Run locally
Requires Node 18+ and a Postgres database (local, or a free hosted one – see below).

```sh
cp .env.example .env            # then edit DATABASE_URL (the server loads .env.local and .env itself)
npm install
npm run seed                    # optional demo housekeepers (password: demo-pass-123)
npm run seed:dummy              # optional bigger fake data set (12 housekeepers in Pusad, 3 households, requests, reviews); refuses a live database (use the owner-only Account-tab buttons there)
npm start                       # http://localhost:3000
```
Tables are created automatically on startup.

Tests need a Postgres they can create temporary schemas in (each test uses its own schema and removes it afterwards):
```sh
TEST_DATABASE_URL=postgres://hs:hs@localhost:5432/hs_test npm test
```
Without `TEST_DATABASE_URL` the tests are skipped.

## Configuration
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** Postgres connection string (on Neon: the pooled one) |
| `DATABASE_URL_UNPOOLED` | Optional direct (non-pooled) connection string, used only for the startup schema step |
| `PORT` | default 3000 |
| `APP_URL` | public base URL, used in password-reset links |
| `NODE_ENV=production` | marks cookies `Secure`; serve behind HTTPS |
| `TRUST_PROXY=1` | behind a hosting proxy: use the client IP from `X-Forwarded-For` for rate limiting. Don't set it if the server is directly exposed. |
| `ADMIN_EMAIL` | optional. The owner is `OWNER_EMAIL` in `server/app.js` unless this overrides it (empty = nobody). Whoever signs in with that email **and has confirmed it** gets a "Sample data" card on the Account tab (one click adds or removes fake housekeepers that only they can see). |
| `RESEND_API_KEY`, `MAIL_FROM` | send confirmation and reset emails through [Resend](https://resend.com) (free tier). Without a key, emails are printed to the server log, so in production nobody can confirm their email. Resend's default test sender (`onboarding@resend.dev`) only delivers to your own account's address: to email real users, verify a domain with Resend and set `MAIL_FROM` to an address on it (check Resend's current docs for details). |
| `DB_POOL_MAX` | max Postgres connections, default 10 (keep it small on free database plans) |

## Free hosting: Neon (database) + Render (server)
1. **Database (Neon)**: create a project at [neon.com](https://neon.com) and copy its connection strings from the **Connect** panel (or run `neon env pull`, see below). Use two settings:
   - `DATABASE_URL`: the **pooled** string (host contains `-pooler`). All normal app traffic uses it; Neon recommends pooled for web apps.
   - `DATABASE_URL_UNPOOLED`: the **direct** string (same host without `-pooler`). Optional but recommended: the app uses it only for the schema step at startup, because Neon recommends direct connections for schema changes. If unset, the pooled URL is used for everything.
   Neon's strings end in `?sslmode=require&channel_binding=require`; both work as pasted. (Our database driver ignores `channel_binding`, and treats `sslmode=require` as full certificate verification with a warning. Writing `sslmode=verify-full` silences the warning and keeps strict checking if the driver is upgraded.)
2. **Server (Render)**: push this repo to GitHub, create a Render *Blueprint* from it (`render.yaml` pins the region to Singapore to sit next to a Neon database in `ap-southeast-1`; if your Neon project is elsewhere, change `region` **before** creating the service, because it can't be changed afterwards) (uses [`render.yaml`](render.yaml)), and fill in `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `APP_URL` (your `https://….onrender.com` address) and optionally `RESEND_API_KEY`.
3. Point the mobile app at the same URL (`EXPO_PUBLIC_API_URL`).

### Continuous deployment (GitHub Actions → Render)
Every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

1. **Checks (in parallel):** API tests on a real Postgres, mobile typecheck + bundle, and the real-browser website regression (`e2e/run.sh web`, production mode).
2. **Deploy**, only if every check is green and only for `main` (never for pull requests): triggers Render's deploy hook.
3. **Wait until live:** polls `/healthz` until the site reports the exact commit that was just merged (a newer commit that includes it also counts). If the new version never starts, the job fails after 20 minutes and Render keeps serving the previous version.
4. **Smoke test** ([`scripts/smoke.js`](scripts/smoke.js)): read-only checks on the live site (pages, health, search never exposes phone numbers or emails, private endpoints refuse anonymous visitors). It creates no accounts and writes nothing.

**One-time setup** (needs your own accounts; until it's done the deploy job simply skips with a notice and the build stays green):
1. Create the Render service from this repo's Blueprint ([`render.yaml`](render.yaml)), as described above. `autoDeployTrigger: "off"` is set so Render doesn't also deploy on every push.
2. In Render open the service, **Settings → Deploy Hook**, and copy the URL. Treat it like a password.
3. In GitHub open **Settings → Secrets and variables → Actions** and add:
   - a repository **secret** `RENDER_DEPLOY_HOOK_URL` = that URL;
   - a repository **variable** `APP_URL` = your site's address, e.g. `https://help-seeker.onrender.com` (no trailing slash).
4. Optional: **Settings → Environments → production → Required reviewers** makes every deploy wait for a click.

You can also deploy any time from **Actions → CI → Re-run**. **Rolling back:** revert the commit on `main` (the pipeline redeploys), or redeploy an earlier deploy from the Render dashboard.

Notes: the live-commit check reads `RENDER_GIT_COMMIT`, which Render sets automatically; on another host set `GIT_COMMIT` yourself. The pipeline deploys the website and API only. The mobile apps go out through the app stores (EAS), not this pipeline. Schema changes apply by themselves at startup. Render also offers a built-in "After CI Checks Pass" auto-deploy if you'd rather not use the hook; this pipeline adds the live-commit check and the smoke test on top.

### Neon CLI (`neon.ts`)
The repo is linked to a Neon project (`.neon`) and declares its services in [`neon.ts`](neon.ts) (Postgres, plus the beta *Realtime* preview). With the [Neon CLI](https://neon.com/docs/cli) (`npm i -g neon@latest`) signed in (`neon login`):
```sh
neon config plan     # preview what neon.ts would change
neon deploy          # provision the services declared in neon.ts
neon env pull --service postgres --service realtime   # writes .env.local (git-ignored): DATABASE_URL, DATABASE_URL_UNPOOLED, NEON_REALTIME_URL, NEON_REALTIME_SECRET
```
The server reads `.env.local` and `.env` itself at startup (real environment variables always win), so `npm start` works straight after `neon env pull`. **Never commit `.env.local`**; it holds database passwords. The Realtime variables are not used by the app yet.

Your data lives in the hosted Postgres, so it survives server restarts and redeploys. Free tiers have limits (storage, idle sleep, cold starts of tens of seconds on the server, databases that pause when unused) and providers change them, so check their current terms before you rely on them for real users. Any other host that runs Node plus any Postgres works too.

## API (JSON; state-changing requests need `Content-Type: application/json`)
| Method | Path | Who |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | anyone |
| POST | `/api/email-verification/confirm` `{token}` | anyone (the link works without signing in) |
| POST | `/api/email-verification/resend` | signed-in, max one email per minute |
| POST | `/api/password-reset/request` `{email}`, `/api/password-reset/confirm` `{token, password}` | anyone |
| POST | `/api/account/delete` `{password}` | signed-in |
| any | every endpoint accepts `Accept-Language` (the UI language); errors answer `{error, code, params?}` (see Languages) | |
| GET | `/api/me` (includes `unreadMessages`), `/api/meta`, `/api/housekeepers?service&city&maxRate&avail&sort` (each card has `mine` when signed in), `/healthz` | anyone |
| PUT | `/api/profile` | any signed-in person (listed in search only once the email is confirmed; one account can both hire and offer services) |
| POST | `/api/requests` | any signed-in person with a confirmed email (not to themselves) |
| GET | `/api/requests?as=sent\|received` | signed-in (own requests only). `sent` = ones you made, `received` = ones sent to your housekeeper profile; without `as`, housekeeper-role accounts get `received` and others `sent` (older app builds) |
| PATCH | `/api/requests/:id` `{status: accepted\|declined}` | the person the request was sent to, confirmed email |
| POST | `/api/requests/:id/review` `{rating, comment}` | the person who sent the accepted request |
| GET | `/api/requests/:id/messages?after=<id>` | the two people in an *accepted* request (confirmed email). Marks the other person's messages read. Returns `{with, messages:[{id, mine, body, created_at}]}` |
| POST | `/api/requests/:id/messages` `{body}` | same; 1–1000 characters, 20 per minute |

## Languages
The website and the phone app are available in English, हिन्दी (hi), मराठी (mr), বাংলা (bn), தமிழ் (ta), తెలుగు (te), ಕನ್ನಡ (kn), മലയാളം (ml), ગુજરાતી (gu) and ਪੰਜਾਬੀ (pa). Both have a language picker (website header, and in the app the header, the sign-in screen and Account). The first visit follows the browser/phone language list when it is supported, otherwise English; the choice is then remembered (`localStorage` / `AsyncStorage`, key `hs-lang`) and applies immediately without losing typed text or signing out.

**Translations were drafted by an AI model and have not been reviewed by native speakers.** Have a native speaker of each language read them before a wide launch; the PR that introduced them lists the strings the drafter was least sure about.

**What is translated, and what is not.** All screen text, placeholders, alerts, the "server is waking up" screen, service and availability names (the API and database keep the English keys: `Cleaning`, `Full-time`...; only the display changes), error messages (see below) and the confirmation / password-reset emails. User-written text (names, bios, notes, cities, chat messages) is never translated or altered. Numbers stay in normal digits (0-9): amounts show as `₹1,50,000` (Indian digit grouping) in every language, and phone numbers are never reformatted.

**One source of truth.** `public/i18n/<code>.json` (flat `"key": "text"`, English is the reference) are the only copies of the words. The website loads them directly; the phone app bundles a copy in `mobile/src/i18n/shared/` made by `npm run i18n:sync` (a test fails if the copy is stale). `public/i18n/core.js` (language list, negotiation, plurals, formatting, Unicode helpers) is shared the same way, and the server uses it too. New UI text goes through the translation function (`I18n.t(key, {named: value})` on the web, `useI18n().t` in the app, or `data-i18n="key"` in HTML) and its key is added to **every** language file in the same change. `test/i18n.test.js` fails when a language lacks a key, keeps a `{placeholder}` out, leaves a sentence untranslated (identical to English or not in the language's script), lacks a plural form, or when a key is used in code but missing from English.

**Messages.** `{name}`-style named placeholders (replaced in one pass, so a user's name containing `{x}` is never expanded) and CLDR plural forms: a value can be `{"one": "{n} housekeeper found", "other": "{n} housekeepers found"}`, chosen with `Intl.PluralRules` (Hindi, Bengali, Gujarati, Kannada and Punjabi treat 0 as singular; a built-in table covers phones without `PluralRules`). Never join translated fragments into a sentence; give the sentence its own key with placeholders so each language controls word order. Links inside sentences use a `{link}` placeholder and the page builds the anchor as a DOM node (no HTML in translations).

**Add a language.** (1) Add `{code, name (autonym), script (ISO 15924)}` to `LANGS` in `public/i18n/core.js` and the plural rule to `FALLBACK_PLURAL`; (2) copy `public/i18n/en.json` to `<code>.json` and translate every value; (3) add the script name to `SCRIPT` in `test/i18n.test.js`, the import to `mobile/src/i18n/messages.ts`, and a `"Noto Sans <Script>"` font name to `public/style.css` if it is a new script; (4) run `npm run i18n:sync` and `npm test`. Nothing else: the pickers, negotiation, email templates and tests read the list.

**Error messages.** Every API error keeps its English `error` text and HTTP status and now also has a stable `code` (e.g. `wrong_credentials`, `field_too_long`, plus `params` such as `{max: 1000}` where a number matters); `email_not_verified` is unchanged. Clients show the translation of `err.<code>` and fall back to the English text; in English they show the server's own sentence. Adding a code means adding it to `ERROR_CODES` in `server/app.js` and an `err.<code>` message in every language (a test enforces both).

**Emails.** The apps send their current language in the standard `Accept-Language` header on every request; the server picks the confirmation / reset email template from it (nothing is stored, no database column). The value is only ever matched against the fixed list of ten codes (q-values and region fallback like `hi-IN` -> `hi` are honoured, anything else -> English) and is never put into SQL, a subject or a body. Emails are sent as UTF-8 JSON with a `Content-Language` header; the provider encodes non-ASCII subjects.

### Standards applied (and not)
Applied: **BCP 47 / ISO 639** codes everywhere (storage key value, `<html lang>`, `Accept-Language` parsing with q-values, region and script fallback: `hi-Latn` and `pa-Arab`/`pa-PK` are not served because we only have Devanagari/Gurmukhi text); **autonyms** (CLDR style) in the picker, each tagged with its own `lang` (WCAG 3.1.2); `<html lang>` follows the choice (WCAG 3.1.1); user-written text in another script than the screen language gets `lang` on the web (e.g. Tamil text on a Hindi screen); **Unicode**: UTF-8 everywhere (`charset=utf-8` on every static file and JSON, emails), text compared and searched in **NFC** (city search normalises both sides in the database, stored text is never altered), limits (names 100, notes/bio/messages 1000...) count **grapheme clusters** with `Intl.Segmenter` (so क्षि counts as 1, and a cut never splits a letter), and no `maxlength`/`maxLength` (UTF-16 units) is used on the long fields; **CLDR plurals** and **named placeholders** (above); **Intl** number / currency / date formatting (`en-IN` grouping for ₹, localised month names) with **Latin digits by default** (decision: rates, phone numbers and dates sit next to numbers typed on a keyboard and shown by UPI/banking apps; Bengali, Marathi etc. would otherwise default to native digits), ₹ before the amount in every language; **WCAG 2.2**: 3.1.1, 3.1.2, an accessible name for the picker (a `<label>`; in the app a labelled radio group), 44px (web) / 48dp (app) minimum touch targets (2.5.5/2.5.8), 1.75 line height for non-Latin scripts and no fixed heights so nothing clips, text wraps instead of truncating (translations are often 30-40% longer; checked at 360px), the app respects the phone's font scaling; native browser validation bubbles are replaced by translated ones; **fonts**: system font stack with `Noto Sans <script>`, Nirmala UI and Apple script fonts as fallbacks, no downloaded web fonts (so no flash of invisible text or boxes from loading, and `font-display` does not apply); no text inside images and no icon-only controls.
Deliberately not applied: **ICU MessageFormat** syntax (a full parser is heavy for three plural strings; we use named placeholders and `Intl.PluralRules`); **`Intl.Collator` for sorting** exists in the shared core (`collator()`) but nothing is sorted by name on the client (the server orders by rating, rate or experience, and the language list is in a fixed order), so it is not wired in; **native digits** (see above); **right-to-left** support (none of the ten is RTL); **per-user language stored on the server** (not needed, and the emails follow the language the person had when the email was triggered); **phone numbers in native digits** (the server and the `pattern` accept `0-9 + - ( )` only); the language of *user-written* text is only hinted on the web, not in the app (React Native has no per-text language attribute except an iOS-only accessibility prop, used for the picker); Hermes (the phone's JS engine) may lack `Intl.Segmenter`, in which case a built-in cluster splitter is used that can differ from the server by a character in rare Kannada/Tamil/Gurmukhi conjunct cases.

## Security notes
Passwords hashed with scrypt; sessions are random tokens stored hashed, sent in an `HttpOnly; SameSite=Lax` cookie (web) or an `Authorization: Bearer` header (mobile, token returned only when the request sends `X-Client: mobile`); login/register/reset are rate-limited per IP (in memory, single process); confirmation and reset links are single-use (consumed atomically), stored hashed and expire (24 h / 1 h), expire after 1 hour and sign the user out everywhere; the reset endpoint answers identically whether or not the email exists; SQL is parameterised; the UI escapes all user text; races (duplicate requests, double answers, reused reset tokens) are settled by the database.

## Working on this project
Day-to-day engineering is handled by the **`software-engineer` agent** (`.claude/agents/software-engineer.md`) following the `software-engineering` skill and `CLAUDE.md`. The owner describes the functionality they want; the agent designs, builds, tests (API tests + a full browser regression, `e2e/run.sh`), opens the pull request, fixes CI and, once everything is green, merges it. It only comes back with a question when a decision is genuinely the owner's (a product choice it can't infer, an account or key only the owner has, anything that could destroy real data or weaken security). Use `/agents` in Claude Code to see it, or ask for work in plain language.

## Upgrading an existing database
The `email_verified_at` column is added automatically, but accounts created before email verification existed start out *unconfirmed*: their housekeepers disappear from search until they confirm (or complete a password reset). If you already have real users, mark them confirmed once with `UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;`.

## Not yet done
Phone verification, ID/background checks, push/email notifications for messages, attachments, payments, database migrations tooling (tables are created with `IF NOT EXISTS`, so later schema changes need a migration step), and a shared rate limiter if you run several instances.
