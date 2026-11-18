import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "maxTV returned no channels yet. Retrying by itself — attempt 1. … HTTP 403, … HTTP 403, …"
 *
 * That is the report this file is written against. The account was never the problem: the same
 * worker had read `get_profile → id 254580` from that portal minutes earlier. The panel had started
 * refusing *the address*, and the app answered by asking harder — the page's retry loop times the
 * eight-address sweep times two identities is up to eighty handshakes, which is exactly what an
 * anti-flood rule is for, and exactly what keeps the block in place.
 *
 * Three things have to hold:
 *   - one refusal of this kind ends the sweep (the other seven addresses are the same host);
 *   - the portal's own words survive into the error, so "403" is not all anyone gets;
 *   - nothing asks again until the pause expires, and the page is told, so it stops retrying too.
 */

const CONFIG = { MAXTV_PORTAL: "http://portal.example/stalker_portal/c/", MAXTV_MAC: "00:1A:79:AA:BB:CC" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A WAF in front of a panel: every path, one refusal, in Apache's own words. */
function stubRefusingHost(status = 403) {
  /** Only the portal's addresses: the AK TV playlist is read in the same request and is not the subject. */
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      if (String(target).includes("portal.example")) calls.push(String(target));
      return new Response(
        "<html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1></body></html>",
        { status, headers: { server: "Apache/2.4.18 (Ubuntu)" } },
      );
    }),
  );
  return calls;
}

/**
 * One catalogue read. `force` is the page's own Refresh (`refresh=1`); the automatic retry the
 * viewer never asked for carries no such flag, which is the difference this file turns on.
 */
async function channels(env: Record<string, string> = CONFIG, force = true) {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(
    new Request(`http://localhost/api/live/channels?source=maxtv${force ? "&refresh=1" : ""}`, {
      headers: { host: "localhost:8080" },
    }),
    env,
  );
  return (await res!.json()) as {
    channels: unknown[];
    sourceError: string | null;
    sourceBlocked: boolean;
    sourceRetryAfterSeconds: number | null;
  };
}

describe("a panel that refuses the address", () => {
  it("stops the address sweep at the first refusal instead of trying all eight", async () => {
    const calls = stubRefusingHost();
    const body = await channels();

    expect(body.channels).toEqual([]);
    expect(body.sourceBlocked).toBe(true);
    // One address was asked, not eight, and not eight times two identities.
    expect(calls.length).toBe(1);
  });

  it("carries the host's own words, not just the status", async () => {
    stubRefusingHost();
    const body = await channels();

    expect(body.sourceError).toContain("refusing this deployment's address");
    // The facts that tell a WAF block from a moved folder: the server and its title.
    expect(body.sourceError).toContain("Apache/2.4.18");
    expect(body.sourceError).toContain("403 Forbidden");
  });

  it("does not ask again while the pause lasts, and says how long that is", async () => {
    const calls = stubRefusingHost();
    const first = await channels();
    expect(first.sourceRetryAfterSeconds).toBeGreaterThan(0);

    const afterFirst = calls.length;
    // No `refresh=1`: this is the retry loop the viewer did not ask for.
    const second = await channels(CONFIG, false);
    // The whole point: a retry must not reach the host. Silence is what ends the block.
    expect(calls.length).toBe(afterFirst);
    expect(second.sourceBlocked).toBe(true);
    expect(second.sourceError).toBe(first.sourceError);
  });

  it("still lets a person spend one request, because a Refresh is a decision", async () => {
    const calls = stubRefusingHost();
    await channels();
    // The page's own Refresh carries `refresh=1`; the pause is not a lockout.
    await channels();
    expect(calls.length).toBe(2);
  });
});

describe("the maxTV diagnostic", () => {
  /**
   * A working panel that mints exactly one token, as the real one does: a second handshake on the
   * same session comes back with an empty `js`, which is what made the diagnostic report
   * "the portal issued no token" about a portal that had just answered.
   */
  function stubWorkingPanel() {
    const handshakes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        if (url.includes("/stalker_portal/c/server/load.php")) return new Response("not found", { status: 404 });
        if (url.includes("action=handshake")) {
          handshakes.push(url);
          return new Response(
            JSON.stringify(handshakes.length === 1 ? { js: { token: "T1", random: "r", not_valid: 0 } } : { js: {} }),
            { status: 200 },
          );
        }
        if (url.includes("action=get_profile")) return new Response(JSON.stringify({ js: { id: "254580" } }), { status: 200 });
        if (url.includes("action=get_genres")) return new Response(JSON.stringify({ js: [{ id: "5", title: "Sports" }] }), { status: 200 });
        if (url.includes("action=get_all_channels")) {
          return new Response(
            JSON.stringify({ js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffmpeg http://cdn/ssl1", tv_genre_id: "5" }] } }),
            { status: 200 },
          );
        }
        return new Response("", { status: 200 });
      }),
    );
    return { handshakes };
  }

  it("reuses the session it already has, and reports the catalogue it could read", async () => {
    const panel = stubWorkingPanel();
    const listed = await channels();
    expect(listed.channels).toHaveLength(1);
    expect(panel.handshakes).toHaveLength(1);

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/diagnose?source=maxtv", { headers: { host: "localhost:8080" } }),
      CONFIG,
    );
    const report = (await res!.json()) as {
      ok: boolean;
      handshake: { ok: boolean; reused?: boolean; token?: string };
      catalogue: { channels: number };
    };

    // No replay: a second handshake would come back with no token and be misread as a refusal.
    expect(panel.handshakes).toHaveLength(1);
    expect(report.handshake.ok).toBe(true);
    expect(report.handshake.reused).toBe(true);
    expect(report.handshake.token).toBe("T1");
    // And the report answers the question it is named after.
    expect(report.ok).toBe(true);
    expect(report.catalogue.channels).toBe(1);
  });
});
