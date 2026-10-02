'use strict';
const DEFAULT = { enabled: true, applyToFollowing: false, imported: [], local: [], lastSync: 0 };
const $ = (id) => document.getElementById(id);

async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...DEFAULT, ...(state || {}) };
}
async function update(patch) {
  await chrome.storage.local.set({ state: { ...(await getState()), ...patch } });
}

function fmtTime(t) {
  return t ? new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function render(s) {
  $('enabled').checked = s.enabled;
  $('applyToFollowing').checked = s.applyToFollowing;
  $('syncStatus').textContent = s.lastSync
    ? `${s.imported.length} words synced (${fmtTime(s.lastSync)})`
    : 'Not synced yet. Open X's muted words settings once to import them.';
  $('importedSummary').textContent = `Imported (${s.imported.length})`;
  const ul = $('importedList');
  ul.replaceChildren(...s.imported.map((r) => {
    const li = document.createElement('li');
    li.textContent = r.keyword;
    if (r.excludeFollowing) { li.className = 'following'; li.title = 'Excludes accounts you follow'; }
    return li;
  }));
  if (document.activeElement !== $('local')) $('local').value = s.local.map((r) => r.keyword).join('\n');
}

$('enabled').addEventListener('change', (e) => update({ enabled: e.target.checked }));
$('applyToFollowing').addEventListener('change', (e) => update({ applyToFollowing: e.target.checked }));

$('saveLocal').addEventListener('click', async () => {
  const words = [...new Set($('local').value.split('\n').map((w) => w.trim()).filter(Boolean))];
  await update({ local: words.map((keyword) => ({ keyword, excludeFollowing: false })) });
  $('saved').hidden = false;
  setTimeout(() => ($('saved').hidden = true), 1500);
});

// X loads the list itself on this page; MuteX only reads that response.
$('openSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://x.com/settings/muted_keywords' });
  window.close();
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.state) render({ ...DEFAULT, ...c.state.newValue });
});
getState().then(render);
