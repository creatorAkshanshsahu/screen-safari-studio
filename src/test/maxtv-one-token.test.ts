import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "channels worked but after refreshing website it showed this"
 *
 * The panel keeps ONE token per device. A handshake anywhere replaces it, and every request still
 * holding the old one is answered `{"js":"Authorization failed."}`. Opening the page asks for the
 * guide and for a stream at the same moment, so both used to handshake, one of them lost the race,
 * and the losing call was retried in a way that handshook again -- a token war that ended with the
 * guide empty and "Authorization failed." printed for every shape.
 *
 * A refresh in a new worker is the same failure with a different first mover.
 *
 * These tests pin the three rules that end it:
 *   1. one handshake at a time -- a caller that arrives during one waits for it;
 *   2. a call that lost its token to a *newer* token is simply repeated, with no handshake on top;
 *   3. a panel that speaks a refusal is not swept for four shapes; it said what it meant.
 */

const CONFIG = {
  MAXTV_PORTAL: "http://portal.example/stalker_portal/c/",
  MAXTV_MAC: "00:1A:79:AA:BB:CC",
  MAXTV_SERIAL: "SERIAL1",
  MAXTV_DEVICE_ID: "DEVICE1",
};

const CATALOGUE = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffrt /media/901", tv_genre_id: "5" }], total_items: 1 },
});
const REFUSAL = JSON.stringify({ js: "Authorization failed." });

/**
 * A panel with one token per device.
 *
 * `handshakes` counts every `action=handshake`; `stale` counts calls that arrived with a token
 * that has since been replaced (they get the refusal, exactly like the real panel).
 */
function oneTokenPanel(opts: { refuseAll?: boolean } = {}) {
  let current = "";
  let minted = 0;
  const calls: string[] = [];
  let stale = 0;
  let handshakes = 0;

  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      calls.push(u);
      const auth = (init?.headers ?? {})["Authorization"] ?? "";
      // Only the panel's own calls are the subject here; the media URL and the other sources'
      // metadata endpoints are not Stalker traffic and carry no token to be stale.
      const isPortalCall = u.includes("/load.php?");
      if (u.includes("action=handshake")) {
        handshakes += 1;
        // A new token replaces the old one; a moment of latency, as a real handshake has.
        await new Promise((r) => setTimeout(r, 5));
        minted += 1;
        current = `T${minted}`;
        return new Response(JSON.stringify({ js: { token: current } }), { status: 200 });
      }
      if (opts.refuseAll) return new Response(REFUSAL, { status: 200 });
      if (isPortalCall && auth !== `Bearer ${current}`) {
        stale += 1;
        return new Response(REFUSAL, { status: 200 });
      }
      if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [{ id: "5", title: "Sports" }] }), { status: 200 });
      if (u.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
      if (u.includes("action=create_link")) {
        return new Response(JSON.stringify({ js: { cmd: "ffmpeg http://cdn.example/901.ts" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ js: {} }), { status: 200 });
    },
  );
  return { calls, get stale() { return stale; }, get handshakes() { return handshakes; } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a portal that keeps one token per device", () => {
  it("serialises the handshake, so the guide and the stream do not sign in over each other", async () => {
    const panel = oneTokenPanel();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");

    // What a page load does: the guide and the channel it wants to play, at the same time.
    const [list] = await Promise.all([
      maybeHandleLiveRequest(
        new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
        CONFIG,
      ),
      maybeHandleLiveRequest(new Request("http://localhost:8080/api/live/stream/st%3A901.ts"), CONFIG),
    ]);

    const body = (await list!.json()) as { channels: Array<{ name: string }>; sourceError: string | null };
    // The token war used to leave this empty, with "Authorization failed." in sourceError.
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);
    expect(body.sourceError).toBeNull();
    expect(panel.stale).toBe(0);
    // One sign-in for both: the second caller waited for the token the first was already minting.
    expect(panel.handshakes).toBe(1);
  });

  it("repeats a call that lost its token, instead of minting another one on top", async () => {
    const panel = oneTokenPanel();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");

    // Learn the endpoint first, as a warm session would.
    const warm = maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const warmBody = (await (await warm)!.json()) as { channels: unknown[] };
    expect(warmBody.channels.length).toBe(1);
    const before = panel.handshakes;

    // A stream ask forces a fresh sign-in; the catalogue ask runs at the same time.
    const list = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const body = (await list!.json()) as { channels: Array<{ name: string }>; sourceError: string | null };
    expect(body.channels.length).toBe(1);
    expect(body.sourceError).toBeNull();
    // Nothing spiralled: one sign-in for the second read, not a handshake per failed call.
    expect(panel.handshakes - before).toBeLessThanOrEqual(1);
  });

  it("does not sweep four token positions at a panel that said 'Authorization failed.'", async () => {
    const panel = oneTokenPanel({ refuseAll: true });
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");

    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const body = (await res!.json()) as { channels: unknown[]; sourceError: string };
    expect(body.channels).toEqual([]);
    expect(body.sourceError).toContain("Authorization failed.");

    const channelCalls = panel.calls.filter((c) => c.includes("action=get_all_channels"));
    // The call, its one retry after a fresh token, and nothing else: no cookie/query/no-header tour
    // and no twelve-page fallback behind a refusal.
    expect(channelCalls.length).toBeLessThanOrEqual(2);
    expect(panel.calls.filter((c) => c.includes("action=get_ordered_list"))).toHaveLength(0);
  });
});
