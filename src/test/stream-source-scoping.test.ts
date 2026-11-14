import { afterEach, describe, expect, it, vi } from "vitest";

// A 502 that never reaches the app handler is the platform's proxy giving up on a request.
// `"Dev server returned 502 ... before the app handler ran"` is therefore never a build error
// in the way it claims: it is a route that took too long.
//
// The route used to earn that timeout by construction. Every `jio:` and `st:` channel id was
// resolved through the `"all"` catalogue, which awaits maxTV, JioTV and TG TV together — so
// opening a JioTV channel waited on the maxTV portal, which answers eight address candidates
// at twenty seconds each when a panel hangs. An id already names its source.

const JIO_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="204" group-title="Kids",Discovery Kids
#EXTVLCOPT:http-user-agent=@allinone_reborn
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=204
`;

type Calls = { urls: string[] };

function stubNetwork(handlers: Array<[string, () => Response | Promise<Response>]>): Calls {
  const calls: Calls = { urls: [] };
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    calls.urls.push(u);
    for (const [needle, handler] of handlers) {
      if (u.includes(needle)) return handler();
    }
    return new Response("", { status: 403 });
  });
  return calls;
}

async function openStream(id: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`http://localhost/api/live/stream/${encodeURIComponent(id)}.mpd?probe=1`),
    { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" },
  );
  return res!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("stream route source scoping", () => {
  it("opens a jio: channel without consulting the maxTV portal", async () => {
    const calls = stubNetwork([
      ["jiotv-m3u", () => new Response(JIO_PLAYLIST, { status: 200 })],
      // The CDN answers; we only care that the portal was never asked.
      ["allinonereborn2.online/jiotv/", () => new Response("#EXTM3U\n", { status: 200 })],
    ]);

    await openStream("jio:204");

    const portalCalls = calls.urls.filter(
      (u) => u.includes("maxtv") || u.includes("stalker_portal") || u.includes("action="),
    );
    expect(portalCalls).toEqual([]);
  });

  it("answers 504 with a retryable message when the catalogue cannot load", async () => {
    // Nothing answers: the playlist is refused and the GioTV fallback is refused too.
    stubNetwork([]);

    const res = await openStream("jio:204");
    // 504, not 503: a 503 with an empty body is the platform's dev proxy giving up before any
    // handler ran, and the two need completely different fixes. This one came from us.
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("jio");
    expect(body.error).toContain("Press Retry");
  });

  it("still reports an unknown id as 404 when the catalogue did load", async () => {
    stubNetwork([["jiotv-m3u", () => new Response(JIO_PLAYLIST, { status: 200 })]]);

    const res = await openStream("jio:999");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Channel not found");
  });
});

describe("jioMediaType", () => {
  it("never routes a transport stream through the DASH engine", async () => {
    const { jioMediaType } = await import("@/lib/live-gateway");
    // A `.ts` address is a transport stream. Calling it `dash` made the player probe `.mpd`
    // and hand it to Shaka, which is how a working kids channel reports "DASH not playable".
    expect(jioMediaType("https://cdn.example/live/kids.ts")).toBe("mp4");
    expect(jioMediaType("https://cdn.example/live/kids.mpegts")).toBe("mp4");
    expect(jioMediaType("https://cdn.example/live/kids.m3u8")).toBe("hls");
    expect(jioMediaType("https://cdn.example/live/kids.mpd?id=4")).toBe("dash");
    // An address with no extension is still a manifest until proven otherwise.
    expect(jioMediaType("https://cdn.example/live/kids?id=4")).toBe("dash");
  });
});
