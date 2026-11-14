import { describe, expect, it } from "vitest";

import { sameTokenScope, withHdneaToken } from "@/lib/direct-token";

// The app's rule is `target == origin`: a token must never travel to a third party. Applied as
// a strict hostname comparison in a browser it is too tight, because reshared playlists put a
// manifest on one CDN host and its segments on a sibling. Every segment then went out unsigned,
// the CDN answered 450/475, and HLS reported a fatal interruption after a manifest that had
// loaded perfectly.

describe("sameTokenScope", () => {
  it("allows the same host", () => {
    expect(sameTokenScope("https://a.cdn.jio.com/x.m3u8", "https://a.cdn.jio.com/y.ts")).toBe(true);
  });

  it("allows a sibling host under the same provider", () => {
    // This is the case that broke: manifest on one edge, segments on another.
    expect(
      sameTokenScope(
        "https://jiotvmblive.cdn.jio.com/bpk-tv/1/index.m3u8",
        "https://jiotvpllive.cdn.jio.com/bpk-tv/1/seg1.ts",
      ),
    ).toBe(true);
  });

  it("still refuses an unrelated host", () => {
    expect(sameTokenScope("https://a.cdn.jio.com/x.m3u8", "https://evil.example/y.ts")).toBe(false);
    expect(sameTokenScope("https://a.cdn.jio.com/x.m3u8", "https://cdn.jio.com.evil.example/y.ts")).toBe(false);
  });

  it("does not let two different sites share a two-part suffix", () => {
    // `a.co.uk` and `b.co.uk` are unrelated, so a naive "last two labels" rule would leak.
    expect(sameTokenScope("https://a.co.uk/x.m3u8", "https://b.co.uk/y.ts")).toBe(false);
  });

  it("never throws on something that is not a URL", () => {
    expect(sameTokenScope("not a url", "https://a.cdn.jio.com/y.ts")).toBe(false);
  });
});

describe("withHdneaToken", () => {
  it("keeps sibling parameters and replaces only the token", () => {
    expect(withHdneaToken("https://h/p.m3u8?id=4&x=1&__hdnea__=old", "__hdnea__=new", true)).toBe(
      "https://h/p.m3u8?id=4&x=1&__hdnea__=new",
    );
  });

  it("leaves an already-signed child URL alone when not replacing", () => {
    const signed = "https://h/s.ts?__hdnea__=mine";
    expect(withHdneaToken(signed, "__hdnea__=other", false)).toBe(signed);
  });
});
