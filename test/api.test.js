const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");

async function start() {
  const { server } = createApp({ dbFile: ":memory:" });
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
  return { server, client };
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
