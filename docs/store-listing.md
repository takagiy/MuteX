# Chrome Web Store Listing Notes

This document collects the information to enter in the Chrome Web Store Developer Dashboard when publishing tweetmuff. Each block is meant to be copied into the matching dashboard field.

The package itself is the `tweetmuff-vX.Y.Z.zip` that the release workflow attaches to each [GitHub release](https://github.com/takagiy/tweetmuff/releases) (see [README.md](../README.md#ci--releases)).

## Store listing

### Name

```
tweetmuff
```

### Summary (≤132 chars)

```
Hides X (Twitter) posts that contain your muted words, without a trace. Uses your existing X mute list.
```

### Detailed description

```
tweetmuff hides posts on X (formerly Twitter) that contain your muted words, for when X's own muted-word filter is not working for you.

Muted posts are removed before X's web app renders them, so there is no placeholder, no gap, and no "this post is hidden" notice. They simply never appear.

Features:
- Uses the muted words you already set on X. Open X's Settings › Muted words once and tweetmuff picks the list up, including each word's "exclude people you follow" option.
- Add extra words on the settings page. Regular expressions (/like this/) are supported.
- The popup shows only how many words are active, never the words themselves, so you don't see them every time you open it.
- Works on the home timeline, replies, "Discover more", search results and search suggestions, profiles, lists, bookmarks, notifications, trends, and Explore news cards.
- Checks the post text, long posts, quoted posts, reposted originals, and link-card titles.
- A reply thread that contains a muted word is removed as a whole, so no broken thread is left behind.
- Matching ignores case and full-width/half-width differences. English words match whole words only, so "cat" does not hide "category".
- Your own posts are never hidden.

Privacy:
- tweetmuff never sends requests to X or any other server. It only reads responses that X's own web app has already requested.
- Your muted words and settings stay on your device.
- No analytics, no tracking, no remote code.

tweetmuff is an independent project and is not affiliated with or endorsed by X Corp.

Requires Chrome 111 or newer.
```

### Category

`Social & Communication`

### Language

`English (United States)` (primary).

## Privacy

### Single purpose description

```
Hides posts on x.com that contain words the user has chosen to mute.
```

### Permission justifications

The dashboard asks for a justification for each permission and for host access.

`storage`:

```
Stores the user's settings and muted-word list (imported from the user's own X mute settings, plus any words added on the settings page) locally on the device, so the filter keeps working across browser sessions. Also keeps a short log of problems the filter ran into, as fixed codes only (affected feature, step, error type, count, date) with no page content, shown in the settings page's Status section.
```

Host access (content scripts on `https://x.com/*` and `https://twitter.com/*`):

```
The single purpose of the extension is filtering posts on X. The content scripts run only on x.com (and twitter.com, which redirects to it). They remove posts containing the user's muted words from the timeline data that X's web app has already loaded, before it is displayed. They also read the user's muted-word list when X's settings page loads it. No requests are sent to any server.
```

Use of remote code:

```
No. All code is included in the extension package. Nothing is fetched or evaluated at runtime.
```

### Data usage disclosure

Chrome Web Store policy requires disclosing data that is handled locally, even if it is never transmitted. tweetmuff never transmits anything, but it does handle the following on the device:

| Category | Collected? | What and why |
| --- | --- | --- |
| Personally identifiable information | No | |
| Website content | **Yes** | Reads and modifies X's timeline API responses in the page to remove posts that contain muted words. Reads the user's muted-word list from X's settings response and stores it locally. Reads the numeric account ID from X's `twid` cookie, only to avoid hiding the user's own posts; it is never stored or transmitted. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | Auth cookies and tokens are not used. |
| Personal communications | No | Direct messages are not touched. |
| Location | No | |
| Web history | No | |
| User activity | No | |

Certifications (tick all three):

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://github.com/takagiy/tweetmuff/blob/main/PRIVACY.md
```

The repository must stay public for this URL to work. It uses the `main` branch rather than a commit SHA, so the URL keeps working after edits.

## Distribution

- Visibility: `Public` (or `Unlisted` for a limited rollout first).
- Regions: All regions.
- Pricing: Free.

## Assets

- [x] **Screenshots** (1280×800): [`store/screenshots/1-popup.png`](../store/screenshots/1-popup.png) and [`store/screenshots/2-options.png`](../store/screenshots/2-options.png). Regenerate them with `bun install` and then `bun run store:screenshots` after changing the popup, the options page, or `store/slides.md`. They show made-up sample words, never a real mute list.
- [ ] **More screenshots** (optional, up to 5 in total): for example, a timeline before and after filtering. Use an account or test words whose timeline doesn't show other people's personal content you would not want published.
- [ ] **Small promo tile**: 440×280 PNG.
- [ ] **Marquee promo tile**: 1400×560 PNG (optional, only used for featured placement).
- [ ] **Store icon**: 128×128 PNG. `icons/128.png` can be used as-is. Google's guideline recommends 96×96 artwork with 16px of transparent padding on each side; the current icon fills almost the whole canvas.

## Release checklist

1. Bump `version` in `manifest.json` on a branch, open a PR, and merge it once CI passes.
2. Push a matching tag (`git tag vX.Y.Z` → `git push origin vX.Y.Z`). The release workflow runs the tests, checks the tag against the manifest, and attaches `tweetmuff-vX.Y.Z.zip` to the GitHub release.
3. Download that zip and upload it in the Developer Dashboard → **Package**.
4. Update the listing fields above if anything changed. In particular, update the permission justifications and the data usage disclosure whenever the manifest's permissions or the data the extension touches change.
5. Submit for review.
