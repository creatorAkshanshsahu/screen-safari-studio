import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "it's not loading our tg tv playlist, we want that it should load whenever I open the website."
 *
 * The playlist is not in memory when someone opens the site -- that is the one moment it
 * definitely is not -- and the guide used to ask exactly once. If that single read was still
 * running, or its host was slow, or the platform's proxy cut the request short, the page was told
 * nothing: an empty list, no reason, and a message saying "the playlist answered but listed
 * nothing", which was the one thing that had never happened.
 *
 * Two halves, both tested here: the relay says what it knows (`tgtvError`, `warming`) and answers
 * inside a first-paint budget; the page keeps asking until it has channels.
 */

const TG = `#EXTM3U
#EXTINF:-1 tvg-id="3146" tvg-chno="3146" group-title="Sports",All Women's Sports Network
https://tg.example/live/womens.m3u8
`;

async function get(path: string, env: Record<string, string> = {}) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
    ...env,
  });
  return { status: res!.status, text: await res!.text() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a playlist that does not arrive", () => {
  it("says why, instead of leaving the guide to guess", async () => {
    // The playlist host refuses, and the backup catalogue refuses too.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const { text } = await get("/api/live/channels?source=tgtv");
    const body = JSON.parse(text) as {
      channels: unknown[];
      tgtvError: string | null;
      warming: boolean;
    };

    expect(body.channels).toEqual([]);
    // The reason was recorded on every failed read and had no way out of the process.
    expect(body.tgtvError).toContain("503");
    // It answered. It is not still thinking.
    expect(body.warming).toBe(false);
  });

  it("answers inside its first-paint budget while the read is still running", async () => {
    // A playlist host that accepts the connection and says nothing. The read never finishes, so
    // the only thing that can end this request is the budget.
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));

    const started = Date.now();
    const { status, text } = await get("/api/live/channels?source=tgtv", { LIVE_CHANNELS_WAIT_MS: "150" });
    const elapsed = Date.now() - started;

    const body = JSON.parse(text) as { channels: unknown[]; warming: boolean };
    expect(status).toBe(200);
    expect(body.channels).toEqual([]);
    // `warming` is a promise, not an error: the page can ask again and it will land.
    expect(body.warming).toBe(true);
    expect(elapsed).toBeLessThan(4000);
  });

  it("answers exactly what the host told this server, on demand", async () => {
    /*
     * "It does not load" is four different faults wearing one sentence, and the deployed site is
     * the only place the answer exists -- a host can refuse a datacentre address and welcome a
     * browser. This endpoint asks the host again, right now, and reports what came back: status,
     * content type, size, the first line of the body, and whether the URL was one we configured or
     * our own default.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>just a moment…</html>", {
            status: 403,
            headers: { "content-type": "text/html; charset=UTF-8" },
          }),
      ),
    );

    const { status, text } = await get("/api/live/diagnose?playlist=1");
    const body = JSON.parse(text) as {
      kind: string;
      ok: boolean;
      configuredUrl: string;
      configuredFromEnv: boolean;
      attempt: { parsed: number; error: string | null };
      probe: { status: number | null; contentType: string | null; firstLine: string | null; ok: boolean };
      cache: { channels: number };
    };

    expect(status).toBe(200);
    expect(body.kind).toBe("tgtv-playlist");
    expect(body.ok).toBe(false);
    expect(body.configuredUrl).toBe("https://tg.example/playlist.m3u");
    expect(body.configuredFromEnv).toBe(true);
    expect(body.attempt.parsed).toBe(0);
    expect(body.attempt.error).toContain("403");
    // The facts that distinguish a block from an empty answer from a challenge page.
    expect(body.probe.status).toBe(403);
    expect(body.probe.contentType).toContain("text/html");
    expect(body.probe.firstLine).toContain("just a moment");
    expect(body.probe.ok).toBe(false);
    expect(body.cache.channels).toBe(0);
  });

  it("never shows maxTV channel names it cannot play", async () => {
    /*
     * The guide used to be filled from `PREVIEW_SEED_CHANNELS` whenever the maxTV portal could not
     * be read: real channel names with a `seed://` command, which is to say a guide of channels
     * that could never play and no sign that anything was wrong. That is the "old mac tv channels"
     * report. A source that cannot answer now says so with an empty list instead.
     */
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    const { text } = await get("/api/live/channels?source=maxtv&refresh=1", { MAXTV_PORTAL: "http://portal.example/c/" });
    const body = JSON.parse(text) as {
      channels: Array<{ name: string }>;
      usingPreviewSeed: boolean;
      portalError: string | null;
      maxTvConfigured: boolean;
    };

    expect(body.channels).toEqual([]);
    expect(body.usingPreviewSeed).toBe(true);
    expect(body.portalError).toBeTruthy();
  });

  it("marks a cached list as stale after its refresh fails, and withholds it once it is too old", async () => {
    /*
     * "we are having old playlist which isn't playing": the guide was serving a list from a read
     * that had since failed, with nothing on screen to say the list had stopped refreshing. A
     * cached catalogue is a kindness for a while and a trap after that -- the addresses inside a
     * playlist are tokens, and tokens expire.
     */
    const ok = vi.fn(async () => new Response(TG, { status: 200 }));
    vi.stubGlobal("fetch", ok);
    const first = JSON.parse((await get("/api/live/channels?source=tgtv&refresh=1")).text) as {
      channels: unknown[];
      stale?: boolean;
    };
    expect(first.channels).toHaveLength(1);
    expect(first.stale).toBe(false);

    // The playlist host goes down. The cached list is still young, so it is served -- flagged.
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 16 * 60 * 1000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const second = JSON.parse((await get("/api/live/channels?source=tgtv")).text) as {
      channels: unknown[];
      stale?: boolean;
      sourceError: string | null;
    };
    expect(second.channels).toHaveLength(1);
    expect(second.stale).toBe(true);
    expect(second.sourceError).toContain("503");

    // Past the window it is not a list any more, it is a wall of dead links.
    nowSpy.mockReturnValue(realNow + 90 * 60 * 1000);
    const third = JSON.parse((await get("/api/live/channels?source=tgtv")).text) as {
      channels: unknown[];
      sourceError: string | null;
    };
    expect(third.channels).toEqual([]);
    expect(third.sourceError).toContain("503");
    nowSpy.mockRestore();
  });

  it("reports the channels as soon as the playlist lands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        if (String(target).includes("tg.example")) return new Response(TG, { status: 200 });
        return new Response("", { status: 404 });
      }),
    );

    const { text } = await get("/api/live/channels?source=tgtv");
    const body = JSON.parse(text) as {
      channels: Array<{ id: string; name: string; number: number }>;
      tgtvError: string | null;
      warming: boolean;
    };

    expect(body.channels).toHaveLength(1);
    expect(body.channels[0]!.name).toBe("All Women's Sports Network");
    expect(body.tgtvError).toBeNull();
    expect(body.warming).toBe(false);
  });
});
