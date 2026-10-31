#!/bin/sh
# Start-up of the API images (apps/api/Dockerfile):
#   (no argument)  secrets, then the API server              — image processhub-api
#   migrate        secrets, database migrations, seed, exit   — image processhub-api-migrate
# docker-compose runs the migrate service once and starts the API after it succeeded.
set -e

# Generate a per-installation JWT secret when none is configured, persisted in the data volume.
if [ -z "$JWT_ACCESS_SECRET" ]; then
  SECRET_FILE=/app/data/jwt_access_secret
  if [ ! -s "$SECRET_FILE" ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "Generated a new JWT_ACCESS_SECRET in $SECRET_FILE"
  fi
  JWT_ACCESS_SECRET="$(cat "$SECRET_FILE")"
  export JWT_ACCESS_SECRET
fi

# Same for the key that encrypts integration tokens (GitHub/GitLab) at rest.
if [ -z "$INTEGRATIONS_ENCRYPTION_KEY" ]; then
  KEY_FILE=/app/data/integrations_encryption_key
  if [ ! -s "$KEY_FILE" ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "Generated a new INTEGRATIONS_ENCRYPTION_KEY in $KEY_FILE"
  fi
  INTEGRATIONS_ENCRYPTION_KEY="$(cat "$KEY_FILE")"
  export INTEGRATIONS_ENCRYPTION_KEY
fi

if [ "$1" = "migrate" ]; then
  if [ -z "$PRISMA_CLI" ]; then
    echo "This image has no Prisma CLI: run migrations with the processhub-api-migrate image." >&2
    exit 1
  fi
  echo "Applying database migrations…"
  "$PRISMA_CLI" migrate deploy --schema prisma/schema.prisma
  if [ "$SEED_ON_START" = "true" ]; then
    echo "Running seed…"
    node dist/prisma/seed.js
  fi
  echo "Database is up to date."
  exit 0
fi

exec node dist/src/main.js
