# Help Seeker

Find a housekeeper (cleaning, dishwashing, cooking, laundry, elder care…). Website + Android/iPhone app + Node backend on Postgres.

## How it works
- **Households** create an account, search housekeepers (service, city, max rate, availability) and send a contact request.
- **Housekeepers** create an account, fill in a profile, and accept or decline incoming requests.
- A housekeeper's phone number is hidden until they **accept** your request; after that you can leave a 1–5★ review.
- Public search never exposes phone numbers or emails.
- New accounts must **confirm their email** (link valid 24 hours). Until then a user can sign in and browse, but households can't contact anyone, and housekeepers stay out of search results and can't answer requests. Completing a password reset also confirms the address.
- Password reset by emailed link; users can permanently delete their account (profile, requests and reviews go with it).

Mobile app: [`mobile/`](mobile/README.md) (Expo / React Native, same API).

## Run locally
Requires Node 18+ and a Postgres database (local, or a free hosted one – see below).

```sh
cp .env.example .env            # then edit DATABASE_URL; load it however you like, e.g.:
export $(grep -v '^#' .env | xargs)
npm install
npm run seed                    # optional demo housekeepers (password: demo-pass-123)
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
| `DATABASE_URL` | **Required.** Postgres connection string |
| `PORT` | default 3000 |
| `APP_URL` | public base URL, used in password-reset links |
| `NODE_ENV=production` | marks cookies `Secure`; serve behind HTTPS |
| `TRUST_PROXY=1` | behind a hosting proxy: use the client IP from `X-Forwarded-For` for rate limiting. Don't set it if the server is directly exposed. |
| `RESEND_API_KEY`, `MAIL_FROM` | send confirmation and reset emails through [Resend](https://resend.com) (free tier). Without a key, emails are printed to the server log, so in production nobody can confirm their email. Resend's default test sender (`onboarding@resend.dev`) only delivers to your own account's address: to email real users, verify a domain with Resend and set `MAIL_FROM` to an address on it (check Resend's current docs for details). |
| `DB_POOL_MAX` | max Postgres connections, default 10 (keep it small on free database plans) |

## Free hosting: Neon (database) + Render (server)
1. **Database** – create a free project at [neon.tech](https://neon.tech) and copy its connection string. Use `sslmode=verify-full` in it (e.g. `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=verify-full`). Supabase's free Postgres works the same way.
2. **Server** – push this repo to GitHub, create a Render *Blueprint* from it (uses [`render.yaml`](render.yaml)), and fill in `DATABASE_URL`, `APP_URL` (your `https://….onrender.com` address) and optionally `RESEND_API_KEY`.
3. Point the mobile app at the same URL (`EXPO_PUBLIC_API_URL`).

Your data lives in the hosted Postgres, so it survives server restarts and redeploys. Free tiers have limits (storage, idle sleep, cold starts of tens of seconds on the server, databases that pause when unused) and providers change them, so check their current terms before you rely on them for real users. Any other host that runs Node plus any Postgres works too.

## API (JSON; state-changing requests need `Content-Type: application/json`)
| Method | Path | Who |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | anyone |
| POST | `/api/email-verification/confirm` `{token}` | anyone (the link works without signing in) |
| POST | `/api/email-verification/resend` | signed-in, max one email per minute |
| POST | `/api/password-reset/request` `{email}`, `/api/password-reset/confirm` `{token, password}` | anyone |
| POST | `/api/account/delete` `{password}` | signed-in |
| GET | `/api/me`, `/api/meta`, `/api/housekeepers?service&city&maxRate&avail&sort`, `/healthz` | anyone |
| PUT | `/api/profile` | housekeeper (listed in search only once the email is confirmed) |
| POST | `/api/requests` | household with a confirmed email |
| GET | `/api/requests` | signed-in (own requests only) |
| PATCH | `/api/requests/:id` `{status: accepted\|declined}` | housekeeper with a confirmed email |
| POST | `/api/requests/:id/review` `{rating, comment}` | household |

## Security notes
Passwords hashed with scrypt; sessions are random tokens stored hashed, sent in an `HttpOnly; SameSite=Lax` cookie (web) or an `Authorization: Bearer` header (mobile, token returned only when the request sends `X-Client: mobile`); login/register/reset are rate-limited per IP (in memory, single process); confirmation and reset links are single-use (consumed atomically), stored hashed and expire (24 h / 1 h), expire after 1 hour and sign the user out everywhere; the reset endpoint answers identically whether or not the email exists; SQL is parameterised; the UI escapes all user text; races (duplicate requests, double answers, reused reset tokens) are settled by the database.

## Working on this project
Day-to-day engineering is handled by the **`software-engineer` agent** (`.claude/agents/software-engineer.md`) following the `software-engineering` skill and `CLAUDE.md`. The owner describes the functionality they want; the agent designs, builds, tests (API tests + a full browser regression, `e2e/run.sh`), opens the pull request, fixes CI and, once everything is green, merges it. It only comes back with a question when a decision is genuinely the owner's (a product choice it can't infer, an account or key only the owner has, anything that could destroy real data or weaken security). Use `/agents` in Claude Code to see it, or ask for work in plain language.

## Upgrading an existing database
The `email_verified_at` column is added automatically, but accounts created before email verification existed start out *unconfirmed*: their housekeepers disappear from search until they confirm (or complete a password reset). If you already have real users, mark them confirmed once with `UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;`.

## Not yet done
Phone verification, ID/background checks, in-app messaging, payments, database migrations tooling (tables are created with `IF NOT EXISTS`, so later schema changes need a migration step), and a shared rate limiter if you run several instances.
