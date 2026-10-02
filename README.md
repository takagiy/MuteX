# MuteX

A Chrome extension that does X (Twitter) muted-word filtering on the client, for when X's own muting stops working.

Posts that contain a muted word never reach the page. MuteX removes them from X's API responses before the web app renders anything, so you get no placeholder, no gap, and no "this post is hidden" notice.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open or reload x.com. Your muted words are imported automatically.

## How it works

| Part | World | Role |
| --- | --- | --- |
| `src/core.js` | MAIN | Keyword matching and timeline filtering. Pure logic, also used by the tests. |
| `src/main.js` | MAIN | Hooks `XMLHttpRequest` / `fetch` at `document_start`, filters timeline responses, imports X's mute list, and runs a DOM safety net. |
| `src/bridge.js` | ISOLATED | Syncs `chrome.storage` with the page hook. Rules are mirrored to x.com's `localStorage` so they are available at page start. |
| `popup/` | – | Enable toggle, sync status, extra local words. |

### Filtering

- Applies to GraphQL / v2 timeline responses: home, replies, search, profiles, notifications, lists, bookmarks, and trends.
- Each timeline entry is checked for every tweet inside it: the post text (including long-form note text), quoted posts, retweeted originals, link-card titles and descriptions, and article titles.
- If any tweet in a conversation module matches, the whole module is dropped, so no broken thread line is left behind.
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

- **Active:** on page load, MuteX calls `GET /i/api/1.1/mutes/keywords/list.json` with the same auth headers X's own requests use. This happens at most every 30 minutes, after you edit muted words on X, or when you click **Sync now**.
- **Passive:** whenever X itself fetches the mute list (for example on Settings › Muted words), MuteX captures that response too.
- X's per-word "exclude people you follow" option is respected. The popup has a switch to apply all words to followed accounts as well.

## Development

```bash
bun test
```

The tests run against synthetic payloads shaped like X's timeline and mute-list responses (`test/fixtures.js`). No real account data is checked in.

`test/harness/index.html` is a browser harness. Run `bun test/build-harness.js` to generate its payloads and copy the scripts, then serve `test/harness/` and open the page. It checks XHR (text and JSON), fetch, the passive import, and the DOM safety net.
