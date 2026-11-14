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
 * The player used to be the whole viewport, with the channel chooser a full screen below it. Every
 * overlay added on top therefore landed on something, and a refused channel felt like a trap.
 *
 * Two things fixed it, and both still have to hold:
 *
 *   1. **Geometry.** The player owns a 16:9 box in normal flow at every breakpoint -- the reference
 *      site's shape. Everything else (title, guide, filters) follows it in the document.
 *   2. **Containment.** The player's own chrome -- transport bar, sound chip, STREAMR mark -- lives
 *      inside that box. Nothing the player draws may land on the guide, and the guide is reachable
 *      without scrolling past a black void.
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

const stageOf = (container: HTMLElement) => container.querySelector(".aspect-video");

describe("the page around the player", () => {
  it("gives the player a 16:9 box, the way the reference site does", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector("main")).not.toBeNull());

    const stage = stageOf(container);
    expect(stage).not.toBeNull();
    // 16:9 at every width: no breakpoint turns the player into a full-screen black wall.
    expect(stage!.className).toContain("aspect-video");
    expect(stage!.className).not.toContain("lg:absolute");
  });

  it("says the channel's title in flow, where it can wrap instead of being clipped", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());

    const title = container.querySelector("h1")!;
    expect(title.textContent).toContain("&Pictures HD");
    expect(title.className).toContain("break-words");
    // In the document, not floating over the picture.
    expect(title.className).not.toContain("absolute");
  });

  it("keeps every player control inside the player's own box", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(screen.getByLabelText(/Mute|Unmute/)).toBeTruthy());

    const stage = stageOf(container)!;
    for (const label of [/Mute|Unmute/, /Play|Pause/, "Audio and quality", "Reload stream", "Fullscreen"]) {
      expect(stage.contains(screen.getByLabelText(label))).toBe(true);
    }

    // And no control is pinned to the page's own bottom edge, over the guide.
    const pinnedToPage = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.classList.contains("absolute") && el.classList.contains("inset-x-0") && el.classList.contains("bottom-0"),
    );
    for (const el of pinnedToPage) expect(stage.contains(el)).toBe(true);
  });

  it("keeps the channel chooser in the same document, under the player", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByPlaceholderText("Search channels…").length).toBeGreaterThan(0));
    // Counted, searchable, and reachable without a desktop-only drawer.
    expect(screen.getAllByText(/2 Channels/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Search channels")).toBeTruthy();
  });
});
