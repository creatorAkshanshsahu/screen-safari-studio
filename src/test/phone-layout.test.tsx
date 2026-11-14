import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { LivePlayerContent } from "@/routes/live";

/**
 * "overlay issue is still these for player and we can select other channel if one failed."
 *
 * The player used to be the whole viewport on a phone, with the channel chooser a full screen
 * below it. Every overlay we added therefore landed on something, and a refused channel felt like
 * a trap: no way to reach the next one without scrolling past a black void.
 *
 * The fix is geometric rather than cosmetic: on a phone the player owns a 16:9 box, and the
 * header, the controls and the chooser follow it in normal flow.
 */

const payload = {
  ok: true,
  channels: [
    { id: "tg:1", key: "tg:one", number: 2523, source: "tgtv", name: "&Pictures HD", category: "ZEE5 Worldwide", rawCategory: "ZEE5 Worldwide", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
    { id: "tg:2", key: "tg:two", number: 2524, source: "tgtv", name: "&Pictures", category: "ZEE5 Worldwide", rawCategory: "ZEE5 Worldwide", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
  ],
  categories: ["ZEE5 Worldwide"],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

function renderLive() {
  const rootRoute = createRootRoute();
  const liveRoute = createRoute({ getParentRoute: () => rootRoute, path: "/live", component: LivePlayerContent });
  const router = createRouter({
    routeTree: rootRoute.addChildren([liveRoute]),
    history: createMemoryHistory({ initialEntries: ["/live"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe("the phone layout", () => {
  it("gives the player its own 16:9 box instead of the whole viewport", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector("main")).not.toBeNull());

    const main = container.querySelector("main")!;
    // In flow on a phone; the full-bleed scene comes back at lg.
    expect(main.classList.contains("overflow-hidden")).toBe(false);
    expect(main.className).toContain("lg:overflow-hidden");

    const stage = container.querySelector(".aspect-video");
    expect(stage).not.toBeNull();
    expect(stage!.className).toContain("lg:absolute");
  });

  it("says the channel's title in flow, where it can wrap instead of being clipped", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByText("&Pictures HD").length).toBeGreaterThan(0));

    const title = screen.getAllByText("&Pictures HD")[0]!;
    expect(title.className).toContain("break-words");
    // The block that holds the title must be allowed to shrink inside the flex row, or it runs
    // off the right edge of a 393px phone -- which is exactly what the screenshot showed.
    expect(title.parentElement!.className).toContain("min-w-0");
  });

  it("does not pin the controls over the player on a phone", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /mute/i }).length).toBeGreaterThan(0));

    const pinned = Array.from(container.querySelectorAll("div")).filter(
      (el) =>
        el.classList.contains("absolute") &&
        el.classList.contains("inset-x-0") &&
        el.classList.contains("bottom-0"),
    );
    expect(pinned).toHaveLength(0);
  });

  it("keeps the channel chooser in the same document, under the player", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByPlaceholderText("Search channels…").length).toBeGreaterThan(0));
    // The rail is reachable without a desktop-only drawer.
    expect(screen.getAllByText(/2 Channels/).length).toBeGreaterThan(0);
  });
});
