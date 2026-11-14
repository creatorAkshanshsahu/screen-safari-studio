import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, RefreshCw, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { LiveVideoSurface, type AudioTrackOption } from "@/components/tv/LiveVideoSurface";
import { accentInk, parseAccent } from "@/lib/live-gateway";

/**
 * The player a host site embeds.
 *
 * This is the app's own player, not a second copy of it. The embed used to be a hand-written script
 * inside a server-rendered string: same idea, different code, and every fix since had to be made
 * twice -- the app learned to use the relay's resolved direct address and the embed did not, so one
 * played and the other sat on "connecting" for the same channel. There is now one engine.
 *
 * What is *not* shared: the chrome. The app page has a header, a channel guide and a filter row; an
 * embed is a rectangle inside someone else's page, so it gets the picture and a transport bar, and
 * nothing else.
 *
 * Two rules this file exists to keep:
 *
 *   1. **Sound on arrival, if the browser allows it.** A host site that writes
 *      `allow="autoplay"` has said the viewer wants to hear it. Starting muted means the answer to
 *      "why is there no sound?" is a mute button the viewer has to find. So it tries with audio,
 *      and when the browser refuses an unmuted autoplay it mutes (the picture must still play),
 *      says so on screen, and resumes with sound on the first tap.
 *   2. **One tap per idea.** The transport bar is the reference player's, because that is the shape
 *      a viewer coming from that site already knows: play/pause, sound, quality, reload, fullscreen.
 */

interface PublicDrm {
  type: "clearkey";
  keyId?: string;
  key?: string;
  keys?: Array<{ kid: string; k: string }>;
}

interface PublicChannel {
  id: string;
  name: string;
  number?: number;
  sources?: string[];
  container?: string;
  drm?: PublicDrm;
}

