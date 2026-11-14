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
