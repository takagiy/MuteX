# Privacy Policy — tweetmuff

**Extension:** tweetmuff
**Last updated:** 2026-10-03

tweetmuff works only on x.com. It handles the data below only to filter posts and to show its own status on its settings page. It never sends anything anywhere: it makes no network requests of its own and has no server.

## Personally identifiable information

- **X account ID** (the numeric ID in X's `twid` cookie): read so that your own posts are never hidden. tweetmuff reads only this one cookie, through the Cookie Store API, and keeps the ID in memory only. It's never stored or sent.

## Website content

Read in the page before X displays it, to remove items that contain your muted words. Nothing here is stored or sent, except your muted-word list.

- Posts in timelines: home, profiles, lists, bookmarks, and notifications
- Replies and "Discover more" under a post
- Search results, and search suggestions (topics, hashtags, and events)
- Trends and Explore news cards
- Your muted-word list on X, when X's web app loads it (for example on Settings › Muted words). The words and their options are saved on your device (see [Stored on your device](#stored-on-your-device)).

## User activity

tweetmuff watches the requests X's web app makes and checks their addresses to find the ones below. It reads only the responses to those. The requests themselves aren't recorded.

| Requests | Why |
| --- | --- |
| `x.com/i/api/graphql/…` | Timelines to filter (home, replies, search, profiles, Explore, and others) |
| `x.com/i/api/2/…` | Older timeline formats to filter, such as notifications |
| `x.com/i/api/1.1/search/typeahead.json` | Search suggestions to filter |
| `api.x.com/graphql/…`, `api.x.com/2/…` | The same APIs on X's API host (also matched on api.twitter.com) |
| `x.com/i/api/1.1/mutes/keywords/list.json` | Your muted-word list, to import it |

## Not handled

tweetmuff doesn't handle health, financial or payment, authentication, personal communications, location, or web history data. It reads no passwords, auth cookies, tokens, or request headers, doesn't touch direct messages, and keeps no list of the pages you visit.

## Stored on your device

In the extension's local storage (`chrome.storage.local`):

- Your settings (on/off, "apply to accounts you follow") and the extra muted words you add on the settings page
- The muted-word list imported from X
- A short problem log. If part of X's data looks unexpected, tweetmuff leaves that part unfiltered and saves a fixed code such as `home/entries/TypeError`, with the extension version, how often it happened, and when. It holds no messages, posts, words, links, or account details. You can see it in the Status section of the settings page, copy it to report a problem, or clear it.

A copy of your settings and words is also kept in x.com's `localStorage` (key `tweetmuff:state`), so the filter is ready as soon as the page starts loading.

## Limited Use

tweetmuff's use of the data above complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The data is used only to filter posts on X and show the extension's status. It isn't sold or transferred, isn't used for advertising or to determine creditworthiness or lending, and isn't read by anyone.

## Permissions

- `storage`: saves your settings, muted words, and problem log on your device.
- Content scripts on `https://x.com/*`: filter posts on X.

tweetmuff uses no third-party services (analytics, error reporting, advertising, or tracking) and loads no remote code.

## Deleting your data

Removing the extension deletes its local storage. The **Clear** button in the settings page's Status section deletes the problem log on its own. The copy in x.com's `localStorage` is removed when you clear site data for x.com.

## Changes

If this policy changes, this file is updated in place and the **Last updated** date above is revised. The current version is always at <https://github.com/takagiy/tweetmuff/blob/main/PRIVACY.md>.

## Contact

Issues, questions, or concerns: <https://github.com/takagiy/tweetmuff/issues>
