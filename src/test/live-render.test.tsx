import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { LivePlayerContent } from "@/routes/live";

const payload = {
  ok: true,
  channels: [
    { id: "tg:1", key: "tg:sports18-1-hd", number: 1, source: "tgtv", name: "Sports18 1 HD", category: "SPORTS | INDIA", rawCategory: "SPORTS", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
    { id: "tg:2", key: "tg:colors-hd", number: 2, source: "tgtv", name: "Colors HD", category: "ENTERTAINMENT", rawCategory: "ENT", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
  ],
  categories: ["SPORTS | INDIA", "ENTERTAINMENT"],
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

describe("Live route", () => {
  it("renders the fetched channel names", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Sports18 1 HD").length).toBeGreaterThan(0);
  });

  it("shows the channel count in the guide header", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText(/2 Channels/).length).toBeGreaterThan(0));
  });

  it("offers AK TV and nothing else", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("AK TV").length).toBeGreaterThan(0));
    // maxTV and JioTV are gone from the product, not merely hidden behind a default.
    expect(screen.queryAllByText("maxTV")).toHaveLength(0);
    expect(screen.queryAllByText("JioTV")).toHaveLength(0);
    expect(screen.queryAllByText("Both")).toHaveLength(0);
  });

  it("asks only for the AK TV catalogue", async () => {
    const fetchMock = vi.mocked(fetch);
    renderLive();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("source=tgtv"))).toBe(true);
      expect(urls.some((u) => u.includes("source=maxtv") || u.includes("source=jio"))).toBe(false);
    });
  });

  it("shows each channel's number, which is how a viewer names one", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("keeps a search box available below the lg breakpoint", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    // Two boxes: one in the desktop drawer, one in the compact rail. The rail is the
    // only one that exists on a phone, and its absence is what hid search there.
    expect(screen.getAllByPlaceholderText(/Search/i).length).toBeGreaterThanOrEqual(2);
  });

  it("filters the guide as the search query is typed", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    const box = screen.getAllByPlaceholderText(/Search/i)[0]!;
    fireEvent.change(box, { target: { value: "Colors" } });
    // Scope to the guide buttons: the player header deliberately keeps showing the
    // active channel so the video is not interrupted by a search for something else.
    await waitFor(() => {
      // The accessible name now starts with the channel number, so match on the name itself.
      expect(screen.queryAllByRole("button", { name: /Sports18 1 HD/ }).length).toBe(0);
      expect(screen.getAllByRole("button", { name: /Colors HD/ }).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/1 Channels/).length).toBeGreaterThan(0);
    });
  });
});

describe("Live route with an empty catalogue", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, channels: [], categories: [], servedBy: "jio", backupError: "Backup playlist unreachable" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  it("says the list is empty instead of claiming it is still connecting", async () => {
    renderLive();
    // The old copy said "Connecting to maxTV portal…" forever, which read as a hung
    // connection when the real problem was an empty catalogue.
    await waitFor(() => expect(screen.queryByText(/Connecting to maxTV portal/)).toBeNull());
    expect(screen.getAllByText(/No channels available from this source/).length).toBeGreaterThan(0);
  });
});
