import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "The stream's playlist was refused (HTTP 403)" — &Pictures HD, 2523, AK TV.
 *
 * These entries come from a third-party reshare playlist ("ZEE5 Worldwide By Premium PlugX").
 * Such hosts commonly require the referrer their own player page would send, and an M3U has a
 * standard way to say so:
 *
 *   #EXTVLCOPT:http-referrer=https://the-player.example/
 *   #EXTHTTP:{"referer":"https://the-player.example/"}
 *
 * We parsed the user agent and the cookie and dropped the referrer on the floor. A channel that
 * plays in VLC therefore answered 403 to both our relay and the viewer's browser.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="2523" tvg-chno="2523" group-title="ZEE5 Worldwide By Premium PlugX",&Pictures HD By Premium PlugX
#EXTVLCOPT:http-user-agent=PlugXPlayer/2.1
#EXTVLCOPT:http-referrer=https://premiumplugx.example/
https://cdn.premiumplugx.example/live/pictures/index.m3u8
#EXTINF:-1 tvg-id="9001" group-title="ZEE5 Worldwide By Premium PlugX",No Directive Channel
https://cdn.premiumplugx.example/live/plain/index.m3u8
`;

const MANIFEST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg-1.ts
`;

function stub(): { calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (target: string, init?: { headers?: Record<string, string> }) => {
    const u = String(target);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    if (u.includes("playlist.m3u")) return new Response(PLAYLIST, { status: 200 });
    if (u.endsWith(".m3u8")) return new Response(MANIFEST, { status: 200 });
    if (u.includes("seg-1.ts")) return new Response("SEGMENT", { status: 200 });
    return new Response("", { status: 404 });
  });
  return { calls };
}

async function openManifest(id: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`https://player.example/api/live/stream/${encodeURIComponent(id)}.m3u8`),
    { TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u" },
  );
  return { status: res!.status, body: await res!.text() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the playlist's referrer directive is honoured", () => {
  it("sends it when fetching a channel's manifest", async () => {
    const net = stub();
    await openManifest("tg:2523");

    const upstream = net.calls.find((c) => c.url.includes("cdn.premiumplugx.example/live/pictures"));
    expect(upstream).toBeDefined();
    expect(upstream!.headers["Referer"]).toBe("https://premiumplugx.example/");
    // The playlist's own UA still goes with it.
    expect(upstream!.headers["User-Agent"]).toBe("PlugXPlayer/2.1");
  });

  it("keeps it on the segments, not just the manifest", async () => {
    // A manifest that loads while its segments are refused looks exactly like a dead channel.
    const net = stub();
    const { body } = await openManifest("tg:2523");
    // The rewrite replaces every media reference with a signed root-relative path, so the
    // segment's own name is deliberately gone from the manifest.
    const segPath = /(\/api\/live\/segment\?t=[^"\s]+)/.exec(body)?.[1];
    expect(segPath).toBeDefined();

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    await maybeHandleLiveRequest(
      new Request(`https://player.example${segPath!.replace(/&amp;/g, "&")}`),
      { TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u" },
    );

    const seg = net.calls.find((c) => c.url.includes("seg-1.ts"));
    expect(seg).toBeDefined();
    expect(seg!.headers["Referer"]).toBe("https://premiumplugx.example/");
  });

  it("sends the host's own origin when the playlist declares none", async () => {
    // Never somebody else's page: the only referrer a browser could have produced for this host
    // is the host's own origin, which is also what a hotlink rule expects to see.
    const net = stub();
    await openManifest("tg:9001");
    const upstream = net.calls.find((c) => c.url.includes("/live/plain/"));
    expect(upstream).toBeDefined();
    expect(upstream!.headers["Referer"]).toBe("https://cdn.premiumplugx.example/");
  });

  it("never claims the STREAMR page as the referrer", async () => {
    const net = stub();
    await openManifest("tg:9001");
    for (const call of net.calls) {
      expect(call.headers["Referer"] ?? "").not.toContain("player.example");
    }
  });
});
