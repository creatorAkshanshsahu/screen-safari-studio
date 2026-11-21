/**
 * Channel directories: a page that lists channels, read where the viewer is.
 *
 * `https://allinonereborn2.online/sony/` is not a playlist and not a portal. It is a page of links:
 * each channel is an `<a>` around its logo, pointing at the seller's own player for that channel.
 * Nothing in it is a stream address, which is why no playlist reader could ever use it — the page is
 * the index, and the player behind each link is what turns a name into a picture.
 *
 * So there are two kinds of row here, and they play differently:
 *
 *   - a link that *is* a media address (`.m3u8`, `.ts`, `.mp4`) plays in this player, directly;
 *   - a link that is the seller's player page plays in a frame inside this player. Their page builds
 *     its stream address at run time from a key we are not given, so the honest way to show what it
 *     shows is to let it run — one click from the guide, in our frame, with our chrome around it.
 *
 * The frame is marked as such in the UI. A channel that needs somebody else's player is worth
 * saying out loud, because it behaves differently from one that does not.
 */

export interface ChannelDirectory {
  id: string;
  label: string;
  url: string;
  note: string;
}

export const DIRECTORIES: ChannelDirectory[] = [
  {
    id: "sony",
    label: "sony",
    url: "https://allinonereborn2.online/sony/",
    note: "the Sony directory",
  },
];

export function findDirectory(id: string | null | undefined): ChannelDirectory | null {
  if (!id) return null;
  return DIRECTORIES.find((d) => d.id === id) ?? null;
}

export interface DirectoryChannel {
  name: string;
  href: string;
  logo: string;
  /** Where this row plays: a media address, or the seller's player page in a frame. */
  play: { kind: "media"; url: string } | { kind: "frame"; url: string };
}

const MEDIA = /\.(m3u8|m3u|ts|mp4|mpd)(\?|#|$)/i;

/** A player page is any link that is not a media file: it renders a picture from its own script. */
function playbackFor(href: string): DirectoryChannel["play"] {
  return MEDIA.test(href) ? { kind: "media", url: href } : { kind: "frame", url: href };
}

/**
 * The channels on a directory page.
 *
 * Written against the shape these pages actually have -- an `<a>` wrapping the channel's logo and
 * its name -- and forgiving about the rest, because the pages are hand-made and change. A link with
 * neither a picture nor a word of text still counts if its address names the channel, which is how
 * `…?id=sony-hd` becomes "sony hd" rather than a blank row.
 */
export function parseDirectory(html: string, base: string): DirectoryChannel[] {
  const out: DirectoryChannel[] = [];
  const seen = new Set<string>();

  const absolute = (href: string): string | null => {
    try {
      return new URL(href, base).toString();
    } catch {
      return null;
    }
  };

  /** "sony-hd" / "sony_max_hd" → "Sony HD" / "Sony Max HD". */
  const nameFromHref = (href: string): string => {
    try {
      const url = new URL(href, base);
      const slug = url.searchParams.get("id") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
      const cleaned = decodeURIComponent(slug).replace(/\.(m3u8?|ts|mp4|mpd|html?)$/i, "").replace(/[-_]+/g, " ").trim();
      return cleaned ? cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "Channel";
    } catch {
      return "Channel";
    }
  };

  const push = (href: string, name: string, logo: string) => {
    const url = absolute(href);
    if (!url) return;
    if (seen.has(url)) return;
    seen.add(url);
    const label = name.trim() || nameFromHref(url);
    out.push({ name: label, href: url, logo: logo.trim(), play: playbackFor(url) });
  };

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || /^(javascript|mailto):/i.test(href)) continue;
      const img = anchor.querySelector("img");
      const name = (img?.getAttribute("alt") || anchor.textContent || "").replace(/\s+/g, " ");
      push(href, name, img?.getAttribute("src") ?? "");
    }
    return out;
  }

  // No DOM (server render, or a runtime without `DOMParser`): the same rule, read from the markup.
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchorRe.exec(html); m; m = anchorRe.exec(html)) {
    const inner = m[2] ?? "";
    const img = /<img\b[^>]*>/i.exec(inner)?.[0] ?? "";
    const logo = /src=["']([^"']+)["']/i.exec(img)?.[1] ?? "";
    const alt = /alt=["']([^"']*)["']/i.exec(img)?.[1] ?? "";
    const text = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    push(m[1]!, alt || text, logo);
  }
  return out;
}

/** Whether a body is a channel directory rather than the page a host served instead of one. */
export function looksLikeDirectory(html: string): boolean {
  return /<a\b[^>]*href=/i.test(html) && !/^<!doctype html>\s*<html>\s*<head>\s*<title>\s*(just a moment|attention required)/i.test(html.trim());
}
