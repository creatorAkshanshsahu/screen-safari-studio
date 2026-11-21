import { describe, expect, it, vi } from "vitest";

/**
 * "You have to use the device id, sn, mac and other things which I provided you."
 *
 * A Stalker panel bills a *device*, and the seller's card prints all of it:
 *
 *     mac 00:1A:79:EE:03:9F
 *     sn 92180365D21FE
 *     device id 1 3610DEAF…6070
 *     device id 2 3610DEAF…6070
 *
 * This app sent the MAC (in the cookie) and the serial and device id (on `get_profile`) -- but not
 * on the handshake, and never `device_id2` from the card as a value of its own. A panel that checks
 * the box on *every* call sees a stranger holding somebody's address on the first request, answers
 * "Authorization failed.", and the app reported that as the subscription being refused.
 *
 * These tests exist because the failure is invisible from the outside: the same sentence covers a
 * lapsed account, a stale token and a half-presented device. So they assert the *request*, not only
 * the outcome.
 */

const ACCOUNT = {
  portal: "http://panel.example/stalker_portal/c/",
  mac: "00:1A:79:EE:03:9F",
  serial: "92180365D21FE",
  deviceId: "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
  deviceId2: "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
};

const CATALOGUE = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "n/901" }], total_items: 1 },
});

type Seen = {
  action: string;
  sn: string | null;
  deviceId: string | null;
  deviceId2: string | null;
  stbType: string | null;
  cookie: string;
};

/**
 * A panel that checks the box, not the address.
 *
 * Every call has to carry the MAC, the serial and both device ids. One missing field anywhere is
 * "Authorization failed." -- which is what a real panel of this kind does.
 */
function strictPanel() {
  const seen: Seen[] = [];
  const handler = async (target: string, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(target));
    const q = (k: string) => url.searchParams.get(k);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const cookie = headers["Cookie"] ?? headers["cookie"] ?? "";
    seen.push({
      action: q("action") ?? "",
      sn: q("sn"),
      deviceId: q("device_id"),
      deviceId2: q("device_id2"),
      stbType: q("stb_type"),
      cookie,
    });

    const body = (js: unknown) =>
      new Response(JSON.stringify({ js }), { status: 200, headers: { "content-type": "application/json" } });
    const refusal = () => body("Authorization failed.");

    const macOk = decodeURIComponent(cookie).toUpperCase().includes(ACCOUNT.mac);
    const deviceOk =
      q("sn") === ACCOUNT.serial &&
      q("device_id") === ACCOUNT.deviceId &&
      q("device_id2") === ACCOUNT.deviceId2 &&
      Boolean(q("stb_type"));
    if (!macOk || !deviceOk) return refusal();

    const action = q("action");
    if (action === "handshake") return body({ token: "TOK" });
    if (action === "get_profile") return body({ id: "1", status: 0 });
    if (action === "get_all_channels") return new Response(CATALOGUE, { status: 200 });
    if (action === "get_genres") return body([{ id: "1", title: "Hindi" }]);
    return body({ status: 0 });
  };
  return { handler, seen };
}

const get = async (path: string, env: Record<string, string>) => {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://screen.test${path}`), env);
  return JSON.parse(await res!.text()) as {
    channels: Array<{ name: string }>;
    sourceError: string | null;
  };
};

const ENV = {
  MAXTV_PORTAL: ACCOUNT.portal,
  MAXTV_MAC: ACCOUNT.mac,
  MAXTV_SERIAL: ACCOUNT.serial,
  MAXTV_DEVICE_ID: ACCOUNT.deviceId,
  MAXTV_DEVICE_ID2: ACCOUNT.deviceId2,
};

describe("the device a panel is talking to", () => {
  it("presents the MAC, the serial and both device ids on every call, the handshake included", async () => {
    const panel = strictPanel();
    vi.stubGlobal("fetch", vi.fn(panel.handler));

    const body = await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", ENV);

    expect(body.sourceError).toBeNull();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);

    // Every request carried the box, not only the one that asked for its profile.
    const portalCalls = panel.seen.filter((c) => c.action !== "");
    expect(portalCalls.length).toBeGreaterThan(2);
    for (const call of portalCalls) {
      expect(call.sn).toBe(ACCOUNT.serial);
      expect(call.deviceId).toBe(ACCOUNT.deviceId);
      expect(call.deviceId2).toBe(ACCOUNT.deviceId2);
      expect(decodeURIComponent(call.cookie).toUpperCase()).toContain(ACCOUNT.mac);
    }
    // The handshake is among them: a token minted for a stranger is a token for a stranger.
    expect(portalCalls.some((c) => c.action === "handshake")).toBe(true);
  });

  it("reports the whole device in diagnose, so the numbers in use can be read back", async () => {
    vi.stubGlobal("fetch", vi.fn(strictPanel().handler));
    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("https://screen.test/api/live/diagnose?source=maxtv&account=maxtv"),
      ENV,
    );
    const json = (await res!.json()) as {
      configured: { mac: string; sn: string; deviceId: string; deviceId2: string; stbType: string };
    };
    expect(json.configured.mac).toBe(ACCOUNT.mac);
    expect(json.configured.sn).toBe(ACCOUNT.serial);
    expect(json.configured.deviceId).toBe(ACCOUNT.deviceId);
    expect(json.configured.deviceId2).toBe(ACCOUNT.deviceId2);
    expect(json.configured.stbType).toBe("MAG254");
  });

  it("keeps a second device id that differs from the first, instead of sending one twice", async () => {
    /*
     * Cards usually print the same value twice. When they print two, the panel is checking two, and
     * sending the first one twice is a device it has never billed.
     */
    const panel = strictPanel();
    vi.stubGlobal("fetch", vi.fn(panel.handler));
    await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      ...ENV,
      MAXTV_DEVICE_ID2: "A-DIFFERENT-SECOND-ID",
    });
    const sent = panel.seen.filter((c) => c.action === "handshake").map((c) => c.deviceId2);
    expect(sent).toContain("A-DIFFERENT-SECOND-ID");
  });
});
