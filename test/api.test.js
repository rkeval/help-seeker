const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createApp } = require("../server/app");

// Tests need a real Postgres, e.g. TEST_DATABASE_URL=postgres://user:pass@localhost:5432/hs_test
// Each test gets its own throwaway schema inside it, so tests don't interfere with each other.
const TEST_URL = process.env.TEST_DATABASE_URL;
const test = (name, fn) => nodeTest(name, { skip: !TEST_URL && "set TEST_DATABASE_URL to run" }, fn);

async function start(opts = {}) {
  const schema = "t_" + crypto.randomBytes(6).toString("hex");
  const { server, db } = await createApp({ databaseUrl: TEST_URL, schema, sendMail: async () => {}, ...opts });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  // tiny client that keeps a cookie jar per "browser"
  const client = () => {
    let cookie = "";
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, headers: res.headers };
    };
  };
  return { server, client, db };
}

const profile = { city: "Pune", phone: "+91 98000 11111", rate: 150, exp: 4, avail: "Full-time", services: ["Cleaning", "Cooking"], bio: "hi" };

test("full flow: register, profile, search, request, accept, review", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const hk = client(), seeker = client(), anon = client();

  let r = await hk("POST", "/api/register", { email: "h@x.com", name: "Hema", password: "password123", role: "housekeeper" });
  assert.equal(r.status, 201);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await hk("PUT", "/api/profile", profile)).status, 200);

  await seeker("POST", "/api/register", { email: "s@x.com", name: "Sam", password: "password123", role: "seeker" });

  // public search never leaks phone numbers
  r = await anon("GET", "/api/housekeepers?service=Cooking&city=pun");
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].phone, undefined);
  assert.equal((await anon("GET", "/api/housekeepers?service=Laundry")).body.length, 0);
  const hkId = r.body[0].id;

  r = await seeker("POST", "/api/requests", { housekeeperId: hkId, phone: "99999 00000", when: "mornings", note: "2BHK" });
  assert.equal(r.status, 201);
  assert.equal((await seeker("POST", "/api/requests", { housekeeperId: hkId, phone: "99999 00000" })).status, 409);

  // housekeeper phone hidden until accepted
  r = await seeker("GET", "/api/requests");
  assert.equal(r.body[0].hk_phone, null);
  assert.equal((await seeker("POST", `/api/requests/${r.body[0].id}/review`, { rating: 5 })).status, 409);

  r = await hk("GET", "/api/requests");
  assert.equal(r.body[0].seeker_phone, "99999 00000");
  const reqId = r.body[0].id;
  assert.equal((await hk("PATCH", `/api/requests/${reqId}`, { status: "accepted" })).status, 200);
  assert.equal((await hk("PATCH", `/api/requests/${reqId}`, { status: "declined" })).status, 409);

  r = await seeker("GET", "/api/requests");
  assert.equal(r.body[0].hk_phone, profile.phone);

  assert.equal((await seeker("POST", `/api/requests/${reqId}/review`, { rating: 4, comment: "good" })).status, 201);
  assert.equal((await seeker("POST", `/api/requests/${reqId}/review`, { rating: 5 })).status, 409);
  r = await anon("GET", "/api/housekeepers");
  assert.equal(r.body[0].rating, 4);
  assert.equal(r.body[0].reviews, 1);
});

test("auth rules", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const a = client(), b = client();

  assert.equal((await a("GET", "/api/requests")).status, 401);
  assert.equal((await a("POST", "/api/register", { email: "bad", name: "x", password: "password123", role: "seeker" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "x", password: "short", role: "seeker" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "x", password: "password123", role: "admin" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "A", password: "password123", role: "seeker" })).status, 201);
  assert.equal((await b("POST", "/api/register", { email: "A@x.com", name: "A", password: "password123", role: "seeker" })).status, 409);

  assert.equal((await a("PUT", "/api/profile", profile)).status, 403); // seekers can't list themselves

  assert.equal((await b("POST", "/api/login", { email: "a@x.com", password: "wrong-password" })).status, 401);
  assert.equal((await b("POST", "/api/login", { email: "a@x.com", password: "password123" })).status, 200);
  assert.equal((await b("GET", "/api/me")).body.user.email, "a@x.com");
  assert.equal((await b("POST", "/api/logout", {})).status, 200);
  assert.equal((await b("GET", "/api/me")).body.user, null);
});

