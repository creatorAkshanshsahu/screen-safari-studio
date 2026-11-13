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

const payload = {
  ok: true,
  channels: [
    { id: "st:1003", source: "maxtv", name: "Sports18 1 HD", category: "SPORTS | INDIA", rawCategory: "SPORTS", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
    { id: "st:1013", source: "maxtv", name: "Colors HD", category: "ENTERTAINMENT", rawCategory: "ENT", logo: "", embedUrl: "", iframeCode: "", streamUrl: "" },
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
});
