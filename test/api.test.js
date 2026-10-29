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
  const mails = []; // every email the app "sent"
  const sendMail = async (m) => { mails.push(m); if (opts.sendMail) await opts.sendMail(m); };
  const { server, db } = await createApp({ databaseUrl: TEST_URL, schema, ...opts, sendMail });
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
  // Signs a user up and, like a real user, clicks the confirmation link in the email they were sent.
  const register = async (c, body) => {
    const r = await c("POST", "/api/register", body);
    const mail = [...mails].reverse().find((m) => m.to === body.email.toLowerCase() && m.text.includes("/verify.html"));
    if (r.status === 201) {
      const token = /token=([\w-]+)/.exec(mail.text)[1];
      assert.equal((await c("POST", "/api/email-verification/confirm", { token })).status, 200);
    }
    return r;
  };
  return { server, client, db, mails, register };
}

const profile = { city: "Pune", phone: "+91 98000 11111", rate: 150, exp: 4, avail: "Full-time", services: ["Cleaning", "Cooking"], bio: "hi" };

test("full flow: register, profile, search, request, accept, review", async (t) => {
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const hk = client(), seeker = client(), anon = client();

  let r = await register(hk, { email: "h@x.com", name: "Hema", password: "password123", role: "housekeeper" });
  assert.equal(r.status, 201);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await hk("PUT", "/api/profile", profile)).status, 200);

  await register(seeker, { email: "s@x.com", name: "Sam", password: "password123", role: "seeker" });

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
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const a = client(), b = client();

  assert.equal((await a("GET", "/api/requests")).status, 401);
  assert.equal((await a("POST", "/api/register", { email: "bad", name: "x", password: "password123", role: "seeker" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "x", password: "short", role: "seeker" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "x", password: "password123", role: "admin" })).status, 400);
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "x", password: "password123", role: "Both" })).status, 400); // exact values only
  assert.equal((await a("POST", "/api/register", { email: "a@x.com", name: "A", password: "password123", role: "seeker" })).status, 201);
  assert.equal((await b("POST", "/api/register", { email: "A@x.com", name: "A", password: "password123", role: "seeker" })).status, 409);

  assert.equal((await a("PUT", "/api/profile", profile)).status, 200); // anyone can add a housekeeper profile: no account is "household only"

  assert.equal((await b("POST", "/api/login", { email: "a@x.com", password: "wrong-password" })).status, 401);
  assert.equal((await b("POST", "/api/login", { email: "a@x.com", password: "password123" })).status, 200);
  assert.equal((await b("GET", "/api/me")).body.user.email, "a@x.com");
  assert.equal((await b("POST", "/api/logout", {})).status, 200);
  assert.equal((await b("GET", "/api/me")).body.user, null);
});

test("other users cannot answer or review someone else's request", async (t) => {
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const hk1 = client(), hk2 = client(), s1 = client(), s2 = client();
  await register(hk1, { email: "1@x.com", name: "H1", password: "password123", role: "housekeeper" });
  await hk1("PUT", "/api/profile", profile);
  await register(hk2, { email: "2@x.com", name: "H2", password: "password123", role: "housekeeper" });
  await register(s1, { email: "3@x.com", name: "S1", password: "password123", role: "seeker" });
  await register(s2, { email: "4@x.com", name: "S2", password: "password123", role: "seeker" });
  const hkId = (await s1("GET", "/api/housekeepers")).body[0].id;
  await s1("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const id = (await s1("GET", "/api/requests")).body[0].id;

  assert.equal((await hk2("PATCH", `/api/requests/${id}`, { status: "accepted" })).status, 404);
  await hk1("PATCH", `/api/requests/${id}`, { status: "accepted" });
  assert.equal((await s2("POST", `/api/requests/${id}/review`, { rating: 1 })).status, 404);
  assert.deepEqual((await s2("GET", "/api/requests")).body, []);
});

test("input hardening", async (t) => {
  const { server, client, register, mails } = await start();
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
  const { server, register, mails } = await start();
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
  const { server, client, db, register, mails } = await start({ appUrl: "https://app.test" });
  const resets = () => mails.filter((m) => /Reset/.test(m.subject));
  t.after(() => server.close());
  const a = client(), other = client(), anon = client();
  await register(a, { email: "r@x.com", name: "R", password: "old-password-1", role: "seeker" });

  const known = await anon("POST", "/api/password-reset/request", { email: "R@x.com" });
  const unknown = await anon("POST", "/api/password-reset/request", { email: "nobody@x.com" });
  assert.deepEqual(known.body, unknown.body); // identical answer either way
  assert.equal(resets().length, 1);
  assert.equal(resets()[0].to, "r@x.com");
  const token = /reset\.html\?token=([\w-]+)/.exec(resets()[0].text)[1];
  assert.match(resets()[0].text, /^Use this link/);
  assert.ok(resets()[0].text.includes("https://app.test/reset.html"));

  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: "bogus", password: "new-password-1" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "short" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "new-password-1" })).status, 200);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token, password: "another-pass-1" })).status, 400); // single use

  assert.equal((await a("GET", "/api/me")).body.user, null); // old session revoked
  assert.equal((await other("POST", "/api/login", { email: "r@x.com", password: "old-password-1" })).status, 401);
  assert.equal((await other("POST", "/api/login", { email: "r@x.com", password: "new-password-1" })).status, 200);

  // expired token
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  const t2 = /token=([\w-]+)/.exec(resets()[1].text)[1];
  await db.query("UPDATE password_resets SET expires_at = now() - interval '1 second'");
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: t2, password: "new-password-2" })).status, 400);

  // a new request replaces the earlier link
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  await anon("POST", "/api/password-reset/request", { email: "r@x.com" });
  const [first, second] = [resets()[2], resets()[3]].map((m) => /token=([\w-]+)/.exec(m.text)[1]);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: first, password: "new-password-3" })).status, 400);
  assert.equal((await anon("POST", "/api/password-reset/confirm", { token: second, password: "new-password-3" })).status, 200);
});