test("other users cannot answer or review someone else's request", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const hk1 = client(), hk2 = client(), s1 = client(), s2 = client();
  await hk1("POST", "/api/register", { email: "1@x.com", name: "H1", password: "password123", role: "housekeeper" });
  await hk1("PUT", "/api/profile", profile);
  await hk2("POST", "/api/register", { email: "2@x.com", name: "H2", password: "password123", role: "housekeeper" });
  await s1("POST", "/api/register", { email: "3@x.com", name: "S1", password: "password123", role: "seeker" });
  await s2("POST", "/api/register", { email: "4@x.com", name: "S2", password: "password123", role: "seeker" });
  const hkId = (await s1("GET", "/api/housekeepers")).body[0].id;
  await s1("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const id = (await s1("GET", "/api/requests")).body[0].id;

  assert.equal((await hk2("PATCH", `/api/requests/${id}`, { status: "accepted" })).status, 404);
  await hk1("PATCH", `/api/requests/${id}`, { status: "accepted" });
  assert.equal((await s2("POST", `/api/requests/${id}/review`, { rating: 1 })).status, 404);
  assert.deepEqual((await s2("GET", "/api/requests")).body, []);
});

test("input hardening", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const c = client();
  const base = `http://localhost:${server.address().port}`;
  let res = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(res.status, 415);
  res = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(res.status, 400);
  res = await fetch(base + "/..%2f..%2fpackage.json");
  assert.equal(res.status, 404);
  assert.equal((await c("GET", "/")).status, 200);
});

test("mobile clients authenticate with a bearer token, browsers never get one", async (t) => {
  const { server } = await start();
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const creds = { email: "m@x.com", name: "Mo", password: "password123", role: "seeker" };

  let res = await post("/api/register", creds);
  assert.equal((await res.json()).token, undefined); // plain browser: cookie only

  res = await post("/api/login", creds, { "X-Client": "mobile" });
  const { token } = await res.json();
  assert.ok(token);

  res = await fetch(base + "/api/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await res.json()).user.email, "m@x.com");

  res = await post("/api/logout", {}, { Authorization: `Bearer ${token}` });
  assert.equal(res.status, 200);
  res = await fetch(base + "/api/me", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await res.json()).user, null);
});

test("password reset: emailed single-use link, revokes sessions, no account enumeration", async (t) => {
  const mails = [];
  const { server, client, db } = await start({ appUrl: "https://app.test", sendMail: async (m) => mails.push(m) });
  t.after(() => server.close());
  const a = client(), other = client(), anon = client();
  await a("POST", "/api/register", { email: "r@x.com", name: "R", password: "old-password-1", role: "seeker" });

  const known = await anon("POST", "/api/password-reset/request", { email: "R@x.com" });
  const unknown = await anon("POST", "/api/password-reset/request", { email: "nobody@x.com" });
  assert.deepEqual(known.body, unknown.body); // identical answer either way
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "r@x.com");
  const token = /reset\.html\?token=([\w-]+)/.exec(mails[0].text)[1];
  assert.match(mails[0].text, /^Use this link/);
  assert.ok(mails[0].text.includes("https://app.test/reset.html"));

  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: "bogus", password: "new-password-1" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "short" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "new-password-1" })).status, 200);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "another-pass-1" })).status, 400); // single use

  assert.equal((await a("GET", "/api/me")).body.user, null); // old session revoked
  assert.equal((await other("POST", "/api/login", { email: "r@x.com", password: "old-password-1" })).status, 401);
  assert.equal((await other("POST", "/api/login", { email: "r@x.com", password: "new-password-1" })).status, 200);

  // expired token
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  const t2 = /token=([\w-]+)/.exec(mails[1].text)[1];
  await db.query("UPDATE password_resets SET expires_at = now() - interval '1 second'");
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: t2, password: "new-password-2" })).status, 400);

  // a new request replaces the earlier link
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  const [first, second] = [mails[2], mails[3]].map((m) => /token=([\w-]+)/.exec(m.text)[1]);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: first, password: "new-password-3" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: second, password: "new-password-3" })).status, 200);
});

