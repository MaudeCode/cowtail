#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/test.sh <test-target>..." >&2
  exit 64
fi

IOS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
# CI's device, which the hosted image provides; setup-ios exports the OS of the pinned Xcode's simulator SDK.
DEVICE="${COWTAIL_IOS_TEST_DEVICE:-iPhone 17}"
DESTINATION="${COWTAIL_IOS_TEST_DESTINATION:-platform=iOS Simulator,name=${DEVICE},OS=${COWTAIL_IOS_TEST_OS:-latest}}"

count="$#"
for target in "$@"; do
  set -- "$@" "-only-testing:${target}"
done
shift "${count}"

cd "${IOS_ROOT}"
./generate.sh
# CI reads each test's run time from this bundle (docs/testing.md); xcodebuild refuses to overwrite one.
RESULT_BUNDLE="${IOS_ROOT}/build/TestResults.xcresult"
rm -rf "${RESULT_BUNDLE}"
# One build for every target named.
xcodebuild test \
  -project Cowtail.xcodeproj \
  -scheme Cowtail \
  -destination "${DESTINATION}" \
  -resultBundlePath "${RESULT_BUNDLE}" \
  "$@"
