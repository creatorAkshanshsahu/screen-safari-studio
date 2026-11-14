# Putting a STREAMR player on another website

Two things you can put on someone else's page:

- **one AK TV channel** — an `<iframe>` you can paste anywhere
- **the whole AK TV playlist**, with a search box and a channel grid — one `<script>` line

Both play from the **viewer's own IP** where the source allows it, both work on any host
(WordPress, Wix, Shopify, Squarespace, plain HTML), and both carry a small **STREAMR** mark in
the top-right corner of the player that opens your site when clicked.

Replace `PLAYER` below with your deployed domain, e.g. `streamr.lovable.app`.

---

## 1. One channel

```html
<iframe
  src="https://PLAYER/embed/tg%3A3436"
  title="Discovery Kids · STREAMR"
  width="100%"
  style="aspect-ratio:16/9;border:0;border-radius:12px;background:#000"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
  referrerpolicy="no-referrer"
></iframe>
```

Notes:

- `%3A` is the colon in the id. `tg%3A3436` and `tg:3436` both work; escaping it is only for
  strict HTML validators.
- `referrerpolicy="no-referrer"` is required for the Jio CDN, which refuses requests that carry
  a third-party referrer.
- `allow="autoplay"` lets the stream start without a click. If the browser still blocks it, add
  `?muted=1` to the `src` and the player starts muted.
- `aspect-ratio:16/9` on the iframe keeps it responsive; the player fills whatever box you give it.

### Where the ids come from

| Prefix | Source | Example |
|---|---|---|
| `tg:` | **AK TV** playlist | `tg:3436` |
| `jio:` | JioTV | `jio:143` |
| `st:` | maxTV portal | `st:1001` |

The ids are stable. They are the same in the app, in links, and in an embed, so a channel you
embed today keeps working.

---

## 2. The whole playlist, with search

One line, no build step:

```html
<div id="ak-tv"></div>
<script
  src="https://PLAYER/embed-sdk.js"
  data-target="#ak-tv"
  data-source="tgtv"
  data-filter="all"
></script>
```

That renders a 16:9 player above a searchable channel grid, and clicking a channel loads it in
the player. `data-source` accepts `tgtv` (AK TV), `jio` (JioTV), `maxtv`, or `starshare`.
`data-filter` accepts `all`, `hindi`, or `kids`.

---

## 3. Build your own picker

If the site wants its own layout, take the channel list and build it yourself:

```
GET https://PLAYER/api/live/channels?source=tgtv&filter=all
```

Each channel comes back with everything a host needs:

```json
{
  "id": "tg:3436",
  "name": "Discovery Kids",
  "category": "Kids",
  "logo": "https://…",
  "embedUrl": "https://PLAYER/embed/tg%3A3436",
  "iframeCode": "<iframe src=\"…\" …></iframe>"
}
```

`iframeCode` is ready to paste. `embedUrl` is for a player you build yourself.

Add `&q=discovery` to search server-side, or `&limit=50` to cap the list.

---

## 4. Also an M3U playlist

For VLC, Kodi, TiviMate, or any IPTV client:

```
https://PLAYER/api/live/playlist.m3u?source=tgtv&filter=all
```

---

## The STREAMR mark

Every embedded player shows a small STREAMR badge **over the channel itself**, in the top-right
corner of the video. The SDK picker shows one under its channel grid too.

- It is a layer of its own, above the controls, the top bar and the "Connecting…"/error overlay,
  so it stays visible while the stream is loading or when it fails — the moments when the frame
  is otherwise empty.
- Clicking it navigates with `target="_top"`: **the host's page goes to your site**, rather than
  the site loading inside the player frame.
- It renders inside the embed's own document, which is cross-origin. The host's CSS cannot hide
  it, and the host's scripts cannot remove it.
- It is part of the embed, not a setting, because a player on someone else's site should tell
  their viewers where it came from.

The one thing it cannot survive is the host cropping the frame with `overflow:hidden` or negative
margins. If you ever find a site doing that, the fix is commercial, not technical.

## If a channel does not play on the host site

The player says which fault it hit. The two that belong to the host page:

- **"This channel's key was…"** / black picture with no error — the source's playlist is the
  problem, not the host page. Try another channel from the same source to confirm.
- **nothing at all, blank frame** — the host is likely stripping the iframe's `allow` attribute
  or sandboxing without `allow-same-origin`. Remove the sandbox, or add
  `allow-same-origin allow-scripts allow-presentation`.

A `403` on the player itself means the host is fetching from a `file://` page or an unsecured
`http://` origin; embeds need `https`.
