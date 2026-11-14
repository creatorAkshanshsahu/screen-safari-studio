import { afterEach, describe, expect, it, vi } from "vitest";

// "The portal returned no playable link" is what `create_link` looks like when the portal
// answers 200 with an empty `js` and no error text. It is not a network fault and it is not a
// subscription refusal on its own — but until now it was reported as one flattened sentence,
// which said nothing about which of the two it was.
//
// Two behaviours are pinned here:
//   1. an empty `create_link` re-handshakes and asks once more, because a session dropped
//      between the catalogue call and this one produces exactly that silent shape;
//   2. a second empty answer is reported as what it is, quoting the portal when it said
//      anything at all.

type Answer = { status: number; body: string };
type Call = { url: string };

const ACCOUNT = {
  portal: "http://portal.example/stalker_portal/c/",
  mac: "00:1A:79:EE:03:9F",
  serial: "SERIAL1",
  deviceId: "DEVICE1",
};

const CATALOGUE = JSON.stringify({
  // A portal handle, not an address: `create_link` is the only way to turn it into a stream.
  // (When `cmd` already holds a URL, `resolveMaxtvLink` answers from it and never asks.)
  js: { data: [{ id: "101", name: "Arena Sports", cmd: "ffrt /media/101/index.m3u8", tv_genre_id: "5" }] },
});

function stubPortal(createLink: (attempt: number) => Answer) {
  const calls: Call[] = [];
  let createLinkAttempts = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    calls.push({ url: u });
    if (u.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
    if (u.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
    if (u.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
    if (u.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
    if (u.includes("action=create_link")) {
      createLinkAttempts += 1;
      const { status, body } = createLink(createLinkAttempts);
      return new Response(body, { status });
    }
    return new Response("", { status: 404 });
  });
  const count = (needle: string) => calls.filter((c) => c.url.includes(needle)).length;
  return { calls, count };
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

describe("maxTV create_link recovery", () => {
  it("re-handshakes and retries once when the portal answers with no link", async () => {
    // First create_link is silent; the session was dropped. The retry finds a link.
    const portal = stubPortal((attempt) =>
      attempt === 1
        ? { status: 200, body: JSON.stringify({ js: {} }) }
        : { status: 200, body: JSON.stringify({ js: { cmd: "ffmpeg http://cdn.example/101/index.m3u8" } }) },
    );

    // The media fetch is not stubbed to succeed; we only care that a link was obtained, which
    // shows up as the proxy trying to reach it rather than as the portal error.
    const res = await streamResponse();
    const body = (await res!.json()) as { ok?: boolean; error?: string };

    expect(portal.count("action=create_link")).toBe(2);
    expect(portal.count("action=handshake")).toBe(2);
    expect(body.error ?? "").not.toContain("no stream address");
  });

  it("reports a silent refusal as silent, not as a network fault", async () => {
    stubPortal(() => ({ status: 200, body: JSON.stringify({ js: {} }) }));

    const res = await streamResponse();
    expect(res!.status).toBe(502);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain("gave no reason");
    expect(body.error).toContain("diagnose?source=maxtv");
  });

  it("rewrites a loopback placeholder onto the portal's own host", async () => {
    // `ffmpeg http://localhost/ch/101_` is the normal Stalker shape. Handing that to a worker
    // means asking the worker to fetch itself, which fails in a way that looks like a dead CDN.
    const portal = stubPortal(() => ({
      status: 200,
      body: JSON.stringify({ js: { cmd: "ffmpeg http://localhost/ch/101/index.m3u8" } }),
    }));

    await streamResponse();
    const urls = portal.calls.map((c) => c.url);
    // The media request went to the portal host, never back to the worker's own loopback.
    expect(urls.some((u) => u.startsWith("http://localhost"))).toBe(false);
    expect(urls.some((u) => u.startsWith("http://portal.example/") && u.includes("/ch/101/index.m3u8"))).toBe(true);
  });

  it("quotes the portal when it does say why", async () => {
    stubPortal(() => ({
      status: 200,
      body: JSON.stringify({ js: { error: "Channel is not available in your subscription" } }),
    }));

    const res = await streamResponse();
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe("Channel is not available in your subscription");
  });
});
