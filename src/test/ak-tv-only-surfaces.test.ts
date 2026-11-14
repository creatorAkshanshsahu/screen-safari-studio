import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "on playlist it shows all jio tv max tv channels we don't need that remove them."
 *
 * Two surfaces are read as a line-up: the channel list and the M3U playlist. Both accepted
 * `source=all`, which is `Promise.all` over maxTV, JioTV and AK TV, so a viewer could open the
 * playlist and find entries for two sources this product does not offer -- and no way to tell
 * which of them were supposed to work.
 *
 * AK TV is the only source. "All" means AK TV on anything a viewer or host site reads.
 */

const TG = `#EXTM3U
#EXTINF:-1 tvg-id="x-sports" tvg-chno="300" group-title="Sports",Jio Sports HD
https://tg.example/live/sports.m3u8
`;
const JIO = `#EXTM3U
#EXTINF:-1 tvg-id="204" group-title="Kids",Discovery Kids
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=204
`;
const MAX = `#EXTM3U
#EXTINF:-1 tvg-id="st-1" group-title="Movies",maxTV Movie One
http://new.maxtv.be/stream/1.ts
`;

function stub() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const u = String(target);
      calls.push(u);
      if (u.includes("tg.example")) return new Response(TG, { status: 200 });
      if (u.includes("jtv39")) return new Response(JIO, { status: 200 });
      if (u.includes("maxtv")) return new Response(MAX, { status: 200 });
      return new Response("", { status: 404 });
    }),
  );
  return { calls };
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
    JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
    MAXTV_PORTAL_URL: "http://new.maxtv.be/c/",
  });
  return { status: res!.status, text: await res!.text() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the channel list a viewer reads", () => {
  it("carries AK TV channels under source=all, and nothing else", async () => {
    stub();
    const { text } = await get("/api/live/channels?source=all&filter=all&limit=50");
    const body = JSON.parse(text) as { channels: Array<{ id: string }> };
    expect(body.channels.length).toBeGreaterThan(0);
    for (const ch of body.channels) expect(ch.id.startsWith("tg:")).toBe(true);
  });

  it("does not spend the request asking the two sources it will not show", async () => {
    const net = stub();
    await get("/api/live/channels?source=all&filter=all&limit=50");
    expect(net.calls.some((u) => u.includes("jtv39"))).toBe(false);
    expect(net.calls.some((u) => u.includes("maxtv"))).toBe(false);
  });
});

describe("the M3U playlist", () => {
  it("lists AK TV only, even when asked for everything", async () => {
    stub();
    const { text } = await get("/api/live/playlist.m3u?source=all&filter=all");
    expect(text).toContain("Jio Sports HD");
    expect(text).not.toContain("Discovery Kids");
    expect(text).not.toContain("maxTV Movie One");
    // Every id in the file names the AK TV catalogue.
    const ids = [...text.matchAll(/tvg-id="([^"]*)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith("tg:")).toBe(true);
  });

  it("is the same file whether or not a source is named", async () => {
    stub();
    const explicit = await get("/api/live/playlist.m3u?source=tgtv");
    vi.unstubAllGlobals();
    vi.resetModules();
    stub();
    const implicit = await get("/api/live/playlist.m3u");
    expect(implicit.text).toBe(explicit.text);
  });
});

describe("a retired source named by hand", () => {
  it("still answers, because it is a code path with tests, not a button", async () => {
    stub();
    const { text } = await get("/api/live/channels?source=jio&filter=all&limit=50");
    const body = JSON.parse(text) as { channels: Array<{ id: string }> };
    expect(body.channels.some((c) => c.id.startsWith("jio:"))).toBe(true);
  });
});

describe("an upstream that never answers", () => {
  it("is a refusal with a recipe, not a hung request or a 500", async () => {
    // The shape the platform proxy reports as "502 before the app handler ran": a route held open
    // by a host that accepted the connection and said nothing. The hop now has a timeout, and a
    // timeout is a refusal like any other -- the browser gets the recipe.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const u = String(target);
        if (u.includes("playlist.m3u")) return new Response(TG, { status: 200 });
        // The stream host itself: accepts the connection and says nothing.
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    );
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("https://player.example/api/live/stream/tg%3Ax-sports.m3u8"),
      { TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u" },
    );
    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { directPlay?: { url: string } };
    expect(body.directPlay?.url).toContain("tg.example");
  });
});
