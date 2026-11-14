import { useEffect, useState } from "react";
import { Maximize, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { LiveVideoSurface } from "@/components/tv/LiveVideoSurface";
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
 * embed is a rectangle inside someone else's page, so it gets the picture, three controls, a name,
 * and the STREAMR mark.
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
  const [muted, setMuted] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [accent, setAccent] = useState<string | null>(null);

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

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-black text-foreground"
      style={
        accent
          ? ({ "--accent": accent, "--accent-foreground": accentInk(accent) } as React.CSSProperties)
          : undefined
      }
    >
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
          selectedAudioTrack={-1}
        />
      )}

      {channel && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-3">
          <span className="rounded bg-live px-2 py-0.5 text-[10px] font-bold tracking-widest text-white">LIVE</span>
          <span className="min-w-0 truncate text-xs font-bold sm:text-sm">
            {channel.number !== undefined && <span className="mr-1.5 tabular-nums text-accent">{channel.number}</span>}
            {channel.name}
          </span>
        </div>
      )}

      {channel && (
        <div className="absolute bottom-0 left-0 z-20 flex items-center gap-1.5 p-2.5">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
            aria-label="Reload stream"
          >
            <RefreshCw className="size-3.5" /> Reload
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
            className="glass inline-flex items-center rounded-full p-1.5"
            aria-label="Fullscreen"
          >
            <Maximize className="size-3.5" />
          </button>
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
        The mark, in the corner and going home. It sits in the bottom-right on its own, never inside
        the control row: an absolute element whose ancestor has no z-index compares its own against
        the player's overlay directly, and a row with a z-index would cover it again.
      */}
      {channel && (
        <a
          href={watchHref}
          target="_top"
          rel="noopener"
          title={`Watch ${channel.name} on STREAMR`}
          className="absolute bottom-2.5 right-2.5 z-30 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/80 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white no-underline transition hover:border-accent"
        >
          <img src="/favicon.png" alt="" width={16} height={16} className="size-4 rounded" />
          STREAMR
        </a>
      )}
    </div>
  );
}
