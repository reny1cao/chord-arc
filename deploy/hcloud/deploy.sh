#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${CHORD_APP_DIR:-/home/dev/chord-arc}"
REPO_URL="${CHORD_REPO_URL:-https://github.com/reny1cao/chord-arc.git}"
BRANCH="${CHORD_BRANCH:-main}"
GIT_SHA="${GIT_SHA:-}"
COMPOSE_FILE="deploy/hcloud/docker-compose.yml"
PORT="${CHORD_NEXT_PORT:-3010}"
CADDY_DOMAIN="${CHORD_CADDY_DOMAIN:-chord.caorenyi.com}"
CADDY_CONTAINER="${CHORD_CADDY_CONTAINER:-speech-relay-caddy-1}"
CADDY_FILE="${CHORD_CADDY_FILE:-/etc/caddy/Caddyfile}"

log() {
  printf '[chord:hcloud] %s\n' "$*"
}

configure_caddy() {
  if [ -z "$CADDY_DOMAIN" ]; then
    log "CHORD_CADDY_DOMAIN is empty; skipping Caddy route"
    return
  fi

  if ! docker ps --format '{{.Names}}' | grep -Fxq "$CADDY_CONTAINER"; then
    log "Caddy container $CADDY_CONTAINER not found; skipping Caddy route"
    return
  fi

  local web_container web_name web_network caddy_network_mode upstream caddy_gateway
  web_container="$(docker compose -f "$COMPOSE_FILE" ps -q web)"
  if [ -z "$web_container" ]; then
    log "web container not found; cannot configure Caddy"
    exit 1
  fi

  web_name="$(docker inspect -f '{{.Name}}' "$web_container" | sed 's#^/##')"
  web_network="$(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$web_container" | head -n 1)"
  if [ -z "$web_name" ] || [ -z "$web_network" ]; then
    log "could not resolve web container name/network for Caddy"
    exit 1
  fi

  caddy_network_mode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CADDY_CONTAINER")"
  if [ "$caddy_network_mode" = "host" ]; then
    upstream="127.0.0.1:$CHORD_NEXT_PORT"
    log "$CADDY_CONTAINER uses host networking; using host upstream $upstream"
  elif [[ "$caddy_network_mode" == container:* ]]; then
    caddy_gateway="$(
      docker exec "$CADDY_CONTAINER" sh -c "ip route 2>/dev/null | awk '/default/ {print \$3; exit}' || true" 2>/dev/null || true
    )"
    upstream="${caddy_gateway:-172.17.0.1}:$CHORD_NEXT_PORT"
    log "$CADDY_CONTAINER shares another network namespace; using host-gateway upstream $upstream"
  else
    upstream="$web_name:3000"
    if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$CADDY_CONTAINER" | grep -Fq "\"$web_network\""; then
      log "connecting $CADDY_CONTAINER to docker network $web_network"
      docker network connect "$web_network" "$CADDY_CONTAINER"
    fi
  fi

  log "configuring Caddy route $CADDY_DOMAIN -> $upstream"
  docker exec -i -u 0 "$CADDY_CONTAINER" sh -s -- "$CADDY_DOMAIN" "$upstream" "$CADDY_FILE" <<'SCRIPT'
set -eu

domain="$1"
upstream="$2"
file="$3"
tmp="$(mktemp)"

awk '
  /^# BEGIN CHORD MANAGED$/ { skip=1; next }
  /^# END CHORD MANAGED$/ { skip=0; next }
  skip != 1 { print }
' "$file" > "$tmp"

cat >> "$tmp" <<EOF

# BEGIN CHORD MANAGED
$domain {
	encode zstd gzip
	reverse_proxy $upstream
}
# END CHORD MANAGED
EOF

cat "$tmp" > "$file"
rm -f "$tmp"
caddy fmt --overwrite "$file"
caddy reload --config "$file"
SCRIPT
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

configure_caddy

log "waiting for app health"
APP_URL="${CHORD_APP_URL:-http://127.0.0.1:$CHORD_NEXT_PORT}" "$APP_DIR/deploy/hcloud/smoke.sh"

log "deployed $(git rev-parse --short HEAD)"
