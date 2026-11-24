#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/test.sh <test-target>..." >&2
  exit 64
fi

IOS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
# CI's device, which the hosted image provides; setup-ios exports the OS of the pinned Xcode's simulator SDK.
DESTINATION="${COWTAIL_IOS_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 17,OS=${COWTAIL_IOS_TEST_OS:-latest}}"

count="$#"
for target in "$@"; do
  set -- "$@" "-only-testing:${target}"
done
shift "${count}"

cd "${IOS_ROOT}"
./generate.sh
# One build for every target named.
xcodebuild test \
  -project Cowtail.xcodeproj \
  -scheme Cowtail \
  -destination "${DESTINATION}" \
  "$@"
