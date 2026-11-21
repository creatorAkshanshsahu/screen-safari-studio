import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "maxTV returned no channels. The portal lists no channels"
 *
 * That sentence is the quietest refusal a Stalker panel makes. `{"js":{"data":[],"total_items":0}}`
 * is exactly what a portal with no channels sends — and exactly what a panel sends when it will not
 * accept the bearer header the app is using. The two are indistinguishable unless the app varies
 * the shape it presents, which it did not: the shape ladder only ran for `create_link`, so a panel
 * that wanted the token elsewhere answered the catalogue with an empty list and the app passed that
 * on as a fact about the account.
 *
 * Also pinned: when every shape is refused, the error says which and what each one answered, so the
 * next step is a decision rather than another guess.
 */

const CONFIG = {
  MAXTV_PORTAL: "http://portal.example/stalker_portal/c/",
  MAXTV_MAC: "00:1A:79:AA:BB:CC",
  MAXTV_SERIAL: "SERIAL1",
  MAXTV_DEVICE_ID: "DEVICE1",
};

const CHANNELS = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffrt /media/901", tv_genre_id: "5" }], total_items: 1 },
});
const EMPTY = JSON.stringify({ js: { data: [], total_items: 0 } });

type Headers = Record<string, string>;

/**
 * A panel that only lists channels when the token is presented the way it wants.
 *
 * `accepts` decides, from what the request actually carried.
 */
function stubPanel(accepts: (seen: Headers) => boolean, listBody = CHANNELS) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      calls.push(u);
      const headers = init?.headers ?? {};
      if (u.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
      if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [{ id: "5", title: "Sports" }] }), { status: 200 });
      if (u.includes("action=get_all_channels")) {
        return new Response(accepts(headers) ? listBody : EMPTY, { status: 200 });
      }
      if (u.includes("action=get_ordered_list")) return new Response(EMPTY, { status: 200 });
      return new Response("", { status: 404 });
    },
  );
  return { calls };
}

async function channels() {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
    CONFIG,
  );
  return (await res!.json()) as { channels: Array<{ name: string }>; sourceError: string | null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a catalogue that comes back empty", () => {
  it("is re-read with the token where this panel wants it, and lists its channels", async () => {
    // The panel ignores any Authorization header: only the bare identity gets a listing.
    stubPanel((headers) => !headers["Authorization"]);
    const body = await channels();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);
    expect(body.sourceError).toBeNull();
  });

  it("is re-read with the token in a cookie for the middleware that wants it there", async () => {
    stubPanel((headers) => String(headers["Cookie"] ?? "").includes("token=T1"));
    const body = await channels();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);
  });

  it("says which position was refused, and what each one answered, when none of them lists anything", async () => {
    stubPanel(() => false);
    const body = await channels();
    expect(body.channels).toEqual([]);
    // Still the sentence the page shows...
    expect(body.sourceError).toContain("The portal lists no channels.");
    // ...but now with the evidence, per shape, instead of the bare claim.
    expect(body.sourceError).toContain("The answer did not depend on where the token went");
    expect(body.sourceError).toContain("as a MAG — an empty list (total_items 0)");
    expect(body.sourceError).toContain("token in a cookie — an empty list (total_items 0)");
    expect(body.sourceError).toContain("no Authorization header — an empty list (total_items 0)");
  });

  it("reports what the panel said, not the silence of the spare identity it could not reach", async () => {
    // The spare identity lives at the published portal, which this network cannot reach at all.
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
      if (!String(url).startsWith("http://portal.example/")) throw new TypeError("fetch failed");
      return real(url as never, init as never);
    });
    stubPanel(() => false);
    const body = await channels();
    expect(body.sourceError).toContain("The portal lists no channels");
    expect(body.sourceError).toContain("as a MAG");
    // The false claim the spare identity used to contribute.
    expect(body.sourceError).not.toContain("no portal at this address");
  });

  it("keeps the shape that worked, so the next read asks once", async () => {
    const panel = stubPanel((headers) => !headers["Authorization"]);
    await channels();
    const learned = panel.calls.filter((u) => u.includes("action=get_all_channels")).length;
    /*
     * The first read had to find out, and there are three shapes between the standard one and the
     * one this panel accepts: a bearer header, the bare token in the same header, then the cookie
     * it wants. That is the cost of learning the panel's habit, and it is paid once.
     */
    expect(learned).toBe(3);

    const before = panel.calls.length;
    await channels();
    const second = panel.calls.slice(before).filter((u) => u.includes("action=get_all_channels")).length;
    expect(second).toBe(1);
  });
});
