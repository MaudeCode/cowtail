#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/Config/project.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}" >&2
  echo "Start from Config/project.env.example and rerun ./generate.sh" >&2
  exit 1
fi

set -a
. "${ENV_FILE}"
set +a

if [ -z "${COWTAIL_AUTH_SESSION_URL:-}" ]; then
  COWTAIL_AUTH_SESSION_URL="${COWTAIL_ALERT_WRITE_URL%/alerts}/auth/session"
fi
export COWTAIL_AUTH_SESSION_URL

if [ -z "${COWTAIL_NOTIFICATION_PREFERENCES_URL:-}" ]; then
  COWTAIL_NOTIFICATION_PREFERENCES_URL="${COWTAIL_ALERT_WRITE_URL%/alerts}/me/notification-preferences"
fi
export COWTAIL_NOTIFICATION_PREFERENCES_URL

if [ -z "${COWTAIL_ROUNDUP_TIMEZONE:-}" ]; then
  COWTAIL_ROUNDUP_TIMEZONE="America/New_York"
fi
export COWTAIL_ROUNDUP_TIMEZONE

for key in \
  COWTAIL_DEVELOPMENT_TEAM \
  COWTAIL_PRODUCT_BUNDLE_IDENTIFIER \
  COWTAIL_PUBLIC_SITE_URL \
  COWTAIL_CONVEX_QUERY_URL \
  COWTAIL_HEALTH_SUMMARY_URL \
  COWTAIL_ALERT_WRITE_URL \
  COWTAIL_PUSH_REGISTRATION_URL \
  COWTAIL_PUSH_UNREGISTRATION_URL \
  COWTAIL_OPENCLAW_REALTIME_URL \
  COWTAIL_ASSOCIATED_DOMAIN_DEBUG \
  COWTAIL_ASSOCIATED_DOMAIN_RELEASE
do
  eval "value=\${${key}:-}"
  if [ -z "${value}" ]; then
    echo "Missing ${key} in ${ENV_FILE}" >&2
    exit 1
  fi
done

cd "${SCRIPT_DIR}/.."
bun run codegen:ios
cd "${SCRIPT_DIR}"

"${SCRIPT_DIR}/scripts/sync-openapi.sh"

exec xcodegen generate
