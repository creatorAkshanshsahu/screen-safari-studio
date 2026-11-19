import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Where do I put the maxTV credentials?" needs one answer, and this pins it.
 *
 * maxTV is a Stalker portal: no username, no password, four values that identify a device —
 * portal, MAC, serial, device id. They live in `src/lib/maxtv-account.ts`, which is editable in the
 * same editor as the rest of the code (the person setting them could not find an environment
 * variable panel, and a credential nobody can place is a credential nobody has). Each one is
 * overridden individually by an environment variable, which is the right home for a secret.
 *
 * The failure this guards against is not a wrong MAC. It is a deployment that *has* an account —
 * edited into the file, no variables set — being told "maxTV is not configured", which reads as
 * "your credentials did not take".
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** What `/api/live/channels` says about the source, and what `/api/live/diagnose?source=maxtv` does. */
type Listed = { maxTvConfigured?: boolean; maxTvAccountSource?: string };
type Configured = {
  portal: string;
  mac: string;
  fromEnv: { portal: boolean; mac: boolean };
  envVars: string[];
};
type Diagnosed = { configured: Configured };

async function get<T>(path: string, env: Record<string, string> = {}) {
  // Nothing here should reach a real portal: segmentation of the question is the whole point, and a
  // question about configuration is answered without one.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://player.example${path}`), env);
  return { status: res?.status ?? null, body: (await res!.json()) as T };
}

describe("the maxTV account", () => {
  it("is read from one file when nothing is configured, and counts as configured", async () => {
    const { MAXTV_ACCOUNT } = await import("@/lib/maxtv-account");

    const listed = await get<Listed>("/api/live/channels?source=maxtv&refresh=1");
    expect(listed.body.maxTvConfigured).toBe(true);
    expect(listed.body.maxTvAccountSource).toBe("code");

    const { configured: diagnosed } = (await get<Diagnosed>("/api/live/diagnose?source=maxtv")).body;
    expect(diagnosed.portal).toBe(MAXTV_ACCOUNT.portal);
    expect(diagnosed.mac).toBe(MAXTV_ACCOUNT.mac);
    expect(diagnosed.fromEnv).toEqual({ portal: false, mac: false });
  });

  it("lets an environment variable override any one of the four values", async () => {
    const { MAXTV_ACCOUNT, MAXTV_ENV_VARS } = await import("@/lib/maxtv-account");
    expect(MAXTV_ENV_VARS).toEqual(["MAXTV_PORTAL", "MAXTV_MAC", "MAXTV_SERIAL", "MAXTV_DEVICE_ID"]);

    const { configured: diagnosed } = (
      await get<Diagnosed>("/api/live/diagnose?source=maxtv", { MAXTV_PORTAL: "http://other.example/c/" })
    ).body;
    // The portal moved; the MAC stayed. Half a configuration is allowed on purpose: only the value
    // that was set is replaced, so a portal change does not silently blank the identity.
    expect(diagnosed.portal).toBe("http://other.example/c/");
    expect(diagnosed.mac).toBe(MAXTV_ACCOUNT.mac);
    expect(diagnosed.fromEnv.portal).toBe(true);
    expect(diagnosed.fromEnv.mac).toBe(false);
  });

  it("names the four variables a person has to set, and says where they came from", async () => {
    const { MAXTV_ENV_VARS } = await import("@/lib/maxtv-account");
    const { configured } = (
      await get<Diagnosed>("/api/live/diagnose?source=maxtv", { MAXTV_MAC: "00:1A:79:00:00:01" })
    ).body;
    expect(configured.mac).toBe("00:1A:79:00:00:01");
    expect(configured.fromEnv.mac).toBe(true);
    // The same list the file documents, so the two cannot drift apart.
    expect(configured.envVars).toEqual([...MAXTV_ENV_VARS]);
  });
  it("lists the portal's channels with nothing configured at all", async () => {
    /*
     * The whole point of the file: no variables, no settings screen, and maxTV still works. The
     * request goes to the portal named in `MAXTV_ACCOUNT`, with the MAC in the file, and the
     * channels come back. A test that only checked the config values could pass while the account
     * was never actually used.
     */
    const { MAXTV_ACCOUNT } = await import("@/lib/maxtv-account");
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        seen.push(url);
        const body = url.includes(`session=${MAXTV_ACCOUNT.mac}`) || url.includes("action=handshake")
          ? { js: { token: "T1" } }
          : url.includes("action=get_genres")
            ? { js: [{ id: "5", title: "Sports" }] }
            : url.includes("action=get_all_channels")
              ? { js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "ffmpeg http://cdn/ssl1", tv_genre_id: "5" }] } }
              : {};
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
    const res = await maybeHandleLiveRequest(
      new Request("http://localhost/api/live/channels?source=maxtv&refresh=1", { headers: { host: "localhost:8080" } }),
      {},
    );
    const body = (await res!.json()) as { channels: Array<{ name: string; source: string }> };
    expect(body.channels.map((c) => c.name)).toContain("Sky Sports 1");
    expect(body.channels.every((c) => c.source === "maxtv")).toBe(true);
    // The portal it asked is the one written in the file, not a placeholder and not a preview seed.
    // Its host, not its exact path: a panel's API sits one level up from the web-client address the
    // file holds, and either address is the same portal.
    const host = new URL(MAXTV_ACCOUNT.portal).host;
    expect(seen.some((u) => new URL(u).host === host)).toBe(true);
  });
});
