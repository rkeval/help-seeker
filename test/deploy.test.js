const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const { waitForDeploy, isAncestor } = require("../scripts/wait-for-deploy");
const { smoke } = require("../scripts/smoke");
const { createApp } = require("../server/app");

const quiet = () => {};
const reply = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
const sequence = (...steps) => { let i = 0; return async () => { const s = steps[Math.min(i++, steps.length - 1)]; if (s instanceof Error) throw s; return s; }; };
const SHA = "a".repeat(40), OTHER = "b".repeat(40);

test("wait-for-deploy: succeeds once the site reports our commit, riding out errors and the old version", async () => {
  const fetchImpl = sequence(new Error("ECONNRESET"), reply({}, 502), reply({ ok: true, commit: OTHER }), reply({ ok: true, commit: null }), reply({ ok: true, commit: SHA }));
  const r = await waitForDeploy("https://x.test", SHA, { timeoutMs: 5000, intervalMs: 1, fetchImpl, ancestor: () => false, log: quiet });
  assert.deepEqual(r, { ok: true, commit: SHA });
});

test("wait-for-deploy: a newer commit that contains ours counts as live; an unrelated one does not", async () => {
  const newer = await waitForDeploy("https://x.test", SHA, { timeoutMs: 1000, intervalMs: 1, fetchImpl: sequence(reply({ ok: true, commit: OTHER })), ancestor: (a, b) => a === SHA && b === OTHER, log: quiet });
  assert.equal(newer.ok, true); assert.equal(newer.newer, true);
  const unrelated = await waitForDeploy("https://x.test", SHA, { timeoutMs: 60, intervalMs: 10, fetchImpl: sequence(reply({ ok: true, commit: OTHER })), ancestor: () => false, log: quiet });
  assert.equal(unrelated.ok, false);
  assert.match(unrelated.last, /serving bbbbbbbb, waiting for aaaaaaaa/);
});

test("wait-for-deploy: times out (never reports success) when the site is down or doesn't report a commit", async () => {
  const down = await waitForDeploy("https://x.test", SHA, { timeoutMs: 60, intervalMs: 10, fetchImpl: sequence(new Error("getaddrinfo ENOTFOUND")), log: quiet });
  assert.deepEqual(down, { ok: false, last: "getaddrinfo ENOTFOUND" });
  const silent = await waitForDeploy("https://x.test", SHA, { timeoutMs: 60, intervalMs: 10, fetchImpl: sequence(reply({ ok: true })), ancestor: () => false, log: quiet });
  assert.equal(silent.ok, false); assert.match(silent.last, /does not report a commit/);
  const notOk = await waitForDeploy("https://x.test", SHA, { timeoutMs: 60, intervalMs: 10, fetchImpl: sequence(reply({ ok: false, commit: SHA })), log: quiet });
  assert.equal(notOk.ok, false); // an unhealthy site is not "live" even if it names our commit
});

