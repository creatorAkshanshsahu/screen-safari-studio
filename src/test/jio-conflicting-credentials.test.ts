import { afterEach, describe, expect, it, vi } from "vitest";

// The app's own note describes two credentials that disagree by design:
//
//   "The playlist's #EXTHTTP cookie is a coarse token minted for the whole site; the URL
//    behind the redirect carries a token minted for that one channel and path. A player
//    that works sends both and lets the CDN choose; a CDN that rejects the coarse one
//    needs the bare request."
//
// A URL that already carries `__hdnea__` and is sent the coarse cookie as well is being
// asked to honour two credentials. That is HTTP 450. It explains both "the CDN refused
// this channel (HTTP 450)" and, on the segment side, "no video arrived": the minted
// segment URLs also carry the token, and we were sending the cookie with them too.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
#EXTHTTP:{"cookie":"__hdnea__=coarse-site-token"}
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;

const KEY = JSON.stringify({
  keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }],
});

const SIGNED = "https://jiotvpllive.cdn.jio.com/bpk-tv/143/manifest.mpd?__hdnea__=channel-specific";

const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <BaseURL>https://jiotvpllive.cdn.jio.com/bpk-tv/143/?__hdnea__=channel-specific</BaseURL>
  <Period><AdaptationSet mimeType="video/mp4"><Representation id="v1" bandwidth="800000">
    <SegmentTemplate initialization="init.mp4" media="$Number$.m4s"/>
  </Representation></AdaptationSet></Period>
</MPD>`;

type Call = { url: string; headers: Record<string, string> };

/**
 * A CDN with one rule: a signed URL must be fetched bare. Present the coarse cookie
 * alongside the URL's own token and it answers 450 -- exactly as observed.
 */
function cdn() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: u, headers });

    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) return new Response(KEY, { status: 200 });
    // The redirector mints a channel-specific token and never answers directly.
    if (u.includes("jtv1.mpd?id=143")) {
      return new Response(null, { status: 302, headers: { location: SIGNED } });
    }
    const signedUrl = u.includes("__hdnea__");
    if (signedUrl && headers["Cookie"]) {
      // Two credentials: the CDN declines to choose.
      return new Response("conflicting credentials", { status: 450 });
    }
    if (u.includes(".mpd")) {
      return new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } });
    }
    return new Response(new Uint8Array([0, 0, 0, 1]), { status: 200 });
  });
  return calls;
}

const CONFIG = { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a signed URL is fetched bare", () => {
  it("opens the manifest instead of being refused with 450", async () => {
    const calls = cdn();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/stream/jio%3A143.mpd", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    expect(res!.status).toBe(200);
    // The ladder may first try the minted address with the coarse cookie -- that is how
    // you discover it is the cookie being refused. What must exist is a request to the
    // same address carrying the token and *no* cookie.
    const bare = calls.filter((c) => c.url === SIGNED && c.headers["Cookie"] === undefined);
    expect(bare.length).toBeGreaterThan(0);
    expect(bare[0]!.headers["User-Agent"]).toBe("@allinone_reborn");
  });

  it("carries no cookie to a segment URL that has its own token", async () => {
    const calls = cdn();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const env = { ...CONFIG };
    const mpd = await (
      await maybeHandleLiveRequest(
        new Request("http://localhost/api/live/stream/jio%3A143.mpd", { headers: { host: "localhost:8080" } }),
        env,
      )
    )!.text();

    // Root-relative by design; the browser resolves it against this origin.
    const base = /<BaseURL>([^<]+)<\/BaseURL>/.exec(mpd)![1]!;
    expect(base.startsWith("/api/live/dashseg/")).toBe(true);
    const seg = await maybeHandleLiveRequest(
      new Request(`http://localhost${base}7.m4s`, { headers: { host: "localhost:8080" } }),
      env,
    );
    expect(seg!.status).toBe(200);
    const segmentCalls = calls.filter((c) => c.url.includes("7.m4s"));
    const last = segmentCalls[segmentCalls.length - 1]!;
    expect(last.url).toContain("__hdnea__");
    // This is the line that was producing a black picture.
    expect(last.headers["Cookie"]).toBeUndefined();
    expect(last.headers["User-Agent"]).toBe("@allinone_reborn");
  });

  it("still sends the playlist cookie when the target has no token of its own", async () => {
    // The plain-mpegts case: no `__hdnea__` anywhere, so the cookie is the only credential
    // and dropping it would break a source that needs it.
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (u.includes("jtv39.m3u8")) {
        return new Response(
          `#EXTM3U\n#EXTINF:-1 tvg-id="7",Plain\n#EXTHTTP:{"cookie":"__hdnea__=coarse"}\nhttps://media.example/plain.ts\n`,
          { status: 200 },
        );
      }
      seen.push(headers);
      return new Response(new Uint8Array([0, 0, 0, 1]), { status: 200 });
    });
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/stream/jio%3A7.ts", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    expect(seen.some((h) => (h["Cookie"] ?? "").includes("coarse"))).toBe(true);
  });
});
