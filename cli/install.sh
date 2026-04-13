#!/usr/bin/env sh
set -eu

REPO="MaudeCode/cowtail"
VERSION="${COWTAIL_VERSION:-${1:-}}"

if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": "\(v[^"]*\)".*/\1/p' | head -n 1)"
fi

if [ -z "$VERSION" ]; then
  echo "Failed to resolve a release version" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    echo "Unsupported operating system: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

asset="cowtail-${os}-${arch}.tar.gz"
url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
install_dir="${INSTALL_DIR:-$HOME/.local/bin}"

if [ -z "${INSTALL_DIR:-}" ] && [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  install_dir="/usr/local/bin"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

curl -fL "$url" -o "$tmpdir/$asset"
tar -xzf "$tmpdir/$asset" -C "$tmpdir"

mkdir -p "$install_dir"
install -m 0755 "$tmpdir/cowtail" "$install_dir/cowtail"

echo "Installed cowtail ${VERSION} to ${install_dir}/cowtail"

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    echo "Add ${install_dir} to your PATH to run 'cowtail' directly."
    ;;
esac
