#!/bin/sh
# Back up ProcessHub: the PostgreSQL database and all uploaded files (attachments, logos).
#
#   ./scripts/backup.sh               # run by hand or daily from cron (deploy/processhub-backup.cron)
#   ./scripts/backup.sh --with-env    # also copy .env (secrets!) into the backup folder
#
# Creates  $BACKUP_DIR/processhub-<date>_<time>/  with
#   database.dump    PostgreSQL dump (pg_dump custom format, compressed)
#   files.tar.gz     the file storage volume (objects are plain files, DECISIONS D-051)
#   MANIFEST.txt     what was backed up, versions and the fingerprint of the encryption key
#   SHA256SUMS       checksums, verified by restore.sh
# and deletes backups older than BACKUP_KEEP_DAYS. BACKUP_DIR and BACKUP_KEEP_DAYS come from the
# environment or .env (defaults /var/backups/processhub and 14). The services keep running.
#
# The backup does NOT contain .env (unless --with-env). Keep .env safe separately: restoring needs the
# same INTEGRATIONS_ENCRYPTION_KEY, otherwise stored Git / SMTP / AI secrets must be entered again.
set -eu
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

WITH_ENV=false
for arg in "$@"; do
  case "$arg" in
    --with-env) WITH_ENV=true ;;
    -h | --help)
      sed -n '2,19p' "$0"
      exit 0
      ;;
    *) die "unknown option: $arg" ;;
  esac
done

env_value() {
  if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -n 1; fi
}
BACKUP_DIR=${BACKUP_DIR:-$(env_value BACKUP_DIR)}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/processhub}
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-$(env_value BACKUP_KEEP_DAYS)}
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
LABEL=${BACKUP_LABEL:-processhub}

PG=$(service_container postgres)
STORAGE=$(service_container storage)
[ -n "$PG" ] || die "the postgres service is not running (docker compose up -d)."
[ -n "$STORAGE" ] || die "the storage service is not running (docker compose up -d)."
DB_USER=$(container_env "$PG" POSTGRES_USER)
DB_NAME=$(container_env "$PG" POSTGRES_DB)

umask 077
mkdir -p "$BACKUP_DIR"
NAME="$LABEL-$(date +%Y-%m-%d_%H%M%S)"
WORK="$BACKUP_DIR/.$NAME.partial"
TARGET="$BACKUP_DIR/$NAME"
rm -rf "$WORK"
mkdir "$WORK"
trap 'rm -rf "$WORK"' EXIT

info "Backing up database '$DB_NAME'"
docker exec "$PG" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=6 >"$WORK/database.dump"
# A dump that pg_restore cannot read is worthless: check it now, not on the day of the restore.
docker exec -i "$PG" pg_restore --list <"$WORK/database.dump" >/dev/null ||
  die "the database dump could not be read back."

info "Backing up file storage"
docker exec "$STORAGE" tar -C /data --exclude=.vgwlocks -czf - . >"$WORK/files.tar.gz"
FILE_COUNT=$(tar -tzf "$WORK/files.tar.gz" | grep -c '^\./objects/.*[^/]$' || true)

if [ "$WITH_ENV" = true ]; then
  [ -f .env ] || die "--with-env: .env not found."
  cp .env "$WORK/env.secret"
  warn "the backup contains .env with all secrets: store it encrypted and access-controlled."
fi

# Fingerprint (not the key itself) so restore.sh can warn about a different key.
KEY=$(env_value INTEGRATIONS_ENCRYPTION_KEY)
API=$(service_container api)
[ -n "$KEY" ] || [ -z "$API" ] || KEY=$(container_env "$API" INTEGRATIONS_ENCRYPTION_KEY)
KEY_FP=unknown
[ -z "$KEY" ] || KEY_FP=$(printf '%s' "$KEY" | sha256sum | cut -c1-16)

{
  echo "ProcessHub backup $NAME"
  echo "created:            $(date -Iseconds)"
  echo "host:               $(hostname)"
  echo "processhub commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "postgres:           $(docker exec "$PG" postgres --version)"
  echo "database:           $DB_NAME ($(wc -c <"$WORK/database.dump") bytes)"
  echo "files:              $FILE_COUNT ($(wc -c <"$WORK/files.tar.gz") bytes)"
  echo "encryption key fp:  $KEY_FP"
  echo "includes .env:      $WITH_ENV"
} >"$WORK/MANIFEST.txt"
(cd "$WORK" && sha256sum database.dump files.tar.gz >SHA256SUMS)

mv "$WORK" "$TARGET"
trap - EXIT
info "Backup complete: $TARGET ($(du -sh "$TARGET" | cut -f1), $FILE_COUNT files)"

# Retention: delete complete backups older than BACKUP_KEEP_DAYS and leftovers of failed runs.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'processhub-*' -mtime "+$BACKUP_KEEP_DAYS" \
  -exec rm -rf {} + -exec echo "==> Deleted old backup {}" \;
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.*.partial' -mtime +1 -exec rm -rf {} +

[ "$WITH_ENV" = true ] || info "Reminder: .env (encryption keys) is not in the backup - keep a copy in your vault."
