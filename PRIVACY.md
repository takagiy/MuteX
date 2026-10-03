# Privacy Policy — tweetmuff

**Extension:** tweetmuff
**Last updated:** 2026-10-03

## Summary

tweetmuff does not transmit, sell, or share any user data. Everything it handles stays on your device.

## Data the extension handles

tweetmuff only works on x.com (and twitter.com). On those pages it handles the following, all locally in your browser:

- **Timeline content.** It reads the timeline data that X's web app has already received, such as posts, replies, search results, trends, and search suggestions. It removes items that contain your muted words before they are displayed. The content is not stored or sent anywhere.
- **Your muted words.** When X's web app loads your muted-word list (for example on Settings › Muted words), tweetmuff reads that response and saves the words and their options. It also saves the extra words you add on the settings page and your settings (on/off, "apply to accounts you follow"). These are stored in the extension's local storage (`chrome.storage.local`). A copy is also kept in x.com's `localStorage`, so the filter is ready as soon as the page starts loading.
- **Your X account ID.** It reads your numeric account ID from X's `twid` cookie, only so that your own posts are never hidden. The ID is not stored.
- **Problem log.** If part of X's data doesn't look the way tweetmuff expects, tweetmuff leaves that part unfiltered and saves a short code for it in `chrome.storage.local`. The code says which feature was affected, which step failed, and the type of error, for example `home/entries/TypeError`. It also saves how often that happened and when. No error messages, posts, words, links, or account details are saved. You can see these codes in the Status section of the settings page, copy them to report a problem, or clear them. They are never sent anywhere automatically, and codes from older versions are discarded.

## Data the extension transmits

**None.** tweetmuff never sends requests to X or to any other server. It does not call X's API itself; it only reads responses that X's own web app requested.

## Permissions used

- `storage`: saves your muted words and settings on your device.
- Content scripts on `https://x.com/*` and `https://twitter.com/*`: filter posts on those pages.

## Third parties

tweetmuff does not use any third-party analytics, error reporting, advertising, or tracking services.

## Remote code

tweetmuff does not load or execute any remote code. All code is shipped inside the extension package.

## Deleting your data

Removing the extension deletes everything in its local storage, including the problem log. The **Clear** button in the settings page's Status section deletes the problem log on its own. The copy in x.com's `localStorage` (key `tweetmuff:state`) is removed when you clear site data for x.com.

## Changes to this policy

If this policy changes, this file is updated in place and the **Last updated** date above is revised. The current version is always available at <https://github.com/takagiy/tweetmuff/blob/main/PRIVACY.md>.

## Contact

Issues, questions, or concerns: <https://github.com/takagiy/tweetmuff/issues>
