// Run: bun test
import { test, expect } from 'bun:test';
import core from '../src/core.js';
import { user, tweet, tweetEntry, moduleEntry, trendEntry, homeTimeline, muteList, sampleTimeline } from './fixtures.js';

const rulesOf = (words) => ({ enabled: true, imported: core.fromXMuteList(muteList(words)), local: [] });
const entries = (d) => d.data.home.home_timeline_urt.instructions.flatMap((i) => i.entries || []);
const contentEntries = (d) => entries(d).filter((e) => !e.content.cursorType);

test('imports X mute list format', () => {
  const r = core.fromXMuteList(muteList(['a', { keyword: 'b', excludeFollowing: true, validUntil: 5 }]));
  expect(r).toEqual([
    { keyword: 'a', excludeFollowing: false, validUntil: null },
    { keyword: 'b', excludeFollowing: true, validUntil: 5 },
  ]);
  expect(core.fromXMuteList({})).toBe(null);
});

test('keyword boundaries and normalization', () => {
  const m = core.compile({ local: [{ keyword: 'cat' }, { keyword: '猫' }] });
  expect(core.judgeText('catで遊ぶ', m)).toBe(true);
  expect(core.judgeText('#cat pics', m)).toBe(true);
  expect(core.judgeText('ＣＡＴ', m)).toBe(true);
  expect(core.judgeText('category', m)).toBe(false);
  expect(core.judgeText('bobcat', m)).toBe(false);
  expect(core.judgeText('子猫', m)).toBe(true);
  expect(core.judgeText('https://t.co/cat123', m)).toBe(false);
});

test('regex local keyword', () => {
  const m = core.compile({ local: [{ keyword: '/foo.*bar/' }] });
  expect(core.judgeText('foo and bar', m)).toBe(true);
  expect(core.judgeText('bar and foo', m)).toBe(false);
});

test('expired keyword ignored', () => {
  expect(core.isEmpty(core.compile({ local: [{ keyword: 'x', validUntil: 1 }] }))).toBe(true);
});

test('filters a mixed timeline', () => {
  const { data, total, muted } = sampleTimeline();
  const m = core.compile(rulesOf(['spoiler', 'ネタバレ']));
  expect(core.filterPayload(data, m)).toBe(muted);
  const left = contentEntries(data);
  expect(left.length).toBe(total - muted);
  const texts = JSON.stringify(left);
  expect(texts).not.toMatch(/ネタバレ|SPOILER|spoiler inside|retweeted spoiler|Spoiler review|limited spoiler/);
  expect(texts).toContain('spoilers are fine');
  expect(texts).toContain('t.co/spoiler1');
  expect(texts).toContain('parent 2');
  // cursors survive so infinite scroll keeps working
  expect(entries(data).filter((e) => e.content.cursorType).length).toBe(2);
});

test('exclude_following exempts followed authors and records ids', () => {
  const friend = user({ following: true });
  const t = tweet({ text: 'spoiler from a friend', author: friend });
  const d = homeTimeline([tweetEntry(t), tweetEntry(tweet({ text: 'spoiler from a stranger' }))]);
  const state = rulesOf([{ keyword: 'spoiler', excludeFollowing: true }]);
  const exempt = new Set();
  expect(core.filterPayload(d, core.compile(state), { exempt })).toBe(1);
  expect(exempt.has(t.rest_id)).toBe(true);

  const d2 = homeTimeline([tweetEntry(tweet({ text: 'spoiler', author: user({ following: true }) }))]);
  expect(core.filterPayload(d2, core.compile({ ...state, applyToFollowing: true }))).toBe(1);
});

test('own tweets are never hidden', () => {
  const me = user();
  const d = homeTimeline([tweetEntry(tweet({ text: 'my spoiler', author: me }))]);
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler'])), { selfId: me.rest_id })).toBe(0);
});

test('module items, pinned entry and trends', () => {
  const d = {
    data: {
      timeline: {
        instructions: [
          { type: 'TimelinePinEntry', entry: tweetEntry(tweet({ text: 'pinned spoiler' })) },
          { type: 'TimelineAddToModule', moduleItems: [moduleEntry([tweet({ text: 'ok' })]), moduleEntry([tweet({ text: 'spoiler' })])] },
          { type: 'TimelineAddEntries', entries: [trendEntry('#Spoiler'), trendEntry('#Weather')] },
        ],
      },
    },
  };
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler'])))).toBe(3);
  const ins = d.data.timeline.instructions;
  expect(ins.some((i) => i.type === 'TimelinePinEntry')).toBe(false);
  expect(ins.find((i) => i.moduleItems).moduleItems.length).toBe(1);
  expect(ins.find((i) => i.entries).entries.map((e) => e.content.itemContent.name)).toEqual(['#Weather']);
});

test('legacy v2 globalObjects shape', () => {
  const d = {
    globalObjects: {
      tweets: { 1: { full_text: 'spoiler', user_id_str: '9' }, 2: { full_text: 'fine', user_id_str: '9' }, 3: { full_text: 'q', user_id_str: '9', quoted_status_id_str: '1' } },
      users: { 9: { following: false } },
    },
    timeline: {
      instructions: [{ addEntries: { entries: ['1', '2', '3'].map((id) => ({ entryId: 'tweet-' + id, content: { item: { content: { tweet: { id } } } } })) } }],
    },
  };
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler'])))).toBe(2);
  expect(d.timeline.instructions[0].addEntries.entries.map((e) => e.entryId)).toEqual(['tweet-2']);
});

test('disabled = untouched', () => {
  const { data } = sampleTimeline();
  expect(core.filterPayload(data, core.compile({ ...rulesOf(['spoiler']), enabled: false }))).toBe(0);
});

test('Explore event cards and trend context', () => {
  const card = (title) => ({ entryId: 'event-' + title, content: { itemContent: { itemType: 'TimelineEventSummary', __typename: 'TimelineEventSummary', title } } });
  const trend = (name, context) => ({ entryId: 'trend-' + name, content: { itemContent: { itemType: 'TimelineTrend', name, social_context: { text: context } } } });
  const d = { data: { explore: { timeline: { instructions: [{ entries: [card('Big spoiler leak'), card('Weather today'), trend('#Movie', 'Trending with spoiler'), trend('#Rain', 'Trending in Tokyo')] }] } } } };
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler'])))).toBe(2);
  expect(d.data.explore.timeline.instructions[0].entries.map((e) => e.entryId)).toEqual(['event-Weather today', 'trend-#Rain']);
});

test('search typeahead suggestions', () => {
  const d = {
    num_results: 4,
    ordered_sections: [],
    users: [{ id_str: '1', name: 'spoiler fan', screen_name: 'someone' }],
    topics: [{ topic: 'spoiler', rounded_score: 1 }, { topic: 'sports' }],
    hashtags: [{ hashtag: '#ネタバレ' }],
    events: [],
  };
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler', 'ネタバレ'])))).toBe(2);
  expect(d.topics).toEqual([{ topic: 'sports' }]);
  expect(d.hashtags).toEqual([]);
  expect(d.users.length).toBe(1); // users are not filtered, like X's own mute
  expect(d.num_results).toBe(2);
});
