// Tiny helper for run.sh: node e2e/db.js recreate|drop <admin-url> <db-name>   (prints the new database's URL on "recreate")
const { Client } = require("pg");
const [cmd, adminUrl, name] = process.argv.slice(2);
if (!/^[a-z0-9_]+$/.test(name || "")) { console.error("bad database name"); process.exit(2); }
(async () => {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  if (cmd === "recreate") await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  if (cmd === "recreate") { const u = new URL(adminUrl); u.pathname = "/" + name; console.log(u.toString()); }
})().catch((e) => { console.error(e.message); process.exit(1); });
