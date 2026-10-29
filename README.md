# Help Seeker

Find a housekeeper (cleaning, dishwashing, cooking, laundry, elder care…), with accounts and a real backend.

## How it works
- **Households** create an account, search housekeepers (service, city, max rate, availability) and send a contact request.
- **Housekeepers** create an account, fill in a profile, and accept or decline incoming requests.
- A housekeeper's phone number is hidden until they **accept** your request; after that you can leave a 1–5★ review.
- Public search never exposes phone numbers or emails.

## Run
Requires Node 22.5+ (uses the built-in `node:sqlite`; no npm dependencies).

```sh
npm start            # http://localhost:3000
npm run seed         # optional demo housekeepers (password: demo-pass-123)
npm test
```

Environment:

| Variable | Purpose |
|---|---|
| `PORT` | default 3000 |
| `DB_FILE` | SQLite file, default `data/app.db` |
| `NODE_ENV=production` | marks cookies `Secure`; serve behind HTTPS |
| `APP_URL` | public base URL, used in password-reset links (e.g. `https://helpseeker.example.com`) |
| `RESEND_API_KEY`, `MAIL_FROM` | send reset emails through [Resend](https://resend.com) (free tier). Without a key, emails are printed to the server log. |

### Database and hosting
The database is a single SQLite file, which costs nothing. It must live on a **persistent disk**: most free app hosts (Render/Koyeb free tiers, Heroku-style dynos) wipe the filesystem on every restart or deploy, which would erase all accounts. Use a host with a persistent volume, or move to a free hosted Postgres.

## Mobile app
Android and iPhone app in [`mobile/`](mobile/README.md) (Expo / React Native) using the same API.

## API (JSON; state-changing requests need `Content-Type: application/json`)
| Method | Path | Who |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | anyone |
| POST | `/api/password-reset/request` `{email}`, `/api/password-reset/confirm` `{token, password}` | anyone |
| POST | `/api/account/delete` `{password}` | signed-in |
| GET | `/api/me`, `/api/meta`, `/api/housekeepers?service&city&maxRate&avail&sort` | anyone |
| PUT | `/api/profile` | housekeeper |
| POST | `/api/requests` | household |
| GET | `/api/requests` | signed-in (own requests only) |
| PATCH | `/api/requests/:id` `{status: accepted\|declined}` | housekeeper |
| POST | `/api/requests/:id/review` `{rating, comment}` | household |

## Security notes
Passwords hashed with scrypt; sessions are random tokens stored hashed, sent in an `HttpOnly; SameSite=Lax` cookie (web) or an `Authorization: Bearer` header (mobile, token returned only when the request sends `X-Client: mobile`); login/register/reset are rate-limited; reset links are single-use, expire after 1 hour and sign the user out everywhere; the reset endpoint answers identically whether or not the email exists per IP (in memory, single process); SQL is parameterised; the UI escapes all user text.

## Not yet done
Email/phone verification, ID/background checks, in-app messaging, payments, and a shared rate limiter if you run several instances.
