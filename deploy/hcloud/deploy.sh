#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CHORD_APP_DIR:-/home/dev/chord-arc}"
REPO_URL="${CHORD_REPO_URL:-https://github.com/reny1cao/chord-arc.git}"
BRANCH="${CHORD_BRANCH:-main}"
GIT_SHA="${GIT_SHA:-}"
COMPOSE_FILE="deploy/hcloud/docker-compose.yml"
PORT="${CHORD_NEXT_PORT:-3010}"

log() {
  printf '[chord:hcloud] %s\n' "$*"
}

if ! command -v git >/dev/null 2>&1; then
  log "git is required"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  log "docker compose v2 is required"
  exit 1
fi

mkdir -p "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  log "cloning $REPO_URL into $APP_DIR"
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
log "fetching origin/$BRANCH"
git fetch --prune origin "$BRANCH"

if [ -n "$GIT_SHA" ]; then
  log "checking out commit $GIT_SHA"
  git checkout --detach "$GIT_SHA"
else
  log "checking out origin/$BRANCH"
  git checkout -B "$BRANCH" "origin/$BRANCH"
fi

SHORT_SHA="$(git rev-parse --short HEAD)"
export CHORD_IMAGE_TAG="${CHORD_IMAGE_TAG:-$SHORT_SHA}"
export CHORD_NEXT_PORT="$PORT"
export NEXT_PUBLIC_CHORD_NETWORK="${NEXT_PUBLIC_CHORD_NETWORK:-arc}"

log "building and starting image chord-arc:$CHORD_IMAGE_TAG on port $CHORD_NEXT_PORT"
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

log "waiting for app health"
APP_URL="${CHORD_APP_URL:-http://127.0.0.1:$CHORD_NEXT_PORT}" "$APP_DIR/deploy/hcloud/smoke.sh"

log "deployed $(git rev-parse --short HEAD)"
