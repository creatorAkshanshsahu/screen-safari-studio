import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LivePlayerContent } from "@/routes/live";

/**
 * "channels are stuck on connecting, and picking another channel does nothing."
 *
 * Two separate faults, both introduced by making the player start earlier:
 *
 *   1. `requestedId` -- the channel named by the URL -- was captured once and preferred forever.
 *      Every click on the guide changed `activeId`, and the player kept the link's channel, so the
 *      picture never changed and no other channel could be reached.
 *   2. The engine's playback effect listed callback props in its dependency array. The new stage
 *      passed inline arrows, so every render -- including the ones the engine itself causes by
 *      reporting tracks -- tore the stream down and started it again. The result was an endless
 *      "Connecting to …" followed by another "Connecting to …".
 *
 * The engine is stubbed here so the test can watch what the page actually asks it to play.
 */

const ENGINE = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: (props: Record<string, unknown>) => {
    ENGINE.props.push(props);
    return <video data-testid="engine" />;
  },
}));

const payload = {
  ok: true,
  categories: ["ZEE5", "Sports"],
  channels: [
    { id: "tg:pictures", key: "tg:pictures", number: 2524, source: "tgtv", name: "&Pictures", category: "ZEE5", rawCategory: "ZEE5", logo: "", embedUrl: "", iframeCode: "", streamUrl: "", directUrl: "https://cdn.example/pictures.m3u8", container: "hls", drm: null },
    { id: "tg:sports", key: "tg:sports", number: 1, source: "tgtv", name: "Sports18 1 HD", category: "Sports", rawCategory: "SPORTS", logo: "", embedUrl: "", iframeCode: "", streamUrl: "", directUrl: "https://cdn.example/sports.m3u8", container: "hls", drm: null },
  ],
};

beforeEach(() => {
  ENGINE.props.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

/** The page uses `<Link>`, so it needs a router even when it is not navigating anywhere. */
function renderLive(initialChannelId?: string) {
  const rootRoute = createRootRoute();
  const liveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/live",
    component: () => <LivePlayerContent {...(initialChannelId ? { initialChannelId } : {})} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([liveRoute]),
    history: createMemoryHistory({ initialEntries: ["/live"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe("opening the guide on a cold instance", () => {
  /*
   * The relay answers a cold instance in two steps: the first request comes back empty with
   * `warming: true` (or simply empty, while the playlist is in flight), and the read lands a moment
   * later. The page used to take the first answer as the truth and stop -- an empty guide until the
   * viewer pressed Refresh, which is the report: "it should load whenever I open the website".
   *
   * It now keeps asking by itself, and this test stands in for the moment the playlist lands.
   */
  it("fills the guide in by itself once the playlist arrives", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        const body = calls === 1 ? { ok: true, channels: [], categories: [], warming: true } : payload;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    renderLive();
    // The first answer is empty, so the page says so honestly rather than claiming to connect.
    await waitFor(() => expect(screen.getAllByText(/AK TV returned no channels yet/).length).toBeGreaterThan(0));

    // No click, no refresh: the retry brings the guide in on its own.
    await waitFor(() => expect(screen.getByRole("button", { name: /Sports18 1 HD/ })).toBeTruthy(), {
      timeout: 5000,
    });
    expect(calls).toBeGreaterThan(1);
  });
});

describe("the maxTV tab", () => {
  /*
   * maxTV is a separate source with its own catalogue and its own ids, and the report that made it
   * necessary was the opposite arrangement: one list with both sources in it, and no way to tell
   * which entries were meant to play. Choosing the tab asks the relay for that source only, and the
   * player switches to a channel that actually exists in it.
   */
  const MAXTV = {
    ok: true,
    servedBy: "maxtv",
    categories: ["SPORTS"],
    channels: [
      {
        id: "st:1001",
        key: "st:1001",
        number: 1001,
        source: "maxtv",
        name: "Star Sports 1 Hindi HD",
        category: "SPORTS",
        rawCategory: "SPORTS",
        logo: "",
        embedUrl: "",
        iframeCode: "",
        streamUrl: "/api/live/stream/st%3A1001.ts",
        container: "mpegts",
        drm: null,
      },
    ],
  };

  it("asks the relay for maxTV only, and plays what comes back", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        calls.push(url);
        const body = url.includes("source=maxtv") ? MAXTV : payload;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    renderLive();
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());
    expect(ENGINE.props.at(-1)!["channelId"]).toBe("tg:pictures");

    fireEvent.click(screen.getByRole("tab", { name: "maxTV" }));

    await waitFor(() => expect(ENGINE.props.at(-1)!["channelId"]).toBe("st:1001"));
    // The AK TV channel is not carried over: an id from one source means nothing in the other.
    expect(calls.some((u) => u.includes("source=maxtv"))).toBe(true);
    expect(screen.getByRole("tab", { name: "maxTV" }).getAttribute("aria-selected")).toBe("true");
  });

  it("says maxTV is unconfigured rather than retrying at nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        const body = url.includes("source=maxtv")
          ? { ok: true, channels: [], categories: [], sourceError: null, maxTvConfigured: false }
          : payload;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    renderLive();
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "maxTV" }));

    await waitFor(() => expect(screen.getByText(/maxTV is not configured/)).toBeTruthy());
    // A deployment with no portal is not a failure to retry; it is a fact to state, with the two
    // variables that fix it.
    expect(screen.getByText(/MAXTV_PORTAL/)).toBeTruthy();
  });
});

