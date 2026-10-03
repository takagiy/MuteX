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

  // state: { enabled, applyToFollowing, imported: [{keyword, excludeFollowing, validUntil}], local: [...] }
  function compile(state, now = Date.now()) {
    const always = [];
    const unlessFollowing = [];
    if (state && state.enabled !== false) {
      const rules = [...(state.imported || []), ...(state.local || [])];
      for (const r of rules) {
        if (r.validUntil && Number(r.validUntil) < now) continue;
        const src = keywordSource(r.keyword);
        if (!src) continue;
        (r.excludeFollowing && !state.applyToFollowing ? unlessFollowing : always).push(src);
      }
    }
    const mk = (list) => (list.length ? new RegExp(list.join('|'), 'u') : null);
    return { always: mk(always), unlessFollowing: mk(unlessFollowing) };
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

  // A conversation module (home-conversation-*, conversationthread-*) is dropped as a whole when any tweet
  // in it matches; dropping just one item would leave a dangling thread line.
  // Other modules are lists of independent items ("Discover more" under a post, carousels): only the matching
  // items go, and the module goes too once it is empty so no bare header is left.
  function entryMuted(e, ctx) {
    if (isCursor(e)) return false;
    const c = e?.content;
    if (Array.isArray(c?.items) && c.items.length && !/Conversation/.test(c.displayType || '')) {
      const before = c.items.length;
      c.items = c.items.filter((it) => !subtreeMuted(it, ctx));
      ctx.removedItems += before - c.items.length;
      return c.items.length === 0;
    }
    return subtreeMuted(e, ctx);
  }

  function filterInstructions(instructions, ctx) {
    let removed = 0;
    for (let i = instructions.length - 1; i >= 0; i--) {
      const ins = instructions[i];
      if (!ins || typeof ins !== 'object') continue;
      if (Array.isArray(ins.entries)) {
        const before = ins.entries.length;
        ins.entries = ins.entries.filter((e) => !entryMuted(e, ctx));
        removed += before - ins.entries.length;
      }
      if (Array.isArray(ins.moduleItems)) {
        const before = ins.moduleItems.length;
        ins.moduleItems = ins.moduleItems.filter((e) => !subtreeMuted(e, ctx));
        removed += before - ins.moduleItems.length;
        if (!ins.moduleItems.length && before) instructions.splice(i, 1);
      }
      if (ins.entry && !isCursor(ins.entry) && subtreeMuted(ins.entry, ctx)) {
        instructions.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  function isCursor(e) {
    const c = e?.content;
    return !!(c && (c.entryType === 'TimelineTimelineCursor' || c.__typename === 'TimelineTimelineCursor' || c.cursorType));
  }

  // Legacy v2 shape (globalObjects + timeline.instructions[].addEntries), still used by some endpoints.
  function filterLegacyV2(obj, ctx) {
    const tweets = obj.globalObjects?.tweets;
    const users = obj.globalObjects?.users || {};
    if (!tweets || !obj.timeline?.instructions) return 0;
    const muted = new Set();
    for (const id in tweets) {
      const t = tweets[id];
      const u = users[t.user_id_str];
      const seg = { userId: t.user_id_str, following: !!u?.following, text: cleanText(t.full_text || t.text) };
      if (segmentMuted(seg, ctx.m, ctx.selfId)) muted.add(id);
    }
    // quotes / retweets inherit
    for (const id in tweets) {
      const t = tweets[id];
      if (muted.has(t.quoted_status_id_str) || muted.has(t.retweeted_status_id_str)) muted.add(id);
    }
    if (!muted.size) return 0;
    let removed = 0;
    const refsMuted = (o) => {
      const s = JSON.stringify(o);
      for (const m of s.matchAll(/"id":"(\d+)"/g)) if (muted.has(m[1])) return true;
      return false;
    };
    for (const ins of obj.timeline.instructions) {
      const ae = ins.addEntries;
      if (!ae?.entries) continue;
      const before = ae.entries.length;
      ae.entries = ae.entries.filter((e) => isCursor(e) || !e.content?.item?.content?.tweet || !refsMuted(e.content.item.content.tweet));
      removed += before - ae.entries.length;
    }
    return removed;
  }

  // Search-box suggestions (/1.1/search/typeahead.json). Users are left alone, like X's own mute.
  function filterTypeahead(obj, ctx) {
    if (!('num_results' in obj && 'ordered_sections' in obj)) return 0;
    let removed = 0;
    for (const key of ['topics', 'hashtags', 'events']) {
      const list = obj[key];
      if (!Array.isArray(list)) continue;
      obj[key] = list.filter((item) => {
        const strings = [];
        JSON.stringify(item, (k, v) => {
          if (typeof v === 'string' && !/url|id$|_str$/i.test(k)) strings.push(v);
          return v;
        });
        return !judgeText(strings.join('\n'), ctx.m);
      });
      removed += list.length - obj[key].length;
    }
    if (removed && typeof obj.num_results === 'number') obj.num_results -= removed;
    return removed;
  }

  // Mutates obj in place. Returns number of removed timeline entries/items.
  function filterPayload(obj, m, opts = {}) {
    if (!obj || typeof obj !== 'object' || isEmpty(m)) return 0;
    const ctx = { m, selfId: opts.selfId || null, removedItems: 0 };
    let removed = filterLegacyV2(obj, ctx) + filterTypeahead(obj, ctx);
    const seen = new Set();
    const visit = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 30 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { for (const v of o) visit(v, depth + 1); return; }
      for (const k in o) {
        const v = o[k];
        if (k === 'instructions' && Array.isArray(v)) removed += filterInstructions(v, ctx);
        else visit(v, depth + 1);
      }
    };
    visit(obj, 0);
    return removed + ctx.removedItems;
  }

  // X's mute-list API -> our rule format
  function fromXMuteList(json) {
    const list = json?.muted_keywords;
    if (!Array.isArray(list)) return null;
    return list.map((k) => ({
      keyword: k.keyword,
      excludeFollowing: Array.isArray(k.mute_options) && k.mute_options.includes('exclude_following_accounts'),
      validUntil: k.valid_until ? Number(k.valid_until) : null,
    }));
  }

  const api = { normalize, keywordSource, compile, isEmpty, judgeText, cleanText, tweetSegments, filterPayload, fromXMuteList };
  root.TweetmuffCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
