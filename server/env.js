const fs = require("node:fs");
const path = require("node:path");

// Loads KEY=VALUE files (e.g. the .env.local that `neon deploy` / `neon env pull` writes) into process.env.
// Real environment variables always win, and earlier files win over later ones, so deploy-time settings can't be
// overridden by a stray file. No dependency: the format Neon writes is plain KEY=VALUE with optional quotes.
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value); // "value" or 'value', optionally followed by a comment
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, ""); // unquoted: strip a trailing comment
    out[m[1]] = value;
  }
  return out;
}

function loadEnvFiles(dir = process.cwd(), names = [".env.local", ".env"], env = process.env) {
  const loaded = [];
  for (const name of names) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    for (const [k, v] of Object.entries(parseEnvFile(text))) if (env[k] === undefined) env[k] = v;
    loaded.push(name);
  }
  return loaded;
}

module.exports = { parseEnvFile, loadEnvFiles };