test("a failing mail provider doesn't change the response or crash", async (t) => {
  const { server, client, register, mails } = await start({ sendMail: async () => { throw new Error("boom"); } });
  t.after(() => server.close());
  const a = client();
  const signup = await a("POST", "/api/register", { email: "f@x.com", name: "F", password: "password123", role: "seeker" });
  assert.equal(signup.status, 201); // a broken mail provider must not block sign-up
  const r = await a("POST", "/api/password-reset/request", { email: "f@x.com" });
  assert.equal(r.status, 200);
});

test("account deletion removes the user and everything attached to them", async (t) => {
  const { server, client, db, register, mails } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await register(hk, { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await register(s, { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
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
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const hk = client(), s = client();
  await register(hk, { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await register(s, { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
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
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await register(hk, { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await register(s, { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
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
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const a = client();
  await register(a, { email: "c@x.com", name: "C", password: "password123", role: "seeker" });
  await a("POST", "/api/password-reset/request", { email: "c@x.com" });
  const token = /token=([\w-]+)/.exec(mails.find((m) => /Reset/.test(m.subject)).text)[1];
  const results = await Promise.all(["pw-number-one", "pw-number-two", "pw-number-three"]
    .map((password) => client()("POST", "/api/password-reset/confirm", { token, password })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
});

test("search: ordering, filters and LIKE wildcards are handled literally", async (t) => {
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const anon = client(), s = client();
  const mk = async (email, name, over) => {
    const c = client();
    await register(c, { email, name, password: "password123", role: "housekeeper" });
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
  await register(s, { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
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
  const { server, client, register, mails } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), anon = client();
  await register(hk, { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await register(s, { email: "s@x.com", name: "S", password: "password123", role: "seeker" });
  const hkId = (await anon("GET", "/api/housekeepers")).body[0].id;
  await s("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const at = (await s("GET", "/api/requests")).body[0].created_at;
  assert.match(at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.ok(Math.abs(Date.parse(at) - Date.now()) < 60_000);
  const h = await anon("GET", "/healthz");
  assert.equal(h.status, 200);
  assert.deepEqual(h.body, { ok: true, commit: null }); // `commit` is filled in by the host (RENDER_GIT_COMMIT) so deploys can be verified
});

test("rate limiting is per client IP and honours X-Forwarded-For only when the proxy is trusted", async (t) => {
  const run = async (trustProxy) => {
    const { server, register, mails } = await start({ trustProxy });
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

const tokenFrom = (mail) => /token=([\w-]+)/.exec(mail.text)[1];
const verifyMails = (mails, to) => mails.filter((m) => m.to === to && m.text.includes("/verify.html"));

test("new accounts get a confirmation email and start unverified", async (t) => {
  const { server, client, mails } = await start({ appUrl: "https://app.test" });
  t.after(() => server.close());
  const a = client();
  const r = await a("POST", "/api/register", { email: "New@X.com", name: "Nia", password: "password123", role: "seeker" });
  assert.equal(r.status, 201);
  assert.equal(r.body.emailVerified, false);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "new@x.com");
  assert.match(mails[0].text, /^Hi Nia,/);
  assert.ok(mails[0].text.includes("https://app.test/verify.html?token="));
  assert.equal((await a("GET", "/api/me")).body.user.emailVerified, false);

  const login = await client()("POST", "/api/login", { email: "new@x.com", password: "password123" });
  assert.equal(login.body.emailVerified, false);
});

test("unverified users can sign in and browse but not contact or be contacted", async (t) => {
  const { server, client, mails } = await start();
  t.after(() => server.close());
  const hk = client(), s = client(), vhk = client(), anon = client();

  // a verified housekeeper to contact
  await vhk("POST", "/api/register", { email: "v@x.com", name: "Vera", password: "password123", role: "housekeeper" });
  const vtoken = tokenFrom(verifyMails(mails, "v@x.com")[0]);
  await vhk("PUT", "/api/profile", profile);
  await anon("POST", "/api/email-verification/confirm", { token: vtoken });

  // unverified housekeeper: can save a profile, but stays hidden and can't answer requests
  await hk("POST", "/api/register", { email: "u@x.com", name: "Uma", password: "password123", role: "housekeeper" });
  assert.equal((await hk("PUT", "/api/profile", profile)).status, 200);
  assert.deepEqual((await anon("GET", "/api/housekeepers")).body.map((h) => h.name), ["Vera"]);
  let r = await hk("PATCH", "/api/requests/1", { status: "accepted" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "email_not_verified");

  // unverified household: can browse, can't send a request
  await s("POST", "/api/register", { email: "s@x.com", name: "Sam", password: "password123", role: "seeker" });
  const veraId = (await s("GET", "/api/housekeepers")).body[0].id;
  r = await s("POST", "/api/requests", { housekeeperId: veraId, phone: "1234567" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "email_not_verified");
  assert.match(r.body.error, /verify your email/i);

  // nobody can send a request to an unverified housekeeper either, even a verified household
  const umaId = (await hk("GET", "/api/me")).body.user.id;
  await s("POST", "/api/email-verification/confirm", { token: tokenFrom(verifyMails(mails, "s@x.com")[0]) });
  assert.equal((await s("POST", "/api/requests", { housekeeperId: umaId, phone: "1234567" })).status, 404);
  assert.equal((await s("POST", "/api/requests", { housekeeperId: veraId, phone: "1234567" })).status, 201);
});

test("confirming the link verifies the account once, and bad or expired links are refused", async (t) => {
  const { server, client, db, mails } = await start();
  t.after(() => server.close());
  const hk = client(), anon = client();
  await hk("POST", "/api/register", { email: "h@x.com", name: "H", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  assert.equal((await anon("GET", "/api/housekeepers")).body.length, 0);

  assert.equal((await anon("POST", "/api/email-verification/confirm", { token: "bogus" })).status, 400);
  assert.equal((await anon("POST", "/api/email-verification/confirm", {})).status, 400);

  const token = tokenFrom(verifyMails(mails, "h@x.com")[0]);
  assert.equal((await anon("POST", "/api/email-verification/confirm", { token })).status, 200); // works without a session
  assert.equal((await hk("GET", "/api/me")).body.user.emailVerified, true);
  assert.equal((await anon("GET", "/api/housekeepers")).body.length, 1); // now listed
  assert.equal((await anon("POST", "/api/email-verification/confirm", { token })).status, 400); // single use

  // expired link
  const late = client();
  await late("POST", "/api/register", { email: "late@x.com", name: "L", password: "password123", role: "seeker" });
  const t2 = tokenFrom(verifyMails(mails, "late@x.com")[0]);
  await db.query("UPDATE email_verifications SET expires_at = now() - interval '1 second'");
  assert.equal((await anon("POST", "/api/email-verification/confirm", { token: t2 })).status, 400);
  assert.equal((await late("GET", "/api/me")).body.user.emailVerified, false);
});

test("a verification token can only be consumed once under concurrency", async (t) => {
  const { server, client, mails } = await start();
  t.after(() => server.close());
  await client()("POST", "/api/register", { email: "c@x.com", name: "C", password: "password123", role: "seeker" });
  const token = tokenFrom(verifyMails(mails, "c@x.com")[0]);
  const results = await Promise.all([1, 2, 3, 4].map(() => client()("POST", "/api/email-verification/confirm", { token })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400, 400]);
});

test("resending: needs sign-in, is rate limited, replaces the old link, skips verified users", async (t) => {
  const { server, client, db, mails } = await start();
  t.after(() => server.close());
  const a = client(), anon = client();
  assert.equal((await anon("POST", "/api/email-verification/resend", {})).status, 401);

  await a("POST", "/api/register", { email: "r@x.com", name: "R", password: "password123", role: "seeker" });
  const first = tokenFrom(verifyMails(mails, "r@x.com")[0]);

  // right after sign-up another email is refused
  assert.equal((await a("POST", "/api/email-verification/resend", {})).status, 429);
  assert.equal(verifyMails(mails, "r@x.com").length, 1);

  // after the cooldown a new email goes out and the earlier link stops working
  await db.query("UPDATE email_verifications SET created_at = now() - interval '2 minutes'");
  assert.equal((await a("POST", "/api/email-verification/resend", {})).status, 200);
  assert.equal(verifyMails(mails, "r@x.com").length, 2);
  const second = tokenFrom(verifyMails(mails, "r@x.com")[1]);
  assert.notEqual(first, second);
  assert.equal((await anon("POST", "/api/email-verification/confirm", { token: first })).status, 400);
  assert.equal((await anon("POST", "/api/email-verification/confirm", { token: second })).status, 200);

  // already verified: nothing is sent
  const r = await a("POST", "/api/email-verification/resend", {});
  assert.deepEqual(r.body, { ok: true, alreadyVerified: true });
  assert.equal(verifyMails(mails, "r@x.com").length, 2);
});

test("completing a password reset also verifies the email address", async (t) => {
  const { server, client, mails } = await start();
  t.after(() => server.close());
  const a = client(), anon = client();
  await a("POST", "/api/register", { email: "p@x.com", name: "P", password: "password123", role: "seeker" });
  assert.equal((await a("GET", "/api/me")).body.user.emailVerified, false);
  await anon("POST", "/api/password-reset/request", { email: "p@x.com" });
  const token = tokenFrom(mails.find((m) => /Reset/.test(m.subject)));
  await anon("POST", "/api/password-reset/confirm", { token, password: "brand-new-pass" });
  const login = await client()("POST", "/api/login", { email: "p@x.com", password: "brand-new-pass" });
  assert.equal(login.body.emailVerified, true);
});

// ---- messaging ----
// A verified housekeeper and household with one request; `accept` decides whether it was accepted.
async function chatSetup(t, { accept = true } = {}) {
  const ctx = await start();
  t.after(() => ctx.server.close());
  const { client, register } = ctx;
  const hk = client(), s = client(), anon = client();
  await register(hk, { email: "h@x.com", name: "Hema", password: "password123", role: "housekeeper" });
  await hk("PUT", "/api/profile", profile);
  await register(s, { email: "s@x.com", name: "Sam", password: "password123", role: "seeker" });
  const hkId = (await anon("GET", "/api/housekeepers")).body[0].id;
  await s("POST", "/api/requests", { housekeeperId: hkId, phone: "1234567" });
  const reqId = (await s("GET", "/api/requests")).body[0].id;
  if (accept) await hk("PATCH", `/api/requests/${reqId}`, { status: "accepted" });
  return { ...ctx, hk, s, anon, hkId, reqId, msgs: `/api/requests/${reqId}/messages` };
}

test("messaging: both people talk inside an accepted request, with unread counts and read marking", async (t) => {
  const { hk, s, msgs } = await chatSetup(t);

  assert.deepEqual((await s("GET", msgs)).body, { with: "Hema", messages: [] });
  assert.equal((await hk("GET", msgs)).body.with, "Sam");

  const sent = await s("POST", msgs, { body: "  Hi Hema, are you free Monday?  " });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.body, "Hi Hema, are you free Monday?"); // trimmed
  assert.equal(sent.body.mine, true);

  // the sender polling their own conversation (as the apps do) must not mark their message as read by the other person
  await s("GET", msgs); await s("GET", `${msgs}?after=${sent.body.id}`);

  // the housekeeper sees one unread message everywhere it's counted; the sender sees none
  assert.equal((await hk("GET", "/api/me")).body.unreadMessages, 1);
  assert.equal((await hk("GET", "/api/requests")).body[0].unread, 1);
  assert.equal((await s("GET", "/api/me")).body.unreadMessages, 0);
  assert.equal((await s("GET", "/api/requests")).body[0].unread, 0);

  // reading it clears the unread count and flips `mine` per viewer
  let r = await hk("GET", msgs);
  assert.deepEqual(r.body.messages.map((m) => [m.body, m.mine]), [["Hi Hema, are you free Monday?", false]]);
  assert.equal((await hk("GET", "/api/me")).body.unreadMessages, 0);
  assert.equal((await hk("GET", "/api/requests")).body[0].unread, 0);

  // reply, then the household sees it as unread; messages come back oldest first
  await hk("POST", msgs, { body: "Yes, from 9am.\nSecond line" });
  await s("POST", msgs, { body: "Perfect" });
  assert.equal((await s("GET", "/api/me")).body.unreadMessages, 1);
  r = await s("GET", msgs);
  assert.deepEqual(r.body.messages.map((m) => [m.body, m.mine]),
    [["Hi Hema, are you free Monday?", true], ["Yes, from 9am.\nSecond line", false], ["Perfect", true]]);
  assert.equal((await s("GET", "/api/me")).body.unreadMessages, 0);

  // polling only returns what's new
  const lastId = r.body.messages[1].id;
  assert.deepEqual((await s("GET", `${msgs}?after=${lastId}`)).body.messages.map((m) => m.body), ["Perfect"]);
  assert.deepEqual((await s("GET", `${msgs}?after=nonsense`)).body.messages.length, 3); // bad cursor = from the start
  assert.match(r.body.messages[0].created_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
});

test("messaging: only the two people in the request can read or write, and only once it's accepted", async (t) => {
  const { hk, s, anon, client, register, msgs, reqId } = await chatSetup(t);
  await s("POST", msgs, { body: "private" });

  assert.equal((await anon("GET", msgs)).status, 401);
  assert.equal((await anon("POST", msgs, { body: "x" })).status, 401);

  // a stranger of either kind gets the same 404 as a request that doesn't exist, so ids can't be probed
  const other = client(), otherHk = client();
  await register(other, { email: "o@x.com", name: "Olu", password: "password123", role: "seeker" });
  await register(otherHk, { email: "oh@x.com", name: "Oha", password: "password123", role: "housekeeper" });
  for (const stranger of [other, otherHk]) {
    for (const [m, body] of [["GET"], ["POST", { body: "hello" }]]) {
      assert.equal((await stranger(m, msgs, body)).status, 404);
    }
  }
  assert.equal((await s("GET", `/api/requests/${reqId + 999}/messages`)).status, 404);
  for (const bad of ["abc", "0", "-3", "99999999999", "1e9"]) {
    assert.equal((await s("GET", `/api/requests/${bad}/messages`)).status, 404, bad);
    assert.equal((await s("POST", `/api/requests/${bad}/messages`, { body: "x" })).status, 404, bad);
  }
  assert.equal((await hk("GET", "/api/me")).body.unreadMessages, 1); // strangers' attempts changed nothing
  assert.equal((await other("GET", "/api/me")).body.unreadMessages, 0);
});

test("messaging is closed for pending and declined requests", async (t) => {
  const { hk, s, msgs, reqId } = await chatSetup(t, { accept: false });
  for (const [m, body] of [["GET"], ["POST", { body: "hi" }]]) {
    const r = await s(m, msgs, body);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /once the housekeeper accepts/i);
    assert.equal((await hk(m, msgs, body)).status, 409);
  }
  await hk("PATCH", `/api/requests/${reqId}`, { status: "declined" });
  assert.equal((await s("POST", msgs, { body: "please?" })).status, 409);
  assert.equal((await s("GET", "/api/me")).body.unreadMessages, 0);
});

test("messaging: message validation and limits", async (t) => {
  const { s, msgs } = await chatSetup(t);
  for (const body of [undefined, null, "", "   ", "\n\t", 42, ["a"], { a: 1 }, "x".repeat(1001)]) {
    assert.equal((await s("POST", msgs, { body })).status, 400, JSON.stringify(body)?.slice(0, 20));
  }
  assert.equal((await s("POST", msgs, {})).status, 400);
  assert.equal((await s("POST", msgs, { body: "x".repeat(1000) })).status, 201);
  const html = `<img src=x onerror="alert(1)"> & 'quotes' 🙂 नमस्ते`;
  assert.equal((await s("POST", msgs, { body: html })).status, 201);
  const stored = (await s("GET", msgs)).body.messages.map((m) => m.body);
  assert.equal(stored[1], html); // stored verbatim; the clients escape it when displaying
});

test("messaging: flooding is limited per sender, not per conversation partner", async (t) => {
  const { hk, s, msgs } = await chatSetup(t);
  for (let i = 0; i < 20; i++) assert.equal((await s("POST", msgs, { body: `m${i}` })).status, 201, `message ${i}`);
  const blocked = await s("POST", msgs, { body: "one too many" });
  assert.equal(blocked.status, 429);
  assert.equal((await hk("POST", msgs, { body: "I can still answer" })).status, 201);
  assert.equal((await s("GET", msgs)).body.messages.length, 21); // the blocked one was not stored
});

test("messaging: deleting an account removes the conversation for the other person too", async (t) => {
  const { hk, s, db, msgs } = await chatSetup(t);
  await s("POST", msgs, { body: "hi" });
  await hk("POST", msgs, { body: "hello" });
  assert.equal((await s("POST", "/api/account/delete", { password: "password123" })).status, 200);
  assert.equal((await hk("GET", msgs)).status, 404);
  assert.equal((await hk("GET", "/api/me")).body.unreadMessages, 0);
  assert.equal((await db.one("SELECT COUNT(*)::int n FROM messages")).n, 0);
});

test("messaging requires a confirmed email", async (t) => {
  const { s, db, msgs } = await chatSetup(t);
  await db.query("UPDATE users SET email_verified_at = NULL WHERE email = 's@x.com'");
  for (const [m, body] of [["GET"], ["POST", { body: "hi" }]]) {
    const r = await s(m, msgs, body);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "email_not_verified");
  }
});

test("messaging: opening a long conversation shows the latest 200 messages; polling continues from the cursor", async (t) => {
  const { s, hk, db, msgs, reqId } = await chatSetup(t);
  const sender = (await db.one("SELECT id FROM users WHERE email = 's@x.com'")).id;
  await db.query("INSERT INTO messages (request_id, sender_id, body) SELECT $1, $2, 'm' || g FROM generate_series(1, 250) g", [reqId, sender]);

  const open = (await s("GET", msgs)).body.messages;
  assert.equal(open.length, 200);
  assert.equal(open[0].body, "m51");     // the oldest 50 are not shown
  assert.equal(open[199].body, "m250");  // ...but the newest are, in order
  assert.deepEqual(open.map((m) => m.id), [...open.map((m) => m.id)].sort((a, b) => a - b));

  const bodies = (r) => r.body.messages.map((m) => m.body);
  const seq = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `m${from + i}`);
  // a cursor inside the shown window returns just what follows it
  assert.deepEqual(bodies(await s("GET", `${msgs}?after=${open[149].id}`)), seq(201, 250));
  // a cursor further back than the window pages forward 200 at a time, in order, skipping nothing
  const m10 = (await db.one("SELECT id FROM messages WHERE request_id = $1 AND body = 'm10'", [reqId])).id;
  const page1 = await s("GET", `${msgs}?after=${m10}`);
  assert.deepEqual(bodies(page1), seq(11, 210));
  assert.deepEqual(bodies(await s("GET", `${msgs}?after=${page1.body.messages[199].id}`)), seq(211, 250));
  // and new messages keep arriving after the newest
  await hk("POST", msgs, { body: "newest" });
  assert.deepEqual(bodies(await s("GET", `${msgs}?after=${open[199].id}`)), ["newest"]);
});

// ---- one person can be both a household and a housekeeper ----
test("one person can be both: hire housekeepers and offer their own services from a single account", async (t) => {
  const { server, client, register } = await start();
  t.after(() => server.close());
  const ana = client(), ben = client(), cara = client(), anon = client();
  const idOf = async (c) => (await c("GET", "/api/me")).body.user.id;

  // Ana signs up as "both"; Ben as a household; Cara as a housekeeper
  let r = await register(ana, { email: "ana@x.com", name: "Ana", password: "password123", role: "both" });
  assert.equal(r.status, 201); assert.equal(r.body.role, "housekeeper"); // "both" is only a sign-up choice
  await register(ben, { email: "ben@x.com", name: "Ben", password: "password123", role: "seeker" });
  await register(cara, { email: "cara@x.com", name: "Cara", password: "password123", role: "housekeeper" });
  assert.equal((await ben("GET", "/api/me")).body.profile, null);

  // anyone can offer services, including someone who signed up as a household
  assert.equal((await ana("PUT", "/api/profile", { ...profile, city: "Pune" })).status, 200);
  assert.equal((await ben("PUT", "/api/profile", { ...profile, city: "Delhi", rate: 90 })).status, 200);
  assert.equal((await cara("PUT", "/api/profile", { ...profile, city: "Goa" })).status, 200);
  assert.equal((await ben("GET", "/api/me")).body.profile.city, "Delhi"); // a household's profile comes back from /api/me
  const [anaId, benId, caraId] = [await idOf(ana), await idOf(ben), await idOf(cara)];
  assert.deepEqual((await anon("GET", "/api/housekeepers")).body.map((h) => h.name).sort(), ["Ana", "Ben", "Cara"]);

  // `mine` marks your own card; nobody is "mine" for a visitor who isn't signed in
  const mineOf = async (c) => (await c("GET", "/api/housekeepers")).body.filter((h) => h.mine).map((h) => h.name);
  assert.deepEqual(await mineOf(ana), ["Ana"]);
  assert.deepEqual(await mineOf(ben), ["Ben"]);
  assert.deepEqual(await mineOf(anon), []);

  // nobody can hire themselves, and nothing is created by trying
  r = await ana("POST", "/api/requests", { housekeeperId: anaId, phone: "1234567" });
  assert.equal(r.status, 400); assert.match(r.body.error, /yourself/);

  // a housekeeper can hire (Cara hires Ana), and a household that now offers services can accept work (Ben)
  assert.equal((await cara("POST", "/api/requests", { housekeeperId: anaId, phone: "1111111", note: "from Cara" })).status, 201);
  assert.equal((await ana("POST", "/api/requests", { housekeeperId: benId, phone: "2222222", note: "from Ana" })).status, 201);
  assert.equal((await ben("POST", "/api/requests", { housekeeperId: caraId, phone: "3333333", note: "from Ben" })).status, 201);

  // Ana is both: the two lists never mix
  const sent = (await ana("GET", "/api/requests?as=sent")).body;
  const received = (await ana("GET", "/api/requests?as=received")).body;
  assert.deepEqual(sent.map((x) => x.hk_name), ["Ben"]);
  assert.deepEqual(received.map((x) => x.seeker_name), ["Cara"]);
  assert.equal((await ana("GET", "/api/requests?as=bogus")).status, 400);
  // older app builds ask without `as`: they still get the list that matches the sign-up choice
  assert.deepEqual((await ana("GET", "/api/requests")).body.map((x) => x.seeker_name), ["Cara"]);
  assert.deepEqual((await ben("GET", "/api/requests")).body.map((x) => x.hk_name), ["Cara"]);

  // each side of each request can only act on its own side of it
  const toAna = received[0].id, toBen = sent[0].id;
  assert.equal((await ben("PATCH", `/api/requests/${toAna}`, { status: "accepted" })).status, 404);   // not Ben's request to answer
  assert.equal((await cara("PATCH", `/api/requests/${toAna}`, { status: "accepted" })).status, 404);  // the hirer can't answer for the housekeeper
  assert.equal((await ana("PATCH", `/api/requests/${toBen}`, { status: "accepted" })).status, 404);   // Ana is the hirer of this one
  assert.equal((await ana("PATCH", `/api/requests/${toAna}`, { status: "accepted" })).status, 200);   // her request as housekeeper
  assert.equal((await ben("PATCH", `/api/requests/${toBen}`, { status: "accepted" })).status, 200);   // Ben, a household, accepts work

  // phone numbers follow the usual rule on both sides
  assert.equal((await cara("GET", "/api/requests?as=sent")).body[0].hk_phone, profile.phone);
  assert.equal((await ana("GET", "/api/requests?as=sent")).body[0].hk_phone, profile.phone);

  // messages: Ana talks in both conversations, each stays private to its two people
  const toAnaMsgs = `/api/requests/${toAna}/messages`, toBenMsgs = `/api/requests/${toBen}/messages`;
  assert.equal((await cara("POST", toAnaMsgs, { body: "Hi Ana (worker)" })).status, 201);
  assert.equal((await ana("POST", toBenMsgs, { body: "Hi Ben (I'm hiring you)" })).status, 201);
  assert.equal((await ana("GET", "/api/me")).body.unreadMessages, 1);   // Cara's message
  assert.equal((await ben("GET", "/api/me")).body.unreadMessages, 1);   // Ana's message
  assert.equal((await ben("GET", toAnaMsgs)).status, 404);              // Ben isn't in Cara's conversation with Ana
  assert.deepEqual((await ana("GET", toAnaMsgs)).body.messages.map((m) => [m.body, m.mine]), [["Hi Ana (worker)", false]]);
  assert.deepEqual((await ana("GET", toBenMsgs)).body.messages.map((m) => [m.body, m.mine]), [["Hi Ben (I'm hiring you)", true]]);

  // reviews only by the hirer of that request, and they land on the right person's card
  assert.equal((await ana("POST", `/api/requests/${toAna}/review`, { rating: 5 })).status, 404);  // Ana was the worker here
  assert.equal((await cara("POST", `/api/requests/${toAna}/review`, { rating: 4 })).status, 201);
  assert.equal((await ana("POST", `/api/requests/${toBen}/review`, { rating: 2 })).status, 201);
  const cards = Object.fromEntries((await anon("GET", "/api/housekeepers")).body.map((h) => [h.name, h.rating]));
  assert.deepEqual(cards, { Ana: 4, Ben: 2, Cara: null });

  // deleting a "both" account removes both of its sides
  assert.equal((await ana("POST", "/api/account/delete", { password: "password123" })).status, 200);
  assert.deepEqual((await cara("GET", "/api/requests?as=sent")).body, []);
  assert.deepEqual((await ben("GET", "/api/requests?as=received")).body, []);
  assert.deepEqual((await anon("GET", "/api/housekeepers")).body.map((h) => h.name).sort(), ["Ben", "Cara"]);
});

test("sample data: only the confirmed owner can add/remove it and see it; nobody else can find, contact or sign in as it", async (t) => {
  const { server, client, register, mails, db } = await start({ adminEmail: "Owner@x.com" });
  t.after(() => server.close());
  const anon = client(), owner = client(), other = client(), imposter = client();
  const sample = (c, action) => c("POST", "/api/admin/sample-data", { action });

  // Someone who typed the owner's address but never confirmed it is not the owner.
  assert.equal((await imposter("POST", "/api/register", { email: "owner@x.com", name: "Imposter", password: "password123", role: "seeker" })).status, 201);
  assert.equal((await sample(imposter, "add")).status, 404);
  assert.equal((await imposter("GET", "/api/me")).body.isAdmin, undefined);
  await db.query("DELETE FROM users WHERE email = 'owner@x.com'");

  await register(owner, { email: "owner@x.com", name: "Owner", password: "password123", role: "seeker" });
  await register(other, { email: "o@x.com", name: "Otto", password: "password123", role: "seeker" });
  assert.equal((await owner("GET", "/api/me")).body.isAdmin, true);
  assert.equal((await other("GET", "/api/me")).body.isAdmin, undefined);
  assert.equal((await sample(other, "add")).status, 404);   // plain 404, as if the route didn't exist
  assert.equal((await sample(anon, "add")).status, 404);
  assert.equal((await sample(owner, "nonsense")).status, 400);

  const real = client();
  await register(real, { email: "real@x.com", name: "Real Hk", password: "password123", role: "housekeeper" });
  await real("PUT", "/api/profile", profile);

  let r = await sample(owner, "add");
  assert.equal(r.status, 200); assert.equal(r.body.sampleHousekeepers, 12);
  assert.equal((await sample(owner, "add")).body.sampleHousekeepers, 12);             // repeating changes nothing
  assert.equal((await owner("GET", "/api/me")).body.sampleHousekeepers, 12);

  const seen = async (c) => (await c("GET", "/api/housekeepers")).body;
  const ownerList = await seen(owner);
  assert.equal(ownerList.length, 13); assert.equal(ownerList.filter((h) => h.sample).length, 12);
  for (const c of [anon, other, real]) { const l = await seen(c); assert.deepEqual(l.map((h) => h.name), ["Real Hk"]); assert.ok(l.every((h) => !h.sample)); }

  const sampleId = ownerList.find((h) => h.sample).id;
  const ask = { housekeeperId: sampleId, phone: "98765 43210" };
  assert.equal((await other("POST", "/api/requests", ask)).status, 404);              // can't guess an id and contact one
  assert.equal((await owner("POST", "/api/requests", ask)).status, 201);              // the owner can try the flow

  // Nobody can sign in as a sample person, and nobody can register one of their addresses.
  assert.equal((await anon("POST", "/api/login", { email: "sara@dummy.test", password: "demo-pass-123" })).status, 401);
  assert.equal((await anon("POST", "/api/register", { email: "new@dummy.test", name: "X", password: "password123", role: "seeker" })).status, 400);

  r = await sample(owner, "remove");
  assert.equal(r.status, 200); assert.equal(r.body.sampleHousekeepers, 0);
  assert.deepEqual((await seen(owner)).map((h) => h.name), ["Real Hk"]);
  assert.ok(await db.one("SELECT 1 FROM users WHERE email = 'real@x.com'"));          // real accounts survive
  assert.ok(await db.one("SELECT 1 FROM users WHERE email = 'o@x.com'"));
});

test("sample data: with no ADMIN_EMAIL configured nobody is the owner", async (t) => {
  const { server, client, register } = await start({ adminEmail: "" });
  t.after(() => server.close());
  const c = client();
  await register(c, { email: "owner@x.com", name: "Owner", password: "password123", role: "seeker" });
  assert.equal((await c("POST", "/api/admin/sample-data", { action: "add" })).status, 404);
  assert.equal((await c("GET", "/api/me")).body.isAdmin, undefined);
});

test("sample data: the owner is built in, so no host setting is needed", async (t) => {
  const prev = process.env.ADMIN_EMAIL; delete process.env.ADMIN_EMAIL;
  t.after(() => { if (prev !== undefined) process.env.ADMIN_EMAIL = prev; });
  const { server, client, register } = await start(); // no adminEmail option and no ADMIN_EMAIL
  t.after(() => server.close());
  const owner = client(), other = client();
  await register(owner, { email: "R.Keval@gmail.com", name: "Owner", password: "password123", role: "seeker" });
  await register(other, { email: "someone@x.com", name: "Someone", password: "password123", role: "seeker" });
  assert.equal((await owner("GET", "/api/me")).body.isAdmin, true);
  assert.equal((await other("GET", "/api/me")).body.isAdmin, undefined);
  assert.equal((await other("POST", "/api/admin/sample-data", { action: "add" })).status, 404);
});
