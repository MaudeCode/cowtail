#!/usr/bin/env sh
# Proves check-ios26-imports.sh fails on a strong import of an iOS 27-only symbol and passes on a weak one.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

cat > "${work}/strong.c" <<'EOF'
extern void swift_initBorrow(void);
void cowtail_fixture(void) { swift_initBorrow(); }
EOF
cat > "${work}/weak.c" <<'EOF'
extern void swift_initBorrow(void) __attribute__((weak_import));
void cowtail_fixture(void) { if (swift_initBorrow) swift_initBorrow(); }
EOF
clang -c "${work}/strong.c" -o "${work}/strong.o"
clang -c "${work}/weak.c" -o "${work}/weak.o"

if "${SCRIPT_DIR}/check-ios26-imports.sh" "${work}/strong.o" > "${work}/strong.log" 2>&1; then
  echo "FAIL: the guard passed a strong _swift_initBorrow import" >&2
  cat "${work}/strong.log" >&2
  exit 1
fi
if ! grep -q "strong.o strongly imports _swift_initBorrow" "${work}/strong.log"; then
  echo "FAIL: the guard failed without naming the binary and symbol" >&2
  cat "${work}/strong.log" >&2
  exit 1
fi
if ! "${SCRIPT_DIR}/check-ios26-imports.sh" "${work}/weak.o"; then
  echo "FAIL: the guard rejected a weak _swift_initBorrow import" >&2
  exit 1
fi
echo "PASS: strong import rejected, weak import accepted"
