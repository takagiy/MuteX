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
