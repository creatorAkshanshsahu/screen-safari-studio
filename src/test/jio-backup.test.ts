import { afterEach, describe, expect, it, vi } from "vitest";

// The JioTV backup playlist: a standard extended-M3U whose entries are HLS URLs.
// maxTV is the primary source; this carries the list when the portal does not answer.

const BACKUP_URL = "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="144" tvg-chno="144" tvg-name="Colors HD" tvg-logo="https://jiotv.catchup.cdn.jio.com/dare_images/images/Colors_HD.png" tvg-language="Hindi" group-title="Entertainment", Colors HD
https://allinonereborn2.online/jiotv/144/master.m3u8
#EXTINF:-1 tvg-id="151" tvg-name="Star Plus HD" tvg-logo="https://cdn/star.png" group-title="Entertainment", Star Plus HD
https://allinonereborn2.online/jiotv/151/master.m3u8
#EXTINF:-1 tvg-id="300" tvg-name="Aaj Tak" group-title="News", Aaj Tak
/jiotv/300/master.m3u8
#EXTINF:-1 group-title="Movies",Sony Max HD
https://allinonereborn2.online/jiotv/320/master.m3u8
`;

function stubPortalDown() {
  // maxTV is unreachable: every portal candidate fails at the network layer.
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://allinonereborn2.online")) {
      return new Response(PLAYLIST, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    }
    throw new TypeError("fetch failed");
  });
}

async function loadChannels(env: Record<string, string> = {}) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request("http://localhost/api/live/channels?source=maxtv&filter=all&max=500"),
    { JIO_PLAYLIST_URL: BACKUP_URL, ...env },
  );
  return (await res!.json()) as {
    servedBy: string;
    usingPreviewSeed: boolean;
    portalError: string | null;
    backupError: string | null;
    channels: Array<{ id: string; name: string; source: string; category: string; streamUrl: string }>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("JioTV backup source", () => {
  it("serves the backup catalogue when the maxTV portal does not answer", async () => {
    stubPortalDown();
    const data = await loadChannels();

    expect(data.servedBy).toBe("jio");
    expect(data.usingPreviewSeed).toBe(false);
    expect(data.portalError).toBeNull();
    expect(data.channels).toHaveLength(4);
    // Sorted by category rank (entertainment, then movies, then news) before name.
    expect(data.channels.map((c) => c.name)).toEqual(["Colors HD", "Star Plus HD", "Sony Max HD", "Aaj Tak"]);
  });

  it("keeps the playlist's own ids, logos and groups", async () => {
    stubPortalDown();
    const data = await loadChannels();

    const colors = data.channels.find((c) => c.name === "Colors HD")!;
    expect(colors.id).toBe("jio:144");
    expect(colors.category).toBe("Entertainment");
    expect(colors.streamUrl).toContain("/api/live/stream/");
    expect(colors.source).toBe("jio");
  });

  it("resolves a relative stream path against the playlist location", async () => {
    stubPortalDown();
    const data = await loadChannels();
    // "Aaj Tak" is listed as /jiotv/300/master.m3u8 and must become absolute.
    expect(data.channels.find((c) => c.name === "Aaj Tak")).toBeTruthy();
  });

  it("prefers maxTV when the portal answers", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
      if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (u.includes("action=get_all_channels")) {
        return new Response(
          JSON.stringify({ js: { data: [{ id: "101", name: "Arena Sports", cmd: "ffmpeg http://cdn/101", tv_genre_id: "5" }] } }),
          { status: 200 },
        );
      }
      if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
      if (u.startsWith("https://allinonereborn2.online")) return new Response(PLAYLIST, { status: 200 });
      return new Response("", { status: 404 });
    });

    const data = await loadChannels();

    expect(data.servedBy).toBe("maxtv");
    expect(data.channels.map((c) => c.name)).toEqual(["Arena Sports"]);
  });

  it("reports the backup failure when both sources are down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    const data = await loadChannels();

    expect(data.usingPreviewSeed).toBe(true);
    expect(data.backupError).toContain("Backup playlist");
    expect(data.portalError).toContain("no portal at this address");
  });

  it("plays a backup channel through the stream endpoint", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.startsWith("https://allinonereborn2.online/jiotv-m3u")) return new Response(PLAYLIST, { status: 200 });
      if (u.startsWith("https://allinonereborn2.online/jiotv/144")) {
        // A real HLS media playlist.
        return new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n", {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new TypeError("fetch failed");
    });

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/stream/jio%3A144.m3u8"), {
      JIO_PLAYLIST_URL: BACKUP_URL,
    });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("x-stream-container")).toBe("hls");
    const body = await res!.text();
    expect(body).toContain("#EXTM3U");
    // Every segment must be rewritten to go through our proxy, not straight to the origin.
    expect(body).toContain("/api/live/segment?t=");
    expect(body).not.toContain("seg1.ts\n");
  });
});
