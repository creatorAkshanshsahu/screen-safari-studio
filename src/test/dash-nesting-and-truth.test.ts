import { afterEach, describe, expect, it, vi } from "vitest";

// Two faults that both produced the same sentence, and neither of which was the sentence.
//
// 1. Nested BaseURLs were each resolved against the manifest URL instead of their parent,
//    so `<BaseURL>143/</BaseURL>` + `<BaseURL>video/</BaseURL>` became `video/` rather
//    than `143/video/`. Every segment then pointed at a directory that does not exist.
//
// 2. The diagnostic counted only requests that reached the proxy. A segment we refused
//    ourselves was invisible, so a refusal was reported as "the player requested no
//    segments at all" -- the opposite of what happened.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143",CNBC
#EXTVLCOPT:http-user-agent=@allinone_reborn
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;

const NESTED = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <BaseURL>https://cdn.example/143/</BaseURL>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <BaseURL>video/</BaseURL>
      <Representation id="v1" bandwidth="800000">
        <SegmentTemplate initialization="init.mp4" media="$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <BaseURL>audio/</BaseURL>
      <Representation id="a1" bandwidth="128000">
        <SegmentTemplate initialization="init.mp4" media="$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

type Call = { url: string; headers: Record<string, string> };

function stub(mpd = NESTED, opts: { refuseManifest?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    if (u.includes(".m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes(".mpd")) {
      if (opts.refuseManifest) return new Response("", { status: 450 });
      return new Response(mpd, { status: 200, headers: { "content-type": "application/dash+xml" } });
    }
    return new Response(new Uint8Array([1]), { status: 200 });
  });
  return calls;
}

const CONFIG = { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("nested BaseURLs resolve against their parent", () => {
  it("keeps the MPD-level directory when an AdaptationSet adds one", async () => {
    stub();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const mpd = await (
      await maybeHandleLiveRequest(
        new Request("http://localhost/api/live/stream/jio%3A143.mpd", { headers: { host: "localhost:8080" } }),
        CONFIG,
      )
    )!.text();

    // Each AdaptationSet now has its own tokenised directory; both must carry the MPD
    // level path, so fetching a segment lands on /143/video/... and /143/audio/...
    const bases = [...mpd.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1]!);
    expect(bases.length).toBe(3);
    expect(new Set(bases).size).toBeGreaterThan(1);
  });

  it("fetches a video segment from the nested directory, not the bare one", async () => {
    const calls = stub();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const mpd = await (
      await maybeHandleLiveRequest(
        new Request("http://localhost/api/live/stream/jio%3A143.mpd", { headers: { host: "localhost:8080" } }),
        CONFIG,
      )
    )!.text();

    // The first AdaptationSet's BaseURL is the one whose segments must carry video/.
    const bases = [...mpd.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1]!);
    const seg = await maybeHandleLiveRequest(
      new Request(`http://localhost${bases[1]}7.m4s`, { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    expect(seg!.status).toBe(200);
    const upstream = calls.filter((c) => c.url.includes("cdn.example")).pop()!;
    // The parent directory survived the nesting.
    expect(upstream.url).toContain("/143/");
    expect(upstream.url).toMatch(/\/143\/(video|audio)\//);
  });
});

describe("the diagnostic never claims the player asked for nothing when it did", () => {
  it("records a segment it refuses itself", async () => {
    stub();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    // Populate the catalogue so the channel exists.
    await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=jio", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    // A forged token is refused by us, before any upstream request is made.
    const refused = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/dashseg/forged-token/7.m4s", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    expect(refused!.status).toBe(403);

    const report = (await (
      await maybeHandleLiveRequest(
        new Request("http://localhost/api/live/diagnose?id=jio%3A143", { headers: { host: "localhost:8080" } }),
        CONFIG,
      )
    )!.json()) as { recentSegments: Array<{ status: number }> };
    // The refusal is visible, so the page can say "refused" instead of "nothing requested".
    expect(report.recentSegments.length).toBeGreaterThan(0);
    expect(report.recentSegments.some((s) => s.status === 403)).toBe(true);
  });
});
