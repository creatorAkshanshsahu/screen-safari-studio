import { afterEach, describe, expect, it, vi } from "vitest";

// "The stream started but no video arrived" has a cause that has nothing to do with the
// CDN: the player asks for the manifest with a relative URL, so the manifest always
// arrives. The segment URLs *inside* it were absolute, built from whatever address the
// server believed was its own. Behind a proxy that address is frequently internal — and
// then the manifest loads, every segment points somewhere unreachable, and the picture
// stays black. Relative references cannot be wrong, because the player resolves them
// against the manifest it just fetched.

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC
#EXTVLCOPT:http-user-agent=@allinone_reborn
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;

const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <BaseURL>https://jiotvpllive.cdn.jio.com/bpk-tv/143/</BaseURL>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="v1" bandwidth="800000">
        <SegmentTemplate initialization="init-$RepresentationID$.m4s" media="$RepresentationID$-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function manifestFor(headers: Record<string, string>, url = "http://internal:3000/api/live/stream/jio%3A143.mpd") {
  vi.stubGlobal("fetch", async (target: string) => {
    const u = String(target);
    if (u.includes(".m3u8")) return new Response(PLAYLIST, { status: 200 });
    return new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } });
  });
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(url, { headers }),
    { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" },
  );
  return { status: res!.status, body: await res!.text() };
}

describe("manifest segment URLs never depend on the server guessing its own address", () => {
  it("points segments at a root-relative path", async () => {
    const { body } = await manifestFor({});
    const bases = [...body.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1]!);
    expect(bases.length).toBeGreaterThan(0);
    for (const b of bases) {
      expect(b.startsWith("/api/live/dashseg/")).toBe(true);
      // No scheme and no host: nothing to get wrong in any environment.
      expect(b).not.toContain("://");
    }
  });

  it("still refuses when the internal host is unreachable but the browser is elsewhere", async () => {
    // The server sees its own container address; the viewer is on the public domain.
    const { body } = await manifestFor({
      host: "internal:3000",
      "x-forwarded-host": "screen-safari-studio.lovable.app",
      "x-forwarded-proto": "https",
    });
    // Whatever the origin is judged to be, the manifest itself must not carry it.
    expect(body).toContain("/api/live/dashseg/");
    expect(body).not.toContain("internal:3000");
  });
});

describe("links handed to other machines use the public origin", () => {
  it("prefers the forwarded host over the internal one", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://internal:3000/api/live/channels", {
        headers: {
          host: "internal:3000",
          "x-forwarded-host": "screen-safari-studio.lovable.app",
          "x-forwarded-proto": "https",
        },
      }),
      {},
    );
    const body = (await res!.json()) as { channels: Array<{ streamUrl?: string; embedUrl?: string }> };
    const first = body.channels[0];
    expect(first?.streamUrl).toContain("https://screen-safari-studio.lovable.app");
    expect(first?.streamUrl).not.toContain("internal");
  });

  it("never emits a localhost link to a browser that is not on localhost", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost:3000/api/live/channels", {
        headers: { host: "localhost:3000", "x-forwarded-host": "telly.example", "x-forwarded-proto": "https" },
      }),
      {},
    );
    const body = (await res!.json()) as { channels: Array<{ streamUrl?: string }> };
    expect(body.channels[0]?.streamUrl).toContain("https://telly.example");
    expect(body.channels[0]?.streamUrl).not.toContain("localhost");
  });
});
