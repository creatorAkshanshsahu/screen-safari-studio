/**
 * The playlists, and reading one in the browser that asked for it.
 *
 * Two of the products this app carries are plain M3U files, not portals: a list of addresses, no
 * device, no token, no handshake. That should make them the *easiest* source to read, and for a
 * long time it was the opposite here -- the relay asked, and the host answered the relay with a
 * robot check, because it serves browsers and the relay is not one.
 *
 * So the browser asks. It is the only client in this conversation that the host recognises, and
 * the addresses in a playlist are addresses it can open directly. When even the browser's own
 * request is refused (a `file:` open, a CORS header the host does not send), the viewer can hand
 * the file over instead: a paste box for the playlist text, which no host policy can block.
 */

export type PlaylistId = "tg" | "tatatv";

export interface PlaylistSource {
  id: PlaylistId;
  label: string;
  /** The address the seller publishes. The first of {@link urls}; kept for links and reports. */
  url: string;
  /**
   * Every address this tab will try, in order.
   *
   * The seller publishes a main link and a list of backups, and says the important thing plainly:
   * "if one playlist doesn't work, try another". That is a rule the page can follow without being
   * told which one is down today — and doing it here is the difference between a tab that works
   * and a tab that says "could not be read" about the one address it happened to pick.
   */
  urls: string[];
  /** What this list is, in one line, for the tab that shows it. */
  note: string;
}

/**
 * The seller's own links, from the announcement that accompanies them.
 *
 * `still-haze-50d5.lindahicks827.workers.dev` and `tghub.lindahicks827.workers.dev` are the
 * published backups; `hjh-545.pages.dev` is the one this app shipped as its default for months, so
 * it is known to have served a list. The order is deliberate: the address that serves a file at a
 * path ending in `.m3u` first, because a bare host is as often a web page as a playlist.
 */
const TG_LINKS = [
  "https://hjh-545.pages.dev/",
  "https://tghub.lindahicks827.workers.dev/",
  "https://still-haze-50d5.lindahicks827.workers.dev/playlist.m3u",
  "https://still-haze-50d5.lindahicks827.workers.dev/",
];

const TATATV_LINKS = [
  "https://allinonereborn2.online/playlist/ttv6t.m3u",
  ...TG_LINKS,
];

export const PLAYLISTS: PlaylistSource[] = [
  {
    id: "tg",
    label: "tg",
    url: TG_LINKS[0]!,
    urls: TG_LINKS,
    note: "the tg playlist",
  },
  {
    id: "tatatv",
    label: "tatatv",
    url: TATATV_LINKS[0]!,
    urls: TATATV_LINKS,
    note: "the tatatv playlist",
  },
];

export function findPlaylist(id: string | null | undefined): PlaylistSource | null {
  if (!id) return null;
  return PLAYLISTS.find((p) => p.id === id) ?? null;
}

/** One line of an M3U: where the channel is, and what to call it. */
export interface PlaylistEntry {
  name: string;
  url: string;
  logo: string;
  group: string;
}

const ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

function attrsOf(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(line); m; m = ATTR.exec(line)) {
    out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

/**
 * Read an M3U into entries.
 *
 * Deliberately forgiving: a `#EXTINF` line's attributes are a convention, not a grammar, and the
 * sellers' files disagree about them. What matters is that a line which is not a comment and looks
 * like an address becomes a channel, named by the `#EXTINF` above it or by the address itself.
 */
export function parsePlaylist(text: string): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  const seen = new Set<string>();
  let pending: { name: string; logo: string; group: string } | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const attrs = attrsOf(line);
      // The name is whatever follows the last comma of the tag, minus the attributes.
      const comma = line.lastIndexOf(",");
      const label = comma >= 0 ? line.slice(comma + 1).trim() : "";
      pending = {
        name: label || attrs["tvg-name"] || attrs["tvg-id"] || "",
        logo: attrs["tvg-logo"] ?? "",
        group: attrs["group-title"] ?? "",
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!/^[a-z0-9+.-]+:\/\//i.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    const name = pending?.name || decodeURIComponent(line.split("/").pop()?.split("?")[0] || "") || line;
    out.push({ name, url: line, logo: pending?.logo ?? "", group: pending?.group ?? "" });
    pending = null;
  }
  return out;
}

/** Whether a body is a playlist at all, rather than the page a host served instead of one. */
export function looksLikePlaylist(text: string): boolean {
  const head = text.trimStart();
  return head.startsWith("#EXTM3U") || head.startsWith("#EXTINF") || /\n#EXTINF/i.test(head.slice(0, 4000));
}

/**
 * Reading a public playlist through a proxy, when the host will not answer this page.
 *
 * A seller's playlist URL is a public file — no token, no account, nothing secret in it — so routing
 * the read through somebody else's server gives away nothing that is not already on a poster. What
 * it buys is the one thing the page cannot do for itself: a different address on the internet, and
 * with it a chance the host does not refuse this particular client.
 *
 * It is a fallback and it says so: the tab reports which link answered, so a proxy that works is
 * visible rather than silent. Nothing with credentials ever goes through here — the panels are not
 * public files and are never proxied.
 */
export const PLAYLIST_PROXIES: Array<(url: string) => string> = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

/** Whether an address is safe to hand a third party: public, no credentials, no query token. */
export function isPublicPlaylistUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    // A query string is where sellers put the buyer's key (`?token=…`, `/playlist/abc.m3u`).
    // A path segment is fine; a secret in the query is not.
    return !parsed.search || !/(token|key|pass|auth|user|mac|login)/i.test(parsed.search);
  } catch {
    return false;
  }
}