test("wait-for-deploy: isAncestor uses real git history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitanc-"));
  try {
    const git = (...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
    git("init", "-q"); fs.writeFileSync(path.join(dir, "a"), "1"); git("add", "."); git("commit", "-q", "-m", "one");
    const first = git("rev-parse", "HEAD"); fs.writeFileSync(path.join(dir, "a"), "2"); git("commit", "-q", "-am", "two");
    const second = git("rev-parse", "HEAD");
    const cwd = process.cwd(); process.chdir(dir);
    try {
      assert.equal(isAncestor(first, second), true);
      assert.equal(isAncestor(second, first), false);
      assert.equal(isAncestor("f".repeat(40), second), false); // unknown commit: never "ancestor"
    } finally { process.chdir(cwd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const URL_ = process.env.TEST_DATABASE_URL;
const dbTest = (name, fn) => test(name, { skip: !URL_ && "set TEST_DATABASE_URL to run" }, fn);

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  return { base: `http://localhost:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

dbTest("smoke: passes against the real app, which reports its commit on /healthz", async (t) => {
  const { server } = await createApp({ databaseUrl: URL_, schema: "t_" + crypto.randomBytes(5).toString("hex"), sendMail: async () => {} });
  await new Promise((r) => server.listen(0, r)); t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const r = await smoke(base, { log: quiet });
  assert.deepEqual([r.ok, r.passed, r.total], [true, 8, 8]);

  process.env.RENDER_GIT_COMMIT = SHA; t.after(() => delete process.env.RENDER_GIT_COMMIT);
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, commit: SHA });
  assert.equal((await waitForDeploy(base, SHA, { timeoutMs: 2000, intervalMs: 10, log: quiet })).ok, true);
});

test("smoke: fails when the site leaks private fields, is broken, or is unreachable", async () => {
  const leaky = await serve((req, res) => {
    const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.url === "/healthz") return send(200, { ok: true });
    if (req.url === "/") { res.writeHead(200); return res.end("<h1>Help Seeker</h1>"); }
    if (req.url === "/api/meta") return send(200, { services: ["Cleaning"] });
    if (req.url === "/api/housekeepers") return send(200, [{ name: "H", phone: "+91 90000 12345" }]); // the leak
    if (req.url.startsWith("/api/requests")) return send(401, { error: "sign in required" });
    if (req.url === "/api/login") return send(401, { error: "wrong" });
    if (["/verify.html", "/reset.html", "/app.js", "/style.css"].includes(req.url)) { res.writeHead(200); return res.end("x"); }
    return send(404, { error: "not found" });
  });
  try {
    const r = await smoke(leaky.base, { log: quiet });
    assert.equal(r.ok, false); assert.equal(r.total - r.passed, 1); // exactly the privacy check fails
  } finally { await leaky.close(); }

  // a file leaking through a traversal path must fail the smoke test, whatever the status code is
  const leakyFile = await serve((req, res) => {
    if (req.url.includes("..")) { res.writeHead(200); return res.end('{ "name": "help-seeker", "dependencies": {} }'); }
    const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (req.url === "/healthz") return send(200, { ok: true });
    if (req.url === "/") { res.writeHead(200); return res.end("<h1>Help Seeker</h1>"); }
    if (req.url === "/api/meta") return send(200, { services: ["Cleaning"] });
    if (req.url === "/api/housekeepers") return send(200, []);
    if (req.url.startsWith("/api/requests")) return send(401, {});
    if (req.url === "/api/login") return send(401, {});
    if (["/verify.html", "/reset.html", "/app.js", "/style.css"].includes(req.url)) { res.writeHead(200); return res.end("x"); }
    return send(404, {});
  });
  try { const r = await smoke(leakyFile.base, { log: quiet }); assert.equal(r.ok, false); assert.equal(r.total - r.passed, 1); } finally { await leakyFile.close(); }

  // ...but a proxy that rejects traversal attempts itself (400) or redirects them (308) is fine
  for (const status of [400, 403, 308]) {
    const edge = await serve((req, res) => {
      if (req.url.includes("..") || req.url.includes("%2e")) { res.writeHead(status, status === 308 ? { Location: "/" } : {}); return res.end(); }
      const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
      if (req.url === "/healthz") return send(200, { ok: true });
      if (req.url === "/") { res.writeHead(200); return res.end("<h1>Help Seeker</h1>"); }
      if (req.url === "/api/meta") return send(200, { services: ["Cleaning"] });
      if (req.url === "/api/housekeepers") return send(200, []);
      if (req.url.startsWith("/api/requests")) return send(401, {});
      if (req.url === "/api/login") return send(401, {});
      if (["/verify.html", "/reset.html", "/app.js", "/style.css"].includes(req.url)) { res.writeHead(200); return res.end("x"); }
      return send(404, {});
    });
    try { const r = await smoke(edge.base, { log: quiet }); assert.equal(r.ok, true, `edge answering ${status} to traversal should pass`); } finally { await edge.close(); }
  }

  const broken = await serve((req, res) => { res.writeHead(500); res.end("boom"); });
  try { assert.equal((await smoke(broken.base, { log: quiet })).ok, false); } finally { await broken.close(); }

  const dead = await smoke("http://localhost:1", { log: quiet }); // nothing listening: reported as failures, not a crash
  assert.equal(dead.ok, false); assert.equal(dead.passed, 0);
});
