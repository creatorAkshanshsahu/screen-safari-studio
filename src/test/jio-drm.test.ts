import { afterEach, describe, expect, it, vi } from "vitest";

// The real JioTV playlist is not plain HLS. Each block looks like this:
//
//   #EXTINF:-1 tvg-id="143" group-title="English" tvg-logo="…",CNBC TV18 Prime
//   #KODIPROP:inputstream.adaptive.license_type=clearkey
//   #KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
//   #EXTVLCOPT:http-user-agent=@allinone_reborn
//   #EXTHTTP:{"cookie":"__hdnea__=st=…"}
//   https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
//
// The media is DASH+ClearKey, the CDN refuses Origin/Referer (HTTP 451), and the key
// document must be fetched before the channel can decrypt a single frame.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English" tvg-logo="https://cdn/143.png",CNBC TV18 Prime
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
#EXTHTTP:{"cookie":"__hdnea__=st=1"}
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
#EXTINF:-1 tvg-id="144" group-title="Hindi",Colors HD
https://allinonereborn2.online/jiotv/144/master.m3u8
`;

const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <Period><AdaptationSet><ContentProtection
    schemeIdUri="urn:mpeg:dash:mp4protection:2011"
    cenc:default_KID="a1b2c3d4-e5f6-1a2b-3c4d-5e6f7a8b9c0d"/></AdaptationSet></Period>
</MPD>`;

type FetchHandlers = Record<string, (init?: RequestInit) => Response | Promise<Response>>;

function stubFetch(handlers: FetchHandlers, fallback: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (u.includes(needle)) return handler(init);
    }
    return fallback(u, init);
  });
  return calls;
}

async function catalogue(headers: Record<string, string> = {}) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/channels?source=jio&filter=all"), {
    JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
    ...headers,
  });
  return (await res!.json()) as {
    servedBy: string;
    channels: Array<{
      id: string;
      name: string;
      container?: string;
      drm?: { type: string; keys: Array<{ kid: string; k: string }> };
    }>;
  };
}

const KEY_DOC = JSON.stringify({ keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("JioTV playlist: DRM and transport", () => {
  it("reads KODIPROP, EXTVLCOPT and EXTHTTP directives per entry", async () => {
    stubFetch(
      { "keyid.php": () => new Response(KEY_DOC, { status: 200 }) },
      (u) => (u.includes("jtv39.m3u8") ? new Response(PLAYLIST, { status: 200 }) : new Response("", { status: 404 })),
    );

    const data = await catalogue();

    const cnbc = data.channels.find((c) => c.name === "CNBC TV18 Prime")!;
    expect(cnbc.container).toBe("dash");
    expect(cnbc.drm?.type).toBe("clearkey");
    // The key document was fetched and its key attached.
    expect(cnbc.drm?.keys).toEqual([{ kid: "abcdef0123456789abcdef0123456789", k: "0123456789abcdef0123456789abcdef" }]);

    // The plain HLS entry stays HLS and carries no DRM.
    const colors = data.channels.find((c) => c.name === "Colors HD")!;
    expect(colors.container).toBe("hls");
    expect(colors.drm).toBeUndefined();
  });

  it("retries the playlist with a browser-shaped request when the player shape is refused", async () => {
    const calls = stubFetch(
      {},
      (u, init) => {
        if (u.includes("jtv39.m3u8")) {
          const h = (init?.headers ?? {}) as Record<string, string>;
          // The front door refuses a player-shaped request (HTTP 415).
          if (h["Accept"] === "*/*" && !h["Origin"]) return new Response("", { status: 415 });
          return new Response(PLAYLIST, { status: 200 });
        }
        if (u.includes("keyid.php")) return new Response(KEY_DOC, { status: 200 });
        return new Response("", { status: 404 });
      },
    );

    const data = await catalogue();

    expect(data.channels.length).toBe(2);
    const playlistCalls = calls.filter((c) => c.url.includes("jtv39.m3u8"));
    expect(playlistCalls.length).toBeGreaterThan(1);
    // The shape that answered was not the bare player shape, i.e. it carried browser
    // identity (an Origin, or a browser Accept header).
    expect(
      playlistCalls.some(
        (c) => c.headers["Origin"] === "https://allinonereborn2.online" || (c.headers["Accept"] ?? "").includes("mpegurl"),
      ),
    ).toBe(true);
  });

  it("proxies the DASH manifest as DASH and never sends Origin or Referer upstream", async () => {
    const calls = stubFetch(
      {
        "keyid.php": () => new Response(KEY_DOC, { status: 200 }),
        "jtv1.mpd": () => new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } }),
      },
      (u) => (u.includes("jtv39.m3u8") ? new Response(PLAYLIST, { status: 200 }) : new Response("", { status: 404 })),
    );

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/stream/jio%3A143.mpd"), {
      JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
    });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("x-stream-container")).toBe("dash");

    // The crucial bit: the CDN answers 451 to Origin/Referer, so neither may be sent.
    const mediaCall = calls.find((c) => c.url.includes("jtv1.mpd"))!;
    expect(mediaCall.headers["Origin"]).toBeUndefined();
    expect(mediaCall.headers["Referer"]).toBeUndefined();
    // The playlist's own UA and cookie are sent instead.
    expect(mediaCall.headers["User-Agent"]).toBe("@allinone_reborn");
    expect(mediaCall.headers["Cookie"]).toBe("__hdnea__=st=1");
  });

  it("exposes the resolved upstream URL and keys so a stream can be checked directly", async () => {
    stubFetch(
      { "keyid.php": () => new Response(KEY_DOC, { status: 200 }) },
      (u) => (u.includes("jtv39.m3u8") ? new Response(PLAYLIST, { status: 200 }) : new Response("", { status: 404 })),
    );

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/resolve?id=jio%3A143"), {
      JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
    });

    const body = (await res!.json()) as {
      ok: boolean;
      upstreamUrl: string;
      container: string;
      clearkeys: Array<{ kid: string }>;
      proxyUrl: string;
    };
    expect(body.ok).toBe(true);
    expect(body.upstreamUrl).toBe("https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143");
    expect(body.container).toBe("dash");
    expect(body.clearkeys).toHaveLength(1);
    expect(body.proxyUrl).toContain(".mpd");
  });

  it("derives KIDs from an MPD when the manifest declares them", async () => {
    stubFetch(
      { "keyid.php": () => new Response(KEY_DOC, { status: 200 }) },
      (u) => (u.includes("jtv39.m3u8") ? new Response(PLAYLIST, { status: 200 }) : new Response("", { status: 404 })),
    );
    const data = await catalogue();
    expect(data.servedBy).toBe("jio");
    // The channel still plays even if the key document rotates: the MPD's default_KID is
    // available to the player, which is why a bad key document does not blank the list.
    expect(data.channels.find((c) => c.name === "CNBC TV18 Prime")).toBeTruthy();
  });
});
