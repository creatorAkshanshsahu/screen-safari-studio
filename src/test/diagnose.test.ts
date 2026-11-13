import { afterEach, describe, expect, it, vi } from "vitest";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;
const KEY = JSON.stringify({ keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }] });
const MPD = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
<BaseURL>https://cdn.jio.example/143/</BaseURL>
<Period><AdaptationSet><Representation id="v1" bandwidth="1">
<SegmentTemplate initialization="init-v1.mp4" media="v1-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("reports the whole DASH chain with a status per reference", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) return new Response(KEY, { status: 200 });
    if (u.includes(".mpd")) return new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } });
    if (u.includes("init-v1")) return new Response(new Uint8Array([1]), { status: 200 });
    if (u.includes("v1-1.m4s")) return new Response(new Uint8Array([1]), { status: 206 });
    return new Response("", { status: 404 });
  });
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/diagnose?id=jio%3A143"), {
    JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8",
  });
  const body = (await res!.json()) as {
    ok: boolean;
    mediaType?: string;
    references: Array<{ kind: string; status: number }>;
    hint: string;
  };
  expect(body.ok).toBe(true);
  expect(body.references.length).toBeGreaterThan(0);
  // The point of the endpoint: a per-reference status, not a single opaque failure.
  for (const ref of body.references) expect(ref.status).toBeGreaterThan(0);
  expect(body.hint).toContain("answered");
});

it("404s for a channel it does not know", async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request("http://localhost/api/live/diagnose?id=nope"), {});
  expect(res!.status).toBe(404);
});
