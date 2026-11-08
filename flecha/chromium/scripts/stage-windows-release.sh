#!/bin/bash
# Puts the built shell and the bundled extensions where a Windows build looks for them without
# --flecha-shell-dir (chrome::DIR_RESOURCES), and where chrome.release takes them for the installer.
#   chromium/scripts/stage-windows-release.sh C:/uc/build/src/out/Default
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$1/resources"
rm -rf "$out/flecha-shell" "$out/flecha-extensions"
cp -r "$here/shell/dist" "$out/flecha-shell"
cp -r "$here/extensions/dist" "$out/flecha-extensions"