describe("a maxTV portal that is refusing the site", () => {
  /**
   * The screenshot: "maxTV returned no channels yet. Retrying by itself — attempt 1. … HTTP 403".
   *
   * The portal had already said no to that address; the page answered by asking again every second,
   * and the relays behind it swept eight addresses each time. A block is the one empty guide where
   * an automatic retry is the harm, so the page states it and stops.
   */
  it("states the refusal and stops the automatic retries", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        calls.push(url);
        const body = url.includes("source=maxtv")
          ? {
              ok: true,
              channels: [],
              categories: [],
              maxTvConfigured: true,
              sourceBlocked: true,
              sourceRetryAfterSeconds: 540,
              sourceError:
                "The maxTV server is refusing this deployment's address (HTTP 403: from Apache/2.4.18 (Ubuntu)).",
            }
          : payload;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    renderLive();
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "maxTV" }));

    await waitFor(() => expect(screen.getByText(/maxTV is refusing this site's address/)).toBeTruthy());
    // It says the account is not the question, and when it will try again.
    expect(screen.getByText(/the account is not the question/)).toBeTruthy();
    expect(screen.getByText(/paused for 9 more minutes/)).toBeTruthy();

    const asked = calls.filter((u) => u.includes("source=maxtv")).length;
    // Well past the first automatic retry (1s) and the second (2s): nothing more is sent.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(calls.filter((u) => u.includes("source=maxtv")).length).toBe(asked);
  });
});

describe("a channel opened from a shared link", () => {
  it("plays the channel the link named, by number", async () => {
    renderLive("2524");
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // The catalogue's id, not the number in the URL: the engine needs the thing it can resolve.
    expect(ENGINE.props.at(-1)!["channelId"]).toBe("tg:pictures");
    expect(ENGINE.props.at(-1)!["directUrl"]).toBe("https://cdn.example/pictures.m3u8");
  });

  it("switches to another channel when the viewer picks one", async () => {
    renderLive("2524");
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());
    expect(ENGINE.props.at(-1)!["channelId"]).toBe("tg:pictures");

    // The guide is the thing a viewer uses when the channel they landed on is not the one they
    // want. It used to be decorative on any deep link.
    fireEvent.click(screen.getByRole("button", { name: /Sports18 1 HD/ }));

    await waitFor(() => expect(ENGINE.props.at(-1)!["channelId"]).toBe("tg:sports"));
  });

  it("hands the engine the same callbacks on every render, so it never restarts itself", async () => {
    renderLive("2524");
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    const first = ENGINE.props.at(-1)!;
    // A control click re-renders the whole page; that must not look like a new player to the engine.
    fireEvent.click(screen.getByLabelText(/Mute|Unmute/));
    const after = ENGINE.props.at(-1)!;

    expect(after["onAudioTracksChange"]).toBe(first["onAudioTracksChange"]);
    expect(after["onAutoMuted"]).toBe(first["onAutoMuted"]);
    expect(after["onContainerDetected"]).toBe(first["onContainerDetected"]);
    // Nothing asked for a reload, so the engine is not asked to start over.
    expect(after["reloadNonce"]).toBe(first["reloadNonce"]);
    expect(after["channelId"]).toBe(first["channelId"]);
  });
});
