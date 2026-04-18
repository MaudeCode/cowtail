#!/usr/bin/env bash

set -euo pipefail

source_root="${CODEX_SOURCE_TREE_PATH:-}"
worktree_root="${CODEX_WORKTREE_PATH:-}"

if [[ -z "${source_root}" || -z "${worktree_root}" ]]; then
  echo "CODEX_SOURCE_TREE_PATH and CODEX_WORKTREE_PATH are required." >&2
  exit 1
fi

copy_if_missing() {
  local relative_path="$1"
  local source_path="${source_root}/${relative_path}"
  local worktree_path="${worktree_root}/${relative_path}"

  if [[ ! -f "${source_path}" || -e "${worktree_path}" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "${worktree_path}")"
  cp -p "${source_path}" "${worktree_path}"
}

# Keep local-only app config available inside Codex-created worktrees.
copy_if_missing "web/.env"
copy_if_missing "ios/Config/project.env"
