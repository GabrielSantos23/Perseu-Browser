#!/bin/bash
# Builds one patch: the Chromium tree before the Flecha patches (backup tar) -> as it is now.
set -e
W=/c/Users/gabs/AppData/Local/Temp/claude/12cad5bb3549e434/e082f58e-4d33-4f12-91b9-700f9a66d1eb/scratchpad/flecha-export
SRC=/c/uc/build/src
rm -rf "$W" && mkdir -p "$W" && cd "$W"
git init -q . && git config core.autocrlf false && git config core.safecrlf false
tar -xf /c/uc/pre-flecha-backup.tar
# Files first touched after that backup (Perseu rename, Windows top bar).
tar -xf /c/uc/pre-flecha-backup2.tar
git add -A && git -c user.name=x -c user.email=x@x commit -qm before
while IFS= read -r f; do
  f="${f%$'\r'}"
  [ -z "$f" ] && continue
  mkdir -p "$(dirname "$f")"
  cp "$SRC/$f" "$f"
done < /c/uc/flecha-touched.txt
git add -A
git diff --cached --binary --full-index > /c/uc/flecha-chromium-157.patch
git diff --cached --stat | tail -1
