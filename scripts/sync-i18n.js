// The website's translation files (public/i18n/) are the single source of truth. The phone app bundles its own copy so
// it works offline and without a monorepo setup; this script refreshes that copy. A test fails if the copy is stale.
//   npm run i18n:sync
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "public", "i18n");
const DST = path.join(root, "mobile", "src", "i18n", "shared");

function sharedFiles() {
  return fs.readdirSync(SRC).filter((f) => f.endsWith(".json") || f === "core.js").sort();
}

if (require.main === module) {
  fs.mkdirSync(DST, { recursive: true });
  for (const f of fs.readdirSync(DST)) if (!sharedFiles().includes(f)) fs.rmSync(path.join(DST, f));
  for (const f of sharedFiles()) fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
  console.log(`copied ${sharedFiles().length} files to mobile/src/i18n/shared`);
}
module.exports = { SRC, DST, sharedFiles };
