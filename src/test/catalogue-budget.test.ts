import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "when we put this iframe … doesn't do a shit stuck on connecting", while the same channel's own
 * page on the same site loads.
 *
 * That is not a player problem, it is a deadline problem. `/embed/<id>` wrapped the catalogue read
 * in an 8 second budget while the playlist fetch underneath it was allowed 10. On a cold instance
 * the budget always expired first, the catalogue came back empty, and the frame rendered "the
 * channel list is still loading" -- over a playlist that was arriving perfectly well. The app's own
 * page has no budget at all, which is why it loaded.
 *
 * A budget shorter than the work it wraps is not a deadline. It is a guaranteed failure.
 */

const BIG = `#EXTM3U
${Array.from({ length: 600 }, (_, i) => `#EXTINF:-1 tvg-id="c${i}" tvg-chno="${i + 1}" group-title="Movies",Channel ${i}\nhttps://cdn.example.test/${i}.m3u8`).join("\n")}
#EXTINF:-1 tvg-id="0-9-pictures" tvg-chno="2524" group-title="ZEE5 Worldwide By Premium PlugX",&Pictures By Premium PlugX
https://premiumplug.fun/tee/playlist.php/0-9-pictures.m3u8
`;

/** A playlist that takes a while, as a cold read of a 2 MB file does. */
function slowStub(delayMs: number) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const u = String(target);
      calls.push(u);
      if (u.includes("playlist.m3u")) {
        await new Promise((r) => setTimeout(r, delayMs));
        return new Response(BIG, { status: 200 });
      }
      return new Response("", { status: 403 });
    }),
  );
  return { calls };
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
  });
  return { status: res!.status, text: await res!.text() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a slow cold catalogue", () => {
  it("still resolves the channel the embed asks for", async () => {
    // Six seconds: comfortably inside the fetch timeout, comfortably past the old 8s budget --
    // the exact window in which the embed used to give up while the fetch succeeded.
    slowStub(6_000);
    const { status, text } = await get("/api/public/channels/2524");

    expect(status).toBe(200);
    expect(text).toContain("&Pictures By Premium PlugX");
    expect(text).toContain("/api/live/stream/");
  }, 20_000);

  it("and the app's own page lands on the same channel", async () => {
    slowStub(6_000);
    const embed = await get("/api/public/channels/2524");

    vi.unstubAllGlobals();
    vi.resetModules();
    slowStub(6_000);
    const byId = await get("/api/public/channels/tg%3A0-9-pictures");

    // Same channel, two addresses -- which is what "it doesn't match" was about.
    expect(byId.text).toContain("&Pictures By Premium PlugX");
    expect(embed.text).toContain("&Pictures By Premium PlugX");
  }, 30_000);

  it("reads the playlist once for concurrent requests, not once per request", async () => {
    const net = slowStub(50);
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const env = { TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u" };

    await Promise.all([
      maybeHandleLiveRequest(new Request("https://player.example/api/public/channels/2524"), env),
      maybeHandleLiveRequest(new Request("https://player.example/api/public/channels/tg%3A0-9-pictures"), env),
      maybeHandleLiveRequest(new Request("https://player.example/api/public/channels/2524"), env),
    ]);

    expect(net.calls.filter((u) => u.includes("playlist.m3u")).length).toBe(1);
  });

  it("does not touch the catalogue for a section page that fetches its own list", async () => {
    const net = slowStub(50);
    await get("/embed/tgtv");
    expect(net.calls).toHaveLength(0);
  });
});
