#!/usr/bin/env python3
"""Builds the shell and fetches the bundled extensions into <out>/resources for the installer."""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FLECHA = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) / 'resources'
major = re.search(r'^MAJOR=(\d+)', (out.parent.parent.parent / 'chrome' / 'VERSION').read_text(), re.M).group(1)

npm = shutil.which('npm') or sys.exit('npm not found')
node = shutil.which('node') or sys.exit('node not found')
subprocess.run([npm, 'ci'], cwd=FLECHA, check=True)
subprocess.run([node, 'chromium/extensions/fetch.mjs'], cwd=FLECHA, check=True)
subprocess.run([node, 'chromium/shell/build.mjs'], cwd=FLECHA, check=True, env={**os.environ, 'FLECHA_MIN_CHROME': major})

for source, name in (('shell', 'flecha-shell'), ('extensions', 'flecha-extensions')):
    target = out / name
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(FLECHA / 'chromium' / source / 'dist', target)
