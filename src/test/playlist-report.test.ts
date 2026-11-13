import { afterEach, describe, expect, it, vi } from "vitest";

// The playlist lives on someone else's server, and "Channel not found" is the least useful
// answer possible: it is identical whether the playlist refused us, moved to another
// number, or simply does not list that id. The report says which happened, per address and
// per header shape, which is the only way to diagnose it from a browser.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const CONFIG = { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" };

describe("the playlist reports its own refusal", () => {
  it("names the status and the address when nothing answers", async () => {
    vi.stubGlobal("fetch", async () => new Response("blocked", { status: 403 }));
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");

    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/manifest?id=jio%3A143", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    // The lookup fails, and the answer explains why rather than only that it failed.
    const body = (await res!.json()) as {
      ok: boolean;
      playlist?: { ok: boolean; attempts: Array<{ url: string; status: number; sniff: string }>; error: string };
    };
    expect(body.ok).toBe(false);
    expect(body.playlist?.ok).toBe(false);
    expect(body.playlist?.error).toContain("403");
    expect(body.playlist?.attempts.length).toBeGreaterThan(0);
    expect(body.playlist?.attempts[0]!.url).toContain("jtv");
    expect(body.playlist?.attempts[0]!.status).toBe(403);
    // The body it got back is kept: "blocked" here tells us it was not a CDN refusal page.
    expect(body.playlist?.attempts[0]!.sniff).toBe("blocked");
  });

  it("records the address that answered when one does", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("jtv39.m3u8")) return new Response("gone", { status: 404 });
      if (String(url).endsWith("jtv40.m3u8")) {
        return new Response(
          `#EXTM3U\n#EXTINF:-1 tvg-id="143",CNBC\nhttps://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143\n`,
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    });
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=jio", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const report = (await (
      await maybeHandleLiveRequest(
        new Request("http://localhost/api/live/diagnose?id=jio%3A143", { headers: { host: "localhost:8080" } }),
        CONFIG,
      )
    )!.json()) as {
      playlist?: { ok: boolean; winner: string | null; entries: number; attempts: Array<{ status: number }> };
    };
    expect(report.playlist?.ok).toBe(true);
    expect(report.playlist?.winner).toContain("jtv40");
    expect(report.playlist?.entries).toBe(1);
    // The 404 from the pinned number is remembered, so the drift is visible not implied.
    expect(report.playlist?.attempts.some((a) => a.status === 404)).toBe(true);
  });
});
