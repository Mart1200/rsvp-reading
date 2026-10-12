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

# --- Auth flow (needs ORIGIN to match BASE_URL, as with the Compose defaults) ---
ORIGIN="${ORIGIN:-$BASE_URL}"
jar=$(mktemp)
user="smoke_$(date +%s)_$RANDOM"
creds="{\"username\":\"$user\",\"password\":\"smoke test password\"}"

# Best effort: remove the test account even if a step below fails, so failed runs
# don't leave smoke_* users behind (no-op when the account was already deleted)
cleanup() {
  local cleanup_jar
  cleanup_jar=$(mktemp)
  local json=(-s -o /dev/null -H "Origin: $ORIGIN" -H 'Content-Type: application/json')
  curl "${json[@]}" -c "$cleanup_jar" -X POST --data "$creds" "$BASE_URL/api/auth/login" || true
  curl "${json[@]}" -b "$cleanup_jar" -X DELETE --data '{"password":"smoke test password"}' \
    "$BASE_URL/api/auth/account" || true
  rm -f "$jar" "$cleanup_jar"
}
trap cleanup EXIT

# api <method> <path> [json body] -> prints "<status> <body>", using the cookie jar
api() {
  local args=(-s -w '\n%{http_code}' -X "$1" -b "$jar" -c "$jar" -H "Origin: $ORIGIN")
  [[ -n "${3:-}" ]] && args+=(-H 'Content-Type: application/json' --data "$3")
  local out
  out=$(curl "${args[@]}" "$BASE_URL$2")
  echo "$(tail -n1 <<<"$out") $(sed '$d' <<<"$out")"
}

# expect <description> <actual "status body"> <expected status> [expected body substring]
expect() {
  local description="$1" actual="$2" expected_status="$3" expected_body="${4:-}"
  if [[ "${actual%% *}" == "$expected_status" && "$actual" == *"$expected_body"* ]]; then
    pass "$description"
  else
    fail "$description: expected $expected_status '$expected_body', got '${actual:0:200}'"
  fi
}

expect "Register"                     "$(api POST /api/auth/register "$creds")" 201 "\"username\":\"$user\""
expect "Session cookie works"         "$(api GET /api/auth/me)"                  200 "\"username\":\"$user\""
expect "Log out"                      "$(api POST /api/auth/logout '{}')"        204
expect "Logged out"                   "$(api GET /api/auth/me)"                  401 '"UNAUTHENTICATED"'
expect "Log in"                       "$(api POST /api/auth/login "$creds")"     200 "\"username\":\"$user\""
expect "Cross-origin requests are blocked" \
  "$(curl -s -w ' %{http_code}' -b "$jar" -X POST -H 'Origin: https://evil.example' \
     -H 'Content-Type: application/json' --data '{}' "$BASE_URL/api/auth/logout" | awk '{print $NF" "$0}')" \
  403 '"CSRF"'

# --- Library ---
saved=$(api POST /api/texts '{"title":"Smoke text","content":"one two three four","currentWordIndex":1}')
expect "Save text to library"         "$saved"                                    201 '"totalWords":4'
text_id=$(grep -o '"id":"[^"]*"' <<<"$saved" | head -n1 | cut -d'"' -f4)
expect "List library"                 "$(api GET /api/texts)"                    200 '"title":"Smoke text"'
expect "Open text"                    "$(api GET "/api/texts/$text_id")"         200 '"content":"one two three four"'
expect "Rename text"                  "$(api PATCH "/api/texts/$text_id" '{"title":"Renamed"}')" 200 '"title":"Renamed"'
expect "Save progress"                "$(api PUT "/api/texts/$text_id/progress" '{"currentWordIndex":3}')" 204
expect "Progress is stored"           "$(api GET "/api/texts/$text_id")"         200 '"currentWordIndex":3'
expect "Delete text"                  "$(api DELETE "/api/texts/$text_id" '{}')" 204
expect "Text is gone"                 "$(api GET "/api/texts/$text_id")"         404 '"NOT_FOUND"'

expect "Delete account"              "$(api DELETE /api/auth/account '{"password":"smoke test password"}')" 204
expect "Account is gone"              "$(api POST /api/auth/login "$creds")"     401 '"INVALID_CREDENTIALS"'

if (( failures > 0 )); then
  echo "$failures smoke test(s) failed"
  exit 1
fi
echo "All smoke tests passed"
