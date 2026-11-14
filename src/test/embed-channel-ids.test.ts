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

    // Over the channel, not inside a bar. The loading/error overlay is the state a viewer sees
    // when nothing else is on screen, and it paints over anything at a lower level.
    const brandZ = Number(/\.brand \{[^}]*z-index: (\d+)/.exec(html)?.[1]);
    const overlayZ = Number(/\.ov \{[^}]*z-index: (\d+)/.exec(html)?.[1]);
    expect(brandZ).toBeGreaterThan(overlayZ);
    expect(html).toMatch(/\.brand \{[^}]*position: absolute/);
    // Directly under the stage rather than inside the top bar, which the overlay covers.
    const topBar = /<div class="top">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(topBar).not.toContain("brand");
    expect(html).toMatch(/<div class="stage" id="stage">[\s\S]*class="brand"/);
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

  it("still renders for an id it cannot find, so the embed never shows a blank page", async () => {
    stubNetwork();
    const res = await embed("tg:does-not-exist");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("tg:does-not-exist");
  });
});
