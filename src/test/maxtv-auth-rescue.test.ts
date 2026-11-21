import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Two panels that say `Authorization failed.` about a live subscription, and the two ways out.
 *
 *   1. **The bare token.** `Authorization: Bearer <token>` is what a MAG sends, and a middleware
 *      that grew up around `Authorization: <token>` answers the prefix with the refusal. It was the
 *      one position this app never tried, and the report that started this was four positions
 *      answering identically -- which reads as an account problem and was a header problem.
 *   2. **The paged list.** Some panels disable the bulk `get_all_channels` for a device and serve
 *      `get_ordered_list` happily, with no reason given for the refusal. One page tells them apart;
 *      twelve would be a flood at a host that has already said no.
 */

const CONFIG = {
  MAXTV_PORTAL: "http://panel.example/stalker_portal/c/",
  MAXTV_MAC: "00:1A:79:EE:03:9F",
  MAXTV_SERIAL: "92180365D21FE",
  MAXTV_DEVICE_ID: "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
};

const LIST = JSON.stringify({
  js: { total_items: 1, data: [{ id: "901", name: "Sky Sports 1", cmd: "n/901", tv_genre_id: "1" }] },
});
const REFUSAL = JSON.stringify({ js: "Authorization failed." });
const EMPTY = JSON.stringify({ js: { data: [], total_items: 0 } });

const channels = async () => {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request("http://localhost/api/live/channels?source=maxtv&refresh=1"),
    CONFIG,
  );
  return (await res!.json()) as { channels: Array<{ name: string }>; sourceError: string | null };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function panel(respond: (url: URL, headers: Record<string, string>) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string, init?: { headers?: Record<string, string> }) => {
      const url = new URL(String(target));
      calls.push(url.toString());
      return respond(url, (init?.headers ?? {}) as Record<string, string>);
    }),
  );
  return { calls };
}

const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

describe("a panel that wants the token with no scheme on it", () => {
  it("lists its channels for the bare token, after the bearer is refused", async () => {
    const seen = panel((url, headers) => {
      const action = url.searchParams.get("action") ?? "";
      if (action === "handshake") return ok(JSON.stringify({ js: { token: "TOK" } }));
      if (action === "get_profile") return ok(JSON.stringify({ js: { id: "1", status: 0 } }));
      const auth = headers["Authorization"] ?? "";
      // Bearer is refused; the token on its own is accepted.
      if (auth.startsWith("Bearer ")) return ok(REFUSAL);
      if (action === "get_all_channels") return auth === "TOK" ? ok(LIST) : ok(REFUSAL);
      if (action === "get_genres") return ok(JSON.stringify({ js: [{ id: "1", title: "Hindi" }] }));
      return ok(REFUSAL);
    });

    const body = await channels();
    expect(body.sourceError).toBeNull();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);
    expect(seen.calls.some((u) => u.includes("action=get_all_channels"))).toBe(true);
  });
});

describe("a panel that disabled the bulk channel list", () => {
  it("reads one page of the ordered list instead of giving up on the refusal", async () => {
    const seen = panel((url) => {
      const action = url.searchParams.get("action") ?? "";
      if (action === "handshake") return ok(JSON.stringify({ js: { token: "TOK" } }));
      if (action === "get_profile") return ok(JSON.stringify({ js: { id: "1", status: 0 } }));
      if (action === "get_all_channels") return ok(REFUSAL);
      if (action === "get_ordered_list") return ok(LIST);
      if (action === "get_genres") return ok(EMPTY);
      return ok(REFUSAL);
    });

    const body = await channels();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);
    // One page, not a walk: the panel was asked once, because the question was "which call works".
    const paged = seen.calls.filter((u) => u.includes("action=get_ordered_list"));
    expect(paged).toHaveLength(1);
    expect(paged[0]).toContain("p=1");
  });
});
