import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Upstream stream returned HTTP 403."
 *
 * A Stalker play link is minted per play and is not meant to be kept. The catalogue behind it sits
 * in a cache for fifteen minutes, and a player may open the same channel twice, so a spent or
 * expired link is ordinary — but it arrives from the media host as 403 or 410, which reads like a
 * ban and named no host at all.
 *
 * Two things are pinned:
 *   - a refused link is replaced with a fresh one and re-opened, because that is the whole remedy;
 *   - when it still fails, the message names the host that refused, since "a spent token" and
 *     "this server's address is blocked" are fixed in opposite places.
 */

const CONFIG = {
  MAXTV_PORTAL: "http://portal.example/stalker_portal/c/",
  MAXTV_MAC: "00:1A:79:AA:BB:CC",
  MAXTV_SERIAL: "SERIAL1",
  MAXTV_DEVICE_ID: "DEVICE1",
};

const CATALOGUE = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffrt /media/901", tv_genre_id: "5" }] },
});

/**
 * A panel whose links are single-use: each `create_link` mints a new one, and the media host
 * accepts only the newest.
 */
function stubPanel(mediaStatus: (attempt: number) => number) {
  const calls: string[] = [];
  let links = 0;
  let mediaAttempts = 0;
  vi.stubGlobal(
    "fetch",
    async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
      if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (u.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
      if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
      if (u.includes("action=create_link")) {
        links += 1;
        return new Response(JSON.stringify({ js: { cmd: `ffmpeg http://cdn.example/901/token-${links}.ts` } }), { status: 200 });
      }
      if (u.startsWith("http://cdn.example/")) {
        mediaAttempts += 1;
        const status = mediaStatus(mediaAttempts);
        if (status !== 200) return new Response("no", { status });
        return new Response(new Uint8Array(188 * 4), { status: 200, headers: { "content-type": "video/mp2t" } });
      }
      return new Response("", { status: 404 });
    },
  );
  const count = (needle: string) => calls.filter((c) => c.includes(needle)).length;
  return { calls, count };
}

async function stream() {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  return maybeHandleLiveRequest(new Request("http://localhost/api/live/stream/st%3A901.ts"), CONFIG);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a play link the media host refuses", () => {
  it("is replaced with a freshly minted one, and the channel plays", async () => {
    // The first link is spent by the time the player opens it; the second is good.
    const panel = stubPanel((attempt) => (attempt === 1 ? 403 : 200));
    const res = await stream();
    expect(res!.status).toBe(200);
    expect(panel.count("action=create_link")).toBe(2);
  });

  it("names the host that refused when a fresh link is refused too", async () => {
    stubPanel(() => 403);
    const res = await stream();
    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { error: string };
    // Which host said no -- the fact that separates an expired token from a blocked address.
    expect(body.error).toContain("Upstream stream returned HTTP 403");
    expect(body.error).toContain("cdn.example");
  });

  it("does not spend a second create_link on a refusal that has nothing to do with the link", async () => {
    // 404 is "there is nothing at this address", not "your token is spent".
    const panel = stubPanel(() => 404);
    const res = await stream();
    expect(res!.status).toBe(404);
    expect(panel.count("action=create_link")).toBe(1);
  });
});
