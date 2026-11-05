#!/usr/bin/env bash
set -euo pipefail

VERSION="${AGENT_WORKSPACE_VERSION:-latest}"
INSTALL_DIR=""
ASSET=""
CHECKSUMS=""
PORTABLE=false
DRY_RUN=false
TMP=""
MOUNT=""
STAGE=""
DESTINATION=""
RELEASES="https://github.com/sd-softdev/ai-worktrees/releases/download"

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Install Agent Workspace (macOS / Linux)

  bash install.sh [--version v0.3.0] [--install-dir DIRECTORY] [--portable] [--dry-run]
  bash install.sh --version v0.3.0 --asset PACKAGE --checksums SHA256SUMS

macOS: install from the DMG to ~/Applications.
Debian/Ubuntu: install the .deb using apt (with sudo if needed).
Other Linux systems or --portable: install the AppImage in the user directory.
--dry-run shows the matching package without downloading or changing anything.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--install-dir|--asset|--checksums)
      [[ $# -ge 2 && -n "$2" ]] || fail "Missing value for $1."
      case "$1" in
        --version) VERSION="$2" ;;
        --install-dir) INSTALL_DIR="$2" ;;
        --asset) ASSET="$2" ;;
        --checksums) CHECKSUMS="$2" ;;
      esac
      shift 2 ;;
    --portable) PORTABLE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

case "$(uname -s)" in
  Darwin) PLATFORM=mac; EXT=dmg ;;
  Linux)
    PLATFORM=linux
    if [[ "$PORTABLE" == false ]] && command -v apt-get >/dev/null 2>&1; then EXT=deb; else EXT=AppImage; fi ;;
  *) fail 'Supported platforms are macOS and Linux.' ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail 'This processor architecture is not supported yet.' ;;
esac
[[ "$PLATFORM" != linux || "$ARCH" == x64 ]] || fail 'Linux packages are currently available for x64 only.'
[[ -z "$INSTALL_DIR" || "$EXT" != deb ]] || fail '--install-dir is available on Linux with --portable.'

if [[ "$VERSION" == latest && "$DRY_RUN" == false ]]; then
  command -v curl >/dev/null 2>&1 || fail 'curl is required.'
  VERSION="$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://api.github.com/repos/sd-softdev/ai-worktrees/releases/latest | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)"
