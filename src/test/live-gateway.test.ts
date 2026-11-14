import { describe, expect, it } from "vitest";
import { maybeHandleLiveRequest } from "@/lib/live-gateway";

describe("Live TV & OG Embed Gateway", () => {
  it("returns CORS-enabled channel JSON on /api/live/channels", async () => {
    const res = await maybeHandleLiveRequest(
      new Request("https://streamr.lovable.app/api/live/channels?source=maxtv&filter=hindi"),
      undefined,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("access-control-allow-origin")).toBe("*");
    const json = (await res!.json()) as { ok: boolean; channels: Array<{ id: string; iframeCode: string }> };
    expect(json.ok).toBe(true);
    expect(json.channels.length).toBeGreaterThan(0);
    expect(json.channels[0]!.iframeCode).toContain("https://streamr.lovable.app/embed/");
  });

  it("generates dynamic M3U playlist on /api/live/playlist.m3u", async () => {
    const res = await maybeHandleLiveRequest(
      new Request("https://streamr.lovable.app/api/live/playlist.m3u?source=maxtv&filter=hindi"),
      undefined,
    );
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text.startsWith("#EXTM3U")).toBe(true);
    expect(text).toContain("https://streamr.lovable.app/api/live/stream/");
  });

  // `st:1001` is a seed channel: it resolves without any network, so these two assert the
  // player's own contract rather than the "id not found" page.
  it("hands one-channel embeds to the app's own player route", async () => {
    // `/embed/<id>` used to be a second, hand-written player in a server string, and it drifted:
    // the app learned to use the relay's resolved direct address and the embed did not, so
    // `/live/tg:0-9-pictures` played while `/embed/2524` sat on "connecting" for the same channel.
    // Returning null hands the request to the router, where the shared player renders.
    const res = await maybeHandleLiveRequest(new Request("https://streamr.lovable.app/embed/st%3A1001"), undefined);
    expect(res).toBeNull();
  });

  it("still serves the section embed, which is a document rather than a player", async () => {
    const res = await maybeHandleLiveRequest(new Request("https://streamr.lovable.app/embed/tgtv"), undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-security-policy")).toContain("frame-ancestors *");
    const html = await res!.text();
    // The section page carries the channel list and boots the player itself.
    expect(html).toContain("/api/live/channels?source=");
  });
});
