#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-http://127.0.0.1:${CHORD_NEXT_PORT:-3010}}"

log() {
  printf '[chord:hcloud:smoke] %s\n' "$*"
}

fetch() {
  local path="$1"
  curl -fsS --retry 12 --retry-delay 2 --retry-connrefused "$APP_URL$path"
}

assert_contains() {
  local path="$1"
  local needle="$2"
  local body
  body="$(fetch "$path")"
  if [[ "$body" != *"$needle"* ]]; then
    log "expected $path to contain: $needle"
    exit 1
  fi
}

log "checking $APP_URL"
assert_contains "/" "Verifiable work"
assert_contains "/projects" "Contracts"
assert_contains "/work" "Worker view"
assert_contains "/agents" "Agents supply center"

agents_body="$(fetch "/api/agents")"
if [[ "$agents_body" != *"prediction-market-pyagent"* ]]; then
  log "expected /api/agents to include prediction-market-pyagent"
  exit 1
fi

log "ok"
