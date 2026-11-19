import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The playlist format a working JioTV reshare actually uses.
 *
 * Taken from the M3U at `https://hjh-545.pages.dev/` — the source that replaced a playlist host
 * that had started answering HTTP 500. Three things about it are not what this app had been
 * written against, and each of them fails quietly if it is not understood:
 *
 *   - every URL is a redirector (`/stream?id=colorshd`) with no extension at all, which is why the
 *     container has to come from `#KODIPROP:…manifest_type=mpd` rather than from the address;
 *   - the ClearKeys are inline in `#KODIPROP:…license_key=kid:key,kid:key`, several per channel;
 *   - there is no `tvg-chno`, so channel numbers are positional.
 *
 * A channel parsed without its keys is a black frame with no error. That is the failure this pins.
 */

const PLAYLIST = `#EXTM3U url-tvg="" refresh="300"
#EXTINF:-1 tvg-id="144" tvg-logo="https://jiotv.catchup.cdn.jio.com/dare_images/images/ColorsHD.png" group-title="Entertainment",Colors HD
#KODIPROP:inputstream=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=5360e12d4bb2519a9148d1089a55908d:7e8f500cef51595f3d43acafab1a8fb4
https://hjh-545.pages.dev/stream?id=colorshd
#EXTINF:-1 tvg-id="1127" tvg-logo="https://jiotv.catchup.cdn.jio.com/dare_images/images/Star_Bharat.png" group-title="Entertainment",Star Bharat
#KODIPROP:inputstream=inputstream.adaptive
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=0c61529f49ba580287aba24a36c9374d:cce83cc814105a1e0d7749267048a3bd,eeaf18e86b23527188171820781b13ac:6ed7d4fa86e473b70c0c5bdabe51845d
https://hjh-545.pages.dev/stream?id=starbharat
`;

/** The redirector's answer: a live Jio MPD, token-signed at the moment it was asked. */
const JIO_MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <BaseURL>https://jiotvmblive.cdn.jio.com/bpk-tv/ColorsHD_MOB/WDVLive/</BaseURL>
  <Period id="0" start="PT0S">
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v1" bandwidth="1200000" codecs="avc1.4d401f" width="1280" height="720">
        <SegmentTemplate timescale="1000" initialization="init-$RepresentationID$.mp4" media="$RepresentationID$-$Number$.m4s" duration="4000" startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

function stub(handlers: Array<[string, () => Response]> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const url = String(target);
      for (const [needle, answer] of handlers) if (url.includes(needle)) return answer();
      return new Response("", { status: 404 });
    }),
  );
}

async function get(path: string, env: Record<string, string> = {}) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://hjh-545.pages.dev/",
    ...env,
  });
  return { status: res?.status ?? null, headers: res?.headers ?? null, text: res ? await res.text() : "" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a playlist whose URLs are redirectors and whose keys are inline", () => {
  it("reads the channels, their groups, and a container the URL cannot express", async () => {
    stub([["hjh-545.pages.dev", () => new Response(PLAYLIST, { status: 200 })]]);

    const { text } = await get("/api/live/channels?source=tgtv&refresh=1");
    const body = JSON.parse(text) as {
      channels: Array<{ id: string; name: string; category: string; container: string; streamUrl: string; drm?: unknown }>;
    };

    expect(body.channels.map((c) => c.name)).toEqual(["Colors HD", "Star Bharat"]);
    expect(body.channels[0]!.id).toBe("tg:144");
    expect(body.channels[0]!.category).toBe("Entertainment");
    // `/stream?id=colorshd` has no extension: the declared manifest type decides.
    expect(body.channels[0]!.container).toBe("dash");
    expect(body.channels[0]!.streamUrl).toContain("/api/live/stream/tg%3A144.mpd");
  });

  it("keeps every ClearKey pair, not just the first", async () => {
    stub([["hjh-545.pages.dev", () => new Response(PLAYLIST, { status: 200 })]]);

    const { text } = await get("/api/live/channels?source=tgtv&refresh=1");
    const body = JSON.parse(text) as {
      channels: Array<{ name: string; drm?: { type: string; keys: Array<{ kid: string; k: string }> } }>;
    };

    const colors = body.channels.find((c) => c.name === "Colors HD")!;
    expect(colors.drm?.type).toBe("clearkey");
    expect(colors.drm?.keys).toEqual([
      { kid: "5360e12d4bb2519a9148d1089a55908d", k: "7e8f500cef51595f3d43acafab1a8fb4" },
    ]);

    const bharat = body.channels.find((c) => c.name === "Star Bharat")!;
    // Five keys on one line in the real list, two here: a channel can rotate its key mid-stream.
    expect(bharat.drm?.keys).toHaveLength(2);
    expect(bharat.drm?.keys[1]).toEqual({
      kid: "eeaf18e86b23527188171820781b13ac",
      k: "6ed7d4fa86e473b70c0c5bdabe51845d",
    });
  });

  it("follows the redirector and hands back a manifest the player can walk", async () => {
    stub([
      // The redirector answers with the CDN address, minted for this request.
      [
        "hjh-545.pages.dev/stream",
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://jiotvmblive.cdn.jio.com/bpk-tv/ColorsHD_MOB/WDVLive/index.mpd?__hdnea__=token" },
          }),
      ],
      ["cdn.jio.com", () => new Response(JIO_MPD, { status: 200, headers: { "content-type": "application/dash+xml" } })],
      ["hjh-545.pages.dev", () => new Response(PLAYLIST, { status: 200 })],
    ]);

    const { status, headers, text } = await get("/api/live/stream/tg%3A144.mpd");
    expect(status).toBe(200);
    expect(headers!.get("x-stream-container")).toBe("dash");
    // Every reference points back at the relay, so the token and the request's identity survive
    // the next hop -- the player must never be handed a bare CDN address it cannot sign.
    expect(text).toContain("/api/live/dashseg/");
    expect(text).not.toContain("jiotvmblive.cdn.jio.com");
  });
  it("reads the default playlist with no configuration at all", async () => {
    // The default has moved twice: `livetgtv.lovable.app/...m3u` answered HTTP 500, then a mirror
    // answered, and now the playlist is the one the seller actually supplies. A stale default is
    // the difference between "no channels" and "plays", so the address the code ships is exercised
    // here rather than assumed.
    const { TATATV_PLAYLIST_URL } = await import("@/lib/maxtv-account");
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        seen.push(url);
        if (url.startsWith(TATATV_PLAYLIST_URL)) return new Response(PLAYLIST, { status: 200 });
        return new Response("", { status: 500 });
      }),
    );

    const { status, text } = await get("/api/live/channels?source=tgtv&refresh=1", { TGTV_PLAYLIST_URL: "" });
    expect(status).toBe(200);
    const body = JSON.parse(text) as { channels: Array<{ name: string }> };
    expect(body.channels.map((c) => c.name)).toEqual(["Colors HD", "Star Bharat"]);
    expect(seen.some((u) => u.startsWith(TATATV_PLAYLIST_URL))).toBe(true);
    expect(seen.some((u) => u.includes("livetgtv.lovable.app"))).toBe(false);
  });
});
