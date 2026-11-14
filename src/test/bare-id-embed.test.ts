import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "https://…/embed/2524 … doesn't open and keep on connecting."
 *
 * `2524` is a bare id — a channel number with no source prefix. Resolving one used to go through
 * the "all" catalogue, which is `Promise.all` over maxTV, JioTV and AK TV. maxTV's portal is
 * unreachable and walks its address candidates one after another, so the 8 second budget expired
 * with nothing to show and the frame rendered "The channel list is still loading".
 *
 * The playlist was fine the whole time. The embed was queueing behind two sources this product no
 * longer offers.
 *
 * The embed page now fetches this endpoint and plays what it returns, so the endpoint *is* the
 * contract: same resolution, same one-source rule, same single playlist read.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="0-9-pictures" tvg-chno="2524" group-title="ZEE5 Worldwide By Premium PlugX",&Pictures By Premium PlugX
https://premiumplug.fun/tee/playlist.php/0-9-pictures.m3u8
`;

/** Every host that is not the AK TV playlist fails loudly, so a wrong call path is visible. */
function stub() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const url = String(target);
      calls.push(url);
      if (url.includes("playlist.m3u")) return new Response(PLAYLIST, { status: 200 });
      if (url.includes("premiumplug.fun")) return new Response("", { status: 403 });
      // A dead maxTV portal or a refusing Jio CDN: both are what used to burn the budget.
      return new Response("", { status: 500 });
    }),
  );
  return { calls };
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
  });
  if (!res) return { status: 0, text: "", json: () => ({}) };
  return { status: res.status, text: await res.text(), json: async () => JSON.parse(await res.clone().text()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a bare channel number", () => {
  it("resolves to the channel, with a playable source", async () => {
    stub();
    const res = await get("/api/public/channels/2524");
    const body = JSON.parse(res.text) as { id: string; name: string; sources: string[] };

    expect(res.status).toBe(200);
    expect(body.id).toBe("2524");
    expect(body.name).toContain("&Pictures By Premium PlugX");
    expect(body.sources[0]).toContain("/api/live/stream/");
  });

  it("touches the AK TV playlist and nothing else", async () => {
    const net = stub();
    await get("/api/public/channels/2524");

    const hosts = net.calls.map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return u;
      }
    });
    expect(hosts).toContain("tg.example");
    expect(hosts.some((h) => h.includes("maxtv"))).toBe(false);
    expect(hosts.some((h) => h.includes("jio"))).toBe(false);
  });

  it("does it fast: one playlist read, not a chain of candidates", async () => {
    const net = stub();
    await get("/api/public/channels/2524");
    expect(net.calls.filter((u) => u.includes("playlist.m3u")).length).toBe(1);
  });

  it("resolves the same channel by its prefixed id and by name", async () => {
    stub();
    const byNumber = await get("/api/public/channels/2524");
    vi.unstubAllGlobals();
    vi.resetModules();

    stub();
    const byId = await get("/api/public/channels/tg%3A0-9-pictures");
    vi.unstubAllGlobals();
    vi.resetModules();

    stub();
    const byName = await get("/api/public/channels/pictures-by-premium-plugx");

    // Same channel through three doors. "It doesn't match" was the report.
    for (const res of [byNumber, byId, byName]) {
      expect(res.text).toContain("&Pictures By Premium PlugX");
    }
  });
});

describe("the player a host site embeds", () => {
  it("is the app's own route, not a second hand-written player", async () => {
    stub();
    const res = await get("/embed/2524");
    // The gateway declines, and the router renders the shared player component. One engine means
    // a fix cannot land in the app and miss the embed -- which is what happened twice.
    expect(res.status).toBe(0);
  });

  it("still serves the section embed as a document", async () => {
    stub();
    const res = await get("/embed/tgtv");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<!DOCTYPE html>");
  });
});
