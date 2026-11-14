import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize, Pause, Play, RefreshCw, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { LiveVideoSurface, type AudioTrackOption } from "@/components/tv/LiveVideoSurface";

/**
 * The player, drawn once.
 *
 * `/live/<channel>`, `/watch/<channel>` and `/embed/<channel>` were three renderings of one idea,
 * and they drifted -- the app grew a chrome the embed never got, the embed grew a bug the app never
 * had. This is the chrome, in one place, and the pages differ only in what they put around it:
 *
 *   - `variant="fill"`   an embed. The frame *is* the player, so the picture fills it.
 *   - `variant="aspect"` a page. 16:9, in normal flow, like the reference site -- a rounded box the
 *                        viewer scrolls past, not a black wall they have to escape from.
 *
 * Two rules, both learned from reports:
 *
 *   1. **The picture starts on the first frame.** So playback begins muted, which no browser
 *      refuses, and *then* asks for sound. A frame that waits for a tap before showing anything is
 *      a frame that looks broken.
 *   2. **Nothing covers anything.** The sound prompt is a chip in the corner, not a full-screen
 *      veil; the transport bar sits inside the player's own rectangle, so it can never land on the
 *      channel list; the mark is above both.
 */

export interface StageChannel {
  id: string;
  name: string;
  number?: number | undefined;
  source?: string | undefined;
  directUrl?: string | undefined;
  drm?: { type: "clearkey"; keys: Array<{ kid: string; k: string }> } | null | undefined;
  container?: string | undefined;
}

interface LivePlayerStageProps {
  /** Null while a page is still resolving which channel it is. */
  channel: StageChannel | null;
  variant?: "aspect" | "fill";
  reloadNonce: number;
  /** Called after the stage bumps its own reload; pages use it to refresh their own state too. */
  onReload?: (() => void) | undefined;
  /** The STREAMR mark. It is the embed's way home and the site's own signature. */
  watermark?: { href: string; title: string } | null | undefined;
  /** Site-only controls, at the right of the transport bar: previous/next channel. */
  extras?: ReactNode;
  onAudioTracksChange?: ((tracks: AudioTrackOption[], active: number) => void) | undefined;
  onContainerDetected?: ((kind: string) => void) | undefined;
  onNextChannel?: (() => void) | undefined;
  onSwitchChannel?: ((id: string) => void) | undefined;
  className?: string;
}

