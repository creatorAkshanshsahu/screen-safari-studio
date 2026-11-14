import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedChannelPlayer } from "@/components/tv/EmbedChannelPlayer";

/**
 * The chrome of the embed, now that there is one engine behind it.
 *
 * `EmbedChannelPlayer` is not a player of its own: it resolves the channel and hands the app's own
 * `LiveVideoSurface` exactly what the app's own page hands it. These tests pin both halves of that
 * -- the props crossing into the engine, and the small amount of chrome that is allowed around it
 * (a name strip, three controls, and the STREAMR mark that goes back to the channel's page).
 *
 * The engine is stubbed: it needs a media element, hls.js and a real network. Its own wiring is
 * covered where it can be -- failure-remedies.test.ts canaries the parts that only a browser can
 * exercise.
 */

const ENGINE = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

/** The props the embed hands the engine, by name. */
const prop = (name: string) => ENGINE.props.at(-1)?.[name];

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: (props: Record<string, unknown>) => {
    ENGINE.props.push(props);
    return <video data-testid="engine" />;
  },
}));

const CHANNEL = {
  id: "tg:3436",
  name: "Discovery Kids",
  number: 7,
  container: "hls",
  sources: ["/api/live/stream/tg%3A3436.m3u8", "https://cdn.tgtv.example/live/discoverykids/index.m3u8"],
};

function stubApi(body: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => {
      calls.push(String(target));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return { calls };
}

/** jsdom's URL is the address bar the component reads `?colour=` from. */
function atAddress(path: string) {
  window.history.replaceState({}, "", path);
}

beforeEach(() => {
  ENGINE.props.length = 0;
  atAddress("/embed/7");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an embedded channel", () => {
  it("plays through the app's own engine, with the same inputs the app page gives it", async () => {
    const net = stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);

    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // The one-source rule, in one assertion: whatever `/live/<id>` plays, this plays.
    expect(net.calls[0]).toContain("/api/public/channels/7");
    expect(prop("channelId")).toBe("tg:3436");
    expect(prop("channelName")).toBe("Discovery Kids");
    // `sources[1]` is the resolved direct address -- the one the embed used to be missing, which
    // is why the app played and the embed sat on "connecting".
    expect(prop("directUrl")).toBe(CHANNEL.sources[1]);
    expect(prop("container")).toBe("hls");
    expect(prop("activeSource")).toBe("tgtv");
    // Never unmuted on arrival: a host site did not ask to make noise.
    expect(prop("muted")).toBe(true);
  });

  it("is a player and nothing else -- no header, no guide, no filter row", async () => {
    stubApi(CHANNEL);
    const { container } = render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    expect(screen.queryByText(/channel guide/i)).toBeNull();
    expect(screen.queryByText(/All channels/i)).toBeNull();
    // Three controls, and no more: an embed is a rectangle inside someone else's page.
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("carries the STREAMR mark to the channel's own page, in the corner, on top", async () => {
    stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    const mark = screen.getByTitle(/Watch Discovery Kids on STREAMR/);
    // The channel's own page, by number -- not the home page, and not where you came from.
    expect(mark.getAttribute("href")).toMatch(/\/watch\/7$/);
    // `_top` is the only navigation an embedded player may perform: it must not be trapped in
    // the iframe the host site drew.
    expect(mark.getAttribute("target")).toBe("_top");
    expect(mark.getAttribute("rel")).toContain("noopener");
    expect(mark.textContent).toContain("STREAMR");

    // Bottom-right, and *not* inside the control row: an absolute child of a parent without a
    // z-index wins against the player's overlay, while a row with one would cover it.
    const className = mark.getAttribute("class") ?? "";
    expect(className).toContain("bottom-2.5");
    expect(className).toContain("right-2.5");
    expect(className).toMatch(/\bz-30\b/);
    const row = screen.getByRole("button", { name: "Unmute" }).parentElement!;
    expect(row.contains(mark)).toBe(false);
    // Both are absolute children of a parent with no z-index, so they are compared directly:
    // the mark's 30 has to beat the row's 20, or the controls cover it again.
    const zOf = (el: Element) => Number(/\bz-(\d+)/.exec(el.getAttribute("class") ?? "")?.[1] ?? 0);
    expect(zOf(mark)).toBeGreaterThan(zOf(row));
  });

  it("says why, in the relay's words, instead of waiting forever", async () => {
    // What the browser used to do: spin on "Connecting to live stream…" while our relay already
    // knew the answer. The reason is quoted verbatim so a host site can forward it.
    stubApi(
      {
        ok: false,
        error: "AK TV relay could not reach premiumplug.fun (HTTP 403). Source rotated its token.",
      },
      502,
    );
    render(<EmbedChannelPlayer rawId="7" />);

    await waitFor(() =>
      expect(screen.getByText(/AK TV relay could not reach premiumplug\.fun \(HTTP 403\)/)).toBeTruthy(),
    );
    // An upstream status is never reported without a remedy.
    const browse = screen.getByText("Browse AK TV channels");
    expect(browse.getAttribute("href")).toMatch(/\/embed\/tgtv$/);
    expect(browse.getAttribute("target")).toBe("_top");
    // Nothing was mounted to play, so nothing can sit on a spinner.
    expect(screen.queryByTestId("engine")).toBeNull();
    expect(screen.queryByText(/Connecting to/)).toBeNull();
  });

  it("never shows a blank page for an id it cannot find", async () => {
    stubApi(
      { ok: false, error: 'No channel matches "tg:does-not-exist". The playlist may have been re-sourced; read /api/public/channels for the current list.' },
      404,
    );
    render(<EmbedChannelPlayer rawId="tg:does-not-exist" />);

    await waitFor(() =>
      expect(screen.getByText(/No channel matches "tg:does-not-exist"/)).toBeTruthy(),
    );
    // Even with nothing to play there is a way out, and it goes to the app.
    const home = screen.getByText("STREAMR").closest("a")!;
    expect(home.getAttribute("target")).toBe("_top");
  });
});

describe("?colour=", () => {
  it("themes the frame it is asked for", async () => {
    atAddress("/embed/7?colour=FF6600");
    stubApi(CHANNEL);
    const { container } = render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--accent")).toBe("#ff6600");
    // Readable text on that accent, picked by luminance rather than left to the browser.
    expect(root.style.getPropertyValue("--accent-foreground")).toBe("#000000");
  });

  it("keeps the default when the value is not a colour", async () => {
    atAddress("/embed/7?colour=nope");
    stubApi(CHANNEL);
    const { container } = render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // No inline override at all: the stylesheet's default accent stands, rather than a guess.
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });
});
