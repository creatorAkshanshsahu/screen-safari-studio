import { afterEach, describe, expect, it, vi } from "vitest";

// Handing a DASH manifest to the browser untouched is the subtle half of the playback
// bug. A SegmentTemplate or BaseURL with an absolute URL sends the player straight to
// the CDN, where it arrives with no User-Agent — and the Jio CDN answers 451 to that.
// The manifest therefore has to be rewritten onto our own segment proxy, and the UA and
// cookie have to travel *inside* the signed token, because a <video> element cannot be
// told to send them.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC TV18 Prime
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
#EXTHTTP:{"cookie":"__hdnea__=st=1"}
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
#EXTINF:-1 tvg-id="144" group-title="Hindi",Colors HD
https://allinonereborn2.online/jiotv/144/master.m3u8
`;

const KEY_DOC = JSON.stringify({
  keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }],
});

// A manifest shaped like the ones jtv1.mpd actually serves: an absolute BaseURL, an
// absolute SegmentTemplate pair, and a segment file it expects the player to name.
const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <BaseURL>https://cdn.jio.example/live/stream143/</BaseURL>
  <Period id="1">
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="a1b2c3d4-e5f6-1a2b-3c4d-5e6f7a8b9c0d"/>
      <Representation id="v1" bandwidth="2000000" codecs="avc1.64001f" width="1280" height="720">
        <SegmentTemplate timescale="90000" duration="180000"
          initialization="https://cdn.jio.example/live/stream143/init-v1.mp4"
          media="https://cdn.jio.example/live/stream143/v1-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const CONFIG = { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" };

type Handled = { url: string; headers: Record<string, string> };

function stubFetch(mpd = MPD) {
  const calls: Handled[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) return new Response(KEY_DOC, { status: 200 });
    if (u.endsWith(".mpd") || u.includes(".mpd?")) {
      return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
    }
    if (u.endsWith(".m4s") || u.endsWith(".mp4")) {
      return new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    return new Response("", { status: 404 });
  });
  return calls;
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  return (await maybeHandleLiveRequest(new Request(`http://localhost${path}`), CONFIG))!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("DASH manifest is rewritten onto the segment proxy", () => {
  it("repoints an absolute BaseURL at our own origin", async () => {
    stubFetch();
    const res = await get("/api/live/stream/jio%3A143.mpd");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-stream-container")).toBe("dash");

    const mpd = await res.text();
    expect(mpd).not.toContain("https://cdn.jio.example");
    expect(mpd).toContain("<BaseURL>/api/live/dashseg/");
  });

  it("keeps SegmentTemplate tokens intact so the player can expand them", async () => {
    stubFetch();
    const mpd = await (await get("/api/live/stream/jio%3A143.mpd")).text();
    // If these tokens get percent-encoded or expanded server-side, the player requests
    // a literal "$Number$" segment and the channel dies after the first frame.
    expect(mpd).toContain("$Number$.m4s");
    expect(mpd).toContain("init-v1.mp4");
    expect(mpd).toContain("/api/live/dashseg/");
  });

  it("resolves a tokenised segment path back to the real CDN file", async () => {
    const calls = stubFetch();
    const mpd = await (await get("/api/live/stream/jio%3A143.mpd")).text();

    const dir = /<BaseURL>([^<]+)<\/BaseURL>/.exec(mpd)![1]!;
    // Root-relative on purpose; the browser resolves it against the manifest's origin.
    expect(dir.startsWith("/")).toBe(true);
    const path = dir;
    // The player expands $Number$ itself; we simulate its request for segment 7.
    const seg = await get(`${path}v1-7.m4s`);

    expect(seg.status).toBe(200);
    const upstream = calls.filter((c) => c.url.includes("cdn.jio.example")).pop()!;
    expect(upstream.url).toBe("https://cdn.jio.example/live/stream143/v1-7.m4s");
  });

  it("carries the playlist's User-Agent and cookie to the segment request", async () => {
    const calls = stubFetch();
    const mpd = await (await get("/api/live/stream/jio%3A143.mpd")).text();
    const seg = await get(`${/<BaseURL>([^<]+)<\/BaseURL>/.exec(mpd)![1]!}init-v1.mp4`);
    expect(seg.status).toBe(200);

    // These are the headers the CDN needs. Without them it answers 451, which is what
    // made every DASH channel look "valid" in the catalogue but dead in the player.
    const last = calls.filter((c) => c.url.includes("cdn.jio.example")).pop()!;
    expect(last.headers["User-Agent"]).toBe("@allinone_reborn");
    expect(last.headers["Cookie"]).toBe("__hdnea__=st=1");
    // Origin/Referer must stay absent: the CDN rejects them outright.
    expect(last.headers["Origin"]).toBeUndefined();
    expect(last.headers["Referer"]).toBeUndefined();
  });

  it("adds a BaseURL when the manifest omits one", async () => {
    // A relative-only MPD is otherwise resolved against /api/live/stream/..., where
    // nothing is served, so the player 404s on the first segment.
    const noBase = MPD.replace(/<BaseURL>[^<]*<\/BaseURL>/, "");
    stubFetch(noBase);
    const mpd = await (await get("/api/live/stream/jio%3A143.mpd")).text();
    expect(mpd).toContain("<BaseURL>/api/live/dashseg/");
  });

  it("refuses a segment request with a forged token", async () => {
    stubFetch();
    const res = await get("/api/live/dashseg/not-a-real-token/v1-1.m4s");
    expect(res.status).toBe(403);
  });
});
