#!/bin/sh
# Start-up for the API container: secrets, migrations, optional seed, then the server.
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

echo "Applying database migrations…"
./node_modules/.bin/prisma migrate deploy

if [ "$SEED_ON_START" = "true" ]; then
  echo "Running seed…"
  node dist/prisma/seed.js
fi

exec node dist/src/main.js
