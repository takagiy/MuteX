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

  // Each distinct problem is reported once per page: a console note for whoever is debugging locally, plus fixed codes
  // ({ feature, step, kind }, no message or data) the bridge keeps for the options page's Status section.
  const reported = new Set();
  function report(e, feature, step) {
    try {
      const problem = core.problemOf(e, feature, step);
      const key = `${problem.feature}/${problem.step}/${problem.kind}`;
      if (reported.has(key)) return;
      reported.add(key);
      console.warn(`[tweetmuff] ${key}: left part of X's data unfiltered because it looked unexpected.`, e);
      emit('tweetmuff:problem', problem);
    } catch {}
  }

  // ---------- state (written by the isolated-world bridge into localStorage) ----------
  let matcher = core.compile(null);

  function loadState() {
    try {
      matcher = core.compile(JSON.parse(localStorage.getItem(STATE_KEY) || 'null'));
    } catch (e) {
      report(e, 'settings', 'settings');
    }
  }

  // The signed-in user's id, so their own posts are never hidden. Read with the Cookie Store API, which returns only
  // the twid cookie; document.cookie would hand over every readable cookie, including X's CSRF token.
  let selfId = null;
  async function readSelfId() {
    try {
      const c = await window.cookieStore?.get('twid');
      const v = c ? decodeURIComponent(c.value).replace(/^"|"$/g, '') : '';
      selfId = (v.match(/u=(\d+)/) || [])[1] || null;
    } catch {
      selfId = null;
    }
  }
  readSelfId();
  try {
    window.cookieStore?.addEventListener('change', (e) => {
      if ([...e.changed, ...e.deleted].some((c) => c.name === 'twid')) readSelfId(); // signed out or switched accounts
    });
  } catch {}

  // ---------- response filtering (only the requests listed in core's GRAPHQL_FEATURES / REST_FEATURES) ----------
  function filterObj(obj, feature) {
    if (core.isEmpty(matcher)) return 0;
    const onError = (e, step = 'response') => report(e, feature, step);
    try {
      return core.filterPayload(obj, matcher, { selfId, onError });
    } catch (e) {
      onError(e);
      return 0;
    }
  }

  // Returns the filtered JSON text, or the original text whenever it isn't JSON or nothing was removed.
  function filterText(text, feature) {
    if (core.isEmpty(matcher) || typeof text !== 'string' || !text || text[0] !== '{') return text;
    let obj;
    try { obj = JSON.parse(text); } catch { return text; }
    return filterObj(obj, feature) ? JSON.stringify(obj) : text;
  }

  // ---------- XMLHttpRequest ----------
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open;
  const textDesc = Object.getOwnPropertyDescriptor(XP, 'responseText');
  const respDesc = Object.getOwnPropertyDescriptor(XP, 'response');
  const META = Symbol('tweetmuff');

  XP.open = function (method, url) {
    try {
      this[META] = { feature: core.filteredFeature(url), raw: undefined, out: undefined };
      if (core.isMuteListRequest(url)) {
        this.addEventListener('load', () => {
          if (this.status !== 200) return;
          let json;
          try { json = JSON.parse(textDesc.get.call(this)); } catch { return; }
          importFromJson(json);
        });
      }
    } catch (e) {
      report(e, 'network', 'hook');
    }
    return origOpen.apply(this, arguments);
  };

  function filtered(xhr, raw) {
    try {
      const meta = xhr[META];
      if (!meta || !meta.feature || xhr.readyState !== 4) return raw;
      if (meta.raw === raw && meta.out !== undefined) return meta.out;
      let out = raw;
      if (typeof raw === 'string') {
        out = filterText(raw, meta.feature);
      } else if (raw && Object.getPrototypeOf(raw) === Object.prototype) {
        // responseType 'json': filter a copy, so X's own object is never left half-edited.
        const copy = structuredClone(raw);
        if (filterObj(copy, meta.feature)) out = copy;
      }
      meta.raw = raw;
      meta.out = out;
      return out;
    } catch (e) {
      report(e, xhr[META]?.feature, 'response');
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
    let feature = null;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
      if (core.isMuteListRequest(url) && res.ok) res.clone().json().then(importFromJson, () => {});
      feature = core.filteredFeature(url);
      if (!feature || core.isEmpty(matcher) || !res.ok) return res;
      if (!(res.headers.get('content-type') || '').includes('json')) return res;
      // Read a clone, so the original response is still intact to hand back if anything goes wrong.
      const text = await res.clone().text();
      const out = filterText(text, feature);
      if (out === text) return res;
      const r2 = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
      Object.defineProperty(r2, 'url', { value: res.url });
      return r2;
    } catch (e) {
      report(e, feature, 'response');
      return res;
    }
  };

  // ---------- import of X's own mute settings ----------
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  }

  function importFromJson(json) {
    try {
      const rules = core.fromXMuteList(json);
      if (rules) emit('tweetmuff:imported', { rules, at: Date.now() });
      else report({ name: 'UnknownFormat' }, 'import', 'format'); // the saved list was kept
    } catch (e) {
      report(e, 'import', 'import');
    }
  }

  // ---------- init ----------
  loadState();
  document.addEventListener('tweetmuff:state', loadState);
})();
