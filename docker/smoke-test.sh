#!/usr/bin/env bash
# End-to-end check of the running Compose stack (app image + db).
# Usage: docker compose -f docker/docker-compose.yml up -d --build --wait
#        bash docker/smoke-test.sh [base-url]
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

# check <description> <path> <expected status> <expected body substring>
check() {
  local description="$1" path="$2" expected_status="$3" expected_body="$4"
  local body status
  body=$(curl -s -w '\n%{http_code}' "$BASE_URL$path")
  status=$(tail -n1 <<<"$body")
  body=$(sed '$d' <<<"$body")

  if [[ "$status" == "$expected_status" && "$body" == *"$expected_body"* ]]; then
    pass "$description"
  else
    fail "$description: expected $expected_status containing '$expected_body', got $status: ${body:0:200}"
  fi
}

# check_header <description> <path> <header name> <expected value substring> [extra curl args...]
check_header() {
  local description="$1" path="$2" header="$3" expected="$4"
  shift 4
  local value
  value=$(curl -s -o /dev/null -D - "$@" "$BASE_URL$path" \
    | tr -d '\r' | grep -i "^$header:" | cut -d' ' -f2- || true)

  if [[ "$value" == *"$expected"* ]]; then
    pass "$description"
  else
    fail "$description: expected $header containing '$expected', got '$value'"
  fi
}

# Wait until the API answers
for _ in $(seq 1 30); do
  curl -sf "$BASE_URL/api/health" >/dev/null && break
  sleep 2
done

check "SPA is served"                     "/"                    200 '<div id="app">'
check "SPA fallback for client routes"    "/some/client/route"   200 '<div id="app">'
check "API health"                        "/api/health"          200 '"ok":true'
check "Unknown API routes are JSON 404s"  "/api/does-not-exist"  404 '"code":"NOT_FOUND"'
check "Missing files are 404s"            "/assets/missing.js"   404 '"code":"NOT_FOUND"'

check_header "index.html is revalidated"  "/"       "Cache-Control" "no-cache"
check_header "Service worker is revalidated" "/sw.js" "Cache-Control" "no-cache"

# Pick a real hashed bundle from the built index.html
asset=$(curl -s "$BASE_URL/" | grep -o '/assets/[^"]*\.js' | head -n1 || true)
if [[ -n "$asset" ]]; then
  check_header "Hashed assets are cached immutably" "$asset" "Cache-Control" "immutable"
  check_header "Assets are gzipped" "$asset" "Content-Encoding" "gzip" -H "Accept-Encoding: gzip"
else
  fail "No /assets/*.js bundle referenced in index.html"
fi

if (( failures > 0 )); then
  echo "$failures smoke test(s) failed"
  exit 1
fi
echo "All smoke tests passed"
