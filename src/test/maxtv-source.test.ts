import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "make sure the channel will load through max tv and max tv should have its own channels not tgs
 * — okay embed too."
 *
 * Two halves of the same promise. maxTV has to serve maxTV channels (its own ids, its own stream
 * path), and an embed has to be able to open one — including through `/embed/maxtv`, the section
 * page a host site points an `<iframe>` at.
 *
 * The failures these replace were both silent:
 *
 *   - `/api/public/channels/<id>` wrapped its result in `akTvOnly`, so an embed of a maxTV channel
 *     resolved the channel and then dropped it, answering 404 about a channel that exists.
 *   - the embed told the player every channel was `tgtv`, so maxTV was fetched along the AK TV
 *     path, found nothing, and sat on "connecting".
 */

const ACCOUNT = {
  portal: "http://portal.example/stalker_portal/c/",
  mac: "00:1A:79:EE:03:9F",
  serial: "SERIAL1",
  deviceId: "DEVICE1",
};

const CATALOGUE = JSON.stringify({
  js: {
    data: [
      { id: "101", name: "Arena Sports", cmd: "ffmpeg http://cdn.example/101", tv_genre_id: "5" },
      { id: "102", name: "Nova News", cmd: "ffmpeg http://cdn.example/102", tv_genre_id: "6" },
    ],
  },
});

const ENV = {
  MAXTV_PORTAL: ACCOUNT.portal,
  MAXTV_MAC: ACCOUNT.mac,
  MAXTV_SERIAL: ACCOUNT.serial,
  MAXTV_DEVICE_ID: ACCOUNT.deviceId,
};

/** The portal conversation, with a real transport stream behind `create_link`. */
function stubPortal() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const url = String(target);
      calls.push(url);
      if (url.includes("action=handshake")) return new Response(JSON.stringify({ js: { token: "T1" } }), { status: 200 });
      if (url.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "1" } }), { status: 200 });
      if (url.includes("action=get_all_channels")) return new Response(CATALOGUE, { status: 200 });
      if (url.includes("action=get_genres")) return new Response(JSON.stringify({ js: [] }), { status: 200 });
      if (url.includes("action=create_link")) {
        return new Response(JSON.stringify({ js: { cmd: "ffmpeg http://cdn.example/live/101.ts" } }), { status: 200 });
      }
      // The media itself: TS packets, which is what a MAG box is given.
      if (url.startsWith("http://cdn.example/")) {
        return new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10, 0x00]), {
          status: 200,
          headers: { "content-type": "video/mp2t" },
        });
      }
      return new Response("", { status: 404 });
    }),
  );
  return { calls };
}

async function get(path: string, env: Record<string, string> = ENV) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), env);
  return { status: res?.status ?? null, headers: res?.headers ?? null, body: res ? await res.text() : "" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("maxTV serves its own channels", () => {
  it("lists the portal's channels with maxTV ids, not the playlist's", async () => {
    stubPortal();
    const { body } = await get("/api/live/channels?source=maxtv&refresh=1");
    const data = JSON.parse(body) as {
      servedBy: string;
      channels: Array<{ id: string; source: string; name: string; streamUrl: string; container?: string }>;
    };

    expect(data.servedBy).toBe("maxtv");
    expect(data.channels.map((c) => c.name)).toEqual(["Arena Sports", "Nova News"]);
    // `st:` ids, and the relay path for that id -- never a `tg:` channel wearing a maxTV label.
    expect(data.channels[0]!.id).toBe("st:101");
    expect(data.channels[0]!.source).toBe("maxtv");
    expect(data.channels[0]!.streamUrl).toContain("/api/live/stream/st%3A101.ts");
  });

  it("carries a maxTV channel through the relay, as a transport stream", async () => {
    stubPortal();
    // A probe resolves `create_link` and reports the container without holding the stream open.
    const probe = await get("/api/live/stream/st%3A101.ts?probe=1");
    expect(probe.status).toBe(200);
    expect(probe.headers!.get("x-stream-container")).toBe("mpegts");

    const media = await get("/api/live/stream/st%3A101.ts");
    expect(media.status).toBe(200);
    expect(media.headers!.get("x-stream-container")).toBe("mpegts");
    expect(media.headers!.get("content-type")).toContain("video/mp2t");
  });
});

describe("maxTV in the embed", () => {
  it("resolves a maxTV channel for a host site, instead of 404-ing on it", async () => {
    stubPortal();
    const { status, body } = await get("/api/public/channels/st%3A101");
    const data = JSON.parse(body) as {
      id: string;
      name: string;
      source: string;
      sources: string[];
      container: string;
      embed?: string;
    };

    expect(status).toBe(200);
    expect(data.name).toBe("Arena Sports");
    // The source travels with it: the shared player asks for the right stream path from this.
    expect(data.source).toBe("maxtv");
    expect(data.sources[0]).toContain("/api/live/stream/st%3A101.ts");
    expect(data.container).toBe("mp4");
  });

  it("hands /embed/st:101 to the app's own player rather than a second implementation", async () => {
    stubPortal();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(new Request("https://player.example/embed/st%3A101"), ENV);
    expect(res).toBeNull();
  });

  it("has a section page that lists maxTV channels, not AK TV ones", async () => {
    const { status, body } = await get("/embed/maxtv");
    expect(status).toBe(200);
    expect(body).toContain("maxTV · STREAMR");
    // The page fetches the source it is named after.
    expect(body).toContain('"/api/live/channels?source=" + encodeURIComponent(SOURCE)');
    expect(body).toContain('const SOURCE = "maxtv"');
  });
});
