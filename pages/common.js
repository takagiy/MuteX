// Shared by the popup and the options page.
'use strict';
const DEFAULT = { enabled: true, applyToFollowing: false, imported: [], local: [], lastSync: 0 };
const X_MUTE_SETTINGS = 'https://x.com/settings/muted_keywords';
const $ = (id) => document.getElementById(id);

async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...DEFAULT, ...(state || {}) };
}

async function update(patch) {
  await chrome.storage.local.set({ state: { ...(await getState()), ...patch } });
}

function onStateChange(render) {
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.state) render({ ...DEFAULT, ...c.state.newValue });
  });
  getState().then(render);
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function count(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function syncStatus(s) {
  return s.lastSync
    ? `${count(s.imported.length, 'word')} from X, synced ${fmtTime(s.lastSync)}`
    : "Not synced yet. Open X's muted words settings once to import them.";
}

// Two-way binding for a checkbox backed by a boolean state field.
function bindCheckbox(id, key) {
  $(id).addEventListener('change', (e) => update({ [key]: e.target.checked }));
}

// X loads the list itself on this page; tweetmuff only reads that response.
function openXMuteSettings() {
  chrome.tabs.create({ url: X_MUTE_SETTINGS });
}
