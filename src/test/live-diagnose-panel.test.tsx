import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LivePlayerContent } from "@/routes/live";

/**
 * "idk how my app is able to make them run."
 *
 * The honest answer for most of this evening was: it isn't, and here is the address to paste into a
 * chat so somebody can read the JSON. That is a fair thing to ask an engineer and a poor thing to
 * ask a viewer, especially one who has already been told six times that a fix was coming.
 *
 * So the panel asks the question itself. `/api/live/diagnose` already knows the device that was
 * presented, the token position that worked and what each address answered; the page now shows
 * those in place, in a form that names the fault rather than quoting a payload.
 */

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: () => <video data-testid="engine" />,
}));

const DIAGNOSIS = {
  ok: false,
  kind: "maxtv",
  tokenPosition: "the bare token in Authorization",
  configured: {
    portal: "http://tv.fusion4k.cc/stalker_portal/c/",
    mac: "00:1A:79:F5:8F:95",
    sn: "99EB2A8128098",
    deviceId: "01F71B517FE629CE5FB7158273354EDF361793DC5BB6C481C4957C3356040ABA",
    deviceId2: "01F71B517FE629CE5FB7158273354EDF361793DC5BB6C481C4957C3356040ABA",
    stbType: "MAG254",
    fromEnv: { portal: false, mac: false },
  },
  handshake: { ok: true, endpoint: "http://tv.fusion4k.cc/stalker_portal/server/load.php", reused: false },
  catalogue: { channels: 0, note: "The handshake succeeded but no channels came back." },
  trace: [
    { action: "get_all_channels", status: 200, address: "tv.fusion4k.cc", said: "Authorization failed." },
  ],
};

const emptyCatalogue = {
  ok: true,
  channels: [],
  categories: [],
  maxTvConfigured: true,
  sourceError: "Authorization failed.",
};

function renderLive() {
  const rootRoute = createRootRoute();
  const liveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/live",
    component: () => <LivePlayerContent initialSource="fusion4k" />,
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
      if (url.includes("/api/live/diagnose")) {
        return new Response(JSON.stringify(DIAGNOSIS), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(emptyCatalogue), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

describe("an empty guide that explains itself", () => {
  it("shows the device it presented and the position that worked, in place", async () => {
    renderLive();
    fireEvent.click(await screen.findByRole("button", { name: "Why is this empty?" }));

    await waitFor(() => expect(screen.getByTestId("diagnosis")).toBeTruthy());

    const shown = screen.getByTestId("diagnosis").textContent ?? "";
    // The whole device, not just the address: this is what "is it using what I gave you" means.
    expect(shown).toContain("00:1A:79:F5:8F:95");
    expect(shown).toContain("99EB2A8128098");
    expect(shown).toContain("MAG254");
    // And the one fact a viewer could never have guessed.
    expect(shown).toContain("the bare token in Authorization");
    expect(shown).toContain("The handshake succeeded but no channels came back.");
    // The panel's own words, one tap deeper.
    expect(shown).toContain("what each address answered");
  });

  it("says so plainly when even the diagnostic request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string) => {
        if (String(target).includes("/api/live/diagnose")) throw new TypeError("offline");
        return new Response(JSON.stringify(emptyCatalogue), { status: 200 });
      }),
    );
    renderLive();
    fireEvent.click(await screen.findByRole("button", { name: "Why is this empty?" }));
    await waitFor(() =>
      expect(screen.getByText(/did not answer the diagnostic request/)).toBeTruthy(),
    );
  });
});
