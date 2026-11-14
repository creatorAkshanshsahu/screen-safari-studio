import { describe, expect, it } from "vitest";

import type { GioTvChannelRecord } from "@/lib/live-gateway";
import { findBestGioTvMatch, normalizeChannelMatchTokens } from "@/lib/live-gateway";

// A maxTV channel that 403s the worker's address is rescued by name-matching it onto a GioTV
// channel the browser can play. That rescue silently did nothing for a whole family of names,
// because `+` was stripped as punctuation: `Nick HD+` reduced to the single token `nick`, which
// scored 0.50 against `Nick Plus HD` and was rejected at the 0.75 threshold.

function rec(id: string, name: string): GioTvChannelRecord {
  return {
    id,
    name,
    category: "Kids",
    logo: "",
    urls: [`https://jiotvmblive.cdn.jio.com/bpk-tv/${id}/index.mpd`],
    keys: [],
  };
}

const CATALOGUE = [
  rec("285", "Nick HD+"),
  rec("286", "Nick HD"),
  rec("287", "Nick Jr HD"),
  rec("165", "Star Sports 1 Hindi HD"),
  rec("166", "Star Sports 2 HD"),
];

describe("channel name matching", () => {
  it("treats `+` as `plus`, so the two spellings are the same channel", () => {
    const target = normalizeChannelMatchTokens("Nick Plus HD");
    expect(normalizeChannelMatchTokens("Nick HD+").tokens).toEqual(target.tokens);
  });

  it("rescues a maxTV channel whose GioTV twin is spelled with `+`", () => {
    const match = findBestGioTvMatch(CATALOGUE, "st:1001", "Nick Plus HD");
    expect(match?.id).toBe("285");
  });

  it("still refuses a neighbour that is not the same channel", () => {
    // `Nick HD` and `Nick Jr HD` are different channels; a loose matcher would rescue the
    // wrong stream, which looks like success until the viewer notices what is on screen.
    expect(findBestGioTvMatch([rec("286", "Nick HD")], "st:1001", "Nick Plus HD")).toBeNull();
    expect(findBestGioTvMatch([rec("287", "Nick Jr HD")], "st:1001", "Nick Plus HD")).toBeNull();
  });

  it("keeps channel numbers significant", () => {
    expect(findBestGioTvMatch(CATALOGUE, "st:1002", "Star Sports 1 Hindi HD")?.id).toBe("165");
  });
});
