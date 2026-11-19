import { describe, expect, it, vi } from "vitest";

/**
 * "Max tv worked at some point find issue fix it"
 *
 * It had, and the panel was not the reason it stopped. This is the shape the deployed guide
 * reported:
 *
 *     The portal lists no channels. The answer did not depend on where the token went:
 *     as a MAG — Authorization failed.; token in a cookie — Authorization failed.; ...
 *
 * Four token positions, one sentence. That is not a token being in the wrong place -- it is a
 * session the panel never accepted, so it is refused before the position is ever looked at.
 *
 * The cause was ours. `get_profile` was sent with `auth_second_step=1`, which is what a MAG sends
 * when it is *volunteering* to answer a challenge: the panel replies
 * `{"status":2,"msg":"Authentication request"}` and holds the device unauthenticated until the
 * second step arrives. We never performed it. Every list and every link after that was answered
 * "Authorization failed.", whatever header the token was in, and the subscription was blamed for
 * it.
 *
 * These tests pin the three rules that end it:
 *   1. the profile is asked *without* volunteering for a step we will not complete;
 *   2. a refusal that arrives before the device was settled re-asks the profile and repeats the
 *      call, instead of being reported as a subscription problem;
 *   3. a tab that names its subscription never borrows the other subscription's MAC.
 */

const CATALOGUE = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffrt /media/901", tv_genre_id: "5" }], total_items: 1 },
});

type Call = { action: string; mac: string; step: string | null };

/**
 * A panel that demands the second authentication step.
 *
 * `auth_second_step=1` makes it ask for the step and leave the device unsettled; anything else
 * settles it. Until it is settled, every action answers "Authorization failed." -- exactly as the
 * deployed panel did.
 */
function secondStepPanel(opts: { refuseEverything?: boolean } = {}) {
  const calls: Call[] = [];
  let settled = false;

  const handler = async (target: string, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(target));
    const action = url.searchParams.get("action") ?? "";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const cookie = headers["Cookie"] ?? headers["cookie"] ?? "";
    const mac = decodeURIComponent((/mac=([^;]+)/.exec(cookie) ?? [])[1] ?? "");
    const step = url.searchParams.get("auth_second_step");
    calls.push({ action, mac, step });

    const body = (js: unknown) =>
      new Response(JSON.stringify({ js }), { status: 200, headers: { "content-type": "application/json" } });

    if (action === "handshake") return body({ token: `T${mac.slice(-5)}`, random: "r" });
    if (action === "get_profile") {
      if (opts.refuseEverything) return body({ status: 2, msg: "Authentication request" });
      if (step === "1") {
        settled = false;
        return body({ status: 2, msg: "Authentication request" });
      }
      settled = true;
      return body({ id: "1", name: "tv", status: 0 });
    }
    if (!settled) return body("Authorization failed.");
    if (action === "get_all_channels") return new Response(CATALOGUE, { status: 200 });
    return body({ status: 0 });
  };

  return { handler, calls };
}

const get = async (path: string, env: Record<string, string>) => {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://screen-safari.test${path}`), env);
  return { status: res!.status, text: await res!.text() };
};

