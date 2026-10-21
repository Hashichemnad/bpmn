#!/bin/sh
# Copy the files of an installation that used the old MinIO container (before Phase 6, D-009) into the
# new file storage service (Versity S3 Gateway, D-051). Run once after updating, from any directory:
#
#   ./scripts/migrate-minio-storage.sh
#
# What it does:
#   1. stops the API (users cannot upload during the copy),
#   2. starts the old MinIO image for a moment on the old volume (default <project>_minio-data),
#   3. copies every object into the new storage with rclone and checks size + checksum of each file,
#   4. removes the temporary MinIO container and starts the API again.
# The old volume is NOT deleted. Remove it yourself once ProcessHub shows all attachments and logos:
#   docker volume rm <project>_minio-data
#
# Environment overrides: OLD_VOLUME, BUCKET (default: the API's MINIO_BUCKET or processhub),
#                         MINIO_IMAGE (old image), RCLONE_IMAGE.
set -eu
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"

MINIO_IMAGE=${MINIO_IMAGE:-bitnamilegacy/minio:2025.4.22}
RCLONE_IMAGE=${RCLONE_IMAGE:-rclone/rclone:1.75.2}
PROJECT=$(project_name)
[ -n "$PROJECT" ] || die "cannot read the Docker Compose configuration (run from the ProcessHub folder, check .env)."
OLD_VOLUME=${OLD_VOLUME:-${PROJECT}_minio-data}
TEMP=ph-minio-migrate

docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1 ||
  die "volume '$OLD_VOLUME' not found - nothing to migrate (set OLD_VOLUME if it has another name)."

info "Starting the new storage service"
compose up -d storage
wait_healthy storage
STORAGE=$(service_container storage)
NETWORK=$(container_network "$STORAGE")
ACCESS=$(container_env "$STORAGE" ROOT_ACCESS_KEY_ID)
SECRET=$(container_env "$STORAGE" ROOT_SECRET_ACCESS_KEY)
API=$(service_container api)
BUCKET=${BUCKET:-$( [ -n "$API" ] && container_env "$API" MINIO_BUCKET || true)}
BUCKET=${BUCKET:-processhub}

if [ -n "$API" ]; then
  info "Stopping the API during the copy"
  compose stop api
fi

cleanup() { docker rm -f "$TEMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

info "Starting the old MinIO ($MINIO_IMAGE) on volume $OLD_VOLUME"
cleanup
# The old container used the same root user and password as the new storage (MINIO_ACCESS_KEY / _SECRET_KEY).
docker run -d --name "$TEMP" --network "$NETWORK" \
  -e MINIO_ROOT_USER="$ACCESS" -e MINIO_ROOT_PASSWORD="$SECRET" \
  -v "$OLD_VOLUME":/bitnami/minio/data "$MINIO_IMAGE" >/dev/null
i=0
until docker exec "$TEMP" curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do
  i=$((i + 2))
  [ "$i" -lt 120 ] || die "the old MinIO did not start (docker logs $TEMP)."
  sleep 2
done

rclone() {
  docker run --rm --network "$NETWORK" -e RCLONE_CONFIG=/dev/null \
    -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio \
    -e RCLONE_CONFIG_OLD_ENDPOINT="http://$TEMP:9000" \
    -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID="$ACCESS" -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY="$SECRET" \
    -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other \
    -e RCLONE_CONFIG_NEW_ENDPOINT="http://storage:7070" -e RCLONE_CONFIG_NEW_FORCE_PATH_STYLE=true \
    -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID="$ACCESS" -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY="$SECRET" \
    "$RCLONE_IMAGE" "$@"
}

info "Copying bucket '$BUCKET'"
rclone copy "old:$BUCKET" "new:$BUCKET" --metadata --stats-one-line --stats 10s
info "Checking every file (size and checksum)"
rclone check "old:$BUCKET" "new:$BUCKET" --one-way
COUNT=$(rclone size "new:$BUCKET" | sed -n 's/^Total objects: *//p')

cleanup
if [ -n "$API" ]; then
  info "Starting the API again"
  compose up -d api
  wait_healthy api 300
fi
info "Done: ${COUNT:-?} file(s) are in the new storage. The old volume '$OLD_VOLUME' is kept;"
info "delete it after checking attachments and logos in ProcessHub: docker volume rm $OLD_VOLUME"
