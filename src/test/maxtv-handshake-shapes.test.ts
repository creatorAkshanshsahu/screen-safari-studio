import { describe, expect, it, vi } from "vitest";

/**
 * "no portal at this address (tried …/server/load.php no token, …/c/server/load.php HTTP 404, …)"
 *
 * The subscription is fine and the portal is there. What the guide printed was one line per address
 * and the word "no token" for the first one, which reads as a dead panel — when a 200 without a
 * token is four different things:
 *
 *   1. a panel asking to be *challenged* before it mints a token (`{"js":{"prehash":"…"}}`);
 *   2. a host serving a web page where the API lives (a redirect, or a firewall challenge);
 *   3. a JSON envelope with no token in it;
 *   4. a genuinely empty body.
 *
 * (1) is answerable, and this app never answered it — it asked with `prehash=0` and gave up. (2)
 * must not be called "no portal at this address", because it sends the reader to check a portal
 * address that is correct. These tests pin both.
 */

const CATALOGUE = JSON.stringify({
  js: { data: [{ id: "901", name: "Sky Sports 1", cmd: "n/901" }], total_items: 1 },
});

const get = async (path: string, env: Record<string, string>) => {
  const { maybeHandleLiveRequest } = await import("@/lib/live-gateway");
  const res = await maybeHandleLiveRequest(new Request(`https://screen.test${path}`), env);
  return JSON.parse(await res!.text()) as {
    channels: Array<{ name: string }>;
    sourceError: string | null;
  };
};

/** A panel that only mints a token once it has been asked to be challenged and answered. */
function challengePanel() {
  const calls: Array<{ action: string; prehash: string | null; token: string | null }> = [];
  let minted = false;
  const handler = async (target: string) => {
    const url = new URL(String(target));
    const action = url.searchParams.get("action") ?? "";
    const prehash = url.searchParams.get("prehash");
    const token = url.searchParams.get("token");
    calls.push({ action, prehash, token });
    const body = (js: unknown) => new Response(JSON.stringify({ js }), { status: 200 });
    if (action === "handshake") {
      if (prehash === "1" && !token) return body({ prehash: "CHALLENGE" });
      if (prehash === "1" && token === "CHALLENGE") {
        minted = true;
        return body({ token: "MINTED" });
      }
      return body({ status: 0 });
    }
    if (!minted) return body("Authorization failed.");
    if (action === "get_all_channels") return new Response(CATALOGUE, { status: 200 });
    return body({ status: 0 });
  };
  return { handler, calls };
}

describe("a handshake that needs a challenge answered", () => {
  it("asks to be challenged, answers it, and reads the guide", async () => {
    const panel = challengePanel();
    vi.stubGlobal("fetch", vi.fn(panel.handler));

    const body = await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      MAXTV_PORTAL: "http://challenge.example/stalker_portal/c/",
    });

    expect(body.sourceError).toBeNull();
    expect(body.channels.map((c) => c.name)).toEqual(["Sky Sports 1"]);

    // The challenge was asked for, then handed back — the two calls a panel of this kind requires.
    const handshakes = panel.calls.filter((c) => c.action === "handshake");
    expect(handshakes.some((c) => c.prehash === "1" && !c.token)).toBe(true);
    expect(handshakes.some((c) => c.prehash === "1" && c.token === "CHALLENGE")).toBe(true);
  });
});

describe("a host serving a web page where the portal API lives", () => {
  it("says it answered a page, instead of calling the portal absent", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("<!DOCTYPE html><html><title>Just a moment...</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }),
    );

    const body = await get("/api/live/channels?source=maxtv&account=maxtv&refresh=1", {
      MAXTV_PORTAL: "http://wall.example/stalker_portal/c/",
    });

    expect(body.sourceError).toMatch(/web page instead of the portal API/);
    // Not "no portal at this address": the address is right.
    expect(body.sourceError).not.toMatch(/no portal at this address/);
    /*
     * Two addresses answering the same page is one firewall, not eight chances. The sweep stops,
     * because the rest of the ladder is the same host -- and sixteen requests is how a soft block
     * becomes a hard one.
     */
    expect(calls).toBeLessThan(8);
  });
});
