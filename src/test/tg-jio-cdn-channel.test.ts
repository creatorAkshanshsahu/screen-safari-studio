import { afterEach, describe, expect, it, vi } from "vitest";

// Reported from the deployed preview:
//
//   GET /api/live/stream/tg%3A3436.mpd
//   { "ok": false, "error": "Upstream stream returned HTTP 450" }
//
// 450 is a Jio CDN refusal. A `tg:` channel only reaches one when its playlist entry points at
// a Jio CDN address rather than TG's own host — which is exactly how the kids channels are
// listed. Proxying that can never work: the CDN refuses the worker's egress address, while it
// sends `Access-Control-Allow-Origin: *` to the viewer's browser.
//
// So the route must not spend a round trip being refused. It reports the refusal and hands
// over the recipe it could not use, and the player plays that directly.

const TG_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="3436" group-title="Kids",Discovery Kids
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key={"keys":[{"kty":"oct","kid":"aa11bb22cc33dd44ee55ff6677889900","k":"00112233445566778899aabbccddeeff"}]}
https://jiotvmblive.cdn.jio.com/bpk-tv/3436/Discovery_Kids/index.mpd
#EXTINF:-1 tvg-id="3467" group-title="Kids",Nick Jr
https://cdn.tgtv.example/live/nickjr/index.m3u8
`;

type Calls = { urls: string[] };

function stubNetwork(): Calls {
  const calls: Calls = { urls: [] };
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    calls.urls.push(u);
    if (u.includes("livetgtv.lovable.app")) return new Response(TG_PLAYLIST, { status: 200 });
    return new Response("", { status: 403 });
  });
  return calls;
}

async function open(id: string, ext = "mpd") {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`http://localhost/api/live/stream/${encodeURIComponent(id)}.${ext}?probe=1`),
    {},
  );
  return res!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a TG channel that lives on the Jio CDN", () => {
  it("reports the 450 without proxying, and returns the recipe to play it directly", async () => {
    const calls = stubNetwork();

    const res = await open("tg:3436");
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      code?: number;
      directPlay?: { url: string; container: string; clearKeys: Record<string, string>; cookie: string };
    };

    /*
     * A probe is a question, so the answer is a 200 carrying a verdict -- not a 5xx. The player
     * still gets the refusal and the recipe; what it no longer gets is an editor dev overlay
     * claiming the app crashed, painted over a page that is working. The header is what proves
     * the answer came from us rather than from the platform's proxy giving up.
     */
    expect(res.status).toBe(200);
    expect(res.headers.get("x-stream-verdict")).toBe("unavailable");
    expect(body.code).toBe(502);
    expect(body.error).toContain("450");
    // The browser is told to fetch the CDN address itself, with the channel's own keys.
    expect(body.directPlay?.url).toBe(
      "https://jiotvmblive.cdn.jio.com/bpk-tv/3436/Discovery_Kids/index.mpd",
    );
    expect(body.directPlay?.container).toBe("dash");
    expect(body.directPlay?.clearKeys["aa11bb22cc33dd44ee55ff6677889900"]).toBe(
      "00112233445566778899aabbccddeeff",
    );
    // The point: no request was ever made to the CDN from the worker.
    expect(calls.urls.some((u) => u.includes("cdn.jio.com"))).toBe(false);
  });

  it("hands over the recipe when any host refuses, not only a known Jio one", async () => {
    // "Sonic Digital By Premium PlugX" answered 475 from a host that is not Jio's CDN. Guessing
    // hostnames means the next reshare breaks the same way, so the refusal itself is the signal.
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("livetgtv.lovable.app")) {
        return new Response(
          `#EXTM3U\n#EXTINF:-1 tvg-id="9" group-title="Kids",Sonic Digital By Premium PlugX\nhttps://edge.premiumplugx.example/kids/sonic.mpd\n`,
          { status: 200 },
        );
      }
      return new Response("", { status: 475 });
    });

    const res = await open("tg:9");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-stream-verdict")).toBe("unavailable");
    const body = (await res.json()) as {
      error: string;
      code?: number;
      directPlay?: { url: string };
    };
    expect(body.code).toBe(502);
    expect(body.error).toContain("475");
    expect(body.directPlay?.url).toBe("https://edge.premiumplugx.example/kids/sonic.mpd");
  });

  it("still proxies a TG channel that is on TG's own host", async () => {
    const calls = stubNetwork();
    // `cdn.tgtv.example` is not a Jio CDN, so the worker path is still correct for it.
    await open("tg:3467", "m3u8");
    expect(calls.urls.some((u) => u.includes("cdn.tgtv.example"))).toBe(true);
  });

  it("offers the playlist entry as a direct candidate for the same channel", async () => {
    stubNetwork();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/direct-config?id=tg%3A3436&name=Discovery%20Kids"),
      {},
    );
    const body = (await res!.json()) as {
      candidates: Array<{ label: string; url: string; clearKeys: Record<string, string> }>;
    };
    const own = body.candidates.find((c) => c.url.includes("3436/Discovery_Kids"));
    expect(own).toBeTruthy();
    expect(own!.clearKeys["aa11bb22cc33dd44ee55ff6677889900"]).toBe(
      "00112233445566778899aabbccddeeff",
    );
  });
});
