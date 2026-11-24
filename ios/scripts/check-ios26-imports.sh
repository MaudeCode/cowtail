#!/usr/bin/env sh
# Fails when a Mach-O under the given path strongly imports a symbol that exists only in the iOS 27 runtime. dyld
# refuses to launch such an app on iOS 26, the deployment target, and CI has no iOS 26 simulator to show it.
# Usage: scripts/check-ios26-imports.sh <Cowtail.app or a Mach-O file>
set -eu

# Runtime symbols iOS 26 lacks, separated by spaces. A weak import is fine: dyld binds it to null.
IOS27_ONLY_SYMBOLS="_swift_initBorrow"

if [ "$#" -ne 1 ] || [ ! -e "$1" ]; then
  echo "Usage: scripts/check-ios26-imports.sh <app bundle or Mach-O file>" >&2
  exit 64
fi

# A "binary<TAB>" line per Mach-O checked, and a "binary<TAB>symbol" line per strong import of a listed symbol.
# Covers the app, its frameworks and any .appex, or the one file given.
report="$(
  find "$1" -type f | while IFS= read -r binary; do
    file -b "${binary}" | grep -q 'Mach-O' || continue
    printf '%s\t\n' "${binary}"
    nm -m "${binary}" | awk -v binary="${binary}" -v symbols="${IOS27_ONLY_SYMBOLS}" '
      BEGIN { n = split(symbols, list, " "); for (i = 1; i <= n; i += 1) wanted[list[i]] = 1 }
      /\(undefined\)/ {
        for (i = 2; i < NF; i += 1) {
          if ($i == "external" && ($(i + 1) in wanted) && $(i - 1) != "weak") print binary "\t" $(i + 1)
        }
      }
    '
  done
)"

checked="$(printf '%s\n' "${report}" | awk -F '\t' '$2 == "" && $1 != ""' | wc -l | tr -d ' ')"
strong="$(printf '%s\n' "${report}" | awk -F '\t' '$2 != ""' | sort -u)"

if [ "${checked}" -eq 0 ]; then
  echo "No Mach-O binaries found under $1" >&2
  exit 1
fi
if [ -n "${strong}" ]; then
  printf '%s\n' "${strong}" | while IFS="$(printf '\t')" read -r binary symbol; do
    echo "::error::${binary} strongly imports ${symbol}, which iOS 26 lacks" >&2
  done
  exit 1
fi
echo "Checked ${checked} Mach-O binaries under $1: no strong iOS 27-only imports"
