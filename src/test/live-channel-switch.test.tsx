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
