#!/bin/sh
# Restore ProcessHub from a folder created by backup.sh. REPLACES the current database and files.
#
#   ./scripts/restore.sh /var/backups/processhub/processhub-2026-10-21_023000
#   ./scripts/restore.sh <folder> --yes                 # no questions (scripts, restore drills)
#   ./scripts/restore.sh <folder> --no-safety-backup    # skip the backup of the current state
#
# Steps: verify checksums → compare the encryption key fingerprint → back up the current state
# (label "pre-restore") → stop the app → replace database and files → start everything and wait until
# the API is healthy. Run it from the ProcessHub folder on the server, with the .env of the installation
# (same INTEGRATIONS_ENCRYPTION_KEY as when the backup was made, see MANIFEST.txt).
set -eu
CALLER_DIR=$(pwd)
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

SRC=""
YES=false
SAFETY=true
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --no-safety-backup) SAFETY=false ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    -*) die "unknown option: $arg" ;;
    *) SRC=$arg ;;
  esac
done
[ -n "$SRC" ] || die "usage: ./scripts/restore.sh <backup folder> [--yes] [--no-safety-backup]"
case "$SRC" in /*) ;; *) SRC="$CALLER_DIR/$SRC" ;; esac # lib.sh changed to the repository root
[ -d "$SRC" ] || die "backup folder not found: $SRC"
for f in database.dump files.tar.gz SHA256SUMS MANIFEST.txt; do
  [ -f "$SRC/$f" ] || die "$SRC is not a complete ProcessHub backup ($f is missing)."
done

info "Verifying checksums"
(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch: the backup is damaged."
sed 's/^/    /' "$SRC/MANIFEST.txt"

env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
BACKUP_FP=$(sed -n 's/^encryption key fp: *//p' "$SRC/MANIFEST.txt")
KEY=$(env_value INTEGRATIONS_ENCRYPTION_KEY)
CURRENT_FP=unknown
[ -z "$KEY" ] || CURRENT_FP=$(printf '%s' "$KEY" | sha256sum | cut -c1-16)
if [ "$BACKUP_FP" != unknown ] && [ "$BACKUP_FP" != "$CURRENT_FP" ]; then
  warn "INTEGRATIONS_ENCRYPTION_KEY in .env is not the key this backup was made with."
  warn "Everything is restored, but stored Git / SMTP / AI secrets must be entered again in Settings."
  [ -f "$SRC/env.secret" ] && warn "The backup contains env.secret: copy the key from there into .env first."
fi

if [ "$YES" != true ]; then
  printf '%s' "This REPLACES all current ProcessHub data with the backup. Type RESTORE to continue: "
  read -r answer
  [ "$answer" = RESTORE ] || die "cancelled."
fi

info "Starting database and storage"
compose up -d postgres storage
wait_healthy postgres
wait_healthy storage

if [ "$SAFETY" = true ]; then
  info "Backing up the current state first (label pre-restore)"
  BACKUP_LABEL=processhub-pre-restore "$(pwd)/scripts/backup.sh"
fi

SERVICES=$(compose config --services)
for svc in caddy web api; do
  if echo "$SERVICES" | grep -qx "$svc"; then compose stop "$svc"; fi
done

PG=$(service_container postgres)
DB_USER=$(container_env "$PG" POSTGRES_USER)
DB_NAME=$(container_env "$PG" POSTGRES_DB)

info "Restoring database '$DB_NAME'"
docker exec "$PG" psql -q -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
docker exec -i "$PG" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --role="$DB_USER" --exit-on-error \
  <"$SRC/database.dump"

info "Restoring files"
compose stop storage
compose run --rm --no-deps -T --entrypoint sh storage \
  -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' <"$SRC/files.tar.gz"

info "Starting ProcessHub"
compose up -d
wait_healthy api 300
info "Restore complete from $SRC. Sign in and check a few processes, pages and attachments."
