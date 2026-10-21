#!/bin/sh
# Shared helpers for the ProcessHub operations scripts. Sourced, not run directly.
# Every script works from the repository root, where docker compose finds .env (and COMPOSE_FILE in it).

cd "$(dirname "$0")/.." || exit 1

info() { printf '%s\n' "==> $*"; }
warn() { printf '%s\n' "WARNING: $*" >&2; }
die() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker is not installed or not in PATH."
docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is missing (docker compose)."

compose() { docker compose "$@"; }

# Compose project name (default: processhub), used for volume and network names.
project_name() { compose config 2>/dev/null | sed -n 's/^name: //p' | head -n 1; }

# Container id of a running service, empty when it is not running.
service_container() { compose ps -q "$1" 2>/dev/null | head -n 1; }

# Value of an environment variable inside a service's container.
container_env() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p" | head -n 1
}

# First Docker network the container is attached to.
container_network() {
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$1" | head -n 1
}

# Wait until a service reports healthy (max. $2 seconds, default 180).
wait_healthy() {
  _svc=$1
  _max=${2:-180}
  _i=0
  while [ "$_i" -lt "$_max" ]; do
    _cid=$(service_container "$_svc")
    if [ -n "$_cid" ]; then
      _state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$_cid")
      [ "$_state" = "healthy" ] && return 0
    fi
    sleep 2
    _i=$((_i + 2))
  done
  die "service '$_svc' did not become healthy within ${_max}s (see: docker compose logs $_svc)."
}
