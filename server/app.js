const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const auth = require("./auth");
const { openDb } = require("./db");

const SERVICES = ["Cleaning", "Dishwashing", "Cooking", "Laundry", "Ironing", "Grocery shopping", "Child care", "Elder care"];
const AVAIL = ["Full-time", "Part-time", "Weekends"];
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

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

function createApp({ dbFile = path.join(__dirname, "..", "data", "app.db"), secureCookies = false } = {}) {
  const db = openDb(dbFile);
  const limitAuth = makeLimiter(20, 15 * 60 * 1000);

  const housekeeperRow = (r) => ({
    id: r.user_id, name: r.name, city: r.city, rate: r.rate, exp: r.exp, avail: r.avail,
    services: JSON.parse(r.services), bio: r.bio,
    rating: r.reviews ? Math.round(r.avg * 10) / 10 : null, reviews: r.reviews,
  });

  const HK_SQL = `SELECT p.*, u.name,
      (SELECT AVG(rating) FROM reviews WHERE hk_id = p.user_id) AS avg,
      (SELECT COUNT(*) FROM reviews WHERE hk_id = p.user_id) AS reviews
    FROM profiles p JOIN users u ON u.id = p.user_id`;

  const routes = [];
  const route = (method, pattern, handler, { auth: needAuth = false, role } = {}) =>
    routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), handler, needAuth, role });

  // ---- auth ----
  route("POST", "/api/register", async ({ body, ip, setToken }) => {
    limitAuth(ip);
    const email = str(body.email, 200, { required: true, label: "email" }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("invalid email");
    const name = str(body.name, 100, { required: true, label: "name" });
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200) throw bad("password must be 8–200 characters");
    if (!["seeker", "housekeeper"].includes(body.role)) throw bad("role must be seeker or housekeeper");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "email already registered");
    const { lastInsertRowid } = db.prepare("INSERT INTO users (email,name,role,pass_hash) VALUES (?,?,?,?)")
      .run(email, name, body.role, auth.hashPassword(password));
    setToken(auth.createSession(db, Number(lastInsertRowid)));
    return [201, { id: Number(lastInsertRowid), email, name, role: body.role }];
  });

  route("POST", "/api/login", async ({ body, ip, setToken }) => {
    limitAuth(ip);
    const email = str(body.email, 200).toLowerCase();
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    const ok = row && typeof body.password === "string" && auth.verifyPassword(body.password, row.pass_hash);
    if (!ok) throw new HttpError(401, "wrong email or password");
    setToken(auth.createSession(db, row.id));
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  });

  route("POST", "/api/logout", async ({ token, setToken }) => {
    auth.destroySession(db, token);
    setToken(null);
    return { ok: true };
  });

  route("GET", "/api/me", async ({ user }) => {
    if (!user) return { user: null };
    const profile = user.role === "housekeeper"
      ? db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(user.id)
      : null;
    return { user, profile: profile && { ...profile, services: JSON.parse(profile.services) } };
  });

  // ---- housekeepers ----
  route("GET", "/api/housekeepers", async ({ query }) => {
    let rows = db.prepare(HK_SQL).all().map(housekeeperRow);
    const { service, city, maxRate, avail, sort } = Object.fromEntries(query);
    if (service) rows = rows.filter((h) => h.services.includes(service));
    if (city) rows = rows.filter((h) => h.city.toLowerCase().includes(city.toLowerCase()));
    if (Number(maxRate) > 0) rows = rows.filter((h) => h.rate <= Number(maxRate));
    if (avail) rows = rows.filter((h) => h.avail === avail);
    const by = {
      rate: (a, b) => a.rate - b.rate,
      exp: (a, b) => b.exp - a.exp,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    }[sort] || ((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return rows.sort(by);
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
    db.prepare(
      `INSERT INTO profiles (user_id,city,phone,rate,exp,avail,services,bio) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET city=excluded.city, phone=excluded.phone, rate=excluded.rate,
         exp=excluded.exp, avail=excluded.avail, services=excluded.services, bio=excluded.bio`
    ).run(user.id, str(body.city, 100, { required: true, label: "city" }), phone, rate, exp, body.avail,
      JSON.stringify(services), str(body.bio, 1000));
    return { ok: true };
  }, { auth: true, role: "housekeeper" });

  // ---- requests ----
  route("POST", "/api/requests", async ({ user, body }) => {
    const hkId = Number(body.housekeeperId);
    if (!db.prepare("SELECT 1 FROM profiles WHERE user_id = ?").get(hkId)) throw new HttpError(404, "housekeeper not found");
    const phone = str(body.phone, 30, { required: true, label: "phone" });
    if (!/^[0-9+\-() ]{7,}$/.test(phone)) throw bad("invalid phone");
    const dup = db.prepare("SELECT 1 FROM requests WHERE seeker_id=? AND hk_id=? AND status='pending'").get(user.id, hkId);
    if (dup) throw new HttpError(409, "you already have a pending request with this housekeeper");
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO requests (seeker_id,hk_id,seeker_phone,when_text,note) VALUES (?,?,?,?,?)"
    ).run(user.id, hkId, phone, str(body.when, 200), str(body.note, 1000));
    return [201, { id: Number(lastInsertRowid) }];
  }, { auth: true, role: "seeker" });

  route("GET", "/api/requests", async ({ user }) => {
    if (user.role === "seeker") {
      return db.prepare(
        `SELECT r.id, r.status, r.when_text AS "when", r.note, r.created_at, r.hk_id, u.name AS hk_name,
           CASE WHEN r.status = 'accepted' THEN p.phone END AS hk_phone,
           (SELECT rating FROM reviews WHERE request_id = r.id) AS my_rating
         FROM requests r JOIN users u ON u.id = r.hk_id JOIN profiles p ON p.user_id = r.hk_id
         WHERE r.seeker_id = ? ORDER BY r.id DESC`
      ).all(user.id);
    }
    return db.prepare(
      `SELECT r.id, r.status, r.when_text AS "when", r.note, r.created_at, u.name AS seeker_name, r.seeker_phone
       FROM requests r JOIN users u ON u.id = r.seeker_id WHERE r.hk_id = ? ORDER BY r.id DESC`
    ).all(user.id);
  }, { auth: true });

  route("PATCH", "/api/requests/:id", async ({ user, body, params }) => {
    if (!["accepted", "declined"].includes(body.status)) throw bad("status must be accepted or declined");
    const r = db.prepare("SELECT * FROM requests WHERE id = ? AND hk_id = ?").get(Number(params.id), user.id);
    if (!r) throw new HttpError(404, "request not found");
    if (r.status !== "pending") throw new HttpError(409, "request already answered");
    db.prepare("UPDATE requests SET status = ? WHERE id = ?").run(body.status, r.id);
    return { ok: true };
  }, { auth: true, role: "housekeeper" });

  route("POST", "/api/requests/:id/review", async ({ user, body, params }) => {
    const r = db.prepare("SELECT * FROM requests WHERE id = ? AND seeker_id = ?").get(Number(params.id), user.id);
    if (!r) throw new HttpError(404, "request not found");
    if (r.status !== "accepted") throw new HttpError(409, "you can only review accepted requests");
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad("rating must be 1–5");
    if (db.prepare("SELECT 1 FROM reviews WHERE request_id = ?").get(r.id)) throw new HttpError(409, "already reviewed");
    db.prepare("INSERT INTO reviews (request_id,hk_id,rating,comment) VALUES (?,?,?,?)")
      .run(r.id, r.hk_id, rating, str(body.comment, 1000));
    return [201, { ok: true }];
  }, { auth: true, role: "seeker" });

  route("GET", "/api/meta", async () => ({ services: SERVICES, availability: AVAIL }));

  // ---- dispatch ----
  async function handleApi(req, res, url) {
    const cookies = auth.parseCookies(req.headers.cookie);
    let token = cookies.sid;
    let cookieOut;
    const setToken = (t) => { token = t; cookieOut = auth.sessionCookie(t, secureCookies); };
    const user = auth.userFromToken(db, token);

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

    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};
    const out = await matched.handler({ user, body, params, query: url.searchParams, token, setToken, ip: req.socket.remoteAddress });
    const [status, payload] = Array.isArray(out) && typeof out[0] === "number" ? out : [200, out];
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
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: status === 500 ? "internal error" : e.message }));
    }
  });
  server.on("close", () => db.close());
  return { server, db };
}

module.exports = { createApp, SERVICES, AVAIL };