export function LivePlayerStage({
  channel,
  variant = "fill",
  reloadNonce,
  onReload,
  watermark,
  extras,
  onAudioTracksChange,
  onContainerDetected,
  onNextChannel,
  onSwitchChannel,
  className = "",
}: LivePlayerStageProps) {
  /*
   * Muted on arrival -- and that is what makes "the stream starts on first load" true. Every
   * browser allows a muted autoplay; the sound is negotiated afterwards, in `useAutoSound` below.
   */
  const [muted, setMuted] = useState(true);
  /** Set when the browser refused the sound we asked for. Dismissed by the chip, not a veil. */
  const [soundPrompt, setSoundPrompt] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tracks, setTracks] = useState<AudioTrackOption[]>([]);
  const [activeTrack, setActiveTrack] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [innerNonce, setInnerNonce] = useState(0);
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Once the viewer has an opinion about audio, stop second-guessing it. */
  const audioChosen = useRef(false);
  /** One automatic attempt per element: `playing` fires again after every stall and seek. */
  const autoTried = useRef(false);

  const bindMedia = useCallback((el: HTMLVideoElement | null) => setMediaEl(el), []);

  /*
   * Stable identities on purpose. The engine keys its playback lifecycle on the channel, but a
   * caller that hands it a fresh arrow function on every render is a call site waiting to restart
   * the stream -- so this one does not, and the engine no longer cares either way.
   */
  const handleTracks = useCallback(
    (next: AudioTrackOption[], active: number) => {
      setTracks(next);
      onAudioTracksChange?.(next, active);
    },
    [onAudioTracksChange],
  );
  const handleContainer = useCallback(
    (kind: string) => onContainerDetected?.(kind),
    [onContainerDetected],
  );
  const handleAutoMuted = useCallback(() => {
    setMuted(true);
    setSoundPrompt(true);
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

  /*
   * Ask for sound once the picture is actually running.
   *
   * Muted autoplay is always allowed; unmuting afterwards is the part browsers argue about. Chrome
   * rejects the `play()` promise with NotAllowedError, Safari sometimes just pauses the element.
   * Both are handled here, and both end the same way: keep playing, keep the sound off, say so in
   * the corner.
   */
  useEffect(() => {
    if (!mediaEl) return;
    let timer: number | undefined;

    const attempt = () => {
      if (autoTried.current || audioChosen.current || !mediaEl.muted) return;
      autoTried.current = true;
      mediaEl.muted = false;
      const started = mediaEl.play();
      const revert = () => {
        if (audioChosen.current) return;
        mediaEl.muted = true;
        setMuted(true);
        setSoundPrompt(true);
        void mediaEl.play().catch(() => undefined);
      };
      if (started && typeof started.then === "function") {
        started.then(() => {
          // Safari resolves the promise and then pauses: believe the element, not the promise.
          timer = window.setTimeout(() => {
            if (mediaEl.paused) revert();
            else setMuted(false);
          }, 300);
        }).catch(revert);
      }
      window.setTimeout(() => {
        if (!audioChosen.current && mediaEl.muted) revert();
      }, 400);
    };

    if (!mediaEl.paused) attempt();
    mediaEl.addEventListener("playing", attempt);
    return () => {
      mediaEl.removeEventListener("playing", attempt);
      if (timer) window.clearTimeout(timer);
    };
  }, [mediaEl]);

  const withSound = () => {
    audioChosen.current = true;
    setSoundPrompt(false);
    setMuted(false);
    if (mediaEl) {
      mediaEl.muted = false;
      void mediaEl.play().catch(() => undefined);
    }
  };

  const toggleMuted = () => {
    audioChosen.current = true;
    setSoundPrompt(false);
    setMuted((m) => !m);
  };

  const togglePlay = () => {
    const el = mediaEl;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const reload = () => {
    setSoundPrompt(false);
    setInnerNonce((n) => n + 1);
    onReload?.();
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => undefined);
  };

  const qualityLabel = activeTrack >= 0 && tracks[activeTrack] ? tracks[activeTrack]!.label.toUpperCase() : "AUTO";
  const frame =
    variant === "aspect"
      ? "relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black"
      : "relative h-full w-full overflow-hidden bg-black";

  return (
    <div ref={stageRef} className={`${frame} ${className}`}>
      {channel && (
        <LiveVideoSurface
          channelId={channel.id}
          channelName={channel.name}
          directUrl={channel.directUrl}
          drm={channel.drm ?? null}
          container={channel.container}
          activeSource={channel.source}
          muted={muted}
          reloadNonce={reloadNonce + innerNonce}
          selectedAudioTrack={activeTrack}
          onMediaElement={bindMedia}
          onAudioTracksChange={handleTracks}
          onContainerDetected={handleContainer}
          onAutoMuted={handleAutoMuted}
          onNextChannel={onNextChannel}
          onSwitchChannel={onSwitchChannel}
        />
      )}

      {/* LIVE, number, name: the only identity a player needs. */}
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

      {/* A chip, not a veil: the picture is playing behind it and stays usable. */}
      {soundPrompt && (
        <button
          type="button"
          onClick={withSound}
          aria-label="Play with sound"
          className="absolute bottom-16 left-2.5 z-30 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-accent-foreground shadow-lg"
        >
          <VolumeX className="size-3.5" />
          Tap for sound
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

            {/* The reference player's coloured disc: sound is what people reach for. */}
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
              {extras}
              <button
                type="button"
                onClick={reload}
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

      {/*
        The mark: over the picture's corner, above the bar, and above the prompt. An absolute child
        of a parent with no z-index compares directly against the player's own layers, so nothing
        the player draws can cover it.
      */}
      {channel && watermark && (
        <a
          href={watermark.href}
          target="_top"
          rel="noopener"
          title={watermark.title}
          className="absolute bottom-16 right-2.5 z-40 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/75 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white no-underline transition hover:border-accent"
        >
          <img src="/favicon.png" alt="" width={16} height={16} className="size-4 rounded" />
          STREAMR
        </a>
      )}
    </div>
  );
}
