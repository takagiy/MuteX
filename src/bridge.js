// tweetmuff bridge (isolated world): relays between chrome.storage and the MAIN-world hook.
// The hook needs rules synchronously at document_start, so the state is mirrored into x.com's localStorage.
// Loaded after src/core.js.
(function () {
  'use strict';
  const core = globalThis.TweetmuffCore;
  const STATE_KEY = 'tweetmuff:state';
  const DEFAULT = { enabled: true, applyToFollowing: false, imported: [], local: [], lastSync: 0 };
  const VERSION = chrome.runtime.getManifest().version;
  const MAX_PROBLEMS = 20;

  function push(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
    document.dispatchEvent(new CustomEvent('tweetmuff:state'));
  }

  async function getState() {
    const { state } = await chrome.storage.local.get('state');
    return { ...DEFAULT, ...(state || {}) };
  }

  async function update(patch) {
    const s = await getState();
    await chrome.storage.local.set({ state: { ...s, ...patch } });
  }

  // Keeps a short log of problems for the options page: one record per distinct { feature, step, kind } in this
  // version, newest first. Only codes from core's fixed lists are accepted, so nothing else from the page is stored.
  async function recordProblem(p) {
    if (!core.isProblem(p)) return;
    const key = `${p.feature}/${p.step}/${p.kind}`;
    const { problems } = await chrome.storage.local.get('problems');
    const list = (Array.isArray(problems) ? problems : []).filter((x) => x && x.version === VERSION && core.isProblem(x));
    const now = Date.now();
    const found = list.find((x) => `${x.feature}/${x.step}/${x.kind}` === key);
    if (found) Object.assign(found, { count: (Number(found.count) || 1) + 1, lastSeen: now });
    else list.push({ feature: p.feature, step: p.step, kind: p.kind, version: VERSION, count: 1, firstSeen: now, lastSeen: now });
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    await chrome.storage.local.set({ problems: list.slice(0, MAX_PROBLEMS) });
  }

  // Storage calls start failing when the extension is reloaded or updated under an open tab; that tab simply keeps
  // its last rules until it is reloaded.
  getState().then(push).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) push({ ...DEFAULT, ...changes.state.newValue });
  });

  function onPageEvent(name, handle) {
    document.addEventListener(name, (e) => {
      let detail;
      try { detail = JSON.parse(e.detail); } catch { return; }
      if (detail && typeof detail === 'object') handle(detail).catch(() => {});
    });
  }

  onPageEvent('tweetmuff:imported', async (d) => {
    if (Array.isArray(d.rules)) await update({ imported: d.rules, lastSync: Number(d.at) || Date.now() });
  });
  onPageEvent('tweetmuff:problem', recordProblem);
})();
