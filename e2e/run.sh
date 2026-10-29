#!/usr/bin/env bash
# Full end-to-end regression: real server + real Postgres + real browser.
#
#   E2E_ADMIN_URL=postgres://user:pass@localhost:5432/postgres e2e/run.sh [web|mobile|all]
#
# E2E_ADMIN_URL must belong to a role that may CREATE DATABASE. Throwaway databases (hs_e2e_*) are created and dropped.
# Needs Playwright with a Chromium (npm i -D playwright && npx playwright install chromium); not a project dependency.
# "web"    = the website + API in production mode (NODE_ENV=production, TRUST_PROXY=1).
# Set E2E_POOLER=host:port to route the app through a PgBouncer-style pooler (see "pooled" below).
# "mobile" = the phone app's React Native screens, run in a browser through react-native-web. Needs network for npm.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHAT="${1:-all}"
: "${E2E_ADMIN_URL:?set E2E_ADMIN_URL to a Postgres URL whose role can CREATE DATABASE}"
(cd "$ROOT" && node -e "require('playwright')") 2>/dev/null || NODE_PATH="${NODE_PATH:-}" node -e "require('playwright')" 2>/dev/null || {
  echo "Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium (don't commit the change)"; exit 2; }

WORK="$(mktemp -d)"; PIDS=(); DBS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  for d in "${DBS[@]:-}"; do [ -n "$d" ] && (cd "$ROOT" && node e2e/db.js drop "$E2E_ADMIN_URL" "$d" >/dev/null 2>&1); done
  rm -rf "$WORK"
}
trap cleanup EXIT

# NB: call as `DBS+=(name); URL="$(new_db name)"`: appending inside $(...) would be lost with the subshell
new_db() { (cd "$ROOT" && node e2e/db.js recreate "$E2E_ADMIN_URL" "$1"); }
wait_up() { for _ in $(seq 1 40); do curl -sf "$1/healthz" >/dev/null && return 0; sleep 0.25; done; echo "server did not start:"; cat "$2"; return 1; }
status=0

# Optional: send the *app's* database traffic through a connection pooler (PgBouncer in transaction mode, like Neon's
# pooled endpoint) while seeding and the startup schema step use the direct URL, i.e. the production setup on Neon:
#   E2E_POOLER=127.0.0.1:6432 E2E_ADMIN_URL=... e2e/run.sh web
pooled() {
  if [ -z "${E2E_POOLER:-}" ]; then echo "$1"; return; fi
  node -e 'const u = new URL(process.argv[1]); const [h, p] = process.argv[2].split(":"); u.hostname = h; u.port = p; console.log(u.toString())' "$1" "$E2E_POOLER"
}

if [ "$WHAT" = web ] || [ "$WHAT" = all ]; then
  echo "== web (production mode) =="
  DBS+=(hs_e2e_web); URL="$(new_db hs_e2e_web)" || exit 1
  (cd "$ROOT" && DATABASE_URL="$URL" node server/seed.js >/dev/null)
  # `exec` makes the subshell *become* node, so $! is the real server PID and cleanup can kill it
  (cd "$ROOT" && exec env DATABASE_URL="$(pooled "$URL")" DATABASE_URL_UNPOOLED="$URL" NODE_ENV=production TRUST_PROXY=1 PORT=3120 APP_URL=http://localhost:3120 node server/index.js >"$WORK/web.log" 2>&1) & PIDS+=("$!")
  wait_up http://localhost:3120 "$WORK/web.log" || exit 1
  (cd "$WORK" && E2E_URL=http://localhost:3120 E2E_LOG="$WORK/web.log" node "$ROOT/e2e/web.js") || status=1
fi

if [ "$WHAT" = mobile ] || [ "$WHAT" = all ]; then
  echo "== mobile (react-native-web) =="
  M="$WORK/mobile-web"; mkdir -p "$M"
  (cd "$ROOT/mobile" && cp -r App.tsx index.ts app.json tsconfig.json package.json package-lock.json src "$M"/)
  (
    set -e; cd "$M"
    npm ci >/dev/null 2>&1
    # versions Expo pins for web support
    npm install "react-native-web@$(node -p "require('expo/bundledNativeModules.json')['react-native-web']")" \
      "react-dom@$(node -p "require('expo/bundledNativeModules.json')['react-dom']")" \
      "@expo/metro-runtime@$(node -p "require('expo/bundledNativeModules.json')['@expo/metro-runtime']")" >/dev/null 2>&1
    # test-only shims in this throwaway copy: expo-secure-store has no web version, and react-native-web's Alert is a no-op
    cat > src/securestore-web.ts <<'SHIM'
export const getItemAsync = async (k: string) => localStorage.getItem(k);
export const setItemAsync = async (k: string, v: string) => { localStorage.setItem(k, v); };
export const deleteItemAsync = async (k: string) => { localStorage.removeItem(k); };
SHIM
    sed -i 's#import \* as SecureStore from "expo-secure-store";#import * as SecureStore from "./securestore-web";#' src/api.ts
    cat > index.ts <<'SHIM'
import { Alert } from "react-native";
import { registerRootComponent } from "expo";
import App from "./App";
(window as any).__alerts = [];
(Alert as any).alert = (title: string, message?: string, buttons?: { text?: string; style?: string; onPress?: () => void }[]) => {
  (window as any).__alerts.push(`${title}${message ? ": " + message : ""}`);
  buttons?.find((b) => b.style === "destructive")?.onPress?.();
};
registerRootComponent(App);
SHIM
    node -e "const f='app.json',d=require('./'+f);d.expo.web={bundler:'metro',output:'single'};require('fs').writeFileSync(f,JSON.stringify(d,null,2))"
    EXPO_PUBLIC_API_URL=http://localhost:3130 npx expo export --platform web --output-dir dist >"$WORK/export.log" 2>&1
  ) || { echo "could not build the mobile web bundle:"; tail -20 "$WORK/export.log" 2>/dev/null; exit 1; }
  DBS+=(hs_e2e_mobile); URL="$(new_db hs_e2e_mobile)" || exit 1
  (cd "$ROOT" && DATABASE_URL="$URL" node server/seed.js >/dev/null)
  (cd "$ROOT" && exec env DATABASE_URL="$(pooled "$URL")" DATABASE_URL_UNPOOLED="$URL" PORT=3121 APP_URL=http://localhost:3130 node server/index.js >"$WORK/mobile.log" 2>&1) & PIDS+=("$!")
  node "$ROOT/e2e/proxy.js" "$M/dist" 3121 3130 >"$WORK/proxy.log" 2>&1 & PIDS+=("$!")
  wait_up http://localhost:3121 "$WORK/mobile.log" || exit 1
  (cd "$WORK" && E2E_URL=http://localhost:3130 E2E_LOG="$WORK/mobile.log" node "$ROOT/e2e/mobile.js") || status=1
fi

[ $status -eq 0 ] && echo "ALL E2E PASSED" || echo "E2E FAILED"
exit $status
