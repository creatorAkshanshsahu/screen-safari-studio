import { afterEach, describe, expect, it, vi } from "vitest";

// The TG tab used to serve GioTV's 1,176-channel catalogue, not TG's own playlist, because the
// playlist sat *behind* GioTV and GioTV never came back empty. The two are not interchangeable:
//
//   - TG playlist entries are TG's own plain-HTTPS HLS, no cookie, no DRM. `toDto` turns them
//     into a `directUrl`, which the viewer's browser plays untouched — no proxy, no token, and
//     nothing for a datacenter egress block to refuse.
//   - GioTV entries are jio CDN streams that need per-request signing in the browser, which is
//     where the TG tab started failing with "This TG TV stream was interrupted".
//
// A tab named after a source must use that source. These tests hold both directions of that.

const TG_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="tg1" group-title="Sports",Star Sports 1 Hindi (TG)
https://cdn.tgtv.example/live/ss1h/index.m3u8
#EXTINF:-1 tvg-id="tg2" group-title="News",Aaj Tak (TG)
https://cdn.tgtv.example/live/aajtak/index.m3u8
`;

const GIO_CATALOGUE = JSON.stringify([
  {
    id: "892",
    name: "Sony SAB HD",
    category: "Entertainment",
    logo: "https://cdn/892.png",
    url: "https://jiotvmblive.cdn.jio.com/bpk-tv//Sony_SAB_HD_MOB/WDVLive/index.mpd",
    keys: [{ keyId: "11112222333344445555666677778888", key: "0123456789abcdef0123456789abcdef" }],
  },
]);

type Body = {
  servedBy: string;
  channels: Array<{ id: string; name: string; directUrl?: string; drm?: unknown }>;
  tgtvError?: string | null;
};

async function catalogue(
  handlers: Array<[string, () => Response | Promise<Response>]>,
  source = "tgtv",
): Promise<Body> {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    for (const [needle, handler] of handlers) {
      if (u.includes(needle)) return handler();
    }
    return new Response("", { status: 403 });
  });
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`https://screen-safari-studio.lovable.app/api/live/channels?source=${source}&filter=all&refresh=1`),
    { TGTV_PLAYLIST_URL: "https://livetgtv.lovable.app/api/public/playlist.m3u" },
  );
  return (await res!.json()) as Body;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("TG TV catalogue source order", () => {
  it("serves the TG playlist when it and GioTV are both reachable", async () => {
    const body = await catalogue([
      ["livetgtv.lovable.app", () => new Response(TG_PLAYLIST, { status: 200 })],
      ["jstr4web.json", () => new Response(GIO_CATALOGUE, { status: 200 })],
    ]);

    expect(body.servedBy).toBe("tgtv");
    expect(body.channels[0]!.name).toBe("Star Sports 1 Hindi (TG)");
    // The playlist's own channel, playable straight from the browser.
    expect(body.channels[0]!.directUrl).toBe("https://cdn.tgtv.example/live/ss1h/index.m3u8");
    // GioTV's catalogue must not have displaced it.
    expect(body.channels.some((c) => c.name === "Sony SAB HD")).toBe(false);
  });

  /*
   * "we are only seeing the jio and old mac tv channels we don't need them"
   *
   * The fallback was the problem, not the rescue. When the playlist could not be read, the guide
   * was filled from GioTV's Jio CDN catalogue and those rows were relabelled `source: "tgtv"` --
   * so the one moment the product was broken was the moment it looked most complete, with channels
   * it does not offer and no sign that anything had failed. "The list is not empty" is not the same
   * question as "the playlist loaded".
   *
   * It is the playlist or nothing now, and the reason travels with the empty list.
   */
  it("stays empty rather than serving Jio channels under AK TV ids", async () => {
    const body = await catalogue([
      ["livetgtv.lovable.app", () => new Response("nope", { status: 500 })],
      ["jstr4web.json", () => new Response(GIO_CATALOGUE, { status: 200 })],
    ]);

    expect(body.channels).toEqual([]);
    expect(body.tgtvError).toContain("500");
  });

  it("says what came back when the host answers with something that is not an M3U", async () => {
    const body = await catalogue([
      ["livetgtv.lovable.app", () => new Response("<html>maintenance</html>", { status: 200 })],
      ["jstr4web.json", () => new Response(GIO_CATALOGUE, { status: 200 })],
    ]);

    expect(body.channels).toEqual([]);
    // The line that turns "it doesn't load" into something a person can act on.
    expect(body.tgtvError).toContain("did not return an M3U");
    expect(body.tgtvError).toContain("bytes");
    // The first line of the body, so an HTML challenge is recognisable at a glance.
    expect(body.tgtvError).toContain("<html>maintenance</html>");
  });
});
