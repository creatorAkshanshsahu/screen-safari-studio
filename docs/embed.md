# Putting a STREAMR player on another website

## Share links look like this

```
https://PLAYER/live/143          ← one channel, by its number
https://PLAYER/live/colors-hd    ← the same channel, by name (survives playlist edits)
https://PLAYER/embed/143         ← the same channel, as a player only, for another site
```

Every channel has a **number** and a **name key**. Copying the address bar while watching a
channel gives you its own URL, and pasting it opens that channel and nothing else — the site no
longer lands on a default source.

There is one source: **AK TV**. maxTV and JioTV are gone; a request that names no source gets
AK TV.

---

Four things you can put on someone else's page, smallest effort first:

- **the AK TV section** — player *and* channel list — **one `<iframe>`, no ids**
- **one channel**, by id — one `<iframe>`
- **an in-page picker** for sites that allow scripts — one `<script>` line
- **the raw M3U**, for VLC, Kodi or TiviMate

They all play from the **viewer's own IP** where the source allows it, they work on any host
(WordPress, Wix, Shopify, Squarespace, plain HTML), and every player carries a small **STREAMR**
badge over the video that opens your site when clicked.

### Get the URLs without editing anything

Open **`/embed`** on your deployed site — e.g. `https://your-domain/embed`. That page prints every
snippet below **already pointing at the domain you opened it on**, each with a Copy button. Open
it on production and the code is production code; open it in a preview and it is preview code.
There is no `PLAYER` placeholder to edit, and no way to accidentally ship a localhost URL.

Replace `PLAYER` below with your deployed domain if you are copying from this file instead.

---

## 1. The AK TV section — player **and** channel list

One iframe. No script tag, no channel ids, nothing to configure:

```html
<iframe
  src="https://PLAYER/embed/tgtv"
  title="AK TV · STREAMR"
  width="100%"
  height="600"
  style="border:0;border-radius:12px;background:#080711"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
  referrerpolicy="no-referrer"
></iframe>
```

That renders the player above a searchable grid of every AK TV channel. Clicking a channel
loads it in the player **inside the frame** — the host page never navigates, never reloads, and
never needs to know a channel id.

Give it any width; the player keeps a 16:9 box and the list fills the rest. A good default is
`height="600"` (or `aspect-ratio` if you prefer a fixed shape).

Optional URL parameters:

| Parameter | Example | Effect |
|---|---|---|
| `filter` | `?filter=kids` | `all`, `hindi`, or `kids` |
| `channel` | `?channel=tg%3A3436` | start on a specific channel instead of the first |
| `muted` | `?muted=1` | start muted, for browsers that block unmuted autoplay |

Swap `tgtv` for `jio` or `maxtv` and the same URL works for those sections.

### If the site cannot use iframes

Most page builders (Squarespace, Notion, some WordPress themes) allow iframes but strip
`<script>`. If a site allows scripts instead, section 3 does the same thing in-page.

---

## 2. One channel

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

### Ids, and why a link can stop working

An `id` is built from the playlist's own `tvg-id` — `tg:<tvg-id>`. Playlists get re-sourced, and
when they do, those ids change. A link you shared last month can therefore point at nothing.

The player resolves **all four** of these to the same channel, so a link only has to be roughly
right:

| Form | Example |
|---|---|
| catalogue id | `tg:set-hd.sonyliv` |
| playlist id, no prefix | `set-hd.sonyliv` |
| name key (durable) | `tg:sony-set-hd` |
| the name, typed | `tg:sony set hd` |

The durable form is the **name key**, which every channel record now carries as `key`:

```
GET https://PLAYER/api/live/channels?source=tgtv&filter=all
→ { "id": "tg:1001", "key": "tg:star-plus-hd", "name": "Star Plus HD", … }
```

`/embed/tg:star-plus-hd` keeps working when `tg:1001` becomes `tg:7788`, because the key does not
depend on the playlist. Use `key` for links you expect to last.

If an id matches nothing, the player says so on the first frame and offers the channel list —
it does not sit on a spinner.

### Where the ids come from

| Form | Example |
|---|---|
| number | `143` |
| name key | `colors-hd` |
| catalogue id | `tg:3436` |

Numbers come from the playlist's `tvg-chno` when it has one, otherwise its position in the
playlist. The name key does not depend on the playlist at all, so it is the form to use for links
you expect to last.

---

## 3. In-page picker, if scripts are allowed

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

## 4. Build your own picker

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

## 5. Also an M3U playlist

For VLC, Kodi, TiviMate, or any IPTV client:

```
https://PLAYER/api/live/playlist.m3u?source=tgtv&filter=all
```

---

## The STREAMR mark

Every embedded player shows a small STREAMR badge **over the channel itself**, in the
**bottom-right corner** of the frame — above the transport bar, so it is never competing with
sound/reload/fullscreen for the same tap. The SDK picker shows one under its channel grid too.

The badge for a single channel points at **that channel's page on your site**, `/watch/<number>`,
not at the front page. A viewer who likes what they are watching lands on the channel they were
already watching.

- It is a layer of its own, above the controls, the top bar and the "Connecting…"/error overlay,
  so it stays visible while the stream is loading or when it fails — the moments when the frame
  is otherwise empty.
