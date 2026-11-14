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

type Body = { servedBy: string; channels: Array<{ id: string; name: string; directUrl?: string; drm?: unknown }> };

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
    {},
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

  it("falls back to GioTV when the TG playlist refuses", async () => {
    const body = await catalogue([
      ["livetgtv.lovable.app", () => new Response("nope", { status: 500 })],
      ["jstr4web.json", () => new Response(GIO_CATALOGUE, { status: 200 })],
    ]);

    expect(body.servedBy).toBe("tgtv");
    expect(body.channels[0]!.name).toBe("Sony SAB HD");
    // GioTV's entry carries ClearKeys, so it is a DASH channel, not a directUrl HLS one.
    expect(body.channels[0]!.directUrl).toBeUndefined();
    expect(body.channels[0]!.drm).toBeTruthy();
  });

  it("falls back to GioTV when the playlist answers with something that is not M3U", async () => {
    const body = await catalogue([
      ["livetgtv.lovable.app", () => new Response("<html>maintenance</html>", { status: 200 })],
      ["jstr4web.json", () => new Response(GIO_CATALOGUE, { status: 200 })],
    ]);

    expect(body.channels[0]!.name).toBe("Sony SAB HD");
  });
});
