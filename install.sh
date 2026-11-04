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

fail() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Agent Workspace installieren (macOS / Linux)

  bash install.sh [--version v0.2.0] [--install-dir VERZEICHNIS] [--portable] [--dry-run]
  bash install.sh --version v0.2.0 --asset PAKET --checksums SHA256SUMS

macOS: DMG nach ~/Applications installieren.
Debian/Ubuntu: .deb über apt installieren (sudo, falls erforderlich).
Andere Linux-Systeme oder --portable: AppImage im Benutzerverzeichnis installieren.
--dry-run zeigt das passende Paket, ohne Downloads oder Änderungen.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--install-dir|--asset|--checksums)
      [[ $# -ge 2 && -n "$2" ]] || fail "Wert für $1 fehlt."
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
    *) fail "Unbekannte Option: $1" ;;
  esac
done

case "$(uname -s)" in
  Darwin) PLATFORM=mac; EXT=dmg ;;
  Linux)
    PLATFORM=linux
    if [[ "$PORTABLE" == false ]] && command -v apt-get >/dev/null 2>&1; then EXT=deb; else EXT=AppImage; fi ;;
  *) fail 'Unterstützt werden macOS und Linux.' ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) fail 'Diese Prozessorarchitektur wird noch nicht unterstützt.' ;;
esac
[[ "$PLATFORM" != linux || "$ARCH" == x64 ]] || fail 'Linux-Pakete sind derzeit für x64 verfügbar.'
[[ -z "$INSTALL_DIR" || "$EXT" != deb ]] || fail '--install-dir ist unter Linux mit --portable verfügbar.'

if [[ "$VERSION" == latest && "$DRY_RUN" == false ]]; then
  command -v curl >/dev/null 2>&1 || fail 'curl wird benötigt.'
  VERSION="$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://api.github.com/repos/sd-softdev/ai-worktrees/releases/latest | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)"
fi
[[ "$VERSION" == latest || "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || fail 'Ungültige Release-Version.'
NAME="agent-workspace-${VERSION#v}-${PLATFORM}-${ARCH}.${EXT}"
if [[ "$DRY_RUN" == true ]]; then
  printf 'Plattform: %s %s\nRelease: %s\nPaket: %s\n' "$PLATFORM" "$ARCH" "$VERSION" "$NAME"
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
  [[ -f "$ASSET" && -f "$CHECKSUMS" ]] || fail '--asset und --checksums müssen auf vorhandene Dateien zeigen.'
  [[ "$(basename "$ASSET")" == "$NAME" ]] || fail "Erwartetes Paket: $NAME"
else
  command -v curl >/dev/null 2>&1 || fail 'curl wird benötigt.'
  ASSET="$TMP/$NAME"
  CHECKSUMS="$TMP/SHA256SUMS"
  printf 'Lade %s …\n' "$NAME"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$ASSET" "$RELEASES/$VERSION/$NAME"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$CHECKSUMS" "$RELEASES/$VERSION/SHA256SUMS"
fi
EXPECTED="$(awk -v name="$NAME" '{ sub(/\r$/, ""); sub(/^\*/, "", $2); if ($2 == name) print tolower($1) }' "$CHECKSUMS")"
[[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Kein eindeutiger SHA-256-Eintrag für das Paket gefunden.'
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$ASSET" | awk '{ print $1 }')"
else ACTUAL="$(shasum -a 256 "$ASSET" | awk '{ print $1 }')"; fi
[[ "$ACTUAL" == "$EXPECTED" ]] || fail 'SHA-256-Prüfung fehlgeschlagen. Das Paket wird nicht installiert.'

if [[ "$PLATFORM" == mac ]]; then
  INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
  mkdir -p "$INSTALL_DIR"
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
  DESTINATION="$INSTALL_DIR/Agent Workspace.app"
  if pgrep -f "$DESTINATION/Contents/MacOS/Agent Workspace" >/dev/null 2>&1; then fail 'Bitte Agent Workspace vor dem Update schließen.'; fi
  MOUNT="$TMP/mount"
  mkdir "$MOUNT"
  hdiutil attach "$ASSET" -readonly -nobrowse -mountpoint "$MOUNT" -quiet
  [[ -d "$MOUNT/Agent Workspace.app" ]] || fail 'Das DMG enthält keine Agent Workspace.app.'
  STAGE="$(mktemp -d "$INSTALL_DIR/.agent-workspace.XXXXXX")"
  ditto "$MOUNT/Agent Workspace.app" "$STAGE/Agent Workspace.app"
  if [[ -e "$DESTINATION" ]]; then
    IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$DESTINATION/Contents/Info.plist" 2>/dev/null || true)"
    [[ "$IDENTIFIER" == dev.agentworkspace.desktop ]] || fail 'Am Installationsort liegt eine andere Anwendung.'
    mv "$DESTINATION" "$STAGE/previous.app"
  fi
  mv "$STAGE/Agent Workspace.app" "$DESTINATION"
  printf 'Installiert: %s\n' "$DESTINATION"
elif [[ "$EXT" == deb ]]; then
  ASSET="$(cd "$(dirname "$ASSET")" && pwd)/$(basename "$ASSET")"
  if [[ "$EUID" -eq 0 ]]; then apt-get install -y "$ASSET"
  else sudo apt-get install -y "$ASSET"; fi
  printf 'Installiert. Start: agent-workspace\n'
else
  INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/agent-workspace}"
  mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$HOME/.local/share/applications"
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
  DESTINATION="$INSTALL_DIR/agent-workspace.AppImage"
  if pgrep -f "$DESTINATION" >/dev/null 2>&1; then fail 'Bitte Agent Workspace vor dem Update schließen.'; fi
  LAUNCHER="$HOME/.local/bin/agent-workspace"
  if [[ -e "$LAUNCHER" || -L "$LAUNCHER" ]]; then
    [[ -L "$LAUNCHER" && "$(readlink "$LAUNCHER")" == "$DESTINATION" ]] || fail "$LAUNCHER ist bereits anderweitig belegt."
  fi
  cp "$ASSET" "$DESTINATION.new"
  chmod 755 "$DESTINATION.new"
  mv "$DESTINATION.new" "$DESTINATION"
  ln -sfn "$DESTINATION" "$LAUNCHER"
  ESCAPED="$(printf '%s' "$DESTINATION" | sed 's/[\\"`$]/\\&/g; s/%/%%/g')"
  printf '[Desktop Entry]\nType=Application\nName=Agent Workspace\nExec="%s" %%U\nIcon=utilities-terminal\nTerminal=false\nCategories=Development;\n' "$ESCAPED" > "$HOME/.local/share/applications/agent-workspace.desktop"
  printf 'Installiert: %s\nStart: %s\nDas AppImage benötigt FUSE 2 auf deinem System.\n' "$DESTINATION" "$LAUNCHER"
fi
