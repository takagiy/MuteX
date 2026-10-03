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

  // Keeps a short log of problems for the options page: one record per distinct problem in this version, newest
  // first. Everything is redacted again here, since events from the page can't be trusted to be clean.
  async function recordProblem(p) {
    const clip = (s, n) => core.redact(s).slice(0, n);
    const problem = {
      feature: clip(p.feature, 80),
      source: clip(p.source, 80),
      message: clip(p.message, 300),
      stack: (Array.isArray(p.stack) ? p.stack : []).slice(0, 6).map((f) => clip(f, 120)),
    };
    const key = problem.feature + '\n' + problem.message;
    const { problems } = await chrome.storage.local.get('problems');
    const list = (Array.isArray(problems) ? problems : []).filter((x) => x && x.version === VERSION);
    const now = Date.now();
    const found = list.find((x) => x.key === key);
    if (found) Object.assign(found, { count: (found.count || 1) + 1, lastSeen: now });
    else list.push({ key, ...problem, version: VERSION, count: 1, firstSeen: now, lastSeen: now });
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
  onPageEvent('tweetmuff:problem', async (p) => {
    if (typeof p.feature === 'string' && typeof p.message === 'string') await recordProblem(p);
  });
})();
