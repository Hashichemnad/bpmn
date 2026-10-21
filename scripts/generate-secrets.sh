#!/bin/sh
# Create .env from .env.example.prod (if it does not exist yet) and replace every __GENERATE__ value
# with a new random secret. Values that are already set are never changed, so running it again is safe.
#
#   ./scripts/generate-secrets.sh
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  [ -f .env.example.prod ] || { echo "ERROR: .env.example.prod not found." >&2; exit 1; }
  cp .env.example.prod .env
  echo "==> Created .env from .env.example.prod"
fi
chmod 600 .env

# Random secrets from the kernel's random generator (no extra tools needed).
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

secret_for() {
  case "$1" in
    POSTGRES_PASSWORD) hex 24 ;; # part of DATABASE_URL: hex keeps it URL-safe
    MINIO_SECRET_KEY) hex 24 ;;
    JWT_ACCESS_SECRET) b64 48 ;;
    INTEGRATIONS_ENCRYPTION_KEY) b64 32 ;; # exactly 32 bytes, base64 (AES-256-GCM)
    SEED_ADMIN_PASSWORD) printf 'Ph1-%s' "$(hex 10)" ;; # meets the password policy (upper, lower, digit)
    *) hex 24 ;;
  esac
}

generated=""
tmp=$(mktemp .env.XXXXXX)
chmod 600 "$tmp"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=__GENERATE__)
      key=${line%%=*}
      value=$(secret_for "$key")
      printf '%s=%s\n' "$key" "$value" >>"$tmp"
      generated="$generated $key"
      [ "$key" = SEED_ADMIN_PASSWORD ] && admin_password=$value
      ;;
    *) printf '%s\n' "$line" >>"$tmp" ;;
  esac
done <.env
mv "$tmp" .env

if [ -z "$generated" ]; then
  echo "==> Nothing to generate: every secret in .env is already set."
else
  echo "==> Generated:$generated"
fi
if [ -n "${admin_password:-}" ]; then
  echo "==> First administrator password (shown once, change it after the first sign-in):"
  echo "      $admin_password"
fi
grep -q '^DOMAIN=processhub.example.com$' .env && echo "==> Next: set DOMAIN, CADDY_TLS and SEED_ADMIN_EMAIL in .env"
echo "==> Store a copy of .env in your password manager or vault (needed to restore backups)."
