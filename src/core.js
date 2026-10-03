// tweetmuff core: keyword matching and API-response filtering.
// Pure logic with no DOM / chrome.* dependency so it can run in the page's MAIN world and in tests.
(function (root) {
  'use strict';

  const ASCII_WORD = /[a-z0-9_]/;
  const URL_RE = /https?:\/\/\S+/g;

  function normalize(s) {
    return String(s).normalize('NFKC').toLowerCase();
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // A keyword becomes one regex source.
  // - "/.../" is treated as a raw regex (only for locally added words).
  // - Edges that are ASCII word chars get word boundaries, so "cat" does not hit "category" but does hit "catで" or "#cat".
  // - Non-ASCII (e.g. Japanese) is plain substring, like X does.
  function keywordSource(keyword) {
    const raw = String(keyword).trim();
    if (raw.length > 2 && raw.startsWith('/') && raw.endsWith('/')) {
      const body = raw.slice(1, -1);
      try { new RegExp(body, 'u'); return body; } catch { return null; }
    }
    const k = normalize(raw);
    if (!k) return null;
    let src = escapeRe(k);
    if (ASCII_WORD.test(k[0])) src = '(?<![a-z0-9_])' + src;
    if (ASCII_WORD.test(k[k.length - 1])) src = src + '(?![a-z0-9_])';
    return src;
  }

  // Keeps only well-formed rules, so a corrupted or unexpected value drops that rule instead of throwing.
  function normalizeRules(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const r of list) {
      if (!r || typeof r.keyword !== 'string' || !r.keyword.trim()) continue;
      const until = r.validUntil == null ? NaN : Number(r.validUntil);
      out.push({ keyword: r.keyword, excludeFollowing: r.excludeFollowing === true, validUntil: until > 0 ? until : null });
    }
    return out;
  }

  // The settings shape everything else relies on: { enabled, applyToFollowing, imported, local, lastSync }.
  function normalizeState(state) {
    const s = state && typeof state === 'object' ? state : {};
    return {
      enabled: s.enabled !== false,
      applyToFollowing: s.applyToFollowing === true,
      imported: normalizeRules(s.imported),
      local: normalizeRules(s.local),
      lastSync: Number.isFinite(s.lastSync) ? s.lastSync : 0,
    };
  }

  function compile(state, now = Date.now()) {
    const s = normalizeState(state);
    const always = [];
    const unlessFollowing = [];
    if (s.enabled) {
      for (const r of [...s.imported, ...s.local]) {
        if (r.validUntil && r.validUntil < now) continue;
        const src = keywordSource(r.keyword);
        if (!src) continue;
        (r.excludeFollowing && !s.applyToFollowing ? unlessFollowing : always).push(src);
      }
    }
    return { always: anyOf(always), unlessFollowing: anyOf(unlessFollowing) };
  }

  // One combined regex is fastest. If user regexes can't be combined (e.g. clashing group names), test them one by
  // one rather than losing all of them.
  function anyOf(sources) {
    if (!sources.length) return null;
    try {
      return new RegExp(sources.map((src) => `(?:${src})`).join('|'), 'u');
    } catch {
      const each = sources.map((src) => new RegExp(src, 'u'));
      return { test: (text) => each.some((re) => re.test(text)) };
    }
  }

  function isEmpty(m) {
    return !m.always && !m.unlessFollowing;
  }

  function cleanText(s) {
    return normalize(String(s || '').replace(URL_RE, ' '));
  }

  // --- tweet extraction (GraphQL shape) ---

  function unwrapTweet(r) {
    if (!r) return null;
    if (r.__typename === 'TweetWithVisibilityResults' && r.tweet) return r.tweet;
    if (r.__typename === 'Tweet' || r.legacy || r.rest_id) return r;
    return null;
  }

  function tweetUser(t) {
    return t?.core?.user_results?.result || null;
  }

  function isFollowing(user) {
    if (!user) return false;
    return !!(user.relationship_perspectives?.following ?? user.legacy?.following);
  }

  function cardText(t) {
    const bv = t?.card?.legacy?.binding_values;
    if (!Array.isArray(bv)) return '';
    const out = [];
    for (const kv of bv) {
      if (/^(title|description|vanity_url)$/.test(kv?.key) && kv.value?.string_value) out.push(kv.value.string_value);
    }
    return out.join('\n');
  }

  // Each "segment" is one authored piece of text: the tweet itself, its quoted tweet, the retweeted original.
  // Following-exemption is decided per segment author.
  function tweetSegments(t, out = [], depth = 0) {
    t = unwrapTweet(t);
    if (!t || depth > 4) return out;
    const legacy = t.legacy || {};
    const rt = legacy.retweeted_status_result?.result;
    if (rt) {
      // A retweet's own full_text is just "RT @x: <truncated>", the original carries the real text.
      tweetSegments(rt, out, depth + 1);
    } else {
      const user = tweetUser(t);
      const parts = [
        t.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '',
        cardText(t),
        t.article?.article_results?.result?.title || '',
        t.article?.article_results?.result?.preview_text || '',
      ];
      out.push({
        userId: user?.rest_id || legacy.user_id_str,
        following: isFollowing(user),
        text: cleanText(parts.join('\n')),
      });
    }
    const q = t.quoted_status_result?.result;
    if (q) tweetSegments(q, out, depth + 1);
    return out;
  }

  // Whether one segment should be muted. The user's own posts never are.
  function segmentMuted(seg, m, selfId) {
    if (selfId && seg.userId === selfId) return false;
    if (m.always && m.always.test(seg.text)) return true;
    return !!(m.unlessFollowing && !seg.following && m.unlessFollowing.test(seg.text));
  }

  function judgeText(text, m) {
    const t = cleanText(text);
    return !!((m.always && m.always.test(t)) || (m.unlessFollowing && m.unlessFollowing.test(t)));
  }

  // Non-tweet timeline items that carry their own text (trends, Explore news/event cards).
  function itemText(o) {
    if (o.itemType === 'TimelineTrend' || o.__typename === 'TimelineTrend') {
      return [o.name, o.social_context?.text, o.trend_metadata?.meta_description, o.trend_metadata?.domain_context];
    }
    if (o.itemType === 'TimelineEventSummary' || o.__typename === 'TimelineEventSummary') {
      const p = o.promotedMetadata || {};
      return [o.title, p.promotedTrendName, p.promotedTrendDescription];
    }
    return null;
  }

  // Walks any subtree and judges every tweet / trend / event card found in it.
  function subtreeMuted(node, ctx) {
    let muted = false;
    const visit = (o, depth) => {
      if (muted || !o || typeof o !== 'object' || depth > 40) return;
      if (Array.isArray(o)) { for (const v of o) visit(v, depth + 1); return; }
      if (o.tweet_results && typeof o.tweet_results === 'object') {
        if (tweetSegments(o.tweet_results.result).some((s) => segmentMuted(s, ctx.m, ctx.selfId))) {
          muted = true;
          return;
        }
      }
      const txt = itemText(o);
      if (txt && judgeText(txt.filter(Boolean).join('\n'), ctx.m)) { muted = true; return; }
      for (const k in o) {
        if (k === 'tweet_results') continue;
        visit(o[k], depth + 1);
      }
    };
    visit(node, 0);
    return muted;
  }

  // Runs one step of the filter. If it throws (a response shape tweetmuff doesn't understand), that step is skipped,
  // i.e. the item is kept as X sent it, and the rest of the response is still filtered.
  function attempt(ctx, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      ctx.onError(e);
      return fallback;
    }
  }

  // Removes items for which muted() is true; an item that can't be judged stays.
  function keep(ctx, list, muted) {
    const kept = list.filter((item) => !attempt(ctx, () => muted(item), false));
    ctx.removed += list.length - kept.length;
    return kept;
  }

  // A conversation module (home-conversation-*, conversationthread-*) is dropped as a whole when any tweet
  // in it matches; dropping just one item would leave a dangling thread line.
  // Other modules are lists of independent items ("Discover more" under a post, carousels): only the matching
  // items go, and the module goes too once it is empty so no bare header is left.
  function entryMuted(e, ctx) {
    if (isCursor(e)) return false;
    const c = e?.content;
    if (Array.isArray(c?.items) && c.items.length && !/Conversation/.test(c.displayType || '')) {
      c.items = keep(ctx, c.items, (it) => subtreeMuted(it, ctx));
      return c.items.length === 0;
    }
    return subtreeMuted(e, ctx);
  }

  function filterInstructions(instructions, ctx) {
    for (let i = instructions.length - 1; i >= 0; i--) {
      const ins = instructions[i];
      if (!ins || typeof ins !== 'object') continue;
      if (Array.isArray(ins.entries)) ins.entries = keep(ctx, ins.entries, (e) => entryMuted(e, ctx));
      if (Array.isArray(ins.moduleItems)) {
        const before = ins.moduleItems.length;
        ins.moduleItems = keep(ctx, ins.moduleItems, (e) => subtreeMuted(e, ctx));
        if (!ins.moduleItems.length && before) instructions.splice(i, 1);
      }
      if (ins.entry && attempt(ctx, () => !isCursor(ins.entry) && subtreeMuted(ins.entry, ctx), false)) {
        instructions.splice(i, 1);
        ctx.removed++;
      }
    }
  }

  function isCursor(e) {
    const c = e?.content;
    return !!(c && (c.entryType === 'TimelineTimelineCursor' || c.__typename === 'TimelineTimelineCursor' || c.cursorType));
  }

  // Legacy v2 shape (globalObjects + timeline.instructions[].addEntries), still used by some endpoints.
  function filterLegacyV2(obj, ctx) {
    const tweets = obj.globalObjects?.tweets;
    const users = obj.globalObjects?.users || {};
    if (!tweets || typeof tweets !== 'object' || !Array.isArray(obj.timeline?.instructions)) return;
    const muted = new Set();
    for (const id in tweets) {
      attempt(ctx, () => {
        const t = tweets[id];
        const seg = { userId: t.user_id_str, following: !!users[t.user_id_str]?.following, text: cleanText(t.full_text || t.text) };
        if (segmentMuted(seg, ctx.m, ctx.selfId)) muted.add(id);
      });
    }
    // quotes / retweets inherit
    for (const id in tweets) {
      const t = tweets[id];
      if (t && (muted.has(t.quoted_status_id_str) || muted.has(t.retweeted_status_id_str))) muted.add(id);
    }
    if (!muted.size) return;
    const refsMuted = (o) => {
      for (const m of JSON.stringify(o).matchAll(/"id":"(\d+)"/g)) if (muted.has(m[1])) return true;
      return false;
    };
    for (const ins of obj.timeline.instructions) {
      const ae = ins?.addEntries;
      if (!Array.isArray(ae?.entries)) continue;
      ae.entries = keep(ctx, ae.entries, (e) => !isCursor(e) && !!e.content?.item?.content?.tweet && refsMuted(e.content.item.content.tweet));
    }
  }

  // Search-box suggestions (/1.1/search/typeahead.json). Users are left alone, like X's own mute.
  function filterTypeahead(obj, ctx) {
    if (!('num_results' in obj && 'ordered_sections' in obj)) return;
    const before = ctx.removed;
    for (const key of ['topics', 'hashtags', 'events']) {
      if (!Array.isArray(obj[key])) continue;
      obj[key] = keep(ctx, obj[key], (item) => {
        const strings = [];
        JSON.stringify(item, (k, v) => {
          if (typeof v === 'string' && !/url|id$|_str$/i.test(k)) strings.push(v);
          return v;
        });
        return judgeText(strings.join('\n'), ctx.m);
      });
    }
    const removed = ctx.removed - before;
    if (removed && typeof obj.num_results === 'number') obj.num_results -= removed;
  }

  // Mutates obj in place and returns how many entries/items were removed. A response shape it doesn't understand
  // never makes it throw: those parts are left as X sent them, and each problem is reported to opts.onError.
  function filterPayload(obj, m, opts = {}) {
    if (!obj || typeof obj !== 'object' || isEmpty(m)) return 0;
    const ctx = { m, selfId: opts.selfId || null, removed: 0, onError: opts.onError || (() => {}) };
    attempt(ctx, () => filterLegacyV2(obj, ctx));
    attempt(ctx, () => filterTypeahead(obj, ctx));
    const seen = new Set();
    const visit = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 30 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { for (const v of o) visit(v, depth + 1); return; }
      for (const k in o) {
        const v = o[k];
        if (k === 'instructions' && Array.isArray(v)) attempt(ctx, () => filterInstructions(v, ctx));
        else visit(v, depth + 1);
      }
    };
    attempt(ctx, () => visit(obj, 0));
    return ctx.removed;
  }

  // X's mute-list API -> our rule format. Returns null (keep the list already saved) when the response isn't
  // recognizable, e.g. X renamed a field, instead of replacing the user's list with nothing or with junk.
  function fromXMuteList(json) {
    const list = json?.muted_keywords;
    if (!Array.isArray(list)) return null;
    const rules = normalizeRules(list.map((k) => ({
      keyword: k?.keyword,
      excludeFollowing: Array.isArray(k?.mute_options) && k.mute_options.includes('exclude_following_accounts'),
      validUntil: k?.valid_until,
    })));
    return list.length && !rules.length ? null : rules;
  }

  // --- problem reports (shown on the options page and meant to be pasteable into a public GitHub issue) ---

  // Removes anything that could identify the user or be abused once a report is posted publicly.
  function redact(text) {
    return String(text ?? '')
      .replace(/chrome-extension:\/\/[a-p]{32}\//g, '') // extension id
      .replace(/(Invalid regular expression: )\/.*\/([a-z]*):/g, '$1/…/$2:') // regex source = the user's muted words
      .replace(/https?:\/\/[^\s'"`)]+/g, (u) => {
        try {
          const url = new URL(u);
          // Keep only API endpoint paths; page paths can contain user names.
          return url.origin + (/(^|\.)(x|twitter)\.com$/.test(url.hostname) && !url.pathname.startsWith('/i/api/') ? '/…' : url.pathname);
        } catch {
          return '<url>';
        }
      })
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
      .replace(/([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+/g, '$1<user>')
      .replace(/(?<!\w)(["'`])(.*?)\1(?!\w)/g, (m, q, s) => (/^[A-Za-z_$][\w$]{0,39}$/.test(s) ? m : `${q}…${q}`)) // quoted data; identifiers stay
      .replace(/\b[A-Za-z0-9%_-]{32,}\b/g, '<token>')
      .replace(/\b\d{6,}\b/g, '<id>')
      .slice(0, 300);
  }

  // Which feature a request belongs to, named for people.
  const FEATURES = [
    [/^(HomeTimeline|HomeLatestTimeline)$/, 'Home timeline'],
    [/^TweetDetail$/, 'Replies and "Discover more"'],
    [/^SearchTimeline$/, 'Search results'],
    [/^(User\w*|Likes)$/, 'Profiles'],
    [/^(ExplorePage|ExploreSidebar|GenericTimelineById|\w*Trends?\w*)$/, 'Explore and trends'],
    [/^Notifications?\w*$/, 'Notifications'],
    [/^Bookmarks?\w*$/, 'Bookmarks'],
    [/^List\w*$/, 'Lists'],
  ];
  function featureFor(url) {
    const path = String(url || '').split(/[?#]/)[0];
    if (/\/search\/typeahead\.json$/.test(path)) return { feature: 'Search suggestions', source: 'typeahead' };
    const op = (path.match(/\/graphql\/[^/]+\/(\w+)$/) || [])[1];
    if (op) return { feature: (FEATURES.find(([re]) => re.test(op)) || [, 'Other timelines'])[1], source: op };
    if (/\/2\/notifications\//.test(path)) return { feature: 'Notifications', source: 'notifications' };
    return { feature: 'Other timelines', source: redact((path.match(/\/i\/api\/(.+)$/) || [, 'unknown'])[1]) };
  }

  // A redacted, compact description of an error: what failed, the message, and where in tweetmuff's own code.
  function toProblem(error, feature, source) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stack = [];
    for (const line of String(error?.stack || '').split('\n')) {
      const m = line.match(/at (?:([\w$.]+) )?\(?.*?((?:core|main|bridge)\.js:\d+:\d+)\)?\s*$/);
      if (m) stack.push(`${m[1] ? m[1] + ' ' : ''}(src/${m[2]})`);
      if (stack.length === 6) break;
    }
    return { feature: redact(feature).slice(0, 80), source: redact(source || '').slice(0, 80), message: redact(message), stack };
  }

  const api = {
    normalize, keywordSource, normalizeState, compile, isEmpty, judgeText, cleanText, tweetSegments, filterPayload, fromXMuteList,
    redact, featureFor, toProblem,
  };
  root.TweetmuffCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
