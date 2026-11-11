#!/bin/bash
# Stash installer for macOS — installs the latest Stash from GitHub.
#   curl -fsSL https://raw.githubusercontent.com/charliecurrin/stash/main/install.sh | bash
set -euo pipefail
REPO="charliecurrin/stash"; RAW="https://raw.githubusercontent.com/$REPO/main"
ELECTRON_VERSION="45.2.3"
say(){ printf "\033[1m▸ %s\033[0m\n" "$*"; }
[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
case "$(uname -m)" in arm64) ARCH=arm64; KIND="Apple Silicon";; x86_64) ARCH=x64; KIND=Intel;; *) echo "Unsupported Mac: $(uname -m)"; exit 1;; esac
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
say "Installing Stash for your $KIND Mac"
say "Downloading the app engine (~110 MB)…"
curl -fL --progress-bar -o "$TMP/electron.zip" "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-darwin-${ARCH}.zip"
say "Downloading Stash…"
ditto -x -k "$TMP/electron.zip" "$TMP/e"
APP="$TMP/e/Electron.app"; RES="$APP/Contents/Resources"; mkdir -p "$RES/app"
for f in boot.js package.json version.json index.html supabase.js collab.js notes.js quick.html island.html ai.js main.js preload.js trayTemplate.png trayTemplate@2x.png icon.png; do
  curl -fsSL "$RAW/$f?t=$(date +%s)" -o "$RES/app/$f"
done
curl -fsSL "$RAW/icon.icns" -o "$RES/electron.icns"
rm -f "$RES/default_app.asar"
PL="$APP/Contents/Info.plist"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$RES/app/version.json" | head -1)"
plutil -replace CFBundleName -string "Stash" "$PL"
plutil -replace CFBundleDisplayName -string "Stash" "$PL"
plutil -replace CFBundleIdentifier -string "com.charlie.stash" "$PL"
plutil -replace CFBundleShortVersionString -string "$VER" "$PL"
plutil -replace CFBundleVersion -string "$VER" "$PL"
mv "$APP" "$TMP/e/Stash.app"; APP="$TMP/e/Stash.app"
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
say "Moving Stash to Applications…"
osascript -e 'tell application "Stash" to quit' >/dev/null 2>&1 || true
sleep 1; pkill -f "/Applications/Stash.app/" >/dev/null 2>&1 || true
DEST="/Applications"; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/Stash.app"; ditto "$APP" "$DEST/Stash.app"
rm -rf "$HOME/Library/Application Support/Stash/app"   # fresh install = start from this version
say "Done! Stash $VER is in $DEST — look for its icon in your menu bar."
open "$DEST/Stash.app"
