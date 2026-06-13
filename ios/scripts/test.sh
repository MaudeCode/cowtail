#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/test.sh <only-testing-target>" >&2
  exit 64
fi

IOS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TEST_TARGET="$1"
DEVICE_NAME="${COWTAIL_IOS_TEST_DEVICE_NAME:-iPhone 17 Pro}"
SIMULATOR_OS="${COWTAIL_IOS_TEST_OS:-26.4.1}"
if [ -n "${COWTAIL_IOS_TEST_DESTINATION:-}" ]; then
  DESTINATION="${COWTAIL_IOS_TEST_DESTINATION}"
else
  target_udid="$(
    xcrun simctl list devices available "iOS ${SIMULATOR_OS}" |
      awk -v device="${DEVICE_NAME}" '
        index($0, "    " device " (") == 1 && match($0, /\([0-9A-Fa-f-]{36}\)/) {
          print substr($0, RSTART + 1, RLENGTH - 2)
          exit
        }
      '
  )"

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
