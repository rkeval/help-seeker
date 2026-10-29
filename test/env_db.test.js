const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseEnvFile, loadEnvFiles } = require("../server/env");
const { openDb } = require("../server/db");

test("env files: Neon-style KEY=VALUE lines are parsed (quotes, comments, export, = and & inside values)", () => {
  const parsed = parseEnvFile([
    "# written by neon env pull",
    "DATABASE_URL=postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    'DATABASE_URL_UNPOOLED="postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"',
    "NEON_REALTIME_URL='wss://example.test/live' # trailing comment",
    "export PLAIN = hello  # note",
    "",
    "not a valid line",
    "EMPTY=",
  ].join("\r\n"));
  assert.equal(parsed.DATABASE_URL, "postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
  assert.equal(parsed.DATABASE_URL_UNPOOLED, "postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require");
  assert.equal(parsed.NEON_REALTIME_URL, "wss://example.test/live");
  assert.equal(parsed.PLAIN, "hello");
  assert.equal(parsed.EMPTY, "");
  assert.equal(Object.keys(parsed).length, 5);
});

test("env files: real environment variables win, .env.local wins over .env, missing files are fine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envtest-"));
  try {
    fs.writeFileSync(path.join(dir, ".env.local"), "A=from_local\nB=from_local\n");
    fs.writeFileSync(path.join(dir, ".env"), "B=from_env\nC=from_env\nA=from_env\n");
    const env = { A: "from_process" };
    assert.deepEqual(loadEnvFiles(dir, [".env.local", ".env", ".env.nope"], env), [".env.local", ".env"]);
    assert.deepEqual(env, { A: "from_process", B: "from_local", C: "from_env" });
    assert.deepEqual(loadEnvFiles(path.join(dir, "missing"), [".env"], {}), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const URL_ = process.env.TEST_DATABASE_URL;
const dbTest = (name, fn) => test(name, { skip: !URL_ && "set TEST_DATABASE_URL to run" }, fn);

dbTest("database: with a separate migration URL, the schema is created through it and app queries use the app URL", async () => {
  const schema = "t_mig_" + Math.random().toString(16).slice(2, 8);
  // Both URLs reach the same server; the migration URL makes every connection land in our throwaway schema via search_path.
  const migration = new URL(URL_); migration.searchParams.set("options", `-c search_path=${schema}`);
  const boot = await openDb(URL_, { schema }); // creates the schema (+ tables) and gives us a handle to inspect/clean up
  try {
    await boot.query("DROP TABLE users CASCADE");
    await boot.query("DROP TABLE IF EXISTS sessions, password_resets, profiles, requests, reviews, messages, email_verifications CASCADE");
    const app = new URL(URL_); app.searchParams.set("options", `-c search_path=${schema}`);
    const db = await openDb(app.toString(), { migrationUrl: migration.toString() });
    try {
      const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schema]);
      assert.ok(tables.some((t) => t.table_name === "messages") && tables.some((t) => t.table_name === "users"));
      await db.query("INSERT INTO users (email,name,role,pass_hash) VALUES ('a@x.com','A','seeker','x')");
      assert.equal((await db.one("SELECT COUNT(*)::int n FROM users")).n, 1);
    } finally { await db.close(); }
  } finally { await boot.close(); }
});

dbTest("database: a broken migration URL fails startup loudly instead of being ignored", async () => {
  await assert.rejects(() => openDb(URL_, { migrationUrl: "postgres://nobody:wrong@127.0.0.1:1/nope" }), /ECONNREFUSED|password|connect/i);
});

test("database: a missing DATABASE_URL gives a clear error", async () => {
  await assert.rejects(() => openDb(undefined), /DATABASE_URL is not set/);
});

test("dummy data: seeds housekeepers, households, requests and reviews, can be re-run, and refuses production-looking URLs", { skip: !URL_ }, async () => {
  const { spawnSync } = require("node:child_process");
  const { Pool } = require("pg");
  const schema = "dummy_" + Math.random().toString(36).slice(2, 8);
  const admin = new Pool({ connectionString: URL_ });
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    const u = new URL(URL_); u.searchParams.set("options", `-c search_path=${schema}`);
    const run = (url) => spawnSync(process.execPath, [path.join(__dirname, "..", "server", "seed-dummy.js")], { env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "" }, encoding: "utf8" });
    for (let i = 0; i < 2; i++) assert.equal(run(u.toString()).status, 0);
    const n = async (t) => Number((await admin.query(`SELECT count(*) FROM ${schema}.${t}`)).rows[0].count);
    assert.deepEqual([await n("profiles"), await n("users"), await n("requests"), await n("reviews")], [12, 15, 7, 4]);
    await admin.query(`INSERT INTO ${schema}.users (email,name,role,pass_hash) VALUES ('real@example.com','Real Person','seeker','x')`);
    const rm = spawnSync(process.execPath, [path.join(__dirname, "..", "server", "seed-dummy.js"), "--remove"], { env: { ...process.env, DATABASE_URL: u.toString(), DATABASE_URL_UNPOOLED: "" }, encoding: "utf8" });
    assert.equal(rm.status, 0);
    assert.deepEqual([await n("users"), await n("profiles"), await n("requests"), await n("messages")], [1, 0, 0, 0]); // the real account survives
    const bad = run("postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb");
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /looks like production/);
  } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
