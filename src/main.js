// MuteX page hook (runs in the page's MAIN world at document_start).
// 1. Filters timeline API responses before X's app sees them, so muted posts are never rendered at all.
// 2. Imports X's own muted-keyword list (actively, and passively whenever X itself fetches it).
// 3. DOM safety net for anything that slips through an unknown response shape.
(function () {
  'use strict';
  if (window.__muteX) return;
  window.__muteX = true;

  const core = window.MuteXCore;
  const STATE_KEY = 'mutex:state';
  const SYNC_INTERVAL = 30 * 60 * 1000;
  const MUTE_LIST_PATH = '/i/api/1.1/mutes/keywords/list.json';

  // ---------- state (written by the isolated-world bridge into localStorage) ----------
  let state = null;
  let matcher = core.compile(null);
  const exempt = new Set(); // tweet ids allowed through because the author is followed

  function loadState() {
    try { state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { state = null; }
    matcher = core.compile(state);
    exempt.clear();
    scanDom(document);
  }

  function selfId() {
    const m = document.cookie.match(/(?:^|;\s*)twid=([^;]+)/);
    if (!m) return null;
    const v = decodeURIComponent(m[1]).replace(/^"|"$/g, '');
    return (v.match(/u=(\d+)/) || [])[1] || null;
  }

  // ---------- response filtering ----------
  function isTimelineUrl(url) {
    return /\/i\/api\/(graphql|2)\//.test(url) || /api\.(x|twitter)\.com\/(graphql|2)\//.test(url);
  }

  function filterObj(obj) {
    if (core.isEmpty(matcher)) return 0;
    try { return core.filterPayload(obj, matcher, { selfId: selfId(), exempt }); }
    catch (e) { console.warn('[MuteX] filter error', e); return 0; }
  }

  function filterText(text) {
    if (core.isEmpty(matcher) || typeof text !== 'string' || !text || text[0] !== '{') return text;
    let obj;
    try { obj = JSON.parse(text); } catch { return text; }
    return filterObj(obj) ? JSON.stringify(obj) : text;
  }

  // ---------- header capture (for active import) ----------
  const captured = {};
  const WANTED = /^(authorization|x-csrf-token|x-twitter-auth-type|x-twitter-active-user|x-twitter-client-language)$/i;
  let onFirstHeaders = null;
  function captureHeader(k, v) {
    if (!WANTED.test(k)) return;
    captured[k.toLowerCase()] = v;
    if (captured.authorization && onFirstHeaders) { const f = onFirstHeaders; onFirstHeaders = null; f(); }
  }

  // ---------- XMLHttpRequest ----------
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open;
  const origSetHeader = XP.setRequestHeader;
  const textDesc = Object.getOwnPropertyDescriptor(XP, 'responseText');
  const respDesc = Object.getOwnPropertyDescriptor(XP, 'response');
  const META = Symbol('mutex');

  XP.open = function (method, url) {
    const u = String(url);
    this[META] = { url: u, timeline: isTimelineUrl(u), raw: undefined, out: undefined };
    if (u.includes(MUTE_LIST_PATH)) {
      this.addEventListener('load', () => {
        try { importFromJson(JSON.parse(textDesc.get.call(this)), 'passive'); } catch {}
      });
    } else if (/\/mutes\/keywords\/(create|destroy)/.test(u)) {
      this.addEventListener('load', () => setTimeout(() => activeImport('changed'), 500));
    }
    return origOpen.apply(this, arguments);
  };

  XP.setRequestHeader = function (k, v) {
    if (this[META] && this[META].url.includes('/i/api/')) captureHeader(k, v);
    return origSetHeader.apply(this, arguments);
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
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
    try {
      const h = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (url.includes('/i/api/')) h.forEach((v, k) => captureHeader(k, v));
    } catch {}
    const res = await origFetch.apply(this, arguments);
    if (url.includes(MUTE_LIST_PATH)) {
      res.clone().json().then((j) => importFromJson(j, 'passive')).catch(() => {});
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

  function importFromJson(json, how) {
    const rules = core.fromXMuteList(json);
    if (rules) emit('mutex:imported', { rules, how, at: Date.now() });
    return !!rules;
  }

  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? m[1] : captured['x-csrf-token'];
  }

  let importing = null;
  function activeImport(reason) {
    if (importing) return importing;
    if (!captured.authorization) {
      // X has not made an authenticated API call yet; retry as soon as it does.
      onFirstHeaders = () => activeImport(reason);
      return Promise.resolve(false);
    }
    const headers = { ...captured, 'x-csrf-token': csrf() };
    importing = origFetch.call(window, MUTE_LIST_PATH, { credentials: 'include', headers })
      .then(async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (!importFromJson(await r.json(), reason)) throw new Error('unexpected response');
        return true;
      })
      .catch((e) => {
        emit('mutex:import-error', { message: String(e.message || e), at: Date.now() });
        return false;
      })
      .finally(() => { importing = null; });
    return importing;
  }

  document.addEventListener('mutex:sync', () => activeImport('manual'));


  // ---------- DOM safety net ----------
  const HIDDEN = 'data-mutex-hidden';

  function installStyle() {
    const s = document.createElement('style');
    s.textContent = `[${HIDDEN}]{display:none!important}`;
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.documentElement) installStyle();
  else document.addEventListener('readystatechange', installStyle, { once: true });

  // Text of an element excluding link anchors pointing to t.co (their visible text is a URL).
  function visibleText(el) {
    let out = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 1) return n.tagName === 'A' && /t\.co\//.test(n.getAttribute('href') || '') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (w.nextNode()) out += w.currentNode.nodeValue;
    return out;
  }

  function tweetId(article) {
    const a = article.querySelector('a[href*="/status/"] time')?.closest('a');
    return (a?.getAttribute('href')?.match(/\/status\/(\d+)/) || [])[1] || null;
  }

  function hide(el) {
    if (el && !el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, '');
  }

  function checkArticle(article) {
    const id = tweetId(article);
    if (id && exempt.has(id)) return;
    const parts = [];
    article.querySelectorAll('[data-testid="tweetText"], [data-testid="card.wrapper"]').forEach((n) => parts.push(visibleText(n)));
    if (!parts.length) return;
    if (core.judgeText(parts.join('\n'), matcher)) hide(article.closest('[data-testid="cellInnerDiv"]') || article);
  }

  function checkTrend(el) {
    if (core.judgeText(el.innerText || el.textContent, matcher)) hide(el.closest('[data-testid="cellInnerDiv"]') || el);
  }

  const ARTICLE = 'article[data-testid="tweet"]';
  const TREND = '[data-testid="trend"], [data-testid^="news_sidebar_article_"]';

  function scanDom(root) {
    if (!root || !root.querySelectorAll || core.isEmpty(matcher)) {
      if (root === document && core.isEmpty(matcher)) document.querySelectorAll(`[${HIDDEN}]`).forEach((n) => n.removeAttribute(HIDDEN));
      return;
    }
    if (root === document) document.querySelectorAll(`[${HIDDEN}]`).forEach((n) => n.removeAttribute(HIDDEN));
    if (root.matches?.(ARTICLE)) checkArticle(root);
    else if (root.closest?.(ARTICLE)) checkArticle(root.closest(ARTICLE));
    root.querySelectorAll(ARTICLE).forEach(checkArticle);
    if (root.matches?.(TREND)) checkTrend(root);
    root.querySelectorAll(TREND).forEach(checkTrend);
  }

  new MutationObserver((records) => {
    if (core.isEmpty(matcher)) return;
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) scanDom(n);
  }).observe(document, { childList: true, subtree: true });

  // ---------- init ----------
  loadState();
  document.addEventListener('mutex:state', loadState);

  // Auto-sync on page load when the last import is stale.
  if (!state || !state.lastSync || Date.now() - state.lastSync > SYNC_INTERVAL) {
    onFirstHeaders = () => activeImport('auto');
  }
})();
