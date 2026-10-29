const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const config = read("mobile/src/config.ts");

test("mobile app: points at the live HTTPS site by default, with an override for local development", () => {
  const live = /LIVE_API_URL\s*=\s*"([^"]+)"/.exec(config)?.[1];
  assert.ok(live, "LIVE_API_URL is not defined in mobile/src/config.ts");
  assert.match(live, /^https:\/\/[a-z0-9.-]+$/i, "must be https, with no path and no trailing slash (release builds block plain http)");
  assert.doesNotMatch(live, /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./, "must not be a local address");
  assert.ok(config.includes("process.env.EXPO_PUBLIC_API_URL || LIVE_API_URL"), "EXPO_PUBLIC_API_URL must still override the default (the e2e runner and local development rely on it)");
  assert.ok(config.includes('.replace(/\\/$/, "")'), "a trailing slash on the address must be stripped");
  assert.ok(read("mobile/README.md").includes(live), "mobile/README.md should name the same live address");
});

test("mobile app: requests time out instead of hanging, and a sleeping free-tier server gets a friendly message", () => {
  const api = read("mobile/src/api.ts");
  assert.match(api, /REQUEST_TIMEOUT_MS\s*=\s*90_000/);
  assert.ok(api.includes("controller.abort()") && api.includes("signal: controller.signal"));
  assert.ok(api.includes("res.status >= 502 && res.status <= 504"));
});
