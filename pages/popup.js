'use strict';
// The popup shows counts only; the words themselves live on the options page so they aren't in view every time.

onStateChange((s) => {
  $('enabled').checked = s.enabled;
  $('applyToFollowing').checked = s.applyToFollowing;
  $('syncStatus').textContent = syncStatus(s);
  $('localStatus').textContent = s.local.length ? `${count(s.local.length, 'extra word')} added here` : '';
});

bindCheckbox('enabled', 'enabled');
bindCheckbox('applyToFollowing', 'applyToFollowing');

$('editWords').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$('openSettings').addEventListener('click', () => {
  openXMuteSettings();
  window.close();
});
