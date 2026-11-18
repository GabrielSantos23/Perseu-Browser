#!/usr/bin/env bash
# Shell-only quick release: repacks the installer with the staged shell in minutes,
# without recompiling Chromium. For when only flecha/chromium/shell changed.
#
# What it does:
#   1. Copies the repo's built shell (flecha/chromium/shell/dist) into the build tree.
#   2. Deletes the packed installer archive, so ninja re-runs only the packaging step.
#   3. Rebuilds mini_installer (archive repack + relink; minutes, not hours).
#   4. Bumps the packaging revision and runs package.py -> new installer + zip in C:/uc/build.
#
# The C++ side (chrome.exe/chrome.dll) is untouched: ninja recompiles nothing unless
# the source tree is newer than the last build. A release that ships C++ changes still
# needs `ninja -C out/Default chrome mini_installer` first — incremental, but not "minutes".
#
# Updater caveat: the auto-update feed only offers strictly-new Chromium versions
# (chrome/VERSION), so a shell-only release reaches users as a GitHub-release download;
# installed copies won't be told about it. To ride the updater, a Chromium version bump
# (and full build) is required.
#
# Usage: docs/scripts/quick-release.sh [64bit|32bit|arm]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
UC="${PERSEU_BUILD_DIR:-C:/uc}"
ARCH="${1:-64bit}"

echo "== Staging the shell from the repo into the build tree"
if [ ! -f "$REPO/flecha/chromium/shell/dist/manifest.json" ]; then
  echo "No shell dist in the repo — run 'npm run shell:build' in flecha/ first" >&2
  exit 1
fi
rm -rf "$UC/build/src/out/Default/resources/flecha-shell"
cp -r "$REPO/flecha/chromium/shell/dist" "$UC/build/src/out/Default/resources/flecha-shell"

if [ ! -f "$UC/build/src/out/Default/chrome.dll" ]; then
  echo "No completed Chromium build at $UC/build/src/out/Default — run a full build first" >&2
  exit 1
fi

echo "== Forcing the installer archive to repack"
rm -f "$UC/build/src/out/Default/chrome.packed.7z" "$UC/build/src/out/Default/mini_installer.exe"

echo "== Repacking mini_installer"
cd "$UC/build/src"
./third_party/ninja/ninja.exe -C out/Default mini_installer

echo "== Bumping the packaging revision"
cd "$UC"
rev=$(($(cat revision.txt) + 1))
echo "$rev" > revision.txt
echo "revision.txt -> $rev"

echo "== Packaging"
python package.py --cpu-arch "$ARCH"
ls -la build/ | grep -F -- "-$rev."
echo "Done. Artifacts are in $UC/build/ — the updater feed only takes new Chromium versions,"
echo "so publish this as a regular GitHub release unless chrome/VERSION changed."
