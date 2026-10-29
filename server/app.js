const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const auth = require("./auth");
const { openDb } = require("./db");
const { createMailer } = require("./mail");
const crypto = require("node:crypto");

const SERVICES = ["Cleaning", "Dishwashing", "Cooking", "Laundry", "Ironing", "Grocery shopping", "Child care", "Elder care"];
const AVAIL = ["Full-time", "Part-time", "Weekends"];
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (m) => new HttpError(400, m);

// Postgres integer columns reject NaN and values past int4, so validate ids before they reach a query.
const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};
const likeEscape = (s) => s.replace(/[\\%_]/g, "\\$&");

const str = (v, max, { required = false, label = "field" } = {}) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long`);
  return s;
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers["content-type"] || "")) return reject(new HttpError(415, "Content-Type must be application/json"));
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, "Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch { reject(bad("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// naive per-IP limiter for login/register to slow password guessing
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (arr.length > max) throw new HttpError(429, "Too many attempts, try again later");
  };
}

const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;
const MESSAGES_PER_MINUTE = 20;

async function createApp({
  databaseUrl = process.env.DATABASE_URL,
  migrationUrl = process.env.DATABASE_URL_UNPOOLED,
  schema,
  secureCookies = false,
  appUrl = "http://localhost:3000",
  trustProxy = false,
  sendMail = createMailer(),
} = {}) {
  const db = await openDb(databaseUrl, { schema, migrationUrl });
  const limitAuth = makeLimiter(20, 15 * 60 * 1000);

  // Behind a hosting proxy every connection comes from the proxy, so use the address it appended to X-Forwarded-For.
  const clientIp = (req) => {
    if (trustProxy) {
      const parts = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return req.socket.remoteAddress;
  };

  const routes = [];
  const route = (method, pattern, handler, { auth: needAuth = false, role, verified = false } = {}) =>
    routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), handler, needAuth, role, verified });

  // Issues a fresh verification link (replacing any earlier one) and emails it. Mail failures are logged, not thrown,
  // so a flaky provider can't block sign-up; the user can ask for another email.
  async function sendVerificationEmail(user) {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.query("DELETE FROM email_verifications WHERE user_id = $1 OR expires_at < now()", [user.id]);
    await db.query("INSERT INTO email_verifications (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
      [auth.sha256(token), user.id, new Date(Date.now() + VERIFY_TTL_MS)]);
    const link = `${appUrl.replace(/\/$/, "")}/verify.html?token=${token}`;
    try {
      await sendMail({
        to: user.email,
        subject: "Confirm your email for Help Seeker",
        text: `Hi ${user.name},\n\nConfirm your email address to start using Help Seeker (link valid for 24 hours):\n\n${link}\n\nIf you didn't create an account, ignore this email.`,
      });
    } catch (e) {
      console.error("verification email failed:", e.message);
    }
  }

  // ---- auth ----
  route("POST", "/api/register", async ({ body, ip, setToken }) => {
    limitAuth(ip);
    const email = str(body.email, 200, { required: true, label: "email" }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("invalid email");
    const name = str(body.name, 100, { required: true, label: "name" });
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200) throw bad("password must be 8–200 characters");
    if (!["seeker", "housekeeper"].includes(body.role)) throw bad("role must be seeker or housekeeper");
    if (await db.one("SELECT 1 FROM users WHERE email = $1", [email])) throw new HttpError(409, "email already registered");
    let row;
    try {
      row = await db.one("INSERT INTO users (email,name,role,pass_hash) VALUES ($1,$2,$3,$4) RETURNING id",
        [email, name, body.role, auth.hashPassword(password)]);
    } catch (e) {
      if (db.isUniqueViolation(e)) throw new HttpError(409, "email already registered"); // lost a race with another signup
      throw e;
    }
    setToken(await auth.createSession(db, row.id));
    await sendVerificationEmail({ id: row.id, email, name });
    return [201, { id: row.id, email, name, role: body.role, emailVerified: false }];
  });

  route("POST", "/api/login", async ({ body, ip, setToken }) => {
    limitAuth(ip);
    const email = str(body.email, 200).toLowerCase();
    const row = await db.one("SELECT * FROM users WHERE email = $1", [email]);
    const ok = row && typeof body.password === "string" && auth.verifyPassword(body.password, row.pass_hash);
    if (!ok) throw new HttpError(401, "wrong email or password");
    setToken(await auth.createSession(db, row.id));
    return { id: row.id, email: row.email, name: row.name, role: row.role, emailVerified: !!row.email_verified_at };
  });

  route("POST", "/api/logout", async ({ token, setToken }) => {
    await auth.destroySession(db, token);
    setToken(null);
    return { ok: true };
  });

  route("POST", "/api/email-verification/confirm", async ({ body, ip }) => {
    limitAuth(ip);
    const token = typeof body.token === "string" ? body.token : "";
    // One atomic statement consumes the token; only an unexpired one verifies the account.
    const row = await db.one("DELETE FROM email_verifications WHERE token_hash = $1 RETURNING user_id, expires_at > now() AS valid",
      [auth.sha256(token)]);
    if (!row || !row.valid) throw bad("this confirmation link is invalid or has expired");
    await db.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [row.user_id]);
    return { ok: true };
  });

  route("POST", "/api/email-verification/resend", async ({ user, ip }) => {
    limitAuth(ip);
    if (user.emailVerified) return { ok: true, alreadyVerified: true };
    const recent = await db.one(
      "SELECT 1 FROM email_verifications WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)",
      [user.id, RESEND_COOLDOWN_SECONDS]);
    if (recent) throw new HttpError(429, "We just sent you an email. Please wait a minute before asking for another.");
    await sendVerificationEmail(user);
    return { ok: true };
  }, { auth: true });

  // Always answers the same way so the endpoint can't be used to discover which emails have accounts.
  route("POST", "/api/password-reset/request", async ({ body, ip }) => {
    limitAuth(ip);
    const email = str(body.email, 200).toLowerCase();
    const user = await db.one("SELECT id, email FROM users WHERE email = $1", [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      await db.query("DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()", [user.id]);
      await db.query("INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
        [auth.sha256(token), user.id, new Date(Date.now() + RESET_TTL_MS)]);
      const link = `${appUrl.replace(/\/$/, "")}/reset.html?token=${token}`;
      try {
        await sendMail({
          to: user.email,
          subject: "Reset your Help Seeker password",
          text: `Use this link within 1 hour to choose a new password:\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
        });
      } catch (e) {
        console.error("password reset email failed:", e.message);
      }
    }
    return { ok: true, message: "If that email has an account, a reset link is on its way." };
  });

  route("POST", "/api/password-reset/confirm", async ({ body, ip }) => {
    limitAuth(ip);
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200) throw bad("password must be 8–200 characters");
    const token = typeof body.token === "string" ? body.token : "";
    // Single atomic statement: only one request can ever consume a given token.
    const row = await db.one("DELETE FROM password_resets WHERE token_hash = $1 RETURNING user_id, expires_at > now() AS valid",
      [auth.sha256(token)]);
    if (!row || !row.valid) throw bad("this reset link is invalid or has expired");
    // Following the emailed link proves the user controls the address, so it verifies it too.
    await db.query("UPDATE users SET pass_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2",
      [auth.hashPassword(password), row.user_id]);
    await db.query("DELETE FROM password_resets WHERE user_id = $1", [row.user_id]);
    await auth.destroyAllSessions(db, row.user_id); // anyone holding an old session is signed out
    return { ok: true };
  });

  // Permanently deletes the account and, via ON DELETE CASCADE, its profile, sessions, requests and reviews.
  route("POST", "/api/account/delete", async ({ user, body, setToken }) => {
    const row = await db.one("SELECT pass_hash FROM users WHERE id = $1", [user.id]);
    if (typeof body.password !== "string" || !auth.verifyPassword(body.password, row.pass_hash)) {
      throw new HttpError(403, "wrong password");
    }
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    setToken(null);
    return { ok: true };
  }, { auth: true });

  route("GET", "/api/me", async ({ user }) => {
    if (!user) return { user: null };
    const profile = user.role === "housekeeper"
      ? await db.one("SELECT city, phone, rate, exp, avail, services, bio FROM profiles WHERE user_id = $1", [user.id])
      : null;
    const unread = await db.one(
      `SELECT COUNT(*)::int AS n FROM messages m JOIN requests r ON r.id = m.request_id
       WHERE m.read_at IS NULL AND m.sender_id <> $1 AND (r.seeker_id = $1 OR r.hk_id = $1)`, [user.id]);
    return { user, profile, unreadMessages: unread.n };
  });

  // ---- housekeepers ----
  route("GET", "/api/housekeepers", async ({ query }) => {
    const { service, city, maxRate, avail, sort } = Object.fromEntries(query);
    const where = ["u.email_verified_at IS NOT NULL"], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
    if (service) add("p.services @> jsonb_build_array(?::text)", service);
    if (city) add("p.city ILIKE '%' || ? || '%'", likeEscape(city));
    if (Number(maxRate) > 0) add("p.rate <= ?", Math.min(Math.floor(Number(maxRate)), 2147483647));
    if (avail) add("p.avail = ?", avail);
    const order = {
      rate: "p.rate ASC",
      exp: "p.exp DESC",
      rating: "r.avg DESC NULLS LAST",
    }[sort] || "r.avg DESC NULLS LAST";
    const rows = await db.query(
      `SELECT p.user_id AS id, u.name, p.city, p.rate, p.exp, p.avail, p.services, p.bio,
              ROUND(r.avg::numeric, 1)::float8 AS rating, COALESCE(r.n, 0) AS reviews
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN (SELECT hk_id, AVG(rating) AS avg, COUNT(*)::int AS n FROM reviews GROUP BY hk_id) r ON r.hk_id = p.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${order}, p.user_id
       LIMIT 200`,
      params
    );
    return rows;
  });

  route("PUT", "/api/profile", async ({ user, body }) => {
    const services = Array.isArray(body.services) ? [...new Set(body.services)] : [];
    if (!services.length || services.some((s) => !SERVICES.includes(s))) throw bad("choose at least one valid service");
    if (!AVAIL.includes(body.avail)) throw bad("invalid availability");
    const rate = Number(body.rate), exp = Number(body.exp ?? 0);
    if (!Number.isInteger(rate) || rate < 0 || rate > 100000) throw bad("invalid rate");
    if (!Number.isInteger(exp) || exp < 0 || exp > 80) throw bad("invalid experience");
    const phone = str(body.phone, 30, { required: true, label: "phone" });
    if (!/^[0-9+\-() ]{7,}$/.test(phone)) throw bad("invalid phone");
    await db.query(
      `INSERT INTO profiles (user_id,city,phone,rate,exp,avail,services,bio) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (user_id) DO UPDATE SET city=EXCLUDED.city, phone=EXCLUDED.phone, rate=EXCLUDED.rate,
         exp=EXCLUDED.exp, avail=EXCLUDED.avail, services=EXCLUDED.services, bio=EXCLUDED.bio`,
      [user.id, str(body.city, 100, { required: true, label: "city" }), phone, rate, exp, body.avail,
        JSON.stringify(services), str(body.bio, 1000)]
    );
    return { ok: true };
  }, { auth: true, role: "housekeeper" });

  // ---- requests ----
  route("POST", "/api/requests", async ({ user, body }) => {
    const hkId = toId(body.housekeeperId);
    if (!hkId || !(await db.one("SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 AND u.email_verified_at IS NOT NULL", [hkId]))) throw new HttpError(404, "housekeeper not found");
    const phone = str(body.phone, 30, { required: true, label: "phone" });
    if (!/^[0-9+\-() ]{7,}$/.test(phone)) throw bad("invalid phone");
    try {
      const row = await db.one(
        "INSERT INTO requests (seeker_id,hk_id,seeker_phone,when_text,note) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [user.id, hkId, phone, str(body.when, 200), str(body.note, 1000)]
      );
      return [201, { id: row.id }];
    } catch (e) {
      if (db.isUniqueViolation(e)) throw new HttpError(409, "you already have a pending request with this housekeeper");
      throw e;
    }
  }, { auth: true, role: "seeker", verified: true });

  route("GET", "/api/requests", async ({ user }) => {
    if (user.role === "seeker") {
      return db.query(
        `SELECT r.id, r.status, r.when_text AS "when", r.note, r.created_at, r.hk_id, u.name AS hk_name,
           CASE WHEN r.status = 'accepted' THEN p.phone END AS hk_phone,
           (SELECT rating FROM reviews WHERE request_id = r.id) AS my_rating,
           (SELECT COUNT(*)::int FROM messages m WHERE m.request_id = r.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
         FROM requests r JOIN users u ON u.id = r.hk_id JOIN profiles p ON p.user_id = r.hk_id
         WHERE r.seeker_id = $1 ORDER BY r.id DESC`,
        [user.id]
      );
    }
    return db.query(
      `SELECT r.id, r.status, r.when_text AS "when", r.note, r.created_at, u.name AS seeker_name, r.seeker_phone,
         (SELECT COUNT(*)::int FROM messages m WHERE m.request_id = r.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
       FROM requests r JOIN users u ON u.id = r.seeker_id WHERE r.hk_id = $1 ORDER BY r.id DESC`,
      [user.id]
    );
  }, { auth: true });

  route("PATCH", "/api/requests/:id", async ({ user, body, params }) => {
    if (!["accepted", "declined"].includes(body.status)) throw bad("status must be accepted or declined");
    const id = toId(params.id);
    // Atomic: only a still-pending request can be answered, so two quick taps can't both win.
    const done = id && await db.one(
      "UPDATE requests SET status = $1 WHERE id = $2 AND hk_id = $3 AND status = 'pending' RETURNING id",
      [body.status, id, user.id]
    );
    if (done) return { ok: true };
    const exists = id && await db.one("SELECT 1 FROM requests WHERE id = $1 AND hk_id = $2", [id, user.id]);
    throw exists ? new HttpError(409, "request already answered") : new HttpError(404, "request not found");
  }, { auth: true, role: "housekeeper", verified: true });

  route("POST", "/api/requests/:id/review", async ({ user, body, params }) => {
    const id = toId(params.id);
    const r = id && await db.one("SELECT status, hk_id FROM requests WHERE id = $1 AND seeker_id = $2", [id, user.id]);
    if (!r) throw new HttpError(404, "request not found");
    if (r.status !== "accepted") throw new HttpError(409, "you can only review accepted requests");
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad("rating must be 1–5");
    try {
      await db.query("INSERT INTO reviews (request_id,hk_id,rating,comment) VALUES ($1,$2,$3,$4)",
        [id, r.hk_id, rating, str(body.comment, 1000)]);
    } catch (e) {
      if (db.isUniqueViolation(e)) throw new HttpError(409, "already reviewed");
      throw e;
    }
    return [201, { ok: true }];
  }, { auth: true, role: "seeker" });

  // ---- messages: a conversation lives inside an accepted request, between exactly its two people ----
  // Non-participants get 404 (not 403) so request ids can't be probed. Messaging opens when the housekeeper accepts,
  // the same moment their phone number is revealed, so nobody can message a housekeeper who hasn't agreed to talk.
  async function loadConversation(user, rawId) {
    const id = toId(rawId);
    const r = id && await db.one(
      `SELECT r.id, r.status, CASE WHEN r.seeker_id = $2 THEN hk.name ELSE s.name END AS other_name
       FROM requests r JOIN users s ON s.id = r.seeker_id JOIN users hk ON hk.id = r.hk_id
       WHERE r.id = $1 AND (r.seeker_id = $2 OR r.hk_id = $2)`, [id, user.id]);
    if (!r) throw new HttpError(404, "conversation not found");
    if (r.status !== "accepted") throw new HttpError(409, "Messaging opens once the housekeeper accepts the request.");
    return r;
  }

  route("GET", "/api/requests/:id/messages", async ({ user, params, query }) => {
    const c = await loadConversation(user, params.id);
    const after = toId(query.get("after")) || 0; // only newer messages, so polling stays cheap
    // Opening/polling a conversation counts as reading what the other person sent.
    await db.query("UPDATE messages SET read_at = now() WHERE request_id = $1 AND sender_id <> $2 AND read_at IS NULL", [c.id, user.id]);
    // Opening a conversation (no cursor) shows the *latest* 200 messages; later polls continue from the cursor.
    const messages = after
      ? await db.query(
        "SELECT id, sender_id = $2 AS mine, body, created_at FROM messages WHERE request_id = $1 AND id > $3 ORDER BY id LIMIT 200",
        [c.id, user.id, after])
      : await db.query(
        `SELECT * FROM (SELECT id, sender_id = $2 AS mine, body, created_at FROM messages WHERE request_id = $1 ORDER BY id DESC LIMIT 200) latest
         ORDER BY id`, [c.id, user.id]);
    return { with: c.other_name, messages };
  }, { auth: true, verified: true });

  route("POST", "/api/requests/:id/messages", async ({ user, params, body }) => {
    const c = await loadConversation(user, params.id);
    const text = str(body.body, 1000, { required: true, label: "message" });
    const recent = await db.one("SELECT COUNT(*)::int AS n FROM messages WHERE sender_id = $1 AND created_at > now() - interval '1 minute'", [user.id]);
    if (recent.n >= MESSAGES_PER_MINUTE) throw new HttpError(429, "You're sending messages too fast. Please wait a moment.");
    const row = await db.one("INSERT INTO messages (request_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, created_at", [c.id, user.id, text]);
    return [201, { id: row.id, mine: true, body: text, created_at: row.created_at }];
  }, { auth: true, verified: true });

  route("GET", "/api/meta", async () => ({ services: SERVICES, availability: AVAIL }));

  // `commit` lets the deploy pipeline check that the new version is the one actually serving traffic
  // (Render sets RENDER_GIT_COMMIT for every deploy; set GIT_COMMIT yourself on other hosts).
  route("GET", "/healthz", async () => {
    await db.one("SELECT 1");
    return { ok: true, commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null };
  });

  // ---- dispatch ----
  async function handleApi(req, res, url) {
    const cookies = auth.parseCookies(req.headers.cookie);
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
    const mobile = req.headers["x-client"] === "mobile";
    let token = bearer ? bearer[1] : cookies.sid;
    let cookieOut;
    const setToken = (t) => { token = t; cookieOut = auth.sessionCookie(t, secureCookies); };
    const user = await auth.userFromToken(db, token);

    let matched = null, params = {}, pathMatch = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatch = true;
      if (r.method === req.method) { matched = r; params = m.groups || {}; break; }
    }
    if (!matched) throw new HttpError(pathMatch ? 405 : 404, pathMatch ? "method not allowed" : "not found");
    if (matched.needAuth && !user) throw new HttpError(401, "sign in required");
    if (matched.role && user.role !== matched.role) throw new HttpError(403, `only ${matched.role}s can do this`);
    if (matched.verified && !user.emailVerified) {
      throw new HttpError(403, "Please verify your email address first. We sent you a link when you signed up.", "email_not_verified");
    }

    const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readJson(req) : {};
    const out = await matched.handler({ user, body, params, query: url.searchParams, token, setToken, ip: clientIp(req) });
    let [status, payload] = Array.isArray(out) && typeof out[0] === "number" ? out : [200, out];
    // Native apps can't rely on cookies: hand them the session token in the body. Browsers never get it
    // in JS-readable form (a cross-site page can't set X-Client without a CORS preflight, which we don't allow).
    if (mobile && cookieOut && token) payload = { ...payload, token };
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (cookieOut) headers["Set-Cookie"] = cookieOut;
    res.writeHead(status, headers);
    res.end(JSON.stringify(payload));
  }

  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
    const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, "not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: status === 500 ? "internal error" : e.message, ...(e.code && status !== 500 ? { code: e.code } : {}) }));
    }
  });
  server.on("close", () => { db.close().catch((e) => console.error("db close failed:", e.message)); });
  return { server, db };
}

module.exports = { createApp, SERVICES, AVAIL };
