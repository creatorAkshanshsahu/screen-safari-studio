import { afterEach, describe, expect, it, vi } from "vitest";

// A DASH manifest routinely repeats the same absolute reference: two Representations
// sharing one SegmentTemplate, several AdaptationSets sharing a BaseURL. String.replace
// with a string pattern replaces only the FIRST match, so every repeat kept pointing at
// the CDN. The browser then fetched those segments bare -- no User-Agent, no cookie --
// and the CDN refused them, which the player surfaced as "segments were refused" and a
// blank picture. A 405 is the same fault seen from the other side.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
#EXTHTTP:{"cookie":"__hdnea__=t"}
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;

const KEY = JSON.stringify({
  keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }],
});

// Two video Representations sharing ONE absolute media template, plus a shared BaseURL.
const MPD_SHARED = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <BaseURL>https://jiotvpllive.cdn.jio.com/bpk-tv/143/</BaseURL>
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v0" bandwidth="800000">
        <SegmentTemplate initialization="https://jiotvpllive.cdn.jio.com/bpk-tv/143/init-$RepresentationID$.m4s"
          media="https://jiotvpllive.cdn.jio.com/bpk-tv/143/$RepresentationID$-$Number$.m4s"/>
      </Representation>
      <Representation id="v1" bandwidth="2000000">
        <SegmentTemplate initialization="https://jiotvpllive.cdn.jio.com/bpk-tv/143/init-$RepresentationID$.m4s"
          media="https://jiotvpllive.cdn.jio.com/bpk-tv/143/$RepresentationID$-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a0" bandwidth="128000">
        <BaseURL>https://jiotvpllive.cdn.jio.com/bpk-tv/143/audio/</BaseURL>
        <SegmentTemplate initialization="init.m4s" media="$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function rewritten(mpd: string) {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) return new Response(KEY, { status: 200 });
    if (u.includes(".mpd")) return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
    return new Response("", { status: 404 });
  });
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/stream/jio%3A143.mpd"), {
    JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
  });
  return await res!.text();
}

describe("DASH rewrite covers every reference, not only the first", () => {
  it("leaves no CDN host anywhere in the manifest", async () => {
    const out = await rewritten(MPD_SHARED);
    // Any surviving CDN reference is a request that will be made bare and refused.
    expect(out).not.toContain("https://jiotvpllive.cdn.jio.com");
  });

  it("rewrites the shared SegmentTemplate in both Representations", async () => {
    const out = await rewritten(MPD_SHARED);
    // Two video Representations share one absolute template; the audio one is relative
    // and resolves through its own rewritten BaseURL. Neither form may reach the CDN.
    const media = out.match(/media="[^"]+"/g) ?? [];
    expect(media).toHaveLength(3);
    const absolute = media.filter((m) => m.includes("http"));
    expect(absolute).toHaveLength(2);
    for (const m of absolute) expect(m).toContain("/api/live/dashseg/");
    for (const m of media) expect(m).not.toContain("cdn.jio.com");
  });

  it("rewrites every BaseURL, including the nested one", async () => {
    const out = await rewritten(MPD_SHARED);
    const bases = [...out.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1]!);
    expect(bases).toHaveLength(2);
    for (const b of bases) expect(b).toContain("/api/live/dashseg/");
  });

  it("keeps template tokens so the player can still expand them", async () => {
    const out = await rewritten(MPD_SHARED);
    expect(out).toContain("$RepresentationID$");
    expect(out).toContain("$Number$");
  });

  it("does not corrupt a file name containing a dollar sign", async () => {
    // A function replacement prevents `$&` in a replacement being read as a backreference.
    const mpd = MPD_SHARED.replaceAll("$RepresentationID$-$Number$.m4s", "seg-$Number$.m4s");
    const out = await rewritten(mpd);
    expect(out).toContain("seg-$Number$.m4s");
    expect(out).not.toContain("https://jiotvpllive.cdn.jio.com");
  });
});
