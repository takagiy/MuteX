# <img src="icons/icon.svg" width="40" height="40" alt="" align="top"> tweetmuff

[![CI](https://github.com/takagiy/tweetmuff/actions/workflows/ci.yml/badge.svg)](https://github.com/takagiy/tweetmuff/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/takagiy/tweetmuff)](https://github.com/takagiy/tweetmuff/releases/latest)

A Chrome extension that does X (Twitter) muted-word filtering on the client, for when X's own muting stops working.

Posts that contain a muted word never reach the page. tweetmuff removes them from X's API responses before the web app renders anything, so you get no placeholder, no gap, and no "this post is hidden" notice.

## Install

tweetmuff isn't on the Chrome Web Store. Install it as an unpacked extension. This works in Chrome, Edge, Brave, and other Chromium browsers.

1. Download `tweetmuff-vX.Y.Z.zip` from the [latest release](https://github.com/takagiy/tweetmuff/releases/latest).
2. Unzip it into a folder you will keep. Chrome loads the extension from that folder every time it starts.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
5. Click the tweetmuff icon, then **Open X mute settings**. When X loads that page, your muted words are imported. The popup shows only how many words are active. To see or edit the words themselves, click **Edit muted words**, which opens the settings page.

### Update

Download the new release and replace the folder's contents. Then click the reload button on the tweetmuff card in `chrome://extensions` and reload x.com. Your settings are kept.

### From source

```bash
git clone https://github.com/takagiy/tweetmuff.git
```

Load the cloned folder with **Load unpacked** as above.

## How it works

| Part | World | Role |
| --- | --- | --- |
| `src/core.js` | MAIN | Keyword matching and timeline filtering. Pure logic, also used by the tests. |
| `src/main.js` | MAIN | Hooks `XMLHttpRequest` / `fetch` at `document_start`, filters timeline responses, imports X's mute list, and runs a DOM safety net. |
| `src/bridge.js` | ISOLATED | Syncs `chrome.storage` with the page hook. Rules are mirrored to x.com's `localStorage` so they are available at page start. |
| `pages/` | – | Popup (enable toggle, word counts) and the options page (the word lists, extra local words). The popup never shows the words themselves. |

### Filtering

- Applies to GraphQL / v2 timeline responses: home, replies, search, profiles, notifications, lists, bookmarks, trends, and Explore news cards. It also covers search-box suggestions (topics, hashtags, and events; accounts are left alone, the same as X's own mute).
- Each timeline entry is checked for every tweet inside it: the post text (including long-form note text), quoted posts, retweeted originals, link-card titles and descriptions, and article titles.
- If any tweet in a conversation module (a reply thread) matches, the whole module is dropped, so no broken thread line is left behind. In list-style modules such as **Discover more** under a post, only the matching posts are removed. If none are left, the whole section is removed so no bare header remains.
- Cursor entries are always kept, so infinite scroll keeps working.
- Your own posts are never hidden.
- The DOM safety net hides any rendered tweet or trend that still matches. It only matters if X introduces a response shape the filter doesn't recognize.

### Matching

- Matching ignores case and goes through Unicode NFKC normalization, so full-width `ＣＡＴ` matches `cat`.
- Keywords that start or end with ASCII letters get word boundaries. For example, `cat` matches `catで` and `#cat` but not `category`.
- Japanese and other non-ASCII keywords match as substrings, the same way X matches them.
- `t.co` URLs are ignored, so a random short link can't trigger a match.
- Expired keywords (`valid_until`) are skipped.
- Extra local words can be written as `/regex/`.

### Importing from X

- tweetmuff never sends requests to X's API itself. It only reads responses that X's own web app has already requested.
- Whenever X fetches your mute list (`/i/api/1.1/mutes/keywords/list.json`, for example on Settings › Muted words), tweetmuff reads that response and saves the list.
- To refresh after editing muted words on X or in the app, open the muted words settings page again. The popup's **Open X mute settings** button does this.
- X's per-word "exclude people you follow" option is respected. The popup and the settings page have a switch to apply all words to followed accounts as well.

## Privacy

tweetmuff sends nothing anywhere. Your muted words and settings stay on your device. See [PRIVACY.md](PRIVACY.md).

## Development

```bash
bun test
bun scripts/check-manifest.js
```

### Chrome Web Store

The store screenshots in `store/screenshots/` are built from `store/slides.md` (a [Marp](https://marp.app/) deck) and live captures of the popup and the options page, shown with made-up sample words. To rebuild them, run the following (Chrome must be installed; set `CHROME_PATH` if it isn't found):

```bash
bun install
```

```bash
bun run store:screenshots
```

[docs/store-listing.md](docs/store-listing.md) has the text for every Developer Dashboard field: listing, permission justifications, data usage disclosure, and privacy policy URL. It also has the list of assets to prepare and the store release checklist. The zip to upload is the one the release workflow attaches to each GitHub release.

### CI / releases

- **CI** (`.github/workflows/ci.yml`) runs the tests and the manifest check on every push to `main` and on every pull request.
- **Release** (`.github/workflows/release.yml`) runs when a `v*` tag is pushed. It runs the tests and checks that the tag matches `manifest.json`'s `version`. Then it zips the extension files and publishes a GitHub release with that zip attached.

To cut a release, bump `version` in `manifest.json`, commit, and push a matching tag. For example:

```bash
git tag v1.0.1
```

```bash
git push origin v1.0.1
```

The tests run against synthetic payloads shaped like X's timeline and mute-list responses (`test/fixtures.js`). No real account data is checked in.

`test/harness/index.html` is a browser harness. Run `bun test/build-harness.js` to generate its payloads and copy the scripts, then serve `test/harness/` and open the page. It checks XHR (text and JSON), fetch, the passive import, and the DOM safety net.

## License

[MIT](LICENSE)
