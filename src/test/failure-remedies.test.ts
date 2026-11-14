import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The complaint, in three parts: "2523 &Pictures HD is refused (HTTP 403)", "the embed link sits on
 * Connecting to live stream… forever", and "we can select other channel if one failed".
 *
 * The first two are the product's own rule being broken — a dead stream must name its cause
 * immediately and offer the next step, never sit on a spinner. The third is a data fact worth
 * using: these playlists list the same channel several times, on different hosts, in different
 * containers. When one host refuses us, the same channel two entries away may play.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="0-9-tvpictureshd" tvg-chno="2523" group-title="ZEE5 Worldwide By Premium PlugX",&Pictures HD By Premium PlugX
https://premiumplug.fun/tee/playlist.php/0-9-tvpictureshd.m3u8
#EXTINF:-1 tvg-id="1839" tvg-chno="28" group-title="Movies By Premium PlugX",&Pictures HD By Premium PlugX
https://example.test/dash/1839.mpd
#EXTINF:-1 tvg-id="999" tvg-chno="77" group-title="Movies By Premium PlugX",Some Other Channel By Premium PlugX
https://example.test/hls/999.m3u8
`;

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      if (String(target).includes("playlist.m3u")) return new Response(PLAYLIST, { status: 200 });
      return new Response("", { status: 404 });
    }),
  );
}

async function call(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), {
    TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
  });
  return { status: res!.status, json: (await res!.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("/api/live/alternatives", () => {
  it("finds the same channel in another category, with its own id", async () => {
    stub();
    const { json } = await call("/api/live/alternatives?id=tg%3A0-9-tvpictureshd");
    const alts = json["alternatives"] as Array<{ id: string; number?: number; container: string }>;

    expect(alts).toHaveLength(1);
    expect(alts[0]!.id).toBe("tg:1839");
    expect(alts[0]!.number).toBe(28);
    // A different container on a different host is the whole point: it is a separate attempt.
    expect(alts[0]!.container).toBe("dash");
  });

  it("never offers the channel you are already on", async () => {
    stub();
    const { json } = await call("/api/live/alternatives?id=tg%3A1839");
    const alts = json["alternatives"] as Array<{ id: string }>;
    expect(alts.map((a) => a.id)).not.toContain("tg:1839");
  });

  it("returns an empty list rather than an error for a channel with no sibling", async () => {
    stub();
    const { status, json } = await call("/api/live/alternatives?id=tg%3A999");
    expect(status).toBe(200);
    expect(json["alternatives"]).toEqual([]);
  });

  it("asks for an id instead of guessing one", async () => {
    stub();
    const { status } = await call("/api/live/alternatives");
    expect(status).toBe(400);
  });
});

describe("share links", () => {
  it("address a channel by number, not by an id that names two channels", async () => {
    stub();
    const { json } = await call("/api/live/channels?source=tgtv&filter=all&q=pictures&limit=5");
    const channels = json["channels"] as Array<{ id: string; number?: number; embedUrl: string; iframeCode: string }>;
    const hd = channels.find((c) => c.number === 2523);

    expect(hd).toBeDefined();
    // `tg:1839` is not unique in this playlist, so a link built from it is ambiguous.
    expect(hd!.embedUrl).toBe("https://player.example/embed/2523");
    expect(hd!.iframeCode).toContain("/embed/2523");
  });
});

describe("the embed never sits on \"Connecting to live stream…\"", () => {
  it("is the app's engine, so the app's error handling comes with it", async () => {
    stub();
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    // `/embed/2523` used to be a hand-written second player, and it had the bug the app did not:
    // no Hls.Events.ERROR handler at all, so a 403 changed nothing on screen until a 12s watchdog
    // -- and Reload restarted the watchdog. Declining here is what makes that impossible: the
    // frame renders LiveVideoSurface, the same component `/live/<id>` renders.
    const res = await maybeHandleLiveRequest(new Request("https://player.example/embed/2523"), {
      TGTV_PLAYLIST_URL: "https://tg.example/playlist.m3u",
    });
    expect(res).toBeNull();
  });

  it("keeps the relay's own words so the browser's refusal can quote them", () => {
    // A canary, because this half only runs in a browser: the engine needs a media element, hls.js
    // from /vendor, and a CDN that refuses it. What must not silently disappear is the two lines
    // that turn a fatal media error into a sentence a viewer can act on.
    const src = readFileSync(path.resolve(__dirname, "../components/tv/LiveVideoSurface.tsx"), "utf8");
    // Subscribed where a manifest 403 arrives, not only at the watchdog.
    expect(src).toMatch(/HlsCtor\.Events\.ERROR/);
    // The relay's message is passed through verbatim rather than replaced by a generic string.
    expect(src).toMatch(/reportError\(j\.error \|\|/);
    // And only a policy refusal counts as "the browser blocked the sound": everything else is a
    // real fault, and muting it would offer a remedy for the wrong problem.
    expect(src).toMatch(/name !== "NotAllowedError"/);
  });
});
