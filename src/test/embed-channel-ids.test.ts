import { afterEach, describe, expect, it, vi } from "vitest";

// An embed is loaded by someone else's page, with a channel id and nothing else. Three things
// have to hold: it answers for ids from every source, it does not wait on a source it is not
// using, and it carries the pieces needed to play from the viewer's own address.

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

async function embed(id: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`https://player.example/embed/${encodeURIComponent(id)}`),
    {},
  );
  return res!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("embedding by channel id", () => {
  it("renders a player for a tg: id and never waits on maxTV", async () => {
    const net = stubNetwork();
    const res = await embed("tg:3436");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // Framing is the whole point of an embed.
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const html = await res.text();
    expect(html).toContain("Discovery Kids");
    expect(html).toContain("tg:3436");
    // The player boots from the DTO's own stream URL, so a dead source cannot stall the frame.
    expect(html).toContain("/api/live/stream/");
    expect(net.urls.some((u) => u.includes("maxtv") || u.includes("action="))).toBe(false);
  });

  it("carries a way back to the site, because the host's viewers are the point", async () => {
    stubNetwork();
    const res = await embed("tg:3436");
    const html = await res.text();

    // A real anchor, not a label: `target="_top"` is what lifts the click out of the iframe and
    // onto the host's page, which is the only navigation an embedded player may perform.
    expect(html).toMatch(/<a class="brand" href="\/" target="_top"/);
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('src="/favicon.png"');
    expect(html).toContain('alt="STREAMR"');
    // The badge must still be clickable inside a stage that ignores pointer events.
    expect(html).toMatch(/\.brand \{[^}]*pointer-events: auto/);

    // In the control row at the bottom-right, but above the loading/error overlay -- the state
    // a viewer sees when nothing else is on screen.
    const brandZ = Number(/\.brand \{[^}]*z-index: (\d+)/.exec(html)?.[1]);
    const overlayZ = Number(/\.ov \{[^}]*z-index: (\d+)/.exec(html)?.[1]);
    expect(brandZ).toBeGreaterThan(overlayZ);
    // The rows must not open their own stacking contexts, or the badge's z-index is compared
    // against its own row instead of against the overlay, and it disappears again.
    expect(html).not.toMatch(/\.top \{[^}]*z-index/);
    expect(html).not.toMatch(/\.bot \{[^}]*z-index/);
    // Bottom-right of the player: beside Fullscreen, after the transport buttons.
    const bottomBar = /<div class="bot">([\s\S]*?)<button id="fs">/.exec(html)?.[1] ?? "";
    expect(bottomBar).toContain('class="brand"');
    expect(bottomBar).toContain("STREAMR");
  });

  it("serves the whole AK TV section from one URL, without resolving anything first", async () => {
    const net = stubNetwork();
    const res = await embed("tgtv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors *");
    const html = await res.text();

    // A section page must paint instantly on someone else's site: the channel list is fetched by
    // the browser, not by this request.
    expect(net.urls).toEqual([]);
    expect(html).toContain("/api/live/channels?source=");
    expect(html).toContain('"tgtv"');
    expect(html).toContain("AK TV");
    // It selects channels by embedding the single-channel player, so branding and playback rules
    // are exactly the ones already tested above.
    expect(html).toContain('/embed/" + encodeURIComponent(ch.id)');
    expect(html).toMatch(/<a class="brand" href="[^"]*" target="_top"/);
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

  it("says a missing channel is missing, on the first frame, instead of spinning", async () => {
    // The reported URL: /embed/tg%3Aset-hd.sonyliv against a playlist that does not list it.
    // The old shell spent ~22s trying a direct connection and a probe before admitting it.
    stubNetwork();
    const res = await embed("tg:set-hd.sonyliv");
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("not in the AK TV playlist");
    expect(html).toContain("tg:set-hd.sonyliv");
    expect(html).toContain("/embed/tgtv");
    // No player shell, no probe: nothing here can ever play, so nothing may try.
    expect(html).not.toContain("/api/live/stream/");
    expect(html).not.toContain("Connecting to");
  });

  it("opens a channel by its number, because a number is what gets shared", async () => {
    stubNetwork();
    // The stubbed AK TV playlist lists exactly one channel, so it is number 1.
    const res = await embed("1");
    const html = await res.text();
    expect(html).toContain("Discovery Kids");
    expect(html).not.toContain("not in the AK TV playlist");
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
    const res = await embed("tg:discoverykids");
    const html = await res.text();
    // Present in the stubbed playlist as Discovery Kids, id tg:3436 -- the key finds it.
    expect(html).toContain("Discovery Kids");
    expect(html).not.toContain("not in the AK TV playlist");
  });

  it("still renders for an id it cannot find, so the embed never shows a blank page", async () => {
    stubNetwork();
    const res = await embed("tg:does-not-exist");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("tg:does-not-exist");
  });
});
