#!/usr/bin/env sh
set -eu

IOS_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
RESET_SLEEP_SECONDS="${COWTAIL_IOS_SIMULATOR_RESET_SLEEP:-5}"
BOOT_TIMEOUT_SECONDS="${COWTAIL_IOS_SIMULATOR_BOOT_TIMEOUT:-60}"
target_udid="$("${IOS_ROOT}/scripts/resolve-simulator-udid.sh")"

if [ -z "${target_udid}" ]; then
  echo "No simulator UDID matched the configured iOS test destination; skipping simulator reset." >&2
  exit 0
fi

echo "Resetting iOS simulator ${target_udid}."

shutdown_log="$(mktemp)"
if ! xcrun simctl shutdown "${target_udid}" >"${shutdown_log}" 2>&1; then
  if ! grep -q "Unable to shutdown device in current state: Shutdown" "${shutdown_log}"; then
    cat "${shutdown_log}" >&2
  fi
fi
rm -f "${shutdown_log}"

boot_log="$(mktemp)"
if ! xcrun simctl boot "${target_udid}" >"${boot_log}" 2>&1; then
  if ! grep -q "Unable to boot device in current state: Booted" "${boot_log}"; then
    cat "${boot_log}" >&2
    rm -f "${boot_log}"
    exit 1
  fi
fi
rm -f "${boot_log}"

timeout_marker="$(mktemp)"
rm -f "${timeout_marker}"
xcrun simctl bootstatus "${target_udid}" -b &
bootstatus_pid="$!"
(
  sleep "${BOOT_TIMEOUT_SECONDS}"
  touch "${timeout_marker}"
  kill "${bootstatus_pid}" 2>/dev/null || true
) &
watchdog_pid="$!"

bootstatus_status=0
wait "${bootstatus_pid}" || bootstatus_status="$?"
kill "${watchdog_pid}" 2>/dev/null || true
wait "${watchdog_pid}" 2>/dev/null || true

if [ -f "${timeout_marker}" ]; then
  rm -f "${timeout_marker}"
  echo "Timed out waiting ${BOOT_TIMEOUT_SECONDS}s for simulator ${target_udid} to finish booting." >&2
  exit 124
fi
rm -f "${timeout_marker}"

if [ "${bootstatus_status}" -ne 0 ]; then
  exit "${bootstatus_status}"
fi
sleep "${RESET_SLEEP_SECONDS}"