export function EmbedChannelPlayer({ rawId }: { rawId: string }) {
  const [channel, setChannel] = useState<PublicChannel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /*
   * Start with sound. The engine asks the browser to play unmuted and reports back if it refuses,
   * which is the only reliable way to know: the block is a promise rejection, not a setting.
   */
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [accent, setAccent] = useState<string | null>(null);
  const [tracks, setTracks] = useState<AudioTrackOption[]>([]);
  const [activeTrack, setActiveTrack] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hex = parseAccent(new URLSearchParams(window.location.search).get("colour"));
    if (hex) setAccent(hex);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    // The same rule as every other embed surface: answer or say why, never wait forever.
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    fetch(`/api/public/channels/${encodeURIComponent(rawId)}`, { signal: ctrl.signal })
      .then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => null) }))
      .then(({ ok, status, body }) => {
        if (cancelled) return;
        if (ok && body) {
          setChannel(body as PublicChannel);
          setProblem(null);
          return;
        }
        setProblem(
          (body as { error?: string } | null)?.error ??
            `This channel could not be resolved (HTTP ${status}). The playlist may have been re-sourced.`,
        );
      })
      .catch(() => {
        if (!cancelled) setProblem("The channel list did not answer. Reload this page and it will try again.");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [rawId]);

  // The engine hands up the element it attached the player to. Transport controls act on that, so
  // there is still exactly one player and one source of truth about whether it is playing.
  const bindMedia = useCallback((el: HTMLVideoElement | null) => {
    setMediaEl(el);
  }, []);

  useEffect(() => {
    if (!mediaEl) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    mediaEl.addEventListener("play", onPlay);
    mediaEl.addEventListener("pause", onPause);
    setPlaying(!mediaEl.paused);
    return () => {
      mediaEl.removeEventListener("play", onPlay);
      mediaEl.removeEventListener("pause", onPause);
    };
  }, [mediaEl]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /**
   * The browser refused an unmuted autoplay: the engine muted itself so the picture could start.
   * Show that, and make the first tap both unmute and play -- a viewer who tapped once should never
   * have to find a second control.
   */
  const onAutoMuted = useCallback(() => {
    setMuted(true);
    setBlocked(true);
  }, []);

  const resumeWithSound = () => {
    setBlocked(false);
    setMuted(false);
    if (mediaEl) {
      mediaEl.muted = false;
      void mediaEl.play().catch(() => undefined);
    }
  };

  const togglePlay = () => {
    const el = mediaEl;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const toggleMuted = () => {
    setBlocked(false);
    setMuted((m) => !m);
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => undefined);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const watchHref = `${origin}/watch/${encodeURIComponent(String(channel?.number ?? channel?.id ?? rawId))}`;
  /*
   * `sources[0]` is our own relay and every source after it is an address the browser can open by
   * itself. Choosing by position would silently break the day the API adds a source, so choose by
   * what it is: the first one that is not the relay.
   */
  const directUrl = channel?.sources?.find((src) => !src.includes("/api/live/stream/"));
  const drm = channel?.drm
    ? {
        type: "clearkey" as const,
        keys: channel.drm.keys?.length
          ? channel.drm.keys
          : channel.drm.keyId && channel.drm.key
            ? [{ kid: channel.drm.keyId, k: channel.drm.key }]
            : [],
      }
    : null;

  const qualityLabel = activeTrack >= 0 && tracks[activeTrack] ? tracks[activeTrack]!.label.toUpperCase() : "AUTO";

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-black text-foreground"
      style={
        accent
          ? ({ "--accent": accent, "--accent-foreground": accentInk(accent) } as React.CSSProperties)
          : undefined
      }
    >
      <div ref={stageRef} className="relative h-full w-full bg-black">
        {channel && (
          <LiveVideoSurface
            channelId={channel.id}
            channelName={channel.name}
            directUrl={directUrl ?? undefined}
            drm={drm && drm.keys.length ? drm : null}
            container={channel.container ?? "hls"}
            activeSource="tgtv"
            muted={muted}
            reloadNonce={reloadNonce}
            selectedAudioTrack={activeTrack}
            onMediaElement={bindMedia}
            onAutoMuted={onAutoMuted}
            // `activeTrack` stays at -1 until the viewer picks one: -1 means "whatever the engine
            // chose", so an automatic Hindi track is not overridden by an opinion from here.
            onAudioTracksChange={(next) => setTracks(next)}
          />
        )}

        {/* LIVE, number, name -- the reference player's top-left, and the only identity an embed
            needs: what am I watching, and which channel is it. */}
        {channel && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-2.5 sm:p-3">
            <span className="flex items-center gap-1.5 rounded bg-live px-2 py-0.5 text-[10px] font-bold tracking-widest text-white">
              <span className="size-1.5 rounded-full bg-white" />
              LIVE
            </span>
            <span className="min-w-0 truncate text-xs font-bold sm:text-sm">
              {channel.number !== undefined && <span className="mr-1.5 tabular-nums text-accent">{channel.number}</span>}
              {channel.name}
            </span>
          </div>
        )}

        {/* One tap, and the sound comes on. Never a mute button to go hunting for. */}
        {blocked && (
          <button
            type="button"
            onClick={resumeWithSound}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/45 text-white"
            aria-label="Play with sound"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg">
              <VolumeX className="size-7" />
            </span>
            <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold tracking-wide">
              Tap to play with sound
            </span>
          </button>
        )}

        {channel && (
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 sm:p-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="glass inline-flex size-9 items-center justify-center rounded-full"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>

              {/* The reference player's coloured disc, and for the same reason: sound is the thing
                  people reach for, so it is the thing the thumb lands on. */}
              <button
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? "Unmute" : "Mute"}
                className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md"
              >
                {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Audio and quality"
                  aria-expanded={menuOpen}
                  className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold tracking-wider"
                >
                  <SlidersHorizontal className="size-3.5" />
                  {qualityLabel}
                </button>
                {menuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-white/15 bg-black/90 p-1.5 text-xs shadow-xl">
                    <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      Language
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTrack(-1);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left font-semibold ${
                        activeTrack < 0 ? "bg-white/10" : ""
                      }`}
                    >
                      Auto <span className="text-[10px] text-muted-foreground">source default</span>
                    </button>
                    {tracks.map((track) => (
                      <button
                        key={track.index}
                        type="button"
                        onClick={() => {
                          setActiveTrack(track.index);
                          setMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left font-semibold ${
                          activeTrack === track.index ? "bg-white/10" : ""
                        }`}
                      >
                        {track.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReloadNonce((n) => n + 1);
                    setBlocked(false);
                  }}
                  aria-label="Reload stream"
                  className="glass inline-flex size-9 items-center justify-center rounded-full"
                >
                  <RefreshCw className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label="Fullscreen"
                  className="glass inline-flex size-9 items-center justify-center rounded-full"
                >
                  {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {problem && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
            <a
              href={origin}
              target="_top"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white no-underline"
            >
              <img src="/favicon.png" alt="" width={16} height={16} className="size-4 rounded" />
              STREAMR
            </a>
            <p className="max-w-sm text-xs text-muted-foreground sm:text-sm">{problem}</p>
            <a
              href={`${origin}/embed/tgtv`}
              target="_top"
              className="rounded-full bg-accent px-4 py-1.5 text-[11px] font-bold text-accent-foreground no-underline"
            >
              Browse AK TV channels
            </a>
          </div>
        )}

        {/*
          The mark, over the picture's corner and above everything the player draws. It sits in the
          bottom-right, clear of the transport bar: an absolute element whose ancestor has no
          z-index compares its own against the player's overlay directly, so it cannot be covered.

          It goes to the channel's own page -- `/watch/<number>`, `target="_top"` -- so a viewer who
          likes what they are watching lands on the channel they were already watching.
        */}
        {channel && (
          <a
            href={watchHref}
            target="_top"
            rel="noopener"
            title={`Watch ${channel.name} on STREAMR`}
            className="absolute bottom-16 right-2.5 z-40 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/75 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white no-underline transition hover:border-accent"
          >
            <img src="/favicon.png" alt="" width={16} height={16} className="size-4 rounded" />
            STREAMR
          </a>
        )}
      </div>
    </div>
  );
}
