import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LivePlayerContent } from "@/routes/live";

/**
 * "channels worked but after refreshing website it showed this"
 *
 * A cold reload used to be indistinguishable from a broken portal: the page had nothing to show
 * until a handshake, a profile call and a list came back (one to three seconds), and if that read
 * was refused the guide became empty even though the viewer had been watching a minute earlier.
 *
 * Two rules fix that, and both are about the same thing -- the list a viewer was already given is
 * not nothing:
 *   - the last catalogue this browser saw is shown immediately, before the relay is asked;
 *   - a failed refresh never replaces a good list with an empty one. It says the refresh failed,
 *     beside the channels it kept.
 */

const ENGINE = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: (props: Record<string, unknown>) => {
    ENGINE.props.push(props);
    return <video data-testid="engine" />;
  },
}));

const CACHE_KEY = "streamr.catalogue.v1.maxtv";

const catalogue = {
  ok: true,
  categories: ["ZEE5", "Sports"],
  channels: [
    { id: "tg:pictures", key: "tg:pictures", number: 2524, source: "tgtv", name: "&Pictures", category: "ZEE5", rawCategory: "ZEE5", logo: "", embedUrl: "", iframeCode: "", streamUrl: "", directUrl: "https://cdn.example/pictures.m3u8", container: "hls", drm: null },
    { id: "tg:sports", key: "tg:sports", number: 1, source: "tgtv", name: "Sports18 1 HD", category: "Sports", rawCategory: "SPORTS", logo: "", embedUrl: "", iframeCode: "", streamUrl: "", directUrl: "https://cdn.example/sports.m3u8", container: "hls", drm: null },
  ],
};

function seedCache(savedAt = Date.now() - 60_000) {
  window.localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ savedAt, channels: catalogue.channels, categories: catalogue.categories }),
  );
}

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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  ENGINE.props.length = 0;
});

describe("a browser that has been here before", () => {
  it("shows the guide and starts playing before the relay has answered", async () => {
    seedCache();
    // A cold relay: nothing comes back at all.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch);

    renderLive();

    // The channels are there because they were here last time -- no waiting, no "Loading Live TV…".
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Sports18 1 HD/ }).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Loading Live TV…/)).toBeNull();
    // And the picture starts: the first channel of the list it already had.
    await waitFor(() => expect(ENGINE.props.at(-1)?.["channelId"]).toBe("tg:pictures"));

    vi.unstubAllGlobals();
  });

  it("keeps that list when the refresh is refused, and says the refresh failed", async () => {
    seedCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ ok: true, channels: [], categories: [], tgtvError: "the playlist host timed out (504)" }),
      ),
    );

    renderLive();

    await waitFor(() => expect(screen.getAllByText(/could not be refreshed/).length).toBeGreaterThan(0));
    // Nothing was lost: the channels are still on screen, and the reason is beside them.
    expect(screen.getAllByRole("button", { name: /Sports18 1 HD/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/the playlist host timed out/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/maxTV returned no channels\./)).toBeNull();

    vi.unstubAllGlobals();
  });

  it("replaces the remembered list the moment the relay answers", async () => {
    seedCache();
    const fresher = {
      ...catalogue,
      channels: [catalogue.channels[0]!, { ...catalogue.channels[1]!, name: "Sports18 2 HD" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(fresher)));

    renderLive();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Sports18 2 HD/ }).length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button", { name: /Sports18 1 HD/ }).length).toBe(0);
    // What the relay said is what the next reload will start from.
    const stored = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}") as { channels?: unknown[] };
    expect(stored.channels).toHaveLength(2);

    vi.unstubAllGlobals();
  });

  it("does not keep a stale list across a source switch", async () => {
    seedCache();
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...catalogue, channels: [], servedBy: "maxtv", maxTvConfigured: true })));

    renderLive();
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(2));
    fireEvent.click(screen.getByRole("tab", { name: "fusion4k" }));

    // AK TV's channels are not maxTV's channels, and the tab is a different question.
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Sports18 1 HD/ }).length).toBe(0));

    vi.unstubAllGlobals();
  });
});