fi
[[ "$VERSION" == latest || "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || fail 'Invalid release version.'
PACKAGE_ARCH="$ARCH"
if [[ "$PLATFORM" == linux ]]; then
  if [[ "$EXT" == deb ]]; then PACKAGE_ARCH=amd64; else PACKAGE_ARCH=x86_64; fi
fi
NAME="agent-workspace-${VERSION#v}-${PLATFORM}-${PACKAGE_ARCH}.${EXT}"
if [[ "$DRY_RUN" == true ]]; then
  printf 'Platform: %s %s\nRelease: %s\nPackage: %s\n' "$PLATFORM" "$ARCH" "$VERSION" "$NAME"
  exit 0
fi

cleanup() {
  if [[ -n "$STAGE" && -d "$STAGE/previous.app" && ! -e "$DESTINATION" ]]; then mv "$STAGE/previous.app" "$DESTINATION"; fi
  [[ -z "$MOUNT" ]] || hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  [[ -z "$STAGE" ]] || rm -rf "$STAGE"
  [[ -z "$TMP" ]] || rm -rf "$TMP"
}
trap cleanup EXIT
TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-workspace-install.XXXXXX")"
if [[ -n "$ASSET" ]]; then
  [[ -f "$ASSET" && -f "$CHECKSUMS" ]] || fail '--asset and --checksums must point to existing files.'
  [[ "$(basename "$ASSET")" == "$NAME" ]] || fail "Expected package: $NAME"
else
  command -v curl >/dev/null 2>&1 || fail 'curl is required.'
  ASSET="$TMP/$NAME"
  CHECKSUMS="$TMP/SHA256SUMS"
  printf 'Downloading %s …\n' "$NAME"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$ASSET" "$RELEASES/$VERSION/$NAME"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$CHECKSUMS" "$RELEASES/$VERSION/SHA256SUMS"
fi
EXPECTED="$(awk -v name="$NAME" '{ sub(/\r$/, ""); sub(/^\*/, "", $2); if ($2 == name) print tolower($1) }' "$CHECKSUMS")"
[[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Could not find a unique SHA-256 entry for the package.'
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$ASSET" | awk '{ print $1 }')"
else ACTUAL="$(shasum -a 256 "$ASSET" | awk '{ print $1 }')"; fi
[[ "$ACTUAL" == "$EXPECTED" ]] || fail 'SHA-256 verification failed. The package will not be installed.'

if [[ "$PLATFORM" == mac ]]; then
  INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
  mkdir -p "$INSTALL_DIR"
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
  DESTINATION="$INSTALL_DIR/Agent Workspace.app"
  if pgrep -f "$DESTINATION/Contents/MacOS/Agent Workspace" >/dev/null 2>&1; then fail 'Please close Agent Workspace before updating.'; fi
  MOUNT="$TMP/mount"
  mkdir "$MOUNT"
  hdiutil attach "$ASSET" -readonly -nobrowse -mountpoint "$MOUNT" -quiet
  [[ -d "$MOUNT/Agent Workspace.app" ]] || fail 'The DMG does not contain Agent Workspace.app.'
  STAGE="$(mktemp -d "$INSTALL_DIR/.agent-workspace.XXXXXX")"
  ditto "$MOUNT/Agent Workspace.app" "$STAGE/Agent Workspace.app"
  if [[ -e "$DESTINATION" ]]; then
    IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$DESTINATION/Contents/Info.plist" 2>/dev/null || true)"
    [[ "$IDENTIFIER" == dev.agentworkspace.desktop ]] || fail 'A different application exists at the installation location.'
    mv "$DESTINATION" "$STAGE/previous.app"
  fi
  mv "$STAGE/Agent Workspace.app" "$DESTINATION"
  printf 'Installed: %s\n' "$DESTINATION"
elif [[ "$EXT" == deb ]]; then
  ASSET="$(cd "$(dirname "$ASSET")" && pwd)/$(basename "$ASSET")"
  if [[ "$EUID" -eq 0 ]]; then apt-get install -y "$ASSET"
  else sudo apt-get install -y "$ASSET"; fi
  printf 'Installed. Launch: agent-workspace\n'
else
  INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/agent-workspace}"
  mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$HOME/.local/share/applications"
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
  DESTINATION="$INSTALL_DIR/agent-workspace.AppImage"
  if pgrep -f "$DESTINATION" >/dev/null 2>&1; then fail 'Please close Agent Workspace before updating.'; fi
  LAUNCHER="$HOME/.local/bin/agent-workspace"
  if [[ -e "$LAUNCHER" || -L "$LAUNCHER" ]]; then
    [[ -L "$LAUNCHER" && "$(readlink "$LAUNCHER")" == "$DESTINATION" ]] || fail "$LAUNCHER is already used by another file or link."
  fi
  cp "$ASSET" "$DESTINATION.new"
  chmod 755 "$DESTINATION.new"
  mv "$DESTINATION.new" "$DESTINATION"
  ln -sfn "$DESTINATION" "$LAUNCHER"
  ESCAPED="$(printf '%s' "$DESTINATION" | sed 's/[\\"`$]/\\&/g; s/%/%%/g')"
  printf '[Desktop Entry]\nType=Application\nName=Agent Workspace\nExec="%s" %%U\nIcon=utilities-terminal\nTerminal=false\nCategories=Development;\n' "$ESCAPED" > "$HOME/.local/share/applications/agent-workspace.desktop"
  printf 'Installed: %s\nLaunch: %s\nThe AppImage requires FUSE 2 on your system.\n' "$DESTINATION" "$LAUNCHER"
fi