test("a failing mail provider doesn't change the response or crash", async (t) => {
  const { server, client } = await start({ sendMail: async () => { throw new Error("boom"); } });
  t.after(() => server.close());
  const a = client();
  await a("POST", "/api/register", { email: "f@x.com", name: "F", password: "password123", role: "seeker" });
  const r = await a("POST", "/api/password-reset/request", { email: "f@x.com" });
  assert.equal(r.status, 200);
});

test("account deletion removes the user and everything attached to them", async (t) => {
  const { server, client, db } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await hk("POST", "/api/register", { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await s("POST", "/api/register", { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  const hkId = (await anon("GET", "/api/housekeepers")).body[0].id;
  await s("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const reqId = (await hk("GET", "/api/requests")).body[0].id;
  await hk("PATCH", `/api/requests/${reqId}`, { status: "accepted" });
  await s("POST", `/api/requests/${reqId}/review`, { rating: 5 });

  assert.equal((await anon("POST", "/api/account/delete", { password: "password123" })).status, 401);
  assert.equal((await hk("POST", "/api/account/delete", { password: "wrong-password" })).status, 403);
  assert.equal((await hk("POST", "/api/account/delete", {})).status, 403);
  assert.equal((await hk("GET", "/api/me")).body.user.email, "h@x.com"); // still there

  const del = await hk("POST", "/api/account/delete", { password: "password123" });
  assert.equal(del.status, 200);
  assert.match(del.headers.get("set-cookie"), /Max-Age=0/);

  assert.equal((await hk("GET", "/api/me")).body.user, null);
  assert.equal((await anon("GET", "/api/housekeepers")).body.length, 0);
  assert.equal((await hk("POST", "/api/login", { email: "h@x.com", password: "password123" })).status, 401);
  const count = async (table, where = "true", ...args) => (await db.one(`SELECT COUNT(*)::int n FROM ${table} WHERE ${where}`, args)).n;
  assert.equal(await count("profiles", "user_id = $1", hkId), 0);
  assert.equal(await count("sessions", "user_id = $1", hkId), 0);
  assert.equal(await count("requests"), 0);
  assert.equal(await count("reviews"), 0);
  assert.deepEqual((await s("GET", "/api/requests")).body, []); // the household survives, request is gone
  assert.equal((await s("GET", "/api/me")).body.user.email, "s@x.com");
});

test("malformed ids return 4xx instead of crashing the database driver", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const hk = client(), s = client();
  await hk("POST", "/api/register", { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await s("POST", "/api/register", { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  for (const bad of ["abc", "NaN", -1, 0, 1.5, 99999999999, null, "1; DROP TABLE users"]) {
    assert.equal((await s("POST", "/api/requests", { housekeeperId: bad, phone: "1234567" })).status, 404, String(bad));
  }
  for (const bad of ["abc", "0", "99999999999", "1e9999"]) {
    assert.equal((await hk("PATCH", `/api/requests/${bad}`, { status: "accepted" })).status, 404, bad);
    assert.equal((await s("POST", `/api/requests/${bad}/review`, { rating: 5 })).status, 404, bad);
  }
  assert.equal((await s("GET", "/api/housekeepers?maxRate=99999999999999999999")).status, 200);
});

test("concurrent duplicate requests and double-answers are resolved by the database", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await hk("POST", "/api/register", { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await s("POST", "/api/register", { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  const hkId = (await anon("GET", "/api/housekeepers")).body[0].id;

  const sent = await Promise.all([1, 2, 3, 4].map(() => s("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" })));
  assert.deepEqual(sent.map((r) => r.status).sort(), [201, 409, 409, 409]);

  const id = (await hk("GET", "/api/requests")).body[0].id;
  const answers = await Promise.all(["accepted", "declined", "accepted"].map((status) => hk("PATCH", `/api/requests/${id}`, { status })));
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 409, 409]);

  const reviews = await Promise.all([5, 1, 3].map((rating) => s("POST", `/api/requests/${id}/review`, { rating })));
  if ((await s("GET", "/api/requests")).body[0].status === "accepted") {
    assert.deepEqual(reviews.map((r) => r.status).sort(), [201, 409, 409]);
  }
});

test("a reset token can only be consumed once even under concurrency", async (t) => {
  const mails = [];
  const { server, client } = await start({ sendMail: async (m) => mails.push(m) });
  t.after(() => server.close());
  const a = client();
  await a("POST", "/api/register", { email: "c@x.com", name: "C", password: "password123", role: "seeker" });
  await a("POST", "/api/password-reset/request", { email: "c@x.com" });
  const token = /token=([\w-]+)/.exec(mails[0].text)[1];
  const results = await Promise.all(["pw-number-one", "pw-number-two", "pw-number-three"]
    .map((password) => client()("POST", "/api/password-reset/confirm", { token, password })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
});

test("search: ordering, filters and LIKE wildcards are handled literally", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const anon = client(), s = client();
  const mk = async (email, name, over) => {
    const c = client();
    await c("POST", "/api/register", { email, name, password: "password123", role: "housekeeper" });
    await c("PUT", "/api/profile", { ...profile, ...over });
    return c;
  };
  const hkA = await mk("a@x.com", "Alice", { city: "Pune", rate: 300, exp: 1, services: ["Cooking"] });
  await mk("b@x.com", "Bob", { city: "100% Fun_City", rate: 100, exp: 9, services: ["Cleaning"], avail: "Weekends" });
  await mk("c@x.com", "Cara", { city: "Delhi", rate: 200, exp: 5, services: ["Cleaning", "Cooking"] });

  const names = async (q) => (await anon("GET", "/api/housekeepers" + q)).body.map((h) => h.name);
  assert.deepEqual(await names("?sort=rate"), ["Bob", "Cara", "Alice"]);
  assert.deepEqual(await names("?sort=exp"), ["Bob", "Cara", "Alice"]);
  assert.deepEqual(await names("?service=Cleaning&sort=rate"), ["Bob", "Cara"]);
  assert.deepEqual(await names("?maxRate=200&sort=rate"), ["Bob", "Cara"]);
  assert.deepEqual(await names("?avail=Weekends"), ["Bob"]);
  assert.deepEqual(await names("?city=DEL"), ["Cara"]); // case-insensitive substring
  assert.deepEqual(await names("?city=" + encodeURIComponent("%")), ["Bob"]); // % is literal, not "match everything"
  assert.deepEqual(await names("?city=" + encodeURIComponent("_")), ["Bob"]);
  assert.deepEqual(await names("?service=" + encodeURIComponent("Cooking' OR '1'='1")), []);

  // unrated housekeepers sort after rated ones
  await s("POST", "/api/register", { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  const alice = (await anon("GET", "/api/housekeepers?city=Pune")).body[0];
  await s("POST", "/api/requests", { housekeeperId: alice.id, phone: "1234567" });
  const rid = (await hkA("GET", "/api/requests")).body[0].id;
  await hkA("PATCH", `/api/requests/${rid}`, { status: "accepted" });
  await s("POST", `/api/requests/${rid}/review`, { rating: 4 });
  const top = (await anon("GET", "/api/housekeepers?sort=rating")).body;
  assert.equal(top[0].name, "Alice");
  assert.equal(top[0].rating, 4);
  assert.equal(top[1].rating, null);
});

test("timestamps are ISO strings and /healthz checks the database", async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await hk("POST", "/api/register", { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await s("POST", "/api/register", { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  const hkId = (await anon("GET", "/api/housekeepers")).body[0].id;
  await s("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const at = (await s("GET", "/api/requests")).body[0].created_at;
  assert.match(at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.ok(Math.abs(Date.parse(at) - Date.now()) < 60_000);
  const h = await anon("GET", "/healthz");
  assert.equal(h.status, 200);
  assert.deepEqual(h.body, { ok: true });
});

test("rate limiting is per client IP and honours X-Forwarded-For only when the proxy is trusted", async (t) => {
  const run = async (trustProxy) => {
    const { server } = await start({ trustProxy });
    t.after(() => server.close());
    const base = `http://localhost:${server.address().port}`;
    const hit = (ip) => fetch(base + "/api/login", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: "x@x.com", password: "wrong-password" }),
    }).then((r) => r.status);
    for (let i = 0; i < 20; i++) await hit("1.1.1.1");
    return { first: await hit("1.1.1.1"), other: await hit("2.2.2.2") };
  };
  assert.deepEqual(await run(true), { first: 429, other: 401 });   // behind a proxy: users are limited separately
  assert.deepEqual(await run(false), { first: 429, other: 429 });  // not trusted: header is ignored, can't be used to dodge the limit
});
