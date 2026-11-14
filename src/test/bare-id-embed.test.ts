import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "https://…/embed/2524 … when we use this link and paste it doesn't open and keep on connecting."
 *
 * `2524` is a bare id — a channel number with no source prefix. Resolving one used to go through
 * the "all" catalogue, which is `Promise.all` over maxTV, JioTV and AK TV. maxTV's portal is
 * unreachable and walks its address candidates one after another, so the 8 second budget expired
 * with nothing to show and the frame rendered "The channel list is still loading".
 *
 * The playlist was fine the whole time. The embed was queueing behind two sources this product no
 * longer offers.
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
  return { status: res!.status, text: await res!.text() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a bare channel number in an embed URL", () => {
  it("resolves the channel instead of rendering \"the channel list is still loading\"", async () => {
    stub();
    const { text } = await get("/embed/2524");

    expect(text).not.toContain("The channel list is still loading");
    // It is a player document for the right channel.
    expect(text).toContain("&Pictures By Premium PlugX");
    expect(text).toContain('<video id="v"');
  });

  it("touches the AK TV playlist and nothing else", async () => {
    const net = stub();
    await get("/embed/2524");

    const hosts = net.calls.map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return u;
      }
    });
    // The dead portals must not be consulted at all: they are what the budget was being spent on.
    expect(hosts).toContain("tg.example");
    expect(hosts.some((h) => h.includes("maxtv"))).toBe(false);
    expect(hosts.some((h) => h.includes("jio"))).toBe(false);
  });

  it("does it fast: one playlist read, not a chain of candidates", async () => {
    const net = stub();
    await get("/embed/2524");
    expect(net.calls.filter((u) => u.includes("playlist.m3u")).length).toBeLessThanOrEqual(1);
  });

  it("still resolves the same channel by its prefixed id and by name", async () => {
    stub();
    const byId = await get("/embed/tg%3A0-9-pictures");
    expect(byId.text).toContain("&Pictures By Premium PlugX");

    vi.unstubAllGlobals();
    vi.resetModules();
    stub();
    const byName = await get("/embed/pictures-by-premium-plugx");
    expect(byName.text).toContain("&Pictures By Premium PlugX");
  });
});

describe("the notice page heals itself", () => {
  it("retries instead of telling a visitor on someone else's site to reload", async () => {
    // An empty playlist is the only thing that can produce this page now.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("#EXTM3U\n", { status: 200 })));
    const { text } = await get("/embed/2524");

    expect(text).toContain("The channel list is still loading");
    expect(text).toContain("/api/public/channels");
    expect(text).toContain("location.reload()");
    // It has to admit defeat out loud if the playlist never answers.
    expect(text).toContain("cannot load right now");
  });
});
