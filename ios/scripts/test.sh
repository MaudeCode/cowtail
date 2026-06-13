#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/test.sh <only-testing-target>" >&2
  exit 64
fi

IOS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TEST_TARGET="$1"
DEVICE_NAME="${COWTAIL_IOS_TEST_DEVICE_NAME:-iPhone 17 Pro}"
SIMULATOR_OS="${COWTAIL_IOS_TEST_OS:-latest}"
if [ -n "${COWTAIL_IOS_TEST_DESTINATION:-}" ]; then
  target_udid="$(COWTAIL_IOS_TEST_OS="${SIMULATOR_OS}" "${IOS_ROOT}/scripts/resolve-simulator-udid.sh")"

  if [ -n "${target_udid}" ]; then
    DESTINATION="id=${target_udid}"
  else
    DESTINATION="${COWTAIL_IOS_TEST_DESTINATION}"
  fi
else
  target_udid="$(COWTAIL_IOS_TEST_OS="${SIMULATOR_OS}" "${IOS_ROOT}/scripts/resolve-simulator-udid.sh")"

  if [ -n "${target_udid}" ]; then
    DESTINATION="id=${target_udid}"
  else
    DESTINATION="platform=iOS Simulator,name=${DEVICE_NAME},OS=${SIMULATOR_OS}"
  fi
fi

cd "${IOS_ROOT}"
./generate.sh
xcodebuild test \
  -project Cowtail.xcodeproj \
  -scheme Cowtail \
  -destination "${DESTINATION}" \
  -only-testing:"${TEST_TARGET}"
