// Fills a database with obviously fake data (see dummy.js). Safe to re-run. Every email ends in @dummy.test and every
// password is "demo-pass-123". Not part of `npm run seed` (the e2e tests rely on that one staying small).
// `--remove` deletes it again (only accounts ending in @dummy.test).
// Refuses to run against a production-looking setup unless ALLOW_DUMMY_DATA=1. For the live site use the owner-only
// buttons on the website's Account tab instead (see README, "Sample data").
const { loadEnvFiles } = require("./env");
loadEnvFiles(require("node:path").join(__dirname, ".."));
const { openDb } = require("./db");
const { addDummy, removeDummy, COUNTS } = require("./dummy");

(async () => {
  if (/onrender|neon\.tech/.test(process.env.DATABASE_URL || "") && process.env.ALLOW_DUMMY_DATA !== "1")
    throw new Error("DATABASE_URL looks like production. Set ALLOW_DUMMY_DATA=1 only if you really want fake people on the live site.");
  const db = await openDb(process.env.DATABASE_URL, { migrationUrl: process.env.DATABASE_URL_UNPOOLED });
  if (process.argv.includes("--remove")) {
    console.log(`Removed ${(await removeDummy(db)).removed} dummy accounts (and everything attached to them).`);
  } else {
    await addDummy(db, { password: "demo-pass-123" });
    console.log(`Dummy data ready: ${COUNTS.housekeepers} housekeepers, ${COUNTS.households} households, ${COUNTS.requests} requests (all @dummy.test, password demo-pass-123).`);
  }
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
