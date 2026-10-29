// "Build" for this project: there is nothing to compile (plain Node server + plain browser scripts), so this verifies
// that every JavaScript file parses and that the files the server serves exist. Exits non-zero on any problem.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dirs = ["server", "public", "public/i18n", "e2e", "test", "scripts"];
const required = ["public/index.html", "public/verify.html", "public/reset.html", "public/app.js", "public/i18n/core.js", "public/i18n/web.js", "public/i18n/en.json", "public/style.css", "server/index.js"];

const files = dirs.flatMap((d) => fs.existsSync(path.join(root, d))
  ? fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js")).map((f) => path.join(d, f)) : []);

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" }); }
  catch (e) { failed++; console.error(`SYNTAX ERROR in ${f}\n${e.stderr}`); }
}
for (const f of required) if (!fs.existsSync(path.join(root, f))) { failed++; console.error(`MISSING ${f}`); }

console.log(`${files.length} scripts checked, ${required.length} required files present${failed ? `, ${failed} problem(s)` : ", no problems"}`);
process.exit(failed ? 1 : 0);
