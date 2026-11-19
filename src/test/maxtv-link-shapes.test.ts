import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "The portal accepted the request but returned no stream address for this channel. It answered:
 * Authorization failed."
 *
 * With a token that the same portal had just issued. That is not a credential problem — it is a
 * guess about *where* the panel looks for the token, and the guess was hard-coded to one place.
 * Panels exist for every position: the bearer header (what a MAG sends), the `token` cookie (the
 * older middleware), a `token` query parameter, and — the least obvious — a panel that treats any
 * `Authorization` header it did not ask for as a failed login and refuses with those exact words.
 *
 * Whatever the answer, it belongs to the shape that got it: the error has to say which positions
 * were tried and what each one said, or the next person is guessing again.
 */

type Answer = { status: number; body: string };

const ACCOUNT = {
  portal: "http://portal.example/stalker_portal/c/",
  mac: "00:1A:79:EE:03:9F",
  serial: "SERIAL1",
  deviceId: "DEVICE1",
};

const CATALOGUE = JSON.stringify({
  // A portal handle, not an address: only `create_link` turns it into a stream.
  js: { data: [{ id: "101", name: "Arena Sports", cmd: "ffrt /media/101/index.m3u8", tv_genre_id: "5" }] },
});

const LINK = "ffmpeg http://cdn.example/101/index.m3u8";

/** The answer this deployment actually got, in the shape a plain-string `js` arrives in. */
const REFUSED: Answer = { status: 200, body: JSON.stringify({ js: "Authorization failed" }) };

/**
 * A panel that accepts `create_link` only when the token is where *it* looks for it.
 *
 * `accepts` is asked of each request; anything else is refused in the deployment's own words.
 */
function stubPanel(accepts: (seen: { cookie: string; authorization: string; query: string }) => boolean) {
  const calls: string[] = [];
  const seen: Array<{ cookie: string; authorization: string; query: string }> = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
      if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (u.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
      if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
      if (u.includes("action=create_link")) {
        const headers = init?.headers ?? {};
        const look = {
          cookie: String(headers["Cookie"] ?? ""),
          authorization: String(headers["Authorization"] ?? ""),
          query: new URL(u).searchParams.get("token") ?? "",
        };
        seen.push(look);
        const answer = accepts(look);
        return new Response(answer ? JSON.stringify({ js: { cmd: LINK } }) : REFUSED.body, { status: answer ? 200 : REFUSED.status });
      }
      return new Response("", { status: 404 });
    },
  );
  return { calls, seen };
}

async function streamResponse() {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  return maybeHandleLiveRequest(new Request("http://localhost/api/live/stream/st%3A101.ts"), {
    MAXTV_PORTAL: ACCOUNT.portal,
    MAXTV_MAC: ACCOUNT.mac,
    MAXTV_SERIAL: ACCOUNT.serial,
    MAXTV_DEVICE_ID: ACCOUNT.deviceId,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a panel that will not take the token in the header", () => {
  it("finds the link anyway when the token has to be in the cookie", async () => {
    const panel = stubPanel(({ cookie }) => cookie.includes("token=T1"));
    const res = await streamResponse();
    const body = (await res!.json()) as { error?: string };
    // The media itself is not stubbed; what matters is that a link was obtained, so the failure is
    // the media host's, not the portal's.
    expect(body.error ?? "").not.toContain("no stream address");
    expect(panel.seen.some((s) => s.cookie.includes("token=T1"))).toBe(true);
  });

  it("finds the link when the panel refuses the Authorization header it never asked for", async () => {
    // This is the one that reads like a credential failure and is not: the same request without
    // the header is accepted.
    const panel = stubPanel(({ authorization }) => authorization === "");
    const res = await streamResponse();
    const body = (await res!.json()) as { error?: string };
    expect(body.error ?? "").not.toContain("no stream address");
    expect(panel.seen.some((s) => s.authorization === "")).toBe(true);
  });

  it("finds the link when the token has to be a query parameter", async () => {
    const panel = stubPanel(({ query }) => query === "T1");
    const res = await streamResponse();
    const body = (await res!.json()) as { error?: string };
    expect(body.error ?? "").not.toContain("no stream address");
    expect(panel.seen.some((s) => s.query === "T1")).toBe(true);
  });

  it("names every position it tried, and what each one answered, when none of them works", async () => {
    stubPanel(() => false);
    const res = await streamResponse();
    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { error: string };

    // The panel's sentence, not the JSON it arrived wrapped in...
    expect(body.error).toContain("It answered: Authorization failed");
    expect(body.error).not.toContain('{"js"');
    // ...and attributed: every position that was tried, so the next move is not another guess.
    expect(body.error).toContain("bearer token");
    expect(body.error).toContain("token in a cookie");
    expect(body.error).toContain("no Authorization header");
    expect(body.error).toContain("token in the query");
    expect(body.error).toContain("diagnose?source=maxtv");
    // The same sentence five times is one fact, not five.
    expect(body.error.match(/Authorization failed/g)?.length).toBe(1);
  });
  it("keeps using the shape that worked, instead of re-learning it for every channel", async () => {
    // A panel that refuses the bearer header refuses it for channel 902 as well. The second
    // channel should not spend a refused request proving what the first one already showed.
    const panel = stubPanel(({ authorization }) => authorization === "");
    await streamResponse();
    const refusedForChannelOne = panel.seen.filter((s) => s.authorization !== "").length;
    expect(refusedForChannelOne).toBeGreaterThan(0);

    await streamResponse();
    const refusedForChannelTwo = panel.seen.filter((s) => s.authorization !== "").length - refusedForChannelOne;
    expect(refusedForChannelTwo).toBe(0);
  });

  it("survives a panel that mints one token per session, and still tries the other shapes", async () => {
    /*
     * The real panel answers a second handshake with an empty `js`. Treating that as "no portal"
     * ended the ladder before it started -- the same misreading that made the diagnostic report
     * "the portal issued no token" about a portal that had just answered.
     */
    let handshakes = 0;
    vi.stubGlobal(
      "fetch",
      async (url: string, init?: { headers?: Record<string, string> }) => {
        const u = String(url);
        if (u.includes("action=handshake")) {
          handshakes += 1;
          return new Response(JSON.stringify(handshakes === 1 ? { js: { token: "T1" } } : { js: {} }), { status: 200 });
        }
        if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
        if (u.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
        if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
        if (u.includes("action=create_link")) {
          const authorization = String((init?.headers ?? {})["Authorization"] ?? "");
          return new Response(
            JSON.stringify(
              authorization === "" ? { js: { cmd: LINK } } : { js: "Authorization failed" },
            ),
            { status: 200 },
          );
        }
        return new Response("", { status: 404 });
      },
    );

    const res = await streamResponse();
    const body = (await res!.json()) as { error?: string };
    expect(body.error ?? "").not.toContain("no stream address");
    expect(body.error ?? "").not.toContain("no portal at this address");
  });
});
