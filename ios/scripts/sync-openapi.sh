#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "${SRCROOT:-$(dirname "$0")/..}" && pwd)"

cd "${REPO_ROOT}"
bun run ./protocol/scripts/generate-ios-openapi.ts
xcrun --sdk macosx swift package \
  --package-path "${REPO_ROOT}/ios/OpenAPITools" \
  --allow-writing-to-package-directory \
  generate-code-from-openapi \
  --target CowtailGeneratedAPI \
