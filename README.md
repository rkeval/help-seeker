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

Environment: `PORT` (default 3000), `DB_FILE` (default `data/app.db`), `NODE_ENV=production` (marks cookies `Secure`; serve behind HTTPS).

## API (JSON; state-changing requests need `Content-Type: application/json`)
| Method | Path | Who |
|---|---|---|
| POST | `/api/register`, `/api/login`, `/api/logout` | anyone |
| GET | `/api/me`, `/api/meta`, `/api/housekeepers?service&city&maxRate&avail&sort` | anyone |
| PUT | `/api/profile` | housekeeper |
| POST | `/api/requests` | household |
| GET | `/api/requests` | signed-in (own requests only) |
| PATCH | `/api/requests/:id` `{status: accepted\|declined}` | housekeeper |
| POST | `/api/requests/:id/review` `{rating, comment}` | household |

## Security notes
Passwords hashed with scrypt; sessions are random tokens stored hashed, sent in an `HttpOnly; SameSite=Lax` cookie; login/register are rate-limited per IP (in memory, single process); SQL is parameterised; the UI escapes all user text.

## Not yet done
Email/phone verification, password reset, ID/background checks, in-app messaging, payments, and a shared rate limiter if you run several instances.
