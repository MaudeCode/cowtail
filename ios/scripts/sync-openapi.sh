#!/usr/bin/env sh
set -eu

IOS_ROOT="${SRCROOT:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
REPO_ROOT="$(CDPATH= cd -- "${IOS_ROOT}/.." && pwd)"

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [ -n "${SHELL:-}" ] && [ -x "${SHELL}" ]; then
    node_path="$("${SHELL}" -lc 'command -v node' 2>/dev/null || true)"
    if [ -n "${node_path}" ] && [ -x "${node_path}" ]; then
      printf '%s\n' "${node_path}"
      return 0
    fi
  fi

  if command -v mise >/dev/null 2>&1; then
    node_path="$(mise which node 2>/dev/null || true)"
    if [ -n "${node_path}" ] && [ -x "${node_path}" ]; then
      printf '%s\n' "${node_path}"
      return 0
    fi
  fi

  return 1
}

if ! NODE_BIN="$(resolve_node)"; then
  echo "Unable to locate 'node' for the Xcode script phase. Install Node or ensure your login shell exposes it." >&2
  exit 127
fi

cd "${REPO_ROOT}"
"${NODE_BIN}" ./protocol/scripts/generate-ios-openapi.ts
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
