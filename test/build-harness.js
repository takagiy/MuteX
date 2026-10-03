// Generates the browser harness payloads from synthetic fixtures.
// Run: bun test/build-harness.js   then serve test/harness/ and open index.html
import fs from 'node:fs';
import path from 'node:path';
import { sampleTimeline, muteList, homeTimeline, tweetEntry, tweet, user } from './fixtures.js';

const root = path.join(import.meta.dir, 'harness');
const write = (rel, data) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
};
const { data, total, muted } = sampleTimeline();
write('i/api/graphql/q/HomeTimeline.json', data);
write('i/api/1.1/mutes/keywords/list.json', muteList(['spoiler', 'ネタバレ', 'sample']));
// Nothing to filter: fetch must hand back X's original response untouched.
write('i/api/graphql/q/Clean.json', homeTimeline([tweetEntry(tweet({ text: 'nothing to see' }))]));
// A legacy-shape response with a null tweet in it: only that part is skipped, the muted one is still removed.
write('i/api/2/timeline/odd.json', {
  globalObjects: { tweets: { 1: null, 2: { full_text: 'legacy spoiler', user_id_str: '9' }, 3: { full_text: 'legacy fine', user_id_str: '9' } }, users: {} },
  timeline: { instructions: [{ addEntries: { entries: ['1', '2', '3'].map((id) => ({ entryId: 'tweet-' + id, content: { item: { content: { tweet: { id } } } } })) } }] },
});
// The signed-in user (twid u=4242, set by index.html) never has their own posts hidden.
write('i/api/graphql/q/Self.json', homeTimeline([
  tweetEntry(tweet({ text: 'my own spoiler', author: user({ id: '4242' }) })),
  tweetEntry(tweet({ text: 'their spoiler' })),
]));
write('expected.json', { total: total + 2, afterFilter: total + 2 - muted, legacy: ['tweet-1', 'tweet-3'] }); // +2 cursors
for (const f of ['core.js', 'main.js']) fs.copyFileSync(path.join(import.meta.dir, '../src', f), path.join(root, f));
console.log('harness ready:', root);
