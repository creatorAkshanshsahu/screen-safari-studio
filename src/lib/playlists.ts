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
  /** The address the seller publishes. */
  url: string;
  /** What this list is, in one line, for the tab that shows it. */
  note: string;
}

export const PLAYLISTS: PlaylistSource[] = [
  {
    id: "tg",
    label: "tg",
    url: "https://hjh-545.pages.dev/",
    note: "the tg playlist",
  },
  {
    id: "tatatv",
    label: "tatatv",
    url: "https://allinonereborn2.online/playlist/ttv6t.m3u",
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
