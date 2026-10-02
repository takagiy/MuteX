// Validates manifest.json and that every file it references exists.
// Usage: bun scripts/check-manifest.js [expected-version]
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dir, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) errors.push(`invalid version "${manifest.version}"`);

const refs = [
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
].filter(Boolean);
for (const f of refs) if (!fs.existsSync(path.join(root, f))) errors.push(`missing file: ${f}`);

const expected = process.argv[2]?.replace(/^v/, '');
if (expected && expected !== manifest.version) errors.push(`tag v${expected} does not match manifest version ${manifest.version}`);

if (errors.length) {
  console.error(errors.map((e) => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ manifest OK (v${manifest.version}, ${refs.length} files)`);
