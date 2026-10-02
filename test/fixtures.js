// Synthetic API payloads shaped like X's GraphQL / v2 timeline responses.
// All ids, names, texts and keywords are made up.

let seq = 0;
const nextId = () => String(1000000000000000000n + BigInt(++seq));

export function user({ id = nextId(), name = 'user' + seq, following = false } = {}) {
  return {
    __typename: 'User',
    rest_id: id,
    core: { name, screen_name: name },
    relationship_perspectives: { following, followed_by: false, blocking: false, muting: false },
  };
}

export function tweet({ id = nextId(), text = '', author = user(), quoted, retweeted, note, card, visibility = false } = {}) {
  const t = {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: author } },
    legacy: { id_str: id, user_id_str: author.rest_id, full_text: text },
  };
  if (quoted) t.quoted_status_result = { result: quoted };
  if (retweeted) {
    t.legacy.retweeted_status_result = { result: retweeted };
    t.legacy.full_text = 'RT @someone: ' + text;
  }
  if (note) t.note_tweet = { note_tweet_results: { result: { text: note } } };
  if (card) {
    t.card = { legacy: { binding_values: Object.entries(card).map(([key, v]) => ({ key, value: { string_value: v, type: 'STRING' } })) } };
  }
  return visibility ? { __typename: 'TweetWithVisibilityResults', tweet: t, limitedActionResults: {} } : t;
}

const tweetItem = (t) => ({ itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: t } });

export function tweetEntry(t, prefix = 'tweet') {
  const id = (t.tweet || t).rest_id;
  return {
    entryId: `${prefix}-${id}`,
    sortIndex: id,
    content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: tweetItem(t) },
  };
}

export function moduleEntry(tweets, prefix = 'home-conversation') {
  const id = nextId();
  return {
    entryId: `${prefix}-${id}`,
    sortIndex: id,
    content: {
      entryType: 'TimelineTimelineModule',
      __typename: 'TimelineTimelineModule',
      displayType: 'VerticalConversation',
      items: tweets.map((t) => ({ entryId: `${prefix}-${id}-tweet-${(t.tweet || t).rest_id}`, item: { itemContent: tweetItem(t) } })),
    },
  };
}

export function trendEntry(name) {
  const id = nextId();
  return {
    entryId: `trend-${id}`,
    sortIndex: id,
    content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTrend', __typename: 'TimelineTrend', name } },
  };
}

export function cursorEntry(cursorType) {
  const id = nextId();
  return {
    entryId: `cursor-${cursorType.toLowerCase()}-${id}`,
    sortIndex: id,
    content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', cursorType, value: 'CURSOR' + id },
  };
}

export function homeTimeline(entries, extra = []) {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [{ type: 'TimelineAddEntries', entries: [cursorEntry('Top'), ...entries, cursorEntry('Bottom')] }, ...extra],
        },
      },
    },
  };
}

export function muteList(words) {
  return {
    muted_keywords: words.map((w, i) => {
      const o = typeof w === 'string' ? { keyword: w } : w;
      return {
        keyword: o.keyword,
        id: String(2000 + i),
        valid_from: null,
        valid_until: o.validUntil ?? null,
        created_at: '0',
        mute_surfaces: ['home_timeline', 'tweet_replies', 'notifications'],
        mute_options: o.excludeFollowing ? ['exclude_following_accounts'] : [],
      };
    }),
  };
}

// A mixed timeline used by both the unit tests and the browser harness.
// Muted words for it: "spoiler" and "ネタバレ".
export function sampleTimeline() {
  const friend = user({ name: 'friend', following: true });
  const entries = [
    tweetEntry(tweet({ text: 'good morning' })),
    tweetEntry(tweet({ text: 'huge SPOILER ahead' })), // muted
    tweetEntry(tweet({ text: '昨日の最終回のネタバレです' }), 'promoted-tweet'), // muted
    tweetEntry(tweet({ text: 'look', quoted: tweet({ text: 'spoiler inside the quote' }) })), // muted via quote
    tweetEntry(tweet({ text: 'x', retweeted: tweet({ text: 'retweeted spoiler' }) })), // muted via retweet
    tweetEntry(tweet({ text: 'short', note: 'long text… with a spoiler near the end' })), // muted via note tweet
    tweetEntry(tweet({ text: 'link', card: { title: 'Spoiler review' } })), // muted via card
    tweetEntry(tweet({ text: 'limited spoiler', visibility: true })), // muted, wrapped
    tweetEntry(tweet({ text: 'spoilers are fine', author: friend })), // "spoilers" is not the word "spoiler"
    tweetEntry(tweet({ text: 'see https://t.co/spoiler1 now' })), // only inside a t.co url
    moduleEntry([tweet({ text: 'parent' }), tweet({ text: 'reply with ネタバレ' })]), // whole module muted
    moduleEntry([tweet({ text: 'parent 2' }), tweet({ text: 'reply 2' })]),
  ];
  return { data: homeTimeline(entries), total: entries.length, muted: 8 };
}
