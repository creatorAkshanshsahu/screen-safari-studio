import { describe, expect, it } from "vitest";
import { channelKey, channelSlug, findChannelByAnyId } from "@/lib/live-gateway";

/**
 * The report that started this:
 *
 *   https://screen-safari-studio.lovable.app/embed/tg%3Aset-hd.sonyliv
 *   "getting stuck on connecting live stream"
 *
 * A shared link has to survive the playlist changing under it, and the search for it has to be
 * forgiving without ever landing on the wrong channel.
 */

type Row = { id: string; rawId: string; name: string; source: string; number?: number };

const rec = (id: string, rawId: string, name: string, source = "tgtv"): Row => ({
  id,
  rawId,
  name,
  source,
});

const POOL: Row[] = [
  rec("tg:set-hd.sonyliv", "set-hd.sonyliv", "Sony SET HD"),
  rec("tg:1001", "1001", "Star Plus HD"),
  rec("tg:2002", "2002", "SET HD Movies"),
  rec("tg:3003", "3003", "Nick HD+"),
];

describe("channelSlug / channelKey", () => {
  it("reduces a name to something a URL can carry", () => {
    expect(channelSlug("Sony SET HD")).toBe("sony-set-hd");
    expect(channelSlug("Nick HD+")).toBe("nick-hd");
    expect(channelSlug("  · Discovery  Kids · ")).toBe("discovery-kids");
    expect(channelSlug("")).toBe("");
  });

  it("carries the source, so the same name in two sources stays two channels", () => {
    expect(channelKey({ source: "tgtv", name: "Sony SET HD" })).toBe("tg:sony-set-hd");
    expect(channelKey({ source: "jio", name: "Sony SET HD" })).toBe("jio:sony-set-hd");
    expect(channelKey({ source: "maxtv", name: "Colors HD" })).toBe("st:colors-hd");
  });
});

describe("findChannelByAnyId", () => {
  it("resolves the exact id", () => {
    expect(findChannelByAnyId(POOL, "tg:set-hd.sonyliv")?.name).toBe("Sony SET HD");
  });

  it("resolves the playlist id without its prefix", () => {
    expect(findChannelByAnyId(POOL, "set-hd.sonyliv")?.name).toBe("Sony SET HD");
    expect(findChannelByAnyId(POOL, "1001")?.name).toBe("Star Plus HD");
  });

  it("resolves the stable key, which is what survives a re-sourced playlist", () => {
    // The playlist is replaced and this channel's id is now numeric; the shared key still works.
    const reSourced: Row[] = [rec("tg:9009", "9009", "Nick HD+")];
    expect(findChannelByAnyId(reSourced, "tg:nick-hd")?.name).toBe("Nick HD+");
  });

  it("resolves a provider domain suffix either way round", () => {
    // Shared as `tg:set-hd` against a playlist that spells it `set-hd.sonyliv`.
    expect(findChannelByAnyId(POOL, "tg:set-hd")?.name).toBe("Sony SET HD");
    // And the reverse: shared with the domain against a playlist that dropped it.
    const bare: Row[] = [rec("tg:set-hd", "set-hd", "Sony SET HD")];
    expect(findChannelByAnyId(bare, "tg:set-hd.sonyliv")?.name).toBe("Sony SET HD");
  });

  it("resolves a name typed by hand", () => {
    expect(findChannelByAnyId(POOL, "tg:sony-set-hd")?.name).toBe("Sony SET HD");
  });

  it("is case-insensitive, because URLs get retyped", () => {
    expect(findChannelByAnyId(POOL, "TG:SET-HD.SONYLIV")?.name).toBe("Sony SET HD");
  });

  it("never lands on the wrong channel just because the names are close", () => {
    // "set-hd" must not resolve to "SET HD Movies" and vice versa.
    expect(findChannelByAnyId(POOL, "tg:set-hd-movies")?.name).toBe("SET HD Movies");
    expect(findChannelByAnyId([rec("tg:1", "1", "SET HD Movies")], "tg:set-hd")).toBeNull();
  });

  it("resolves a channel by its number, which is the shortest thing to share", () => {
    const numbered: Row[] = [
      { ...rec("tg:1001", "1001", "Star Plus HD"), number: 1 },
      { ...rec("tg:1002", "1002", "Sony SET HD"), number: 2 },
      { ...rec("tg:1003", "1003", "Colors HD"), number: 143 },
    ];
    expect(findChannelByAnyId(numbered, "143")?.name).toBe("Colors HD");
    expect(findChannelByAnyId(numbered, "1")?.name).toBe("Star Plus HD");
    // A number that matches no channel number but is a real playlist id still resolves by id.
    expect(findChannelByAnyId(numbered, "tg:1002")?.name).toBe("Sony SET HD");
    expect(findChannelByAnyId(numbered, "999")).toBeNull();
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(findChannelByAnyId(POOL, "tg:does-not-exist")).toBeNull();
    expect(findChannelByAnyId(POOL, "")).toBeNull();
    expect(findChannelByAnyId([], "tg:1001")).toBeNull();
  });
});
