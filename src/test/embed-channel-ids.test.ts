import { afterEach, describe, expect, it, vi } from "vitest";

// An embed is loaded by someone else's page, with a channel id and nothing else. Three things
// have to hold: it answers for ids from every source, it does not wait on a source it is not
// using, and it carries the pieces needed to play from the viewer's own address.
//
// What changed: `/embed/<id>` is no longer a server-rendered document. The gateway declines it and
// the router renders the app's own player, which asks this endpoint who the channel is. So the
// resolution questions moved here, and the chrome questions moved to embed-player-surface.test.tsx.

const TG_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="3436" group-title="Kids",Discovery Kids
https://cdn.tgtv.example/live/discoverykids/index.m3u8
`;

function stubNetwork(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("livetgtv.lovable.app")) return new Response(TG_PLAYLIST, { status: 200 });
    return new Response("", { status: 403 });
  });
  return { urls };
}

type Body = Record<string, unknown> & { error?: string; sources?: string[]; name?: string; number?: number };

async function api(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  // No env override: the stub answers the default AK TV playlist address, which is the one a
  // deployed instance reads when nobody configures anything.
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {});
  if (!res) return { status: 0, body: {} as Body };
  return { status: res.status, body: (await res.json()) as Body };
}

async function embed(id: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`https://player.example/embed/${encodeURIComponent(id)}`),
    {},
  );
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("embedding by channel id", () => {
  it("is the app's own route, so it cannot drift from the app's own player", async () => {
    stubNetwork();
    // Declining is the fix: there is one engine, and the router is what renders it. A second
    // hand-written player is exactly how `/embed/2524` came to sit on "connecting" while
    // `/live/tg:0-9-pictures` played the same channel.
    expect(await embed("tg:3436")).toBeNull();
  });

  it("hands the player a tg: channel with a playable source, and never waits on maxTV", async () => {
    const net = stubNetwork();
    const { status, body } = await api("/api/public/channels/tg%3A3436");

    expect(status).toBe(200);
    expect(body.name).toBe("Discovery Kids");
    // The player boots from this URL, so a dead source cannot stall the frame.
    expect(body.sources?.[0]).toContain("/api/live/stream/");
    expect(net.urls.some((u) => u.includes("maxtv") || u.includes("action="))).toBe(false);
  });

  it("serves the whole AK TV section from one URL, without resolving anything first", async () => {
    const net = stubNetwork();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = (await maybeHandleLiveRequest(new Request("https://player.example/embed/tgtv"), {}))!;
    expect(res.status).toBe(200);
    // Framing is the whole point of an embed.
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const html = await res.text();

    // A section page must paint instantly on someone else's site: the channel list is fetched by
    // the browser, not by this request.
    expect(net.urls).toEqual([]);
    expect(html).toContain("/api/live/channels?source=");
    expect(html).toContain('"tgtv"');
    expect(html).toContain("AK TV");
    // It selects channels by embedding the single-channel player, so playback and branding rules
    // are the app's, not a second copy's.
    expect(html).toContain('/embed/\" + encodeURIComponent(ch.id)');
  });

  it("builds copy-paste snippets from the address the page is served on", async () => {
    // A friend wants a production URL to paste. The snippet must carry the origin the reader is
    // actually looking at, so there is no placeholder to edit and no way to ship localhost.
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = (await maybeHandleLiveRequest(new Request("https://streamr.example/embed"), {}))!;
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://streamr.example/embed/tgtv");
    expect(html).toContain("https://streamr.example/embed-sdk.js");
    expect(html).toContain("https://streamr.example");
    expect(html).not.toContain("PLAYER");
    expect(html).toContain("Copy");
  });

  it("says a missing channel is missing, and says what to do about it", async () => {
    // The reported URL: /embed/tg%3Aset-hd.sonyliv against a playlist that does not list it.
    // Nothing here can ever play, so the answer is a 404 with the reason in it -- not a spinner.
    stubNetwork();
    const { status, body } = await api("/api/public/channels/tg%3Aset-hd.sonyliv");
    expect(status).toBe(404);
    expect(body.error).toContain("No channel matches");
    expect(body.error).toContain("tg:set-hd.sonyliv");
    // The remedy, in the same breath: an upstream status is never reported bare.
    expect(body.error).toContain("/api/public/channels");
  });

  it("opens a channel by its number, because a number is what gets shared", async () => {
    stubNetwork();
    // The stubbed AK TV playlist lists exactly one channel, so it is number 1.
    const { status, body } = await api("/api/public/channels/1");
    expect(status).toBe(200);
    expect(body.name).toBe("Discovery Kids");
  });

  it("serves only AK TV: a request that names no source must not reach a portal", async () => {
    const net = stubNetwork();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = (await maybeHandleLiveRequest(
      new Request("https://player.example/api/live/channels"),
      {},
    ))!;
    const json = (await res.json()) as { channels: Array<{ source: string; key: string; number?: number }> };
    expect(json.channels.length).toBeGreaterThan(0);
    expect(json.channels.every((c) => c.source === "tgtv")).toBe(true);
    // Every channel is individually addressable and numbered.
    expect(json.channels[0]!.key).toBe("tg:discovery-kids");
    expect(json.channels[0]!.number).toBe(1);
    expect(net.urls.some((u) => u.includes("action="))).toBe(false);
  });

  it("still resolves a channel the playlist spells with a provider suffix", async () => {
    stubNetwork();
    // Present in the stubbed playlist as Discovery Kids, id tg:3436 -- the key finds it.
    const { status, body } = await api("/api/public/channels/tg%3Adiscoverykids");
    expect(status).toBe(200);
    expect(body.name).toBe("Discovery Kids");
  });
});
