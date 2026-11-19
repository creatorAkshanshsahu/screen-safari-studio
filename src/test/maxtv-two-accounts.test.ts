import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "I gave u the new portal file — I want that in another tab. Our maxTV isn't expired."
 *
 * Two paid subscriptions on two panels. They are two devices: different portal, different MAC,
 * different serial, different device id. The guide gives each its own tab, and the tab's name
 * travels to the relay as `?account=`.
 *
 * The failure this guards against is the one that is easy to ship and hard to see: a worker holds
 * ONE Stalker session, so a request for the second panel that reuses the first panel's token is
 * refused -- or worse, answered with the first panel's channel list under the second panel's name.
 */

const MAXTV = {
  id: "maxtv",
  label: "maxTV",
  portal: "http://new.maxtv.be/stalker_portal/c/",
  mac: "00:1A:79:EE:03:9F",
};

const FUSION = {
  id: "fusion4k",
  label: "fusion4k",
  portal: "http://tv.fusion4k.cc/stalker_portal/c/",
  mac: "00:1A:79:F5:8F:95",
};

type Call = { host: string; mac: string; action: string };

/** A panel per host, listing the channels that belong to *it*. */
function panels() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = new URL(String(url));
      const cookie = decodeURIComponent((init?.headers ?? {})["Cookie"] ?? "");
      const action = u.searchParams.get("action") ?? "";
      const mac = cookie.split("mac=")[1]?.split(";")[0]?.toUpperCase() ?? "";
      calls.push({ host: u.host, mac, action });
      const name = u.host === "new.maxtv.be" ? "Sky Sports 1" : "Fusion Sports";
      const body =
        action === "handshake"
          ? { js: { token: `TOK-${u.host}` } }
          : action === "get_profile"
            ? { js: { id: "1" } }
            : action === "get_genres"
              ? { js: [{ id: "5", title: "Sports" }] }
              : action === "get_all_channels"
                ? { js: { data: [{ id: "901", name, cmd: "ffrt /media/901", tv_genre_id: "5" }], total_items: 1 } }
                : { js: {} };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  );
  return calls;
}

async function catalogue(account: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`http://localhost/api/live/channels?source=maxtv&account=${account}&refresh=1`, {
      headers: { host: "localhost:8080" },
    }),
    {},
  );
  return (await res!.json()) as {
    channels: Array<{ name: string; id: string; streamUrl: string }>;
    sourceError: string | null;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("two paid subscriptions", () => {
  it("answers each tab from its own panel, with its own device", async () => {
    const calls = panels();

    const first = await catalogue("maxtv");
    expect(first.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);

    const second = await catalogue("fusion4k");
    expect(second.channels.map((c) => c.name)).toEqual(["Fusion Sports"]);

    // Each panel was asked with its own MAC, never with the other subscription's.
    for (const call of calls) {
      if (call.host === "new.maxtv.be") expect(call.mac).toBe(MAXTV.mac.toUpperCase());
      if (call.host === "tv.fusion4k.cc") expect(call.mac).toBe(FUSION.mac.toUpperCase());
    }
    expect(calls.some((c) => c.host === "new.maxtv.be")).toBe(true);
    expect(calls.some((c) => c.host === "tv.fusion4k.cc")).toBe(true);
  });

  it("keeps the two catalogues apart, so one tab never shows the other's channels", async () => {
    panels();
    const a = await catalogue("maxtv");
    const b = await catalogue("fusion4k");
    // Both panels use channel 901; the name is what tells them apart, and neither leaks.
    expect(a.channels[0]!.name).toBe("Sky Sports 1");
    expect(b.channels[0]!.name).toBe("Fusion Sports");

    // ...and going back to the first tab is still the first panel's list.
    const again = await catalogue("maxtv");
    expect(again.channels[0]!.name).toBe("Sky Sports 1");
  });

  it("sends the play link through the subscription that listed it", async () => {
    panels();
    const { channels } = await catalogue("fusion4k");
    // A play link that did not name its panel would resolve channel 901 on whichever panel
    // happened to be warm -- a different channel, and a refusal on the other.
    expect(channels[0]!.streamUrl).toContain("account=fusion4k");
  });
});
