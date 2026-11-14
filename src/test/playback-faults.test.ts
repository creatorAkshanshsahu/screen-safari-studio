import { describe, expect, it } from "vitest";
import { describeHlsFatal, describeShakaStall } from "@/lib/playback-faults";

/**
 * Both real reports are pinned here:
 *   "Live HLS stream interrupted. Press Retry to request a fresh stream token."  (maxTV, Nick Hindi)
 *   "Direct CDN stream is taking too long to deliver video frames."              (Jio, DASH)
 * Neither named a cause although both players had supplied one.
 */
describe("describeHlsFatal", () => {
  it("names the status when the playlist itself was refused", () => {
    const f = describeHlsFatal(
      { fatal: true, details: "manifestLoadError", response: { code: 403 } },
      "maxtv",
    );
    expect(f.kind).toBe("manifest");
    expect(f.status).toBe(403);
    expect(f.message).toContain("HTTP 403");
    expect(f.message).toContain("portal link");
  });

  it("says a body that is not a playlist is not a playlist, rather than blaming a token", () => {
    const f = describeHlsFatal({ fatal: true, details: "manifestParsingError" }, "maxtv");
    expect(f.kind).toBe("manifest");
    expect(f.message).toContain("not an HLS playlist");
    expect(f.message).toContain("MPEG-TS");
  });

  it("calls an unfetchable AES key a key fault, not the network", () => {
    const f = describeHlsFatal({ fatal: true, details: "keyLoadError" }, "maxtv");
    expect(f.kind).toBe("key");
    expect(f.message).toMatch(/AES key/);
    expect(f.message).toContain("not the network");
  });

  it("reports a media refusal with its status and the source's own remedy", () => {
    const f = describeHlsFatal(
      { fatal: true, details: "fragLoadError", response: { code: 450 } },
      "jio",
    );
    expect(f.kind).toBe("network");
    expect(f.message).toContain("HTTP 450");
    expect(f.message).toContain("CDN token");
    expect(f.message).not.toContain("Live HLS stream interrupted");
  });

  it("separates a decoder failure from a load failure", () => {
    const f = describeHlsFatal({ fatal: true, details: "bufferAppendError" }, "maxtv");
    expect(f.kind).toBe("codec");
    expect(f.message).toContain("codec fault");
  });

  it("keeps the old sentence only when the player truly said nothing", () => {
    for (const src of ["maxtv", "jio", "tgtv"] as const) {
      const f = describeHlsFatal({ fatal: true }, src);
      expect(f.kind).toBe("unknown");
      expect(f.message).toContain("Press Retry");
    }
    expect(describeHlsFatal({ fatal: true }, "tgtv").message).toContain("AK TV");
  });

  it("ignores a response code that is not an HTTP status", () => {
    const f = describeHlsFatal(
      { fatal: true, details: "manifestLoadError", response: { code: 0 } },
      "maxtv",
    );
    expect(f.status).toBeUndefined();
    expect(f.message).not.toContain("HTTP 0");
  });
});

describe("describeShakaStall", () => {
  it("never offers a new token for a DRM refusal", () => {
    const f = describeShakaStall({ code: 6008, hadKeys: true, source: "jio" });
    expect(f.kind).toBe("key");
    expect(f.message).toContain("Shaka 6008");
    expect(f.message).not.toContain("taking too long");
  });

  it("never offers a new token for a decode failure", () => {
    const f = describeShakaStall({ code: 3016, hadKeys: true, source: "jio" });
    expect(f.kind).toBe("codec");
    expect(f.message).toContain("not the connection");
    expect(f.message).not.toContain("taking too long");
  });

  it("says the playlist carries no key when none was advertised", () => {
    // The open question for the kids channels: `directPlay.clearKeys` arriving empty.
    const f = describeShakaStall({ code: 3016, hadKeys: false, source: "jio" });
    expect(f.kind).toBe("codec");
    expect(f.message).toContain("advertises no ClearKey");

    const noCode = describeShakaStall({ hadKeys: false, source: "jio" });
    expect(noCode.kind).toBe("key");
    expect(noCode.message).toContain("no amount of retrying");
  });

  it("blames the CDN only for an actual network code", () => {
    const f = describeShakaStall({ code: 1001, hadKeys: true, source: "jio" });
    expect(f.kind).toBe("network");
    expect(f.message).toContain("Shaka 1001");
    expect(f.message).toContain("CDN token");
  });

  it("falls back to a retry hint without inventing a cause", () => {
    const f = describeShakaStall({ hadKeys: true, source: "jio" });
    expect(f.kind).toBe("unknown");
    expect(f.message).toContain("Press Retry");
  });
});
