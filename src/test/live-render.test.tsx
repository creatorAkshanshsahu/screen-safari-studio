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

  it("offers one tab per paid subscription, never one mixed list", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("fusion4k").length).toBeGreaterThan(0));
    /*
     * Both subscriptions are chosen by the viewer, one at a time. A single "all" list is what
     * filled this guide with two sources' channels and no way to tell which were meant to work --
     * so there is no such tab. AK TV is gone from the bar: it is not what this page is for.
     */
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["tg", "tatatv", "sony", "fusion4k", "maxTV"]);
    expect(screen.queryAllByText("Both")).toHaveLength(0);
  });

  it("reads a playlist tab in this browser, and never asks the relay about it", async () => {
    /*
     * A playlist is a file, not a panel: the host serves browsers and refuses servers, so the relay
     * is not asked at all. Its answer would only be the refusal, and it would overwrite the list
     * this browser read for itself -- the only list that can play.
     */
    const fetchMock = vi.mocked(fetch);
    renderLive();
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(5));
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: "tatatv" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("allinonereborn2.online"))).toBe(true);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/live/channels"))).toBe(false);
    expect(urls.some((u) => u.includes("account="))).toBe(false);
  });


  it("asks for the one subscription the tab names", async () => {
    const fetchMock = vi.mocked(fetch);
    renderLive();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("account=fusion4k"))).toBe(true);
      // One account per request: a list carrying both panels is exactly what this page is not.
      expect(urls.filter((u) => u.includes("/api/live/channels") && u.includes("account=")).every((u) => !/account=.*account=/.test(u))).toBe(true);
      expect(urls.some((u) => u.includes("source=tgtv"))).toBe(false);
    });
  });

  it("never floats a hint over the header or the channel guide", async () => {
    // The report: a "Tap to Unmute Live Audio" bubble at `top-24` landed on the channel name and
    // the filter pills on a phone -- covering the controls it was telling you to use.
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    const floating = [...document.body.querySelectorAll("button")].filter((b) =>
      /Tap to Unmute Live Audio/.test(b.textContent ?? ""),
    );
    expect(floating).toHaveLength(0);

    // Sound is handled by the player's own control, inside the player's box. When the browser
    // refuses the sound there is a chip -- a chip in the corner, never a veil over the picture.
    const muteControl = screen.getByLabelText(/Mute|Unmute/);
    const stage = document.body.querySelector(".aspect-video")!;
    expect(stage.contains(muteControl)).toBe(true);
    expect(screen.queryByLabelText("Play with sound")).toBeNull();
  });

  it("keeps branding inside the player's box, where it cannot cover the guide", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("fusion4k").length).toBeGreaterThan(0));
    const brand = screen.getAllByTitle("STREAMR home");
    expect(brand.length).toBeGreaterThan(0);
    // The mark sits over the picture's own corner -- and nowhere else on the page.
    const stage = document.body.querySelector(".aspect-video")!;
    for (const el of brand) expect(stage.contains(el)).toBe(true);
  });

  it("shows each channel's number, which is how a viewer names one", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("keeps a search box available below the lg breakpoint", async () => {
    renderLive();
    await waitFor(() => expect(screen.getAllByText("Colors HD").length).toBeGreaterThan(0));
    // One box, in the guide, at every width: the desktop drawer is gone rather than duplicated, so
    // the thing a phone needs cannot be the thing a phone does not get.
    expect(screen.getAllByPlaceholderText(/Search/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Search channels")).toBeTruthy();
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
    // Two places, on purpose: the channel's own line says "No channel", and the guide says why.
    expect(screen.getAllByText(/No channel/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/fusion4k returned no channels/).length).toBeGreaterThan(0);
  });
});