- Clicking it navigates with `target="_top"`: **the host's page goes to your site**, rather than
  the site loading inside the player frame.
- It renders inside the embed's own document, which is cross-origin. The host's CSS cannot hide
  it, and the host's scripts cannot remove it.
- It is chrome around *your own player*: `/embed/<channel>` mounts the same component as
  `/live/<channel>`, so a fix to playback reaches both. If the two ever disagree, that is a bug.
- It is part of the embed, not a setting, because a player on someone else's site should tell
  their viewers where it came from.

The one thing it cannot survive is the host cropping the frame with `overflow:hidden` or negative
margins. If you ever find a site doing that, the fix is commercial, not technical.

## Sound

The picture starts **on the first frame**, and it starts muted — because a muted autoplay is the one
form of autoplay no browser refuses. Waiting for a tap before showing anything is a frame that looks
broken, and asking for sound first is a frame that a phone may refuse to start at all.

Sound is negotiated immediately afterwards, from the `playing` event:

- If the browser allows it, the stream is audible within a fraction of a second and **no UI appears
  at all**. A host site that writes `allow="autoplay; fullscreen; encrypted-media; picture-in-picture"`
  usually gets this.
- If it refuses, the picture keeps playing, sound stays off, and a small **"Tap for sound"** chip
  appears in the corner. Never a veil, never a modal, never anything over the picture: one tap and
  the sound is on.

## The transport bar

The picture comes with the same bar the reference player uses, because it is the one a viewer
coming from there already knows: **play/pause · sound · quality/language · reload · fullscreen**.
Nothing beyond that — an embed is a rectangle inside your page, so there is no guide, no filter row
and no header to scroll past.

It is not an embed-only bar. `/live/<channel>` and `/watch/<channel>` mount the *same*
`LivePlayerStage`, so the player on the site and the player in your iframe cannot drift apart again:
one component, two frames.

Quality is whatever the source serves; the button doubles as the audio-language picker when the
stream carries more than one.

---

## If a channel does not play on the host site

The player says which fault it hit. The two that belong to the host page:

- **"This channel's key was…"** / black picture with no error — the source's playlist is the
  problem, not the host page. Try another channel from the same source to confirm.
- **nothing at all, blank frame** — the host is likely stripping the iframe's `allow` attribute
  or sandboxing without `allow-same-origin`. Remove the sandbox, or add
  `allow-same-origin allow-scripts allow-presentation`.

A `403` on the player itself means the host is fetching from a `file://` page or an unsecured
`http://` origin; embeds need `https`.

## The documented surface (mirrors the reference site)

Everything a host site needs, in the shape they already know from `livetgtv.lovable.app`. The kit
page at **`/embed`** shows all of it with copy buttons, written against the origin you are
reading it on — there is no domain to edit.

| What | Where |
| --- | --- |
| One channel, full page | `/watch/143` · also `/live/143` |
| One film / series episode | `/watch/<slug>` — a title is named by a slug, a channel by a number or a `tg:` key |
| One channel, embeddable | `/embed/143` |
| Player + channel list | `/embed/tgtv` |
| Channel list JSON | `/api/public/channels?category=&q=&limit=` |
| One channel JSON | `/api/public/channels/143` |

`/watch/<n>` and `/live/<n>` are the same player behind two doors: `/live/` is every link this app
has already handed out, `/watch/` is the name the reference site uses and the one its documentation
will teach people to ask for.

### `?colour=`

Add it to an embed or a watch URL to theme the player accent — the LIVE badge, focus rings, control
borders and the STREAMR pill:

```
/embed/143?colour=%23FF6600
/watch/143?colour=FF6600
```

Six hex digits, with or without `#`. Text on the accent is chosen by **contrast ratio**, not by a
luminance guess: `#FF6600` gets black text (7:1) rather than white (3:1). Without the parameter, or
with anything that is not six hex digits, the player keeps its default — a half-honoured garbage
value is a player with unreadable controls, so an invalid value is *ignored*, never coerced.

### `GET /api/public/channels`

```json
{ "count": 1,
  "channels": [
    { "id": "143", "name": "…", "category": "…", "logo": "…",
      "embed": "https://…/embed/143", "watch": "https://…/watch/143" }
  ] }
```

`id` is the channel number when the playlist gives one. Numbers are the identity in a URL because a
raw id is not unique in these playlists — the same channel is listed once per reseller category.

### `GET /api/public/channels/{id}`

```json
{ "id": "143", "name": "…", "category": "…",
  "sources": ["https://…/api/live/stream/tg%3A….m3u8"],
  "drm": { "type": "clearkey", "keyId": "…", "key": "…" },
  "embed": "…", "watch": "…", "container": "hls" }
```

- `sources[0]` is the relay: it rewrites the playlist, signs the segments and sends whatever header
  the host demands. `sources[1]`, when present, is the direct CDN address for players that can reach
  it themselves.
- `drm` appears only for encrypted channels; `keys` is included when more than one key is advertised.
- **The manifest URL is stable, the segment URLs inside it are signed per request.** Fetch a source
  just before playback rather than storing it — that is the one line of this page a host can get
  wrong in a way that looks like our bug.
- An unknown id answers `404` with the reason and a pointer to the list, because playlists get
  re-sourced and an id built from one changes when they do.
