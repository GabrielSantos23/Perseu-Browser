// What build.mjs adds for the developer features (features.ts): their pages and content
// scripts as entry points, and their static files.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const featureEntries = {
  boostsPage: path.join(here, 'boostsPage.ts'),
  consoleHook: path.join(here, 'features/consoleHook.ts'),
  consoleBridge: path.join(here, 'features/consoleBridge.ts'),
};

export function copyFeatureStatic(out) {
  for (const f of ['boosts.html', 'boosts.css']) fs.copyFileSync(path.join(here, f), path.join(out, f));
}
