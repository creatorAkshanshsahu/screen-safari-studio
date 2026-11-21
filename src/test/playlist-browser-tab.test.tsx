import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LivePlayerContent } from "@/routes/live";
import { parsePlaylist, looksLikePlaylist } from "@/lib/playlists";

/**
 * "how our website was able to play" — because the tab that works reads the file where the viewer is.
 *
 * The two playlist tabs are files, not panels. The host serves browsers and refuses this site's
 * server, so asking the relay can only ever produce the refusal. The page reads the playlist in the
 * browser that asked, keeps it, and plays each channel from the address the playlist gave — no relay
 * in the path at all, which is also the end of "Upstream stream returned HTTP 401/403" for these
 * channels.
 *
 * When even the browser's own read is refused (no CORS header, a challenge for `fetch` as well), the
 * viewer can paste the playlist. Nothing a host does can block that, and this is the case that has
 * to work when everything else does not.
 */

const ENGINE = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: (props: Record<string, unknown>) => {
    ENGINE.props.push(props);
    return <video data-testid="engine" />;
  },
}));

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="colors" tvg-logo="https://cdn.example/colors.png" group-title="Hindi",Colors HD
https://cdn.example/colors.m3u8
#EXTINF:-1 tvg-id="sports" group-title="Sports",Star Sports 1 Hindi
https://cdn.example/sports.ts
`;

function renderLive() {
  const rootRoute = createRootRoute();
  const liveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/live",
    component: () => <LivePlayerContent />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([liveRoute]),
    history: createMemoryHistory({ initialEntries: ["/live"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

beforeEach(() => {
  ENGINE.props.length = 0;
  window.localStorage.clear();
});

describe("reading a playlist", () => {
  it("understands the files the sellers actually publish", () => {
    const entries = parsePlaylist(PLAYLIST);
    expect(entries.map((e) => e.name)).toEqual(["Colors HD", "Star Sports 1 Hindi"]);
    expect(entries[0]!.url).toBe("https://cdn.example/colors.m3u8");
    expect(entries[0]!.logo).toBe("https://cdn.example/colors.png");
    expect(entries[1]!.group).toBe("Sports");
    // A page served instead of a playlist is not a playlist, and must not be parsed as one.
    expect(looksLikePlaylist("<!DOCTYPE html><html>Just a moment…</html>")).toBe(false);
    expect(looksLikePlaylist(PLAYLIST)).toBe(true);
  });
});

describe("a playlist tab", () => {
  it("reads the file in this browser and plays it without the relay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        if (String(target).includes("allinonereborn2.online")) {
          return new Response(PLAYLIST, { status: 200, headers: { "content-type": "audio/x-mpegurl" } });
        }
        // The relay must not be asked about a playlist tab at all.
        return new Response(JSON.stringify({ ok: true, channels: [], categories: [] }), { status: 200 });
      }),
    );

    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "tatatv" }));
    // Whatever the page asked about the tab it opened on, this test is about the playlist tab.
    vi.mocked(fetch).mockClear();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Colors HD/ }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: /Colors HD/ })[0]!);
    await waitFor(() => expect(ENGINE.props.at(-1)?.["channelId"]).toMatch(/^pl:tatatv:/));

    const engine = ENGINE.props.at(-1)!;
    // The address the playlist gave, played as it is: no `/api/live/stream/` in sight.
    expect(engine["directUrl"]).toBe("https://cdn.example/colors.m3u8");
    expect(engine["directFirst"]).toBe(true);

    const relayCalls = vi
      .mocked(fetch)
      .mock.calls.map((c) => String(c[0]))
      .filter((u) => u.includes("/api/live/channels"));
    expect(relayCalls).toHaveLength(0);
  });

  it("takes a pasted playlist when the host will not let the page read it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!DOCTYPE html><html>Just a moment…</html>", { status: 200 })),
    );

    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "tg" }));
    await waitFor(() => expect(screen.getByTestId("playlist-panel")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Paste it instead/ }));
    fireEvent.change(screen.getByLabelText("Paste the playlist"), { target: { value: PLAYLIST } });
    fireEvent.click(screen.getByRole("button", { name: /Use this playlist/ }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Colors HD/ }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: /Star Sports 1 Hindi/ })[0]!);
    await waitFor(() => expect(ENGINE.props.at(-1)?.["directUrl"]).toBe("https://cdn.example/sports.ts"));
    // Kept, so the next visit does not need the paste again.
    expect(window.localStorage.getItem("streamr.playlist.v1.tg")).toContain("#EXTM3U");
  });

  it("follows an address the viewer supplied, without a deployment", async () => {
    /*
     * Sellers move their files, and a mirror is worth nothing if it needs a rebuild. `?playlistUrl=`
     * points one playlist tab at an address of the viewer's choosing, and is remembered for it.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        if (String(target).includes("mirror.example")) {
          return new Response(PLAYLIST, { status: 200, headers: { "content-type": "audio/x-mpegurl" } });
        }
        return new Response("<!DOCTYPE html><html>nope</html>", { status: 200 });
      }),
    );
    window.localStorage.setItem("streamr.playlistUrl.v1.tatatv", "https://mirror.example/list.m3u");

    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "tatatv" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Colors HD/ }).length).toBeGreaterThan(0));
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0])).some((u) => u.includes("mirror.example"))).toBe(true);
  });

  it("walks to the seller's backups when the first address is not a playlist", async () => {
    /*
     * The seller publishes a main link and a list of backups, with one instruction: "if one
     * playlist doesn't work, try another". That is an algorithm, and this tab follows it -- the
     * alternative is telling the viewer the whole product is broken because the page picked the
     * one address that is down today.
     */
    const hosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        const url = String(target);
        hosts.push(new URL(url).host);
        // The first address serves a page; the second serves the file.
        if (url.includes("hjh-545")) return new Response("<!DOCTYPE html><html>Just a moment…</html>", { status: 200 });
        if (url.includes("tghub")) return new Response(PLAYLIST, { status: 200 });
        return new Response("nope", { status: 404 });
      }),
    );

    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "tg" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Colors HD/ }).length).toBeGreaterThan(0));
    expect(hosts).toContain("hjh-545.pages.dev");
    expect(hosts).toContain("tghub.lindahicks827.workers.dev");
  });

  it("refuses something that is not a playlist, and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "tg" }));
    await waitFor(() => expect(screen.getByTestId("playlist-panel")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Paste it instead/ }));
    fireEvent.change(screen.getByLabelText("Paste the playlist"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Use this playlist/ }));

    await waitFor(() => expect(screen.getByText(/does not look like a playlist/)).toBeTruthy());
  });
});
