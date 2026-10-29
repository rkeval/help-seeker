#!/usr/bin/env node
// Waits until the live site reports the commit that was just released, e.g.
//   node scripts/wait-for-deploy.js https://helpseeker.onrender.com <commit-sha> [timeoutSeconds=1200]
// The site reports its commit on /healthz. A *newer* commit than ours also counts as success (someone merged again
// while we waited), checked with git when the history is available. Exits 0 when live, 1 on timeout.
const { execFileSync } = require("node:child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });

function isAncestor(older, newer) {
  try {
    // a commit pushed after this job started isn't in our copy of the history yet: fetch it first
    try { git("cat-file", "-e", `${newer}^{commit}`); } catch { try { git("fetch", "--quiet", "origin", newer); } catch { /* no remote or unknown sha */ } }
    git("merge-base", "--is-ancestor", older, newer);
    return true;
  } catch { return false; }
}

async function readHealth(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/healthz`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return body && body.ok ? { commit: body.commit || null } : { error: "healthz did not report ok" };
  } catch (e) {
    return { error: e.name === "TimeoutError" ? "timed out" : e.message }; // cold start / mid-deploy: keep waiting
  }
}

async function waitForDeploy(url, expected, { timeoutMs = 20 * 60 * 1000, intervalMs = 10000, log = console.log, fetchImpl = fetch, ancestor = isAncestor } = {}) {
  const started = Date.now();
  let last = "no answer yet";
  while (Date.now() - started < timeoutMs) {
    const h = await readHealth(url, fetchImpl);
    if (h.error) last = h.error;
    else if (h.commit === expected) { log(`Live: ${url} is serving ${expected.slice(0, 8)}`); return { ok: true, commit: h.commit }; }
    else if (h.commit && ancestor(expected, h.commit)) { log(`Live: ${url} is already serving a newer commit (${h.commit.slice(0, 8)}) that includes ${expected.slice(0, 8)}`); return { ok: true, commit: h.commit, newer: true }; }
    else last = h.commit ? `serving ${h.commit.slice(0, 8)}, waiting for ${expected.slice(0, 8)}` : "site does not report a commit yet";
    log(`[${Math.round((Date.now() - started) / 1000)}s] ${last}`);
    await sleep(intervalMs);
  }
  return { ok: false, last };
}

module.exports = { waitForDeploy, readHealth, isAncestor };

if (require.main === module) {
  const [url, expected, seconds] = process.argv.slice(2);
  if (!url || !expected) { console.error("usage: wait-for-deploy.js <url> <commit-sha> [timeoutSeconds]"); process.exit(2); }
  waitForDeploy(url, expected, { timeoutMs: (Number(seconds) || 1200) * 1000 }).then((r) => {
    if (!r.ok) { console.error(`::error title=Deploy did not go live::Timed out waiting for ${expected.slice(0, 8)} on ${url} (last seen: ${r.last}). The previous version is still serving traffic.`); process.exit(1); }
  });
}
