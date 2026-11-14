import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter as memRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { looksLikeLiveChannel } from "@/routes/watch.$id";
import { LivePlayerContent } from "@/routes/live";

/**
 * "/watch/165 plays on the reference site; ours doesn't."
 *
 * Two routes claimed `/watch/<something>`: the live channel (`watch_.$channel.tsx`) and the movie
 * player (`watch.$id.tsx`). TanStack resolved the collision quietly in favour of the film player,
 * so a channel link opened a movie -- and the embed's own STREAMR mark, the snippets this app
 * prints and every `/watch/<number>` in the docs pointed there.
 *
 * One path, one route, decided by the id's shape.
 */

const payload = {
  ok: true,
  channels: [
    { id: "tg:0-9-pictures", key: "tg:0-9-pictures", number: 2524, source: "tgtv", name: "&Pictures By Premium PlugX", category: "ZEE5", rawCategory: "ZEE5", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
  ],
  categories: ["ZEE5"],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

describe("/watch/<id>", () => {
  it("reads a channel by number or by prefixed key, and a title by slug", () => {
    expect(looksLikeLiveChannel("2524")).toBe(true);
    expect(looksLikeLiveChannel("tg:0-9-pictures")).toBe(true);
    expect(looksLikeLiveChannel("st:1001")).toBe(true);
    // The movie and series rails use slugs.
    expect(looksLikeLiveChannel("dune")).toBe(false);
    expect(looksLikeLiveChannel("the-crossing")).toBe(false);
  });

  it("is the live channel route in the app's own tree, not the film player", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const matches = router.matchRoutes("/watch/2524");
    // One match per path segment: the last one is the route that will render.
    expect(matches.at(-1)?.routeId).toBe("/watch/$id");
  });

  it("opens the live player for a channel number", async () => {
    const rootRoute = createRootRoute();
    const watchRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/watch/$id",
      component: () => <LivePlayerContent initialChannelId="2524" />,
    });
    const router = memRouter({
      routeTree: rootRoute.addChildren([watchRoute]),
      history: createMemoryHistory({ initialEntries: ["/watch/2524"] }),
    });
    const { container } = render(<RouterProvider router={router as never} />);

    // The live page: a 16:9 player in flow, and a searchable guide under it.
    await waitFor(() => expect(container.querySelector(".aspect-video")).not.toBeNull());
    expect(screen.getByLabelText("Search channels")).toBeTruthy();
    // Not a film: no "episodes" chrome anywhere.
    expect(screen.queryByText(/Episodes/i)).toBeNull();
  });

  it("mounts the player only once the catalogue has named the channel", async () => {
    /*
     * The first version of the page mounted on the id in the URL to save a round trip. On a cold
     * instance that made the player probe before the catalogue existed, and the probe's 504 carries
     * no direct-play recipe -- a frame stuck on "Connecting to …". Resolve first, then play.
     */
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch);

    const rootRoute = createRootRoute();
    const watchRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/watch/$id",
      component: () => <LivePlayerContent initialChannelId="2524" />,
    });
    const router = memRouter({
      routeTree: rootRoute.addChildren([watchRoute]),
      history: createMemoryHistory({ initialEntries: ["/watch/2524"] }),
    });
    const { container } = render(<RouterProvider router={router as never} />);

    await waitFor(() => expect(container.querySelector(".aspect-video")).not.toBeNull());
    // The box is there, the player is not invented, and the page does not claim a channel it has
    // not resolved.
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByLabelText(/Mute|Unmute/)).toBeNull();
  });
});
