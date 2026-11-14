import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedChannelPlayer } from "@/components/tv/EmbedChannelPlayer";

/**
 * The chrome of the embed, now that there is one engine behind it.
 *
 * `EmbedChannelPlayer` is not a player of its own: it resolves the channel and hands the app's own
 * `LiveVideoSurface` exactly what the app's own page hands it. These tests pin both halves of that
 * -- the props crossing into the engine, and the chrome that is allowed around it: the name strip,
 * the reference player's transport bar, the tap-to-play-with-sound prompt, and the STREAMR mark
 * that goes back to the channel's own page.
 *
 * The engine is stubbed: it needs hls.js and a real network. The stub hands back a real `<video>`
 * through `onMediaElement`, which is the same door the embed's transport controls use.
 */

const ENGINE = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

/** The props the embed hands the engine, by name. */
const prop = (name: string) => ENGINE.props.at(-1)?.[name];

vi.mock("@/components/tv/LiveVideoSurface", () => ({
  LiveVideoSurface: (props: Record<string, unknown>) => {
    ENGINE.props.push(props);
    const ref = useRef<HTMLVideoElement | null>(null);
    const bind = props["onMediaElement"] as ((el: HTMLVideoElement | null) => void) | undefined;
    useEffect(() => {
      bind?.(ref.current);
      return () => bind?.(null);
    }, [bind]);
    return <video data-testid="engine" ref={ref} />;
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
  // jsdom does not implement media playback; the embed only needs the promise and the flag.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an embedded channel", () => {
  it("plays through the app's own engine, with the same inputs the app page gives it", async () => {
    const net = stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);

    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // The one-source rule, in one assertion: whatever `/live/<id>` plays, this plays.
    expect(net.calls[0]).toContain("/api/public/channels/7");
    /*
     * The engine is keyed on the id the embed was *given* (`7`), not on the canonical id the API
     * returns. That is what lets the player mount before the metadata request finishes: swapping
     * the id underneath a running player would tear the stream down and start it again.
     */
    expect(prop("channelId")).toBe("7");
    expect(prop("channelName")).toBe("Discovery Kids");
    // The first source that is not our relay: the address the app page plays when the relay is
    // refused. The embed used to be missing exactly this, which is why it sat on "connecting".
    expect(prop("directUrl")).toBe(CHANNEL.sources[1]);
    expect(prop("container")).toBe("hls");
    expect(prop("activeSource")).toBe("tgtv");
  });

  it("mounts the player before the channel metadata has arrived", async () => {
    // A cold catalogue read is a second of the viewer's life. The id is enough to start on, so the
    // stream is connecting while the name, the direct address and the ClearKey are still in flight.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch);
    render(<EmbedChannelPlayer rawId="2524" />);

    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());
    expect(prop("channelId")).toBe("2524");
    // Nothing is on top of the picture while it connects.
    expect(screen.queryByLabelText("Play with sound")).toBeNull();
  });

  it("starts the picture immediately, without waiting for a tap", async () => {
    stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    /*
     * "we want stream on first load". Muted autoplay is the one form of autoplay no browser
     * refuses, so the picture starts on the first frame and the sound is negotiated *after*. The
     * previous version asked for sound first and put a full-screen prompt over the video when the
     * browser said no -- which reads as a player that never started.
     */
    expect(prop("muted")).toBe(true);
    expect(screen.queryByLabelText("Play with sound")).toBeNull();
  });

  it("asks for sound as soon as the picture is running, and keeps it when allowed", async () => {
    stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);
    const video = (await screen.findByTestId("engine")) as HTMLVideoElement;

    // The engine reports `playing`; the stage then unmutes the element and calls play() again.
    act(() => {
      video.dispatchEvent(new Event("playing"));
    });

    await waitFor(() => expect(video.muted).toBe(false));
    // No prompt: the browser allowed it.
    expect(screen.queryByLabelText("Play with sound")).toBeNull();
  });

  it("when the browser refuses, says so in a corner chip -- not over the picture", async () => {
    stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // What the engine reports after a NotAllowedError: the picture started, the sound did not.
    act(() => (ENGINE.props.at(-1)!["onAutoMuted"] as () => void)());

    expect(prop("muted")).toBe(true);
    const prompt = screen.getByLabelText("Play with sound");
    expect(prompt.textContent).toContain("Tap for sound");
    // A chip: it does not cover the video, and it is not a veil over the controls.
    expect(prompt.className).not.toContain("inset-0");
    expect(prompt.className).toContain("bottom-16");

    // One tap: sound on and playing. Never "now find the mute button".
    fireEvent.click(prompt);
    expect(prop("muted")).toBe(false);
    expect(screen.queryByLabelText("Play with sound")).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("carries a transport bar, not a page of chrome", async () => {
    stubApi(CHANNEL);
    const { container } = render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());

    // The reference player's row: play/pause, sound, quality, reload, fullscreen. An embed is a
    // rectangle inside someone else's page, so there is no guide, no filter row, no header.
    expect(screen.getByLabelText(/Play|Pause/)).toBeTruthy();
    expect(screen.getByLabelText(/Mute|Unmute/)).toBeTruthy();
    expect(screen.getByLabelText("Audio and quality")).toBeTruthy();
    expect(screen.getByLabelText("Reload stream")).toBeTruthy();
    expect(screen.getByLabelText("Fullscreen")).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(5);
    expect(screen.queryByText(/channel guide/i)).toBeNull();
    expect(screen.queryByText(/All channels/i)).toBeNull();
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

    // Over the picture's corner, above the transport bar rather than behind it: an absolute child
    // of a parent with no z-index compares directly against the player's own layers.
    const className = mark.getAttribute("class") ?? "";
    expect(className).toContain("bottom-16");
    expect(className).toContain("right-2.5");
    const zOf = (el: Element) => Number(/\bz-(\d+)/.exec(el.getAttribute("class") ?? "")?.[1] ?? 0);
    expect(zOf(mark)).toBeGreaterThan(zOf(screen.getByLabelText(/Mute|Unmute/)));
    const bar = screen.getByLabelText(/Mute|Unmute/).closest(".absolute")!;
    expect(bar.contains(mark)).toBe(false);
  });

  it("reloads through the engine, so a fresh token is one tap away", async () => {
    stubApi(CHANNEL);
    render(<EmbedChannelPlayer rawId="7" />);
    await waitFor(() => expect(screen.getByTestId("engine")).toBeTruthy());
    const before = prop("reloadNonce");

    fireEvent.click(screen.getByLabelText("Reload stream"));
    expect(prop("reloadNonce")).toBeGreaterThan(before as number);
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
      {
        ok: false,
        error:
          'No channel matches "tg:does-not-exist". The playlist may have been re-sourced; read /api/public/channels for the current list.',
      },
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

describe("the frame a host site draws", () => {
  it("says it may be framed, instead of relying on nobody adding that header", async () => {
    const { withEmbedFraming } = await import("@/server");

    const embed = withEmbedFraming(
      new Request("https://player.example/embed/2524"),
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    expect(embed.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(embed.headers.get("access-control-allow-origin")).toBe("*");

    // Everything that is not an embed keeps the app's own policy.
    const live = withEmbedFraming(
      new Request("https://player.example/live/2524"),
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    expect(live.headers.get("content-security-policy")).toBeNull();
  });
});
