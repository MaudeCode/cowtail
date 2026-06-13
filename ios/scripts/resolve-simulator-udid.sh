#!/usr/bin/env sh
set -eu

DEVICE_NAME="${COWTAIL_IOS_TEST_DEVICE_NAME:-iPhone 17 Pro}"
SIMULATOR_OS="${COWTAIL_IOS_TEST_OS:-}"
DESTINATION="${COWTAIL_IOS_TEST_DESTINATION:-}"

extract_destination_field() {
  printf '%s\n' "${DESTINATION}" |
    awk -v key="$1" '
      BEGIN { FS = "," }
      {
        for (i = 1; i <= NF; i += 1) {
          field = $i
          sub(/^[[:space:]]*/, "", field)
          sub(/[[:space:]]*$/, "", field)
          if (index(field, key "=") == 1) {
            sub("^[^=]*=", "", field)
            print field
            exit
          }
        }
      }
    '
}

case "${DESTINATION}" in
  id=*)
    destination_id="${DESTINATION#id=}"
    printf '%s\n' "${destination_id%%,*}"
    exit 0
    ;;
  [0-9A-Fa-f]*-[0-9A-Fa-f]*-[0-9A-Fa-f]*-[0-9A-Fa-f]*-[0-9A-Fa-f]*)
    printf '%s\n' "${DESTINATION}"
    exit 0
    ;;
esac

if [ -n "${DESTINATION}" ]; then
  destination_id="$(extract_destination_field id)"
  if [ -n "${destination_id}" ]; then
    printf '%s\n' "${destination_id}"
    exit 0
  fi

  destination_name="$(extract_destination_field name)"
  if [ -n "${destination_name}" ]; then
    DEVICE_NAME="${destination_name}"
  fi

  destination_os="$(extract_destination_field OS)"
  if [ -n "${destination_os}" ] && [ "${destination_os}" != "latest" ]; then
    SIMULATOR_OS="${destination_os}"
  fi
fi

if [ "${SIMULATOR_OS}" = "latest" ]; then
  SIMULATOR_OS=""
fi

if [ -n "${SIMULATOR_OS}" ]; then
  xcrun simctl list devices available "iOS ${SIMULATOR_OS}"
else
  xcrun simctl list devices available
fi |
  awk -v device="${DEVICE_NAME}" -v filtered="${SIMULATOR_OS:+1}" '
    index($0, "    " device " (") == 1 && match($0, /\([0-9A-Fa-f-]{36}\)/) {
      udid = substr($0, RSTART + 1, RLENGTH - 2)
      if (filtered == "1") {
        print udid
        exit
      }
    }
    END {
      if (filtered != "1" && udid != "") {
        print udid
      }
    }
  '
