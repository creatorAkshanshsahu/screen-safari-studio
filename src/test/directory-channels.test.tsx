import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LivePlayerContent } from "@/routes/live";
import { parseDirectory } from "@/lib/directories";

/**
 * "can map channels from this and make them play in our player" — `allinonereborn2.online/sony/`.
 *
 * That page is not a playlist and not a portal. It is a page of links: each channel is an `<a>`
 * around its logo, pointing at the seller's own player for that channel. No playlist reader could
 * ever use it, and that is why it looked like nothing could be done with it.
 *
 * The markup below is the page as it actually is (fetched from the live site), trimmed to four
 * channels: a picture, an `alt`, and a link to `ptest1.html?id=<slug>`.
 */

const DIRECTORY_HTML = `<!DOCTYPE html><html><body>
<h2>SonyLiv Web by @Allinone_Reborn</h2>
<a href="https://suniliv.pages.dev/ptest1.html?id=sony-hd"><img src="https://jiotvimages.cdn.jio.com/dare_images/images/Sony_HD.png" alt="SONY HD"></a>
<a href="https://suniliv.pages.dev/ptest1.html?id=sab-hd"><img src="https://jiotvimages.cdn.jio.com/dare_images/images/Sony_SAB_HD.png" alt="SAB HD"></a>
<a href="https://cdn.example/sony-max.m3u8">SONY MAX</a>
<a href="https://suniliv.pages.dev/ptest1.html?id=sony-ten-1-hd"><img src="https://jiotvimages.cdn.jio.com/dare_images/images/Ten_HD.png" alt="SONY TEN 1 HD"></a>
</body></html>`;

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: () => <video data-testid="engine" />,
}));

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
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      const url = String(target);
      if (url.includes("allinonereborn2.online")) {
        return new Response(DIRECTORY_HTML, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify({ ok: true, channels: [], categories: [] }), { status: 200 });
    }),
  );
});

describe("mapping a channel directory", () => {
  it("reads names, logos and links out of the page as it is published", () => {
    const rows = parseDirectory(DIRECTORY_HTML, "https://allinonereborn2.online/sony/");
    expect(rows.map((r) => r.name)).toEqual(["SONY HD", "SAB HD", "SONY MAX", "SONY TEN 1 HD"]);
    expect(rows[0]!.logo).toContain("Sony_HD.png");
    expect(rows[0]!.href).toBe("https://suniliv.pages.dev/ptest1.html?id=sony-hd");

    /*
     * The distinction the whole feature rests on: a link that is a media address plays in this
     * player, and a link that is the seller's player page does not.
     */
    expect(rows[0]!.play.kind).toBe("frame");
    expect(rows[3]!.play.kind).toBe("frame");
    expect(rows[2]!.play).toEqual({ kind: "media", url: "https://cdn.example/sony-max.m3u8" });
  });

  it("names a channel from its address when the page gives no text", () => {
    const rows = parseDirectory(
      `<a href="https://suniliv.pages.dev/ptest1.html?id=sony-max-2"><img src="x.png"></a>`,
      "https://allinonereborn2.online/sony/",
    );
    expect(rows[0]!.name).toBe("Sony Max 2");
  });
});

describe("the directory tab", () => {
  it("maps the page in this browser and plays a framed channel in our own frame", async () => {
    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "sony" }));
    // Whatever the page asked about the tab it opened on, this test is about the directory tab.
    vi.mocked(fetch).mockClear();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /SONY HD/ }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: /SONY HD/ })[0]!);

    // Their player page, inside our frame: the stream address is built by their script, so the
    // only honest way to show the picture is to let it run.
    await waitFor(() => expect(screen.getByTestId("framed-channel")).toBeTruthy());
    expect(screen.getByTestId("framed-channel").getAttribute("src")).toBe(
      "https://suniliv.pages.dev/ptest1.html?id=sony-hd",
    );

    // And nothing asked the relay about a directory tab.
    const relay = vi
      .mocked(fetch)
      .mock.calls.map((c) => String(c[0]))
      .filter((u) => u.includes("/api/live/channels"));
    expect(relay).toHaveLength(0);
  });

  it("plays a channel whose link is a stream address in our own player", async () => {
    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "sony" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /SONY MAX/ }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole("button", { name: /SONY MAX/ })[0]!);

    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());
    expect(screen.queryByTestId("framed-channel")).toBeNull();
  });

  it("says how many of its channels are framed, so the difference is never a surprise", async () => {
    renderLive();
    fireEvent.click(await screen.findByRole("tab", { name: "sony" }));
    await waitFor(() => expect(screen.getByTestId("directory-panel")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/3 of them play in the seller's own player/)).toBeTruthy());
  });
});
