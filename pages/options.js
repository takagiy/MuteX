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

// ---------- Status: problems tweetmuff ran into on X (recorded by the bridge, already redacted) ----------

const VERSION = chrome.runtime.getManifest().version;
let problems = [];

// Only this version's records, redacted once more before they're shown or copied.
function currentProblems(stored) {
  const r = TweetmuffCore.redact;
  return (Array.isArray(stored) ? stored : [])
    .filter((p) => p && p.version === VERSION && typeof p.message === 'string')
    .map((p) => ({
      feature: r(p.feature), source: r(p.source), message: r(p.message),
      stack: (Array.isArray(p.stack) ? p.stack : []).map(r),
      count: Number(p.count) || 1, lastSeen: Number(p.lastSeen) || 0,
    }));
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
    feature.textContent = p.feature;
    const message = document.createElement('code');
    message.textContent = p.message;
    const seen = document.createElement('div');
    seen.className = 'muted small';
    seen.textContent = `Seen ${p.count === 1 ? 'once' : `${p.count} times`}, last on ${fmtDate(p.lastSeen)}`;
    li.append(feature, message, seen);
    return li;
  }));
}

function reportText() {
  const browser = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1];
  const platform = navigator.userAgentData?.platform;
  const lines = [`tweetmuff ${VERSION} problem report`, `Browser: Chrome ${browser || '?'}${platform ? ` on ${platform}` : ''}`, ''];
  problems.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.feature}${p.source ? ` (${p.source})` : ''}`, `   ${p.message}`);
    lines.push(`   Seen ${p.count} time${p.count === 1 ? '' : 's'}, last on ${new Date(p.lastSeen).toISOString().slice(0, 10)}`);
    for (const frame of p.stack) lines.push(`   at ${frame}`);
    lines.push('');
  });
  lines.push('Account and post IDs, tokens, links, and quoted text were removed from this report.');
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
