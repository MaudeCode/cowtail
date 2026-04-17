#!/usr/bin/env sh
set -eu

IOS_ROOT="${SRCROOT:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
REPO_ROOT="$(CDPATH= cd -- "${IOS_ROOT}/.." && pwd)"

resolve_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  if [ -n "${SHELL:-}" ] && [ -x "${SHELL}" ]; then
    bun_path="$("${SHELL}" -lc 'command -v bun' 2>/dev/null || true)"
    if [ -n "${bun_path}" ] && [ -x "${bun_path}" ]; then
      printf '%s\n' "${bun_path}"
      return 0
    fi
  fi

  if command -v mise >/dev/null 2>&1; then
    bun_path="$(mise which bun 2>/dev/null || true)"
    if [ -n "${bun_path}" ] && [ -x "${bun_path}" ]; then
      printf '%s\n' "${bun_path}"
      return 0
    fi
  fi

  return 1
}

if ! BUN_BIN="$(resolve_bun)"; then
  echo "Unable to locate 'bun' for the Xcode script phase. Install bun or ensure your login shell exposes it." >&2
  exit 127
fi

cd "${REPO_ROOT}"
"${BUN_BIN}" run ./protocol/scripts/generate-ios-openapi.ts
xcrun --sdk macosx swift package \
  --package-path "${REPO_ROOT}/ios/OpenAPITools" \
  --allow-writing-to-package-directory \
  generate-code-from-openapi \
  --target CowtailGeneratedAPI

GENERATED_SOURCE_DIR="${REPO_ROOT}/ios/OpenAPITools/Sources/CowtailGeneratedAPI/GeneratedSources"
APP_GENERATED_DIR="${REPO_ROOT}/ios/CowtailApp/Sources/Generated/OpenAPI"

mkdir -p "${APP_GENERATED_DIR}"
find "${APP_GENERATED_DIR}" -type f -name '*.swift' -delete
cp "${GENERATED_SOURCE_DIR}"/*.swift "${APP_GENERATED_DIR}/"
