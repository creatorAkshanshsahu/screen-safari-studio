import { afterEach, describe, expect, it, vi } from "vitest";
import { accentInk, parseAccent } from "@/lib/live-gateway";

/**
 * The embedding surface a host site codes against, modelled on the reference site's page:
 * one-channel iframe, responsive 16:9, `?colour=` theming, and a documented JSON API that
 * resolves a channel into playable sources with its ClearKey.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="0-9-tvpictureshd" tvg-chno="2523" group-title="ZEE5 Worldwide By Premium PlugX",&Pictures HD By Premium PlugX
https://cdn.example.test/live/pictures/index.m3u8
#EXTINF:-1 tvg-id="zee5-3" tvg-chno="2408" group-title="ZEE5 India By Premium PlugX",&PICTURES HD By Premium PlugX
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
https://cdn.example.test/dash/pictures/manifest.mpd
#EXTINF:-1 tvg-id="sports-1" tvg-chno="300" group-title="Sports By Premium PlugX",Star Sports 1 HD By Premium PlugX
https://cdn.example.test/live/sports/index.m3u8
`;

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const u = String(target);
      if (u.includes("playlist.m3u")) return new Response(PLAYLIST, { status: 200 });
      // The ClearKey document the parser follows for the DASH entry.
      if (u.includes("keyid.php")) return magResponse([{ id: "143", kid: "aa".repeat(16), key: "bb".repeat(16) }]);
      return new Response("", { status: 404 });
    }),
  );
}

function magResponse(body: unknown) {
  const raw = JSON.stringify(body);
  const scrambled = Buffer.from(raw, "utf8")
    .toString("base64")
    .split("")
    .reverse()
    .join("");
  return new Response(scrambled, { status: 200 });
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
  });
  const text = await res!.text();
  return { status: res!.status, text, type: res!.headers.get("content-type") ?? "" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("?colour=", () => {
  it("accepts six hex digits with or without a hash", () => {
    expect(parseAccent("#FF6600")).toBe("#ff6600");
    expect(parseAccent("ff6600")).toBe("#ff6600");
    expect(parseAccent("%23ff6600")).toBeNull(); // still encoded: decoding is the URL's job
    expect(parseAccent("ff6600")).toBe("#ff6600");
  });

  it("refuses anything that is not a colour, rather than half-honouring it", () => {
    for (const bad of ["red", "#fff", "#ff66000", "ff66", "", null, undefined, "rgb(1,2,3)"]) {
      expect(parseAccent(bad)).toBeNull();
    }
  });

  it("picks readable text by luminance, not by channel average", () => {
    expect(accentInk("#ffffff")).toBe("#000000");
    expect(accentInk("#000000")).toBe("#ffffff");
    // Both are mid-grey-mean colours and demand opposite text.
    expect(accentInk("#00ff00")).toBe("#000000");
    expect(accentInk("#0000ff")).toBe("#ffffff");
  });

  it("themes the embed it is asked for", async () => {
    stub();
    const { text } = await get("/embed/2523?colour=FF6600");
    expect(text).toContain("--accent: #ff6600");
    expect(text).toContain("--accent-ink: #000000");
  });

  it("keeps the default when the value is not a colour", async () => {
    stub();
    const { text } = await get("/embed/2523?colour=nope");
    expect(text).toContain("--accent: #00ecf7");
  });
});

describe("/api/public/channels", () => {
  it("lists channels with the identity and the two links a host needs", async () => {
    stub();
    const { status, text } = await get("/api/public/channels");
    const body = JSON.parse(text) as { count: number; channels: Array<Record<string, string>> };

    expect(status).toBe(200);
    expect(body.count).toBe(3);
    const hd = body.channels.find((c) => c["id"] === "2523")!;
    expect(hd["name"]).toContain("&Pictures HD");
    expect(hd["category"]).toBe("ZEE5 Worldwide By Premium PlugX");
    // Numbers are the identity in a URL: /embed/2523, /watch/2523.
    expect(hd["embed"]).toBe("https://player.example/embed/2523");
    expect(hd["watch"]).toBe("https://player.example/watch/2523");
  });

  it("filters by name and by category", async () => {
    stub();
    const byQuery = JSON.parse((await get("/api/public/channels?q=star")).text) as { count: number };
    expect(byQuery.count).toBe(1);

    const byCategory = JSON.parse((await get("/api/public/channels?category=Sports By Premium PlugX")).text) as {
      count: number;
    };
    expect(byCategory.count).toBe(1);
  });

  it("resolves one channel into sources, and its ClearKey", async () => {
    stub();
    const { status, text } = await get("/api/public/channels/2408");
    const body = JSON.parse(text) as {
      id: string;
      sources: string[];
      drm?: { type: string; keyId: string; key: string };
      container: string;
    };

    expect(status).toBe(200);
    expect(body.id).toBe("2408");
    expect(body.container).toBe("dash");
    expect(body.sources[0]).toContain("/api/live/stream/");
    if (body.drm) {
      expect(body.drm.type).toBe("clearkey");
      expect(body.drm.keyId).toHaveLength(32);
      expect(body.drm.key).toHaveLength(32);
    }
  });

  it("answers 404 with the reason and the remedy for an unknown channel", async () => {
    stub();
    const { status, text } = await get("/api/public/channels/not-a-channel");
    expect(status).toBe(404);
    expect(text).toContain("/api/public/channels");
  });
});

describe("the /embed documentation page", () => {
  it("documents the snippets a host site actually pastes", async () => {
    stub();
    const { text } = await get("/embed");

    expect(text).toContain('src="https://player.example/embed/143"');
    expect(text).toContain("padding-top:56.25%"); // responsive 16:9
    expect(text).toContain("?colour=%23FF6600");
    expect(text).toContain("/api/public/channels/143");
    expect(text).toContain("/watch/143");
    // One source only: advertising a player that does not exist is not documentation.
    expect(text).not.toContain("JioTV");
    expect(text).not.toContain("maxTV");
  });
});
