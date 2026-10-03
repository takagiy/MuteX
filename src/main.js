// tweetmuff page hook (runs in the page's MAIN world at document_start).
// 1. Filters timeline API responses before X's app sees them, so muted posts are never rendered at all.
// 2. Imports X's own muted-keyword list by reading the response whenever X itself fetches it.
// tweetmuff never makes API requests of its own and never touches X's DOM, so changes to X's markup can't break it.
// Fail-safe by design: whenever something unexpected happens, tweetmuff steps aside and X gets its data unchanged.
(function () {
  'use strict';
  const core = window.TweetmuffCore;
  if (window.__tweetmuff || !core) return;
  window.__tweetmuff = true;

  const STATE_KEY = 'tweetmuff:state';
  const MUTE_LIST_PATH = '/i/api/1.1/mutes/keywords/list.json';

  // One console note per distinct problem, so a format change on X's side doesn't flood the console.
  const reported = new Set();
  function report(e) {
    const key = String(e?.message || e);
    if (reported.has(key)) return;
    reported.add(key);
    console.warn('[tweetmuff] Left part of X\'s data unfiltered because it looked unexpected:', e);
  }

  // ---------- state (written by the isolated-world bridge into localStorage) ----------
  let matcher = core.compile(null);

  function loadState() {
    try {
      matcher = core.compile(JSON.parse(localStorage.getItem(STATE_KEY) || 'null'));
    } catch (e) {
      report(e);
    }
  }

  function selfId() {
    try {
      const m = document.cookie.match(/(?:^|;\s*)twid=([^;]+)/);
      const v = m ? decodeURIComponent(m[1]).replace(/^"|"$/g, '') : '';
      return (v.match(/u=(\d+)/) || [])[1] || null;
    } catch {
      return null;
    }
  }

  // ---------- response filtering ----------
  function isTimelineUrl(url) {
    return /\/i\/api\/(graphql\/|2\/|1\.1\/search\/typeahead\.json)/.test(url)
      || /api\.(x|twitter)\.com\/(graphql|2)\//.test(url);
  }

  function filterObj(obj) {
    if (core.isEmpty(matcher)) return 0;
    try {
      return core.filterPayload(obj, matcher, { selfId: selfId(), onError: report });
    } catch (e) {
      report(e);
      return 0;
    }
  }

  // Returns the filtered JSON text, or the original text whenever it isn't JSON or nothing was removed.
  function filterText(text) {
    if (core.isEmpty(matcher) || typeof text !== 'string' || !text || text[0] !== '{') return text;
    let obj;
    try { obj = JSON.parse(text); } catch { return text; }
    return filterObj(obj) ? JSON.stringify(obj) : text;
  }

  // ---------- XMLHttpRequest ----------
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open;
  const textDesc = Object.getOwnPropertyDescriptor(XP, 'responseText');
  const respDesc = Object.getOwnPropertyDescriptor(XP, 'response');
  const META = Symbol('tweetmuff');

  XP.open = function (method, url) {
    try {
      const u = String(url);
      this[META] = { url: u, timeline: isTimelineUrl(u), raw: undefined, out: undefined };
      if (u.includes(MUTE_LIST_PATH)) {
        this.addEventListener('load', () => {
          try { importFromJson(JSON.parse(textDesc.get.call(this))); } catch {}
        });
      }
    } catch (e) {
      report(e);
    }
    return origOpen.apply(this, arguments);
  };

  function filtered(xhr, raw) {
    try {
      const meta = xhr[META];
      if (!meta || !meta.timeline || xhr.readyState !== 4) return raw;
      if (meta.raw === raw && meta.out !== undefined) return meta.out;
      let out = raw;
      if (typeof raw === 'string') {
        out = filterText(raw);
      } else if (raw && Object.getPrototypeOf(raw) === Object.prototype) {
        // responseType 'json': filter a copy, so X's own object is never left half-edited.
        const copy = structuredClone(raw);
        if (filterObj(copy)) out = copy;
      }
      meta.raw = raw;
      meta.out = out;
      return out;
    } catch (e) {
      report(e);
      return raw;
    }
  }

  Object.defineProperty(XP, 'responseText', {
    configurable: true, enumerable: textDesc.enumerable,
    get() { return filtered(this, textDesc.get.call(this)); },
  });
  Object.defineProperty(XP, 'response', {
    configurable: true, enumerable: respDesc.enumerable,
    get() { return filtered(this, respDesc.get.call(this)); },
  });

  // ---------- fetch ----------
  const origFetch = window.fetch;
  window.fetch = async function (input) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
      if (url.includes(MUTE_LIST_PATH)) res.clone().json().then(importFromJson).catch(() => {});
      if (!isTimelineUrl(url) || core.isEmpty(matcher) || !res.ok) return res;
      if (!(res.headers.get('content-type') || '').includes('json')) return res;
      // Read a clone, so the original response is still intact to hand back if anything goes wrong.
      const text = await res.clone().text();
      const out = filterText(text);
      if (out === text) return res;
      const r2 = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
      Object.defineProperty(r2, 'url', { value: res.url });
      return r2;
    } catch (e) {
      report(e);
      return res;
    }
  };

  // ---------- import of X's own mute settings ----------
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  }

  function importFromJson(json) {
    const rules = core.fromXMuteList(json);
    if (rules) emit('tweetmuff:imported', { rules, at: Date.now() });
  }

  // ---------- init ----------
  loadState();
  document.addEventListener('tweetmuff:state', loadState);
})();
