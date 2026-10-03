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

test('exclude_following exempts followed authors', () => {
  const friend = user({ following: true });
  const d = homeTimeline([
    tweetEntry(tweet({ text: 'spoiler from a friend', author: friend })),
    tweetEntry(tweet({ text: 'spoiler from a stranger' })),
  ]);
  const state = rulesOf([{ keyword: 'spoiler', excludeFollowing: true }]);
  expect(core.filterPayload(d, core.compile(state))).toBe(1);
  expect(JSON.stringify(contentEntries(d))).toContain('spoiler from a friend');

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

test('TweetDetail: replies and "Discover more"', () => {
  const focal = tweet({ text: 'the post you opened' });
  const related = (texts) => {
    const e = moduleEntry(texts.map((text) => tweet({ text })), 'tweetdetailrelatedtweets');
    e.content.displayType = 'Vertical';
    e.content.header = { text: 'Discover more' };
    return e;
  };
  const d = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              tweetEntry(focal),
              moduleEntry([tweet({ text: 'reply with spoiler' }), tweet({ text: 'its follow-up' })], 'conversationthread'),
              moduleEntry([tweet({ text: 'nice reply' })], 'conversationthread'),
              related(['related one', 'related spoiler', 'related three']),
            ],
          },
          // "Show more" inside Discover more, and a related list that ends up empty
          { type: 'TimelineAddToModule', moduleItems: [moduleEntry([tweet({ text: 'more spoiler' })]).content.items[0]] },
        ],
      },
    },
  };
  const ins = d.data.threaded_conversation_with_injections_v2.instructions;
  ins[0].entries.push(related(['all spoiler']));
  core.filterPayload(d, core.compile(rulesOf(['spoiler'])));
  const ids = ins[0].entries.map((e) => e.entryId.split('-')[0]);
  expect(ids).toEqual(['tweet', 'conversationthread', 'tweetdetailrelatedtweets']); // spoiler thread + empty related list gone
  const discover = ins[0].entries[2].content.items.map((i) => i.item.itemContent.tweet_results.result.legacy.full_text);
  expect(discover).toEqual(['related one', 'related three']); // only the matching related post is removed
  expect(ins.some((i) => i.moduleItems)).toBe(false);
});

// --- fail-safety: unexpected data must never stop the rest from working ---

test('damaged saved state drops only the bad parts', () => {
  const m = core.compile({
    enabled: 'yes',
    imported: { not: 'a list' },
    local: [null, { keyword: 5 }, { keyword: '  ' }, { keyword: 'spoiler', validUntil: 'soon' }],
  });
  expect(core.judgeText('a spoiler', m)).toBe(true);
  expect(core.normalizeState(undefined)).toEqual({ enabled: true, applyToFollowing: false, imported: [], local: [], lastSync: 0 });
});

test('an entry it cannot read is kept, and the rest is still filtered', () => {
  const odd = tweetEntry(tweet({ text: 'odd spoiler' }));
  Object.defineProperty(odd.content.itemContent.tweet_results, 'result', {
    get() { throw new TypeError('unexpected shape'); },
    enumerable: true,
  });
  const d = homeTimeline([tweetEntry(tweet({ text: 'spoiler A' })), odd, tweetEntry(tweet({ text: 'fine' }))]);
  const errors = [];
  expect(core.filterPayload(d, core.compile(rulesOf(['spoiler'])), { onError: (e, step) => errors.push([e.message, step]) })).toBe(1);
  expect(contentEntries(d)).toContain(odd);
  expect(contentEntries(d).length).toBe(2);
  expect(errors).toEqual([['unexpected shape', 'entries']]);
});

test('an unrecognizable mute list keeps the saved one', () => {
  expect(core.fromXMuteList({ muted_keywords: [{ text: 'spoiler' }] })).toBe(null); // e.g. X renamed "keyword"
  expect(core.fromXMuteList({ muted_keywords: [{ keyword: 'ok' }, { text: 'x' }, null] })).toEqual([
    { keyword: 'ok', excludeFollowing: false, validUntil: null },
  ]);
  expect(core.fromXMuteList({ muted_keywords: [] })).toEqual([]); // a genuinely empty list still applies
});

