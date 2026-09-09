import fs from 'fs';
import path from 'path';
import mdiIcons from './mdi-icons.json';

// Guards the airgapped offline icon bundle (see icons.ts). Every `mdi:<name>`
// icon referenced in shipped source must be present in mdi-icons.json, otherwise
// it silently fails to render in environments without Iconify CDN access
// (e.g. in-cluster Headlamp) — which is how the multi-console button went missing.
const SRC_DIR = path.join(process.cwd(), 'src');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('offline icon bundle (airgap)', () => {
  it('bundles every statically-referenced mdi icon used in the source', () => {
    const used = new Set<string>();
    for (const file of collectSourceFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/mdi:([a-z0-9-]+)/g)) {
        used.add(match[1]);
      }
    }

    const bundled = new Set(Object.keys((mdiIcons as { icons: Record<string, unknown> }).icons));
    const missing = [...used].filter(name => !bundled.has(name)).sort();

    expect(
      missing,
      `mdi icons used in source but missing from mdi-icons.json (airgap bundle): ${missing.join(
        ', '
      )}`
    ).toEqual([]);
  });
});
