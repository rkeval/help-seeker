# Help Seeker: project guide

A marketplace for finding housekeepers (cleaning, dishwashing, cooking…): website + Android/iPhone app + Node backend on Postgres.
The owner decides *what the product does*; engineering decisions are made by the engineer (see `.claude/skills/software-engineering`).

## Layout
- `server/`: plain Node `http` server, no framework. `app.js` (routes), `auth.js`, `db.js` (schema, created on startup with `IF NOT EXISTS`), `mail.js`, `seed.js`.
- `public/`: the website (plain HTML/CSS/JS, no build step). `verify.html` and `reset.html` are the emailed-link pages.
- `mobile/`: Expo / React Native app (TypeScript) using the same API. Token auth (`Authorization: Bearer`, only issued when the request sends `X-Client: mobile`). It talks to the live site by default (`mobile/src/config.ts`, `LIVE_API_URL`); `EXPO_PUBLIC_API_URL` overrides it (the e2e runner and local development use that). Requests time out after 90 s and the first screen explains the free-tier cold start.
- `test/api.test.js`: API tests against real Postgres; each test gets its own schema.
- `e2e/`: browser end-to-end regression (`e2e/run.sh`).
- `.github/workflows/ci.yml`: runs the API tests (Postgres service) and the mobile typecheck + bundle.

## Commands
| What | Command |
|---|---|
| API tests | `TEST_DATABASE_URL=postgres://hs:hs@localhost:5432/hs_test npm test` (skipped without the variable) |
| Mobile typecheck | `cd mobile && npx tsc --noEmit` |
| Mobile bundle check | `cd mobile && npx expo export --platform android --platform ios --output-dir "$TMPDIR/export"` |
| Full browser regression | `E2E_ADMIN_URL=postgres://hs:hs@localhost:5432/postgres e2e/run.sh [web\|mobile\|all]` |
| Run locally | `DATABASE_URL=… npm start`, optionally `npm run seed` first |

Local Postgres in the cloud container: `pg_ctlcluster 16 main start`; role `hs` / password `hs` with `CREATEDB`; database `hs_test`. If missing:
`su postgres -c "psql -c \"CREATE ROLE hs LOGIN PASSWORD 'hs' CREATEDB\" -c 'CREATE DATABASE hs_test OWNER hs'"`.

## CI/CD
- `.github/workflows/ci.yml`: jobs `api`, `mobile`, `e2e` (website, real browser) run on every PR and push; job `deploy` runs only for pushes to `main`, after all three are green: Render deploy hook → `scripts/wait-for-deploy.js` (waits for `/healthz` to report the merged commit; `RENDER_GIT_COMMIT`) → `scripts/smoke.js` (read-only checks of production).
- Deploy needs the repo secret `RENDER_DEPLOY_HOOK_URL` and variable `APP_URL`; when they're missing the deploy step skips with a notice (it must never fail the build for that reason). Never print the hook URL.
- A merge to `main` IS a production deploy once those are set: only merge green PRs, and if the deploy job goes red after a merge, treat it as an incident (check the Render deploy, fix forward or revert).
- `/healthz` must keep returning `{ok, commit}`; the pipeline depends on it.

## Neon
- `neon.ts` declares the Neon services; `.neon` links this folder to the Neon project (org/project ids, no secrets). `neon deploy` / `neon env pull` write `.env.local` (git-ignored, holds passwords): never print, commit or paste its contents.
- App traffic uses the pooled `DATABASE_URL`; only the startup schema step uses the direct `DATABASE_URL_UNPOOLED` (`openDb(url, { migrationUrl })`). Keep `pg` (node-postgres): the server is a long-running Node process, which is what Neon's guidance prescribes.
- Neon's hosts are not reachable from the cloud sandbox unless the environment's network access allows them (HTTPS to `api.neon.tech`/`console.neon.tech` for the CLI, and raw Postgres connections to `*.neon.tech`).

## Conventions
- SQL is always parameterised (`$1…`). Ids from clients go through `toId` before reaching a query. Timestamps are `timestamptz`, serialised as ISO strings.
- Anything that must hold under concurrency is enforced by the database (unique index, atomic `UPDATE … WHERE status = 'pending' RETURNING`), not by check-then-write.
- Never leak phone numbers or emails in public responses; a housekeeper's phone is revealed only after they accept a request.
- Messaging lives inside an accepted request. Non-participants get `404` (never `403`) so ids can't be probed; messages are rendered as text only (web: text nodes, mobile: `<Text>`), never as HTML. Reading a conversation marks only the *other* person's messages read.
- One account can both hire and offer services. `users.role` only records what the person chose at sign-up (`both` is stored as `housekeeper`) and gates nothing: ownership is enforced by the queries (`hk_id`/`seeker_id`), and you can't request yourself. `GET /api/requests?as=sent|received` picks the list.
- Gated actions return `403` with `code: "email_not_verified"` for unconfirmed accounts.
- Web UI escapes all user text (`esc()`); mobile renders text via React Native (no HTML).
- New behaviour needs a test; a guard that protects security or data should be mutation-checked (break it on purpose, see the test fail, restore).
- Schema changes: add `ALTER TABLE … ADD COLUMN IF NOT EXISTS` / `CREATE … IF NOT EXISTS` in `db.js` so existing databases upgrade on startup, and say in the PR what happens to existing rows.

## Gotchas learned the hard way
- Don't `pkill -f <name>`: the pattern matches your own shell command and kills it. Kill by PID, or anchor the pattern (`pgrep -f "^node server/index"`).
- Resend's default test sender only delivers to the account owner's address; real users need a verified domain + `MAIL_FROM`.
- Browsers parse the `pattern` attribute in strict mode: escape `(` `)` inside character classes (`[0-9+\-\(\) ]`).
- `react-native-web`'s `Alert.alert` is a no-op and `expo-secure-store` has no web build; `e2e/run.sh` shims both in a throwaway copy only.
- Accounts created before email verification existed start unconfirmed (see README, "Upgrading an existing database").
