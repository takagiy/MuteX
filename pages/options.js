'use strict';

onStateChange((s) => {
  $('enabled').checked = s.enabled;
  $('applyToFollowing').checked = s.applyToFollowing;
  $('syncStatus').textContent = syncStatus(s);
  $('importedList').replaceChildren(...s.imported.map((r) => {
    const li = document.createElement('li');
    li.textContent = r.keyword;
    if (r.excludeFollowing) { li.className = 'following'; li.title = 'Excludes accounts you follow'; }
    return li;
  }));
  if (document.activeElement !== $('local')) $('local').value = s.local.map((r) => r.keyword).join('\n');
});

bindCheckbox('enabled', 'enabled');
bindCheckbox('applyToFollowing', 'applyToFollowing');

$('openSettings').addEventListener('click', openXMuteSettings);

$('saveLocal').addEventListener('click', async () => {
  const words = [...new Set($('local').value.split('\n').map((w) => w.trim()).filter(Boolean))];
  await update({ local: words.map((keyword) => ({ keyword, excludeFollowing: false })) });
  $('saved').hidden = false;
  setTimeout(() => ($('saved').hidden = true), 1500);
});

// ---------- Status: problems tweetmuff ran into on X ----------
// The bridge stores only fixed codes ({ feature, step, kind }); these turn them into words.

const VERSION = chrome.runtime.getManifest().version;
const FEATURE_NAMES = {
  home: 'Home timeline',
  replies: 'Replies and "Discover more"',
  search: 'Search results',
  suggestions: 'Search suggestions',
  profiles: 'Profiles',
  explore: 'Explore and trends',
  notifications: 'Notifications',
  bookmarks: 'Bookmarks',
  lists: 'Lists',
  other: 'Other timelines',
  settings: 'Settings',
  import: 'Importing muted words from X',
  network: "Watching X's requests",
};
const STEP_TEXT = {
  entries: "Couldn't read some items in X's response; they were shown unfiltered.",
  legacy: "Couldn't read some items in X's response; they were shown unfiltered.",
  suggestions: "Couldn't read some search suggestions; they were shown unfiltered.",
  response: "Couldn't process X's response; it was shown unfiltered.",
  settings: "Couldn't load the saved settings.",
  format: "X's muted-words list came in an unknown format, so the saved list was kept.",
  import: "Couldn't read X's muted-words list, so the saved list was kept.",
  hook: "Couldn't watch one of X's requests; it was left as it was.",
};
let problems = [];

function currentProblems(stored) {
  return (Array.isArray(stored) ? stored : [])
    .filter((p) => p && p.version === VERSION && TweetmuffCore.isProblem(p))
    .map((p) => ({ feature: p.feature, step: p.step, kind: p.kind, count: Number(p.count) || 1, lastSeen: Number(p.lastSeen) || 0 }));
}

function fmtDate(t) {
  return t ? new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
}

function renderProblems(stored) {
  problems = currentProblems(stored);
  $('statusOk').hidden = problems.length > 0;
  $('statusProblems').hidden = problems.length === 0;
  $('problemList').replaceChildren(...problems.map((p) => {
    const li = document.createElement('li');
    const feature = document.createElement('div');
    feature.className = 'feature';
    feature.textContent = FEATURE_NAMES[p.feature];
    const what = document.createElement('div');
    what.textContent = `${STEP_TEXT[p.step]} (${p.kind})`;
    const seen = document.createElement('div');
    seen.className = 'muted small';
    seen.textContent = `Seen ${p.count === 1 ? 'once' : `${p.count} times`}, last on ${fmtDate(p.lastSeen)}`;
    li.append(feature, what, seen);
    return li;
  }));
}

function reportText() {
  const browser = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  const platform = navigator.userAgentData?.platform;
  const lines = [`tweetmuff ${VERSION} problem report`, `Browser: Chrome ${browser || '?'}${platform ? ` on ${platform}` : ''}`, ''];
  problems.forEach((p, i) => {
    const when = new Date(p.lastSeen).toISOString().slice(0, 10);
    lines.push(`${i + 1}. ${FEATURE_NAMES[p.feature]}: ${STEP_TEXT[p.step]}`);
    lines.push(`   Code: ${p.feature}/${p.step}/${p.kind}. Seen ${p.count} time${p.count === 1 ? '' : 's'}, last on ${when}.`);
  });
  lines.push('', 'This report has only problem codes: no posts, muted words, or account details.');
  return lines.join('\n');
}

$('copyReport').addEventListener('click', async () => {
  const text = reportText();
  try {
    await navigator.clipboard.writeText(text);
    $('copied').hidden = false;
    setTimeout(() => ($('copied').hidden = true), 1500);
  } catch {
    // Clipboard unavailable: show the text so it can be copied by hand.
    $('reportFallback').value = text;
    $('reportFallback').hidden = false;
    $('reportFallback').select();
  }
});

$('clearProblems').addEventListener('click', () => chrome.storage.local.remove('problems'));

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.problems) renderProblems(c.problems.newValue);
});
chrome.storage.local.get('problems').then(({ problems: stored }) => renderProblems(stored));
