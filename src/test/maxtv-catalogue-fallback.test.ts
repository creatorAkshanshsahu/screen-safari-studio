import { afterEach, describe, expect, it, vi } from "vitest";

// The app carries a fallback for panels that disable the bulk catalogue call:
//
//   "Fallback for Stalker panels that disable bulk get_all_channels and serve
//    paginated get_ordered_list."
//
// We never ported it. A portal in that configuration therefore looked like a portal with
// no channels at all -- the maxTV tab empty, with a handshake that had plainly succeeded.

type Call = { url: string };

function stub(answer: (url: string) => { status?: number; body?: string }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push({ url: String(url) });
    const { status = 200, body = "" } = answer(String(url));
    return new Response(body, { status });
  });
  return calls;
}

const GENRES = JSON.stringify({ js: [{ id: "5", title: "Sports" }] });

function page(n: number, size: number) {
  const data = Array.from({ length: size }, (_, i) => ({
    id: String(n * 100 + i),
    name: `Ch ${n}-${i}`,
    cmd: `ffmpeg http://cdn/${n}-${i}`,
    tv_genre_id: "5",
  }));
  return JSON.stringify({ js: { data, total_items: 20 } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const CONFIG = { MAXTV_PORTAL: "http://portal.example/c/", MAXTV_MAC: "00:1A:79:BA:DF:D7" };

describe("a portal that refuses the bulk catalogue still lists channels", () => {
  it("walks the paginated list when get_all_channels returns nothing", async () => {
    const calls = stub((url) => {
      if (url.includes("action=handshake")) return { body: JSON.stringify({ js: { token: "T1" } }) };
      if (url.includes("action=get_profile")) return { body: JSON.stringify({ js: { id: "1" } }) };
      if (url.includes("action=get_genres")) return { body: GENRES };
      // The bulk call is disabled on this panel.
      if (url.includes("action=get_all_channels")) return { body: JSON.stringify({ js: { data: [] } }) };
      if (url.includes("action=get_ordered_list")) {
        const p = Number(/[?&]p=(\d+)/.exec(url)?.[1] ?? "1");
        return { body: page(p, p === 1 ? 14 : 6) };
      }
      return { body: "" };
    });

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const body = (await res!.json()) as { channels: unknown[] };
    expect(body.channels.length).toBe(20);
    expect(calls.some((c) => c.url.includes("action=get_ordered_list"))).toBe(true);
  });

  it("stops at the first short page instead of asking for pages that do not exist", async () => {
    const calls = stub((url) => {
      if (url.includes("action=handshake")) return { body: JSON.stringify({ js: { token: "T1" } }) };
      if (url.includes("action=get_profile")) return { body: JSON.stringify({ js: { id: "1" } }) };
      if (url.includes("action=get_genres")) return { body: GENRES };
      if (url.includes("action=get_all_channels")) return { body: JSON.stringify({ js: { data: [] } }) };
      if (url.includes("action=get_ordered_list")) return { body: page(1, 3) };
      return { body: "" };
    });

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    expect(calls.filter((c) => c.url.includes("action=get_ordered_list"))).toHaveLength(1);
  });

  it("does not page when the bulk call works", async () => {
    const calls = stub((url) => {
      if (url.includes("action=handshake")) return { body: JSON.stringify({ js: { token: "T1" } }) };
      if (url.includes("action=get_profile")) return { body: JSON.stringify({ js: { id: "1" } }) };
      if (url.includes("action=get_genres")) return { body: GENRES };
      if (url.includes("action=get_all_channels")) return { body: page(1, 14) };
      return { body: "" };
    });

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const body = (await res!.json()) as { channels: unknown[] };
    expect(body.channels.length).toBe(14);
    expect(calls.some((c) => c.url.includes("action=get_ordered_list"))).toBe(false);
  });
});
