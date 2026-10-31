#!/bin/sh
# Backup / restore drill (final session, part A; DEPLOYMENT.md §8): proves that backup.sh and
# restore.sh round-trip the database, the uploaded files and the encryption key, and records timings.
#
#   ./scripts/backup-drill.sh            # on a TEST installation (asks for confirmation)
#   ./scripts/backup-drill.sh --yes      # CI (runs after the end-to-end tests)
#
# Steps: seal a canary secret with INTEGRATIONS_ENCRYPTION_KEY and store it in the database →
# fingerprint the database (row counts + checksums of key tables) and every stored file → backup.sh →
# damage the installation (canary deleted, a process renamed, a stray file added) → restore.sh →
# compare the fingerprints and decrypt the canary. It REPLACES the data of the installation with
# the backup it just made, so never run it against production while people are working.
set -eu
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"
YES=false
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) die "unknown option: $arg" ;;
  esac
done
if [ "$YES" != true ]; then
  printf '%s' "The drill restores this installation from a fresh backup. Type DRILL to continue: "
  read -r answer
  [ "$answer" = DRILL ] || die "cancelled."
fi

PG=$(service_container postgres)
API=$(service_container api)
STORAGE=$(service_container storage)
if [ -z "$PG" ] || [ -z "$API" ] || [ -z "$STORAGE" ]; then
  die "start the installation first (docker compose up -d)."
fi
DB_USER=$(container_env "$PG" POSTGRES_USER)
DB_NAME=$(container_env "$PG" POSTGRES_DB)
DRILL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/processhub-drill.XXXXXX")
trap 'rm -rf "$DRILL_DIR"' EXIT
now() { date +%s; }

sql() { docker exec -i "$(service_container postgres)" psql -qtA -U "$DB_USER" -d "$DB_NAME" -c "$1"; }
# Row counts and checksums of the main tables, and of every stored file.
fingerprint() {
  sql "SELECT concat_ws(' ',
    (SELECT count(*) FROM \"User\"), (SELECT count(*) FROM \"Process\"),
    (SELECT count(*) FROM \"ProcessVersion\"), (SELECT count(*) FROM \"Page\"),
    (SELECT count(*) FROM \"Publication\"), (SELECT count(*) FROM \"AuditLog\"),
    (SELECT count(*) FROM \"Attachment\"),
    (SELECT md5(string_agg(id::text || code || \"nameEn\", ',' ORDER BY id)) FROM \"Process\"),
    (SELECT md5(string_agg(\"processId\"::text || md5(\"bpmnXml\"), ',' ORDER BY \"processId\")) FROM \"ProcessModel\"),
    (SELECT md5(string_agg(key || value::text, ',' ORDER BY key)) FROM \"Setting\"))"
  docker exec "$(service_container storage)" sh -c \
    'cd /data/objects && find . -type f ! -name ".*" | sort | xargs -r sha256sum | sha256sum | cut -c1-16; find . -type f ! -name ".*" | wc -l'
}
# Encrypts / decrypts with the key the API runs with (the code of the API image).
api_node() { docker exec -i "$(service_container api)" node -e "$1"; }
# The key from the environment, or the one the API generated in its data volume.
KEYJS='const key=process.env.INTEGRATIONS_ENCRYPTION_KEY||require("fs").readFileSync("/app/data/integrations_encryption_key","utf8");const box=new (require("./dist/src/integrations/secret-box").SecretBox)(key);'
SEAL="${KEYJS}process.stdout.write(box.encrypt(process.argv[1]))"
OPEN="${KEYJS}"'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(box.decrypt(s.trim())))'

info "Sealing a canary with the encryption key"
CANARY="drill-$(date +%s)-$$"
SEALED=$(docker exec "$API" node -e "$SEAL" "$CANARY")
sql "INSERT INTO \"Setting\" (key, value, \"updatedAt\") VALUES ('backup.drill', to_jsonb('$SEALED'::text), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \"updatedAt\" = now();" >/dev/null
fingerprint >"$DRILL_DIR/before"
sed 's/^/    /' "$DRILL_DIR/before"

info "Backup"
t0=$(now)
BACKUP_DIR="$DRILL_DIR/backups" BACKUP_LABEL=processhub-drill ./scripts/backup.sh
t1=$(now)
BACKUP=$(find "$DRILL_DIR/backups" -mindepth 1 -maxdepth 1 -type d -name 'processhub-drill-*' | head -n 1)
[ -n "$BACKUP" ] || die "backup.sh did not create a backup folder."
SIZE=$(du -sh "$BACKUP" | cut -f1)

info "Damaging the installation (canary, a process name, a stray file)"
sql "DELETE FROM \"Setting\" WHERE key = 'backup.drill';
     UPDATE \"Process\" SET \"nameEn\" = \"nameEn\" || ' (changed after the backup)' WHERE id = (SELECT id FROM \"Process\" ORDER BY id LIMIT 1);" >/dev/null
docker exec "$STORAGE" sh -c 'mkdir -p /data/objects/drill && echo stray > /data/objects/drill/stray.txt'
fingerprint >"$DRILL_DIR/damaged"
cmp -s "$DRILL_DIR/before" "$DRILL_DIR/damaged" && die "the damage did not change the fingerprint (drill is not meaningful)."

info "Restore"
t2=$(now)
./scripts/restore.sh "$BACKUP" --yes --no-safety-backup
t3=$(now)
wait_healthy api 300

info "Verifying"
fingerprint >"$DRILL_DIR/after"
if ! cmp -s "$DRILL_DIR/before" "$DRILL_DIR/after"; then
  diff "$DRILL_DIR/before" "$DRILL_DIR/after" >&2 || true
  die "the restored installation differs from the backed-up state."
fi
RESTORED=$(sql "SELECT value #>> '{}' FROM \"Setting\" WHERE key = 'backup.drill';")
OPENED=$(printf '%s' "$RESTORED" | api_node "$OPEN")
[ "$OPENED" = "$CANARY" ] || die "the canary did not decrypt after the restore (encryption key round-trip failed)."
sql "DELETE FROM \"Setting\" WHERE key = 'backup.drill';" >/dev/null

info "Drill passed: database, files and encryption key round-trip"
echo "    backup:  $((t1 - t0)) s ($SIZE)"
echo "    restore: $((t3 - t2)) s (incl. restart until the API is healthy)"
