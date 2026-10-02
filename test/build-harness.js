// Generates the browser harness payloads from synthetic fixtures.
// Run: bun test/build-harness.js   then serve test/harness/ and open index.html
import fs from 'node:fs';
import path from 'node:path';
import { sampleTimeline, muteList } from './fixtures.js';

const root = path.join(import.meta.dir, 'harness');
const write = (rel, data) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
};
const { data, total, muted } = sampleTimeline();
write('i/api/graphql/q/HomeTimeline.json', data);
write('i/api/1.1/mutes/keywords/list.json', muteList(['spoiler', 'ネタバレ', 'sample']));
write('expected.json', { total: total + 2, afterFilter: total + 2 - muted }); // +2 cursors
for (const f of ['core.js', 'main.js']) fs.copyFileSync(path.join(import.meta.dir, '../src', f), path.join(root, f));
console.log('harness ready:', root);
