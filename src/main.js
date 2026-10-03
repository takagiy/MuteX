// tweetmuff page hook (runs in the page's MAIN world at document_start).
// 1. Filters timeline API responses before X's app sees them, so muted posts are never rendered at all.
// 2. Imports X's own muted-keyword list by reading the response whenever X itself fetches it.
// tweetmuff never makes API requests of its own and never touches X's DOM, so changes to X's markup can't break it.
(function () {
  'use strict';
  if (window.__tweetmuff) return;
  window.__tweetmuff = true;

  const core = window.TweetmuffCore;
  const STATE_KEY = 'tweetmuff:state';
  const MUTE_LIST_PATH = '/i/api/1.1/mutes/keywords/list.json';

  // ---------- state (written by the isolated-world bridge into localStorage) ----------
  let matcher = core.compile(null);

  function loadState() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch {}
    matcher = core.compile(state);
  }

  function selfId() {
    const m = document.cookie.match(/(?:^|;\s*)twid=([^;]+)/);
    if (!m) return null;
    const v = decodeURIComponent(m[1]).replace(/^"|"$/g, '');
    return (v.match(/u=(\d+)/) || [])[1] || null;
  }

  // ---------- response filtering ----------
  function isTimelineUrl(url) {
    return /\/i\/api\/(graphql\/|2\/|1\.1\/search\/typeahead\.json)/.test(url)
      || /api\.(x|twitter)\.com\/(graphql|2)\//.test(url);
  }

  function filterObj(obj) {
    if (core.isEmpty(matcher)) return 0;
    try { return core.filterPayload(obj, matcher, { selfId: selfId() }); }
    catch (e) { console.warn('[tweetmuff] filter error', e); return 0; }
  }

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
    const u = String(url);
    this[META] = { url: u, timeline: isTimelineUrl(u), raw: undefined, out: undefined };
    if (u.includes(MUTE_LIST_PATH)) {
      this.addEventListener('load', () => {
        try { importFromJson(JSON.parse(textDesc.get.call(this))); } catch {}
      });
    }
    return origOpen.apply(this, arguments);
  };

  function filtered(xhr, raw) {
    const meta = xhr[META];
    if (!meta || !meta.timeline || xhr.readyState !== 4) return raw;
    if (meta.raw === raw && meta.out !== undefined) return meta.out;
    let out = raw;
    if (typeof raw === 'string') out = filterText(raw);
    else if (raw && typeof raw === 'object' && !(raw instanceof ArrayBuffer) && !(raw instanceof Blob)) filterObj(raw); // responseType 'json': in place
    meta.raw = raw;
    meta.out = out;
    return out;
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
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    const res = await origFetch.apply(this, arguments);
    if (url.includes(MUTE_LIST_PATH)) {
      res.clone().json().then((j) => importFromJson(j)).catch(() => {});
    }
    if (!isTimelineUrl(url) || core.isEmpty(matcher) || !res.ok) return res;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return res;
    const text = await res.text();
    const out = filterText(text);
    const r2 = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(r2, 'url', { value: res.url });
    return r2;
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