test('user regexes that cannot be combined still work one by one', () => {
  const Real = globalThis.RegExp;
  globalThis.RegExp = function (src, flags) {
    if (String(src).includes('cat') && String(src).includes('do+g')) throw new SyntaxError('cannot combine');
    return new Real(src, flags);
  };
  let m;
  try {
    m = core.compile({ local: [{ keyword: 'cat' }, { keyword: '/do+g/' }] });
  } finally {
    globalThis.RegExp = Real;
  }
  expect(core.judgeText('a dooog', m)).toBe(true);
  expect(core.judgeText('a cat', m)).toBe(true);
  expect(core.judgeText('a bird', m)).toBe(false);
});

// --- problem log: fixed codes only, never anything taken from X's data ---

test('only the allowlisted X requests are filtered', () => {
  const f = core.filteredFeature;
  expect(f('https://x.com/i/api/graphql/q1/HomeTimeline?variables=1')).toBe('home');
  expect(f('/i/api/graphql/q2/TweetDetail')).toBe('replies');
  expect(f('/i/api/graphql/q3/UserTweets')).toBe('profiles');
  expect(f('/i/api/graphql/q4/ListLatestTweetsTimeline')).toBe('lists');
  expect(f('/i/api/graphql/q5/ExplorePage')).toBe('explore');
  expect(f('/i/api/graphql/q6/NotificationsTimeline')).toBe('notifications');
  expect(f('/i/api/1.1/search/typeahead.json?q=secret')).toBe('suggestions');
  // anything else passes through untouched
  expect(f('/i/api/graphql/q7/SomethingNew')).toBe(null);
  expect(f('/i/api/graphql/q8/toString')).toBe(null);
  expect(f('/i/api/2/notifications/all.json')).toBe(null);
  expect(f('https://api.x.com/graphql/q1/HomeTimeline')).toBe(null);
  expect(f('https://example.com/i/api/graphql/q1/HomeTimeline')).toBe(null);
  expect(f('/i/api/graphql/q1/HomeTimeline/extra')).toBe(null);
  expect(f(undefined)).toBe(null);
});

test('the mute-list request is recognized exactly', () => {
  expect(core.isMuteListRequest('https://x.com/i/api/1.1/mutes/keywords/list.json')).toBe(true);
  expect(core.isMuteListRequest('/i/api/1.1/mutes/keywords/list.json?x=1')).toBe(true);
  expect(core.isMuteListRequest('https://example.com/i/api/1.1/mutes/keywords/list.json')).toBe(false);
  expect(core.isMuteListRequest('/other/i/api/1.1/mutes/keywords/list.json')).toBe(false);
});

test('problemOf keeps only codes and ignores the error message', () => {
  const e = new TypeError('leaked "my muted words" from user 1234567890 https://x.com/someone');
  const p = core.problemOf(e, 'home', 'entries');
  expect(p).toEqual({ feature: 'home', step: 'entries', kind: 'TypeError' });
  expect(JSON.stringify(p)).not.toMatch(/muted|1234567890|someone/);
  class WeirdError extends Error {}
  WeirdError.prototype.name = 'Secret: my muted words';
  expect(core.problemOf(new WeirdError('x'), 'not-a-feature', 'not-a-step')).toEqual({ feature: 'other', step: 'response', kind: 'Error' });
  expect(core.problemOf({ name: 'UnknownFormat' }, 'import', 'format').kind).toBe('UnknownFormat');
});

test('isProblem accepts only known codes', () => {
  expect(core.isProblem({ feature: 'home', step: 'entries', kind: 'TypeError' })).toBe(true);
  expect(core.isProblem({ feature: 'home', step: 'entries', kind: 'TypeError: leaked text' })).toBe(false);
  expect(core.isProblem({ feature: 'https://x.com/someone', step: 'entries', kind: 'Error' })).toBe(false);
  expect(core.isProblem(null)).toBe(false);
});
