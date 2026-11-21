# Media and Reddit pipeline

Feeds provide images in different ways. An image can come from RSS, an HTML attribute, a resized URL, or a Reddit preview. Albatros checks these sources in order. It keeps a backup image URL when possible.

## Feed parsing

`FeedParser` uses the thumbnail or enclosure given by the feed. If the feed has none, it finds the first usable image in the article HTML. It uses the article or feed URL to complete relative URLs.

The parser does not use inline `data:` images or empty placeholders as list thumbnails. It keeps the raw article HTML so the reader can find other media later.

## Reader HTML normalisation

Before DOMPurify and rendering, `normalizeArticleHtml()`:

1. parses the fragment with `DOMParser`;
2. resolves relative `src`, lazy-load attributes and `srcset` candidates;
3. upgrades common filename dimensions such as `photo-300x200.jpg` to the likely original URL;
4. adds `loading="lazy"`, `decoding="async"` and `referrerpolicy="no-referrer"`;
5. records the RSS thumbnail as `data-fallback-src` when a higher-resolution candidate is attempted;
6. inserts the preferred thumbnail when the body has no usable image;
7. converts Reddit player links into media placeholders instead of leaving a preview image that looks like a video.

The reader checks an upgraded image once. If it fails, the reader uses the known thumbnail. It does not retry without a limit.

## Image layout

Article images keep their natural shape. They use `max-width: 100%` and automatic height. The reading column limits their size. Images do not extend beyond a narrow pane.

List thumbnails are small and can use a crop from the publisher. The list and reader can use different image URLs.

## Reddit post enrichment

Reddit RSS often contains only a preview or link. When you open a Reddit article, the reader can load post JSON in a hidden `persist:adblock` webview. It can then get:

- self-text HTML;
- secure media metadata;
- Reddit video fallback/HLS URLs;
- preview/poster images.

The reader keeps the RSS images as backup. It can use them if the JSON post has more text but no media.

## Reddit comments

`articles.getRedditComments()` validates that the target is a Reddit URL, requests the post JSON, normalises the comment tree and caches results in memory. Old cache entries are removed after the TTL window. Comment-like RSS rows are tagged internally with `enclosure_type = 'reddit-comment'` and excluded from normal feed counts/lists.

## Reddit video

Reddit-hosted video commonly separates video and audio and exposes an HLS playlist. The reader:

- lazy-imports HLS.js only when a Reddit video is present;
- uses native HLS when the browser can play it directly;
- otherwise attaches HLS.js to a standard `<video controls>` element;
- displays the recovered preview as a poster;
- destroys the HLS instance when the article changes/unmounts;
- shows a play/browser fallback when playback cannot be initialised.

The reader loads HLS.js only when needed. The production build contains a separate HLS file.

## Embedded browser

The embedded webview uses `partition="persist:adblock"`. That session carries a prebuilt EasyList + EasyPrivacy engine (network-level blocking via `onBeforeRequest`) and Reddit-specific request rewriting (clean User-Agent, normalised `Sec-Fetch-*` headers) installed by the main process at bootstrap.

Two constraints are load-bearing:

- **Cosmetic filters must stay disabled** (`loadCosmeticFilters: false` in `src/main/index.ts`). The cosmetic-filter preload injects scriptlets into every page, which violates Reddit's nonce-based CSP and leaves the webview permanently blank (ghostery/adblocker#4234). Network filtering keeps blocking ads/trackers without touching page content.
- **Electron allows only one listener per `webRequest` event.** The Reddit response-header handler registered by the app intentionally replaces the adblocker's own `onHeadersReceived`; the adblocker does not need it because cosmetic filtering is off.

Reddit serves a JavaScript challenge to first-time clients; the embedded webview solves it automatically and stores the resulting cookies in the partition. The same partition serves the hidden webview that recovers post JSON, so comments/self-text/video enrichment shares the challenge-free cookie state.

The engine cache is versioned (`adblocker-engine-v2.bin`): the engine serialises its config, so an older cache file would silently restore cosmetic filtering on load.

## Failure modes

| Symptom | Likely cause | Behaviour/fallback |
|---|---|---|
| Tiny or blurry reader image | Feed supplied only a resized thumbnail. | Try original-size URL, then fall back to thumbnail. |
| Image absent but list thumbnail exists | Hotlink protection, invalid lazy URL or CSP. | Inject thumbnail with no-referrer; browser action remains available. |
| Black Reddit video rectangle | Player iframe/HLS metadata unavailable or blocked. | Native HLS/HLS.js attempt, poster and browser fallback. |
| Preview shown as a still image | Reddit player link was not recognised. | Add a focused normaliser fixture/test for the new URL pattern. |
| Video has no audio | Reddit DASH/HLS source composition changed. | Prefer the HLS playlist; direct fallback video may be video-only. |
| Embedded Reddit page stays black/empty | Cosmetic-filter preload violating page CSP (must stay disabled) or a challenge that never solved. | Check main-process logs for CSP refusals sourced from `@cliqz/adblocker-electron`; restart to reload the engine config. |
| Reddit comments/self-text never load | Post `.json` endpoint blocked (HTTP 403) for the current session. | The hidden webview solves Reddit's challenge first; cached articles and the browser action remain available. |

When you add a media rule, make its result predictable. Keep a backup path. Add a test in `articleHtml.test.ts` or `FeedParser.test.ts`.
