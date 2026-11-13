import { afterEach, describe, expect, it, vi } from "vitest";

// Building the catalogue used to fetch one key document at a time, so a playlist of a
// few hundred DRM channels took as long as the sum of every round-trip. Measured at
// 6.1s for 60 channels with a 100ms RTT; the guide sat on "Loading…" throughout.

const N = 60;
const entries: string[] = ["#EXTM3U"];
for (let i = 0; i < N; i++) {
  entries.push(`#EXTINF:-1 tvg-id="${i}" group-title="Entertainment",Channel ${i}`);
  entries.push("#KODIPROP:inputstream.adaptive.license_type=clearkey");
  entries.push(`#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=${i}`);
  entries.push(`https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=${i}`);
}
const PLAYLIST = entries.join("\n");
const KEY = JSON.stringify({ keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function catalogue(delayMs: number, failKeys = false) {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) {
      if (failKeys) throw new TypeError("fetch failed");
      await new Promise((r) => setTimeout(r, delayMs));
      return new Response(KEY, { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const t0 = Date.now();
  const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/channels?source=jio&filter=all"), {
    JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
  });
  const elapsed = Date.now() - t0;
  const data = (await res!.json()) as { channels: Array<{ id: string; drm?: { keys: unknown[] } }> };
  return { data, elapsed };
}

describe("JioTV catalogue assembly", () => {
  it("fetches key documents concurrently rather than one at a time", async () => {
    const { data, elapsed } = await catalogue(100);
    expect(data.channels).toHaveLength(N);
    // Serial would be 60 x 100ms = 6s. Concurrency has to land far under that.
    expect(elapsed).toBeLessThan(3000);
  }, 60000);

  it("still resolves a key for every channel", async () => {
    const { data } = await catalogue(0);
    const withKeys = data.channels.filter((c) => c.drm?.keys?.length).length;
    expect(withKeys).toBe(N);
  }, 60000);

  it("keeps non-DRM channels out of the key round-trip entirely", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("plain.m3u8")) {
        return new Response(
          '#EXTM3U\n#EXTINF:-1 tvg-id="1" group-title="News",Plain News\nhttps://allinonereborn2.online/jiotv/1/master.m3u8\n',
          { status: 200 },
        );
      }
      if (u.includes("keyid.php")) throw new Error("should not fetch a key for a plain HLS channel");
      return new Response("", { status: 404 });
    });
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/channels?source=jio&filter=all"), {
      JIO_PLAYLIST_URL: "https://allinonereborn2.online/plain.m3u8",
    });
    const data = (await res!.json()) as { channels: Array<{ drm?: unknown; container?: string }> };
    expect(data.channels).toHaveLength(1);
    expect(data.channels[0]!.container).toBe("hls");
    expect(data.channels[0]!.drm).toBeUndefined();
  }, 60000);

  it("survives key documents that all fail", async () => {
    // One unreachable key host must not cost the viewer the whole playlist.
    const { data } = await catalogue(0, true);
    expect(data.channels).toHaveLength(N);
  }, 60000);
});
