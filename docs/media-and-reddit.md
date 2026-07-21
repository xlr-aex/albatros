# Media and Reddit pipeline

Feed media is inconsistent: a thumbnail may come from an RSS extension, lazy-load attribute, resized CDN URL, HTML body or Reddit preview. Albatros resolves these sources in layers and keeps fallbacks instead of assuming one URL will always work.

## Feed parsing

`FeedParser` extracts an explicit thumbnail/enclosure when the format provides one. Otherwise it examines article HTML for the first usable image and resolves relative URLs against the article or feed URL.

Inline `data:` assets and empty placeholders are not promoted to list thumbnails. The parser preserves the article's raw HTML so richer media can still be recovered later.

## Reader HTML normalisation

Before DOMPurify and rendering, `normalizeArticleHtml()`:

1. parses the fragment with `DOMParser`;
2. resolves relative `src`, lazy-load attributes and `srcset` candidates;
3. upgrades common filename dimensions such as `photo-300x200.jpg` to the likely original URL;
4. adds `loading="lazy"`, `decoding="async"` and `referrerpolicy="no-referrer"`;
5. records the RSS thumbnail as `data-fallback-src` when a higher-resolution candidate is attempted;
6. inserts the preferred thumbnail when the body has no usable image;
7. converts Reddit player links into media placeholders instead of leaving a preview image that looks like a video.

The reader attaches a one-shot error listener to upgraded images. If the original-size candidate fails, it switches to the known thumbnail without producing an infinite retry loop.

## Image layout

Article images use their natural aspect ratio, `max-width: 100%` and automatic height. They are constrained by the reading column/display rather than stretched to a fixed square. This preserves quality when a large source exists and prevents overflow on smaller panes.

List thumbnails remain intentionally small and may use publisher-provided crops; the reader and the list therefore do not always request the same asset.

## Reddit post enrichment

RSS often contains only a preview or link. For a selected Reddit article, the reader can load the post JSON in a hidden `persist:adblock` webview and recover:

- self-text HTML;
- secure media metadata;
- Reddit video fallback/HLS URLs;
- preview/poster images.

The original RSS images are retained as rescue candidates when the JSON self-text is more complete textually but lacks media.

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

Loading HLS.js dynamically keeps the normal reader path lighter, although the production build still emits a separate sizeable HLS chunk.

## Embedded browser

The embedded webview uses `partition="persist:adblock"`. The main process enables ad/tracker blocking for that partition and scopes Reddit header rewriting to Reddit/Reddit-media URLs. Response headers that prevent framing are adjusted only for this embedded Reddit use case.

## Failure modes

| Symptom | Likely cause | Behaviour/fallback |
|---|---|---|
| Tiny or blurry reader image | Feed supplied only a resized thumbnail. | Try original-size URL, then fall back to thumbnail. |
| Image absent but list thumbnail exists | Hotlink protection, invalid lazy URL or CSP. | Inject thumbnail with no-referrer; browser action remains available. |
| Black Reddit video rectangle | Player iframe/HLS metadata unavailable or blocked. | Native HLS/HLS.js attempt, poster and browser fallback. |
| Preview shown as a still image | Reddit player link was not recognised. | Add a focused normaliser fixture/test for the new URL pattern. |
| Video has no audio | Reddit DASH/HLS source composition changed. | Prefer the HLS playlist; direct fallback video may be video-only. |

Any new media heuristic should be deterministic, preserve a fallback and include a unit test in `articleHtml.test.ts` or `FeedParser.test.ts`.
