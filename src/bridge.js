// tweetmuff bridge (isolated world): relays between chrome.storage and the MAIN-world hook.
// The hook needs rules synchronously at document_start, so the state is mirrored into x.com's localStorage.
(function () {
  'use strict';
  const STATE_KEY = 'tweetmuff:state';
  const DEFAULT = { enabled: true, applyToFollowing: false, imported: [], local: [], lastSync: 0 };

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

  getState().then(push);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) push({ ...DEFAULT, ...changes.state.newValue });
  });

  document.addEventListener('tweetmuff:imported', (e) => {
    const d = JSON.parse(e.detail);
    update({ imported: d.rules, lastSync: d.at });
  });
})();