describe("a panel that demands a second authentication step", () => {
  it("settles the device without volunteering for a step it will never complete", async () => {
    const panel = secondStepPanel();
    vi.stubGlobal("fetch", vi.fn(panel.handler));

    const { text } = await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      MAXTV_PORTAL: "http://portal.example/stalker_portal/c/",
    });

    const body = JSON.parse(text) as { channels: Array<{ name: string }>; sourceError: string | null };
    expect(body.sourceError).toBeNull();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);

    // The first profile call is the plain one. `auth_second_step=1` is the promise we cannot keep.
    const profiles = panel.calls.filter((c) => c.action === "get_profile");
    expect(profiles[0]?.step).toBe("0");
    expect(profiles.some((c) => c.step === "1")).toBe(false);
  });

  it("reports the panel's own words when even the plain profile is refused", async () => {
    const panel = secondStepPanel({ refuseEverything: true });
    vi.stubGlobal("fetch", vi.fn(panel.handler));

    // A different address, so this test cannot be answered from the list the one above cached.
    const { text } = await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      MAXTV_PORTAL: "http://refusing.example/stalker_portal/c/",
    });

    const body = JSON.parse(text) as {
      channels: unknown[];
      sourceError: string | null;
      usingPreviewSeed: boolean;
    };
    // Whatever is shown is the preview seed, not a list this panel gave us.
    expect(body.usingPreviewSeed).toBe(true);
    // Every shape was tried, and the answer is still the panel's, not a guess dressed as one.
    expect(body.sourceError).toContain("Authorization failed.");
    const steps = panel.calls.filter((c) => c.action === "get_profile").map((c) => c.step);
    expect(new Set(steps).size).toBeGreaterThan(1);
  });

  it("starts the profile shapes again after a new token, instead of resuming at the trap", async () => {
    /*
     * The catalogue settles the device with the plain profile, then the token is replaced (a
     * re-handshake is ordinary -- a second worker, an idle timeout, a retry). Resuming the shape
     * cursor where it left off asks the second authentication step on the *new* token, which
     * unsettles the device the panel just settled and earns "Authorization failed." for every call
     * after it. The shapes are about the token, so a new token starts them again.
     */
    const panel = secondStepPanel();
    vi.stubGlobal("fetch", vi.fn(panel.handler));

    await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      MAXTV_PORTAL: "http://renew.example/stalker_portal/c/",
    });

    // Force a fresh handshake by asking for a stream: the link path re-signs when it needs to.
    vi.mocked(fetch).mockImplementation(async (target: any, init?: any) => {
      const url = new URL(String(target));
      if (url.searchParams.get("action") === "create_link") {
        // First link answer is empty, which makes the relay re-sign and ask again.
        const seen = panel.calls.filter((c) => c.action === "create_link").length;
        if (seen <= 1) {
          panel.calls.push({ action: "create_link", mac: "", step: null });
          return new Response(JSON.stringify({ js: {} }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ js: { cmd: "ffmpeg http://media.example/901.ts", streamer: "http://media.example/901.ts" } }),
          { status: 200 },
        );
      }
      return panel.handler(target, init);
    });

    await get("/api/live/stream/st%3A901.ts?account=maxtv", {
      MAXTV_PORTAL: "http://renew.example/stalker_portal/c/",
    });

    const handshakes = panel.calls.filter((c) => c.action === "handshake").length;
    expect(handshakes).toBeGreaterThan(1);
    // Every profile call that followed a handshake used the plain shape.
    const profiles = panel.calls.filter((c) => c.action === "get_profile");
    const afterLastHandshake = profiles.slice(profiles.length - 1);
    expect(afterLastHandshake.every((c) => c.step !== "1")).toBe(true);
  });

  it("never lends one subscription's MAC to the other's tab", async () => {
    /*
     * Both subscriptions are paid for and each is a whole device: a MAC belongs to a serial and a
     * device id. Handing a panel a device it has never billed earns "Authorization failed." about
     * the *account*, which is a true sentence about the wrong subscription.
     */
    const panel = secondStepPanel({ refuseEverything: true });
    vi.stubGlobal("fetch", vi.fn(panel.handler));
    const { MAXTV_ACCOUNTS } = await import("@/lib/maxtv-account");
    const fusion = MAXTV_ACCOUNTS.find((a) => a.id === "fusion4k")!;

    await get(`/api/live/channels?source=maxtv&account=fusion4k&refresh=1`, {
      MAXTV_PORTAL_FUSION4K: "http://fusion.example/stalker_portal/c/",
    });

    const macs = new Set(panel.calls.map((c) => c.mac.toUpperCase()).filter(Boolean));
    expect([...macs]).toEqual([fusion.mac.toUpperCase()]);
  });
});
