import { afterEach, describe, expect, it, vi } from "vitest";

// The v.4.9 app documents this precisely: the playlist's #EXTHTTP cookie is a *coarse*
// token minted for the whole site, while the address behind the redirect carries one
// minted for that single channel. Jio's CDN answers 450 (or 451/403) to the wrong one,
// which is why the app sends several header shapes in turn and lets the CDN choose.
// Sending exactly one shape is what produced "Upstream stream returned HTTP 450".

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="143" group-title="English",CNBC TV18 Prime
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=https://allinonereborn2.online/jtv-fetch/keyid.php?id=143
#EXTVLCOPT:http-user-agent=@allinone_reborn
#EXTHTTP:{"cookie":"__hdnea__=site-token"}
https://allinonereborn2.online/jiotv-m3u/jtv1.mpd?id=143
`;

const KEY_DOC = JSON.stringify({
  keys: [{ kty: "oct", k: "0123456789abcdef0123456789abcdef", kid: "abcdef0123456789abcdef0123456789" }],
});

// The manifest's own key id deliberately differs from the key document's.
const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <BaseURL>https://cdn.jio.example/live/143/</BaseURL>
  <Period><AdaptationSet>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="11112222333344445555666677778888"/>
    <Representation id="v1" bandwidth="2000000">
      <SegmentTemplate media="v1-$Number$.m4s" initialization="init.mp4"/>
    </Representation>
  </AdaptationSet></Period>
</MPD>`;

const CFG = { JIO_PLAYLIST_URL: "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stub(opts: { refusals?: number; status?: number } = {}) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  let mediaAttempts = 0;
  const refusals = opts.refusals ?? 1;
  const status = opts.status ?? 450;

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: u, headers });

    if (u.includes("jtv39.m3u8")) return new Response(PLAYLIST, { status: 200 });
    if (u.includes("keyid.php")) return new Response(KEY_DOC, { status: 200 });

    if (u.includes("jiotv-m3u") || u.includes("cdn.jio.example")) {
      // The playlist address redirects to a signed CDN address, like the real host.
      if (u.includes("jiotv-m3u") && u.includes(".mpd")) {
        return new Response(null, {
          status: 302,
          headers: { location: `https://cdn.jio.example/live/143/signed.mpd?__hdnea__=chan-token` },
        });
      }
      mediaAttempts++;
      if (mediaAttempts <= refusals) return new Response("blocked", { status });
      return new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } });
    }
    return new Response("", { status: 404 });
  });
  return seen;
}

async function get(path: string) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  return (await maybeHandleLiveRequest(new Request(`http://localhost${path}`), CFG))!;
}

describe("JioTV CDN refusals", () => {
  it("retries a second header shape when the CDN answers 450", async () => {
    stub({ refusals: 1, status: 450 });
    const res = await get("/api/live/stream/jio%3A143.mpd");
    // One refused shape must not be the end of the channel.
    expect(res.status).toBe(200);
    expect(res.headers.get("x-stream-container")).toBe("dash");
  });

  it("keeps trying across several refusals", async () => {
    stub({ refusals: 2, status: 451 });
    const res = await get("/api/live/stream/jio%3A143.mpd");
    expect(res.status).toBe(200);
  });

  it("follows the redirect and keeps the signed CDN address", async () => {
    const seen = stub();
    await get("/api/live/stream/jio%3A143.mpd");
    // The redirector re-mints the token; the bare playlist URL carries a stale one.
    expect(seen.some((c) => c.url.includes("cdn.jio.example"))).toBe(true);
  });

  it("reports the refusal when every shape is rejected", async () => {
    stub({ refusals: 99, status: 450 });
    const res = await get("/api/live/stream/jio%3A143.mpd");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("450");
  });
});

describe("ClearKey key id reconciliation", () => {
  it("relabels a lone key onto the key id the manifest declares", async () => {
    stub();
    const res = await get("/api/live/stream/jio%3A143.mpd");
    const header = res.headers.get("x-clear-keys") ?? "";

    // The key document says abcdef01…, the manifest says 11112222…. Using the document's
    // id decrypts nothing and shows a black screen with no error at all.
    // Key ids travel as unpadded base64url, which is what EME and Shaka expect.
    expect(header).toContain("EREiIjMzRERVVWZmd3eIiA"); // base64url of 11112222…8888
    expect(header).not.toContain("abcdef0123456789abcdef0123456789");
    expect(header).toContain("0123456789abcdef0123456789abcdef");
  });

  it("exposes the header to browsers", async () => {
    // Without this the player cannot read the corrected keys from the response.
    stub();
    const res = await get("/api/live/stream/jio%3A143.mpd");
    expect(res.headers.get("access-control-expose-headers")).toContain("X-Clear-Keys");
  });
});
