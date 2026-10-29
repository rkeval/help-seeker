#!/usr/bin/env node
// Read-only checks of a running site. It creates no accounts and writes nothing, so it is safe against production.
//   node scripts/smoke.js https://helpseeker.onrender.com
// Exits 1 if anything is wrong.
async function smoke(base, { fetchImpl = fetch, log = console.log } = {}) {
  const url = (p) => `${base.replace(/\/$/, "")}${p}`;
  const get = (p, init) => fetchImpl(url(p), { signal: AbortSignal.timeout(30000), redirect: "manual", ...init });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([true, name]); log(`  ok   ${name}`); }
    catch (e) { results.push([false, name]); log(`  FAIL ${name}: ${e.message}`); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  await check("health check answers and the database is reachable", async () => {
    const r = await get("/healthz"); expect(r.status === 200, `HTTP ${r.status}`);
    expect((await r.json()).ok === true, "healthz.ok is not true");
  });
  await check("home page is served", async () => {
    const r = await get("/"); expect(r.status === 200, `HTTP ${r.status}`);
    expect((await r.text()).includes("Help Seeker"), "page does not mention Help Seeker");
  });
  await check("the other pages and the app script are served", async () => {
    for (const p of ["/verify.html", "/reset.html", "/app.js", "/style.css"]) expect((await get(p)).status === 200, `${p} did not return 200`);
  });
  await check("service list is available", async () => {
    const r = await get("/api/meta"); expect(r.status === 200, `HTTP ${r.status}`);
    const m = await r.json(); expect(Array.isArray(m.services) && m.services.length > 0, "no services listed");
  });
  await check("search works and never exposes phone numbers or emails", async () => {
    const r = await get("/api/housekeepers"); expect(r.status === 200, `HTTP ${r.status}`);
    const text = await r.text(); expect(Array.isArray(JSON.parse(text)), "not a list");
    expect(!/"(phone|email|seeker_phone|pass_hash)"/i.test(text), "response contains a private field");
  });
  await check("private endpoints refuse anonymous visitors", async () => {
    for (const p of ["/api/requests", "/api/requests/1/messages"]) expect((await get(p)).status === 401, `${p} did not return 401`);
  });
  await check("unknown paths return 404 and nothing outside the website folder can be fetched", async () => {
    for (const p of ["/api/nope", "/server/app.js", "/package.json", "/.env"]) {
      const r = await get(p); expect(r.status === 404, `${p} returned ${r.status}, expected 404`);
    }
    // A proxy in front of the app (Render's edge) may answer a path-traversal attempt itself with a 400, 403 or a
    // redirect before the app ever sees it, so the status isn't fixed. What must hold: no file contents come back
    // and nothing is a server error. The status is logged so surprises are visible.
    for (const p of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2fserver%2fapp.js"]) {
      const r = await get(p);
      const body = r.status === 200 ? await r.text() : "";
      log(`       (${p} -> ${r.status})`);
      expect(!/"name":\s*"help-seeker"|createApp|require\(/.test(body), `${p} returned file contents`);
      expect(r.status < 500, `${p} returned ${r.status}`);
    }
  });
  await check("sign-in refuses unknown credentials (writes nothing)", async () => {
    const r = await get("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "smoke@invalid.example", password: "not-a-real-password" }) });
    expect(r.status === 401, `HTTP ${r.status}`);
  });
  const failed = results.filter(([ok]) => !ok).length;
  log(`${results.length - failed}/${results.length} smoke checks passed`);
  return { ok: failed === 0, passed: results.length - failed, total: results.length };
}

module.exports = { smoke };

if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.error("usage: smoke.js <base-url>"); process.exit(2); }
  smoke(url).then((r) => process.exit(r.ok ? 0 : 1));
}
