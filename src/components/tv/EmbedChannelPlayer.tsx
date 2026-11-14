import { useEffect, useState } from "react";
import { LivePlayerStage, type StageChannel } from "@/components/tv/LivePlayerStage";
import { accentInk, parseAccent } from "@/lib/live-gateway";

/**
 * The player a host site embeds.
 *
 * This is the app's own player, not a second copy of it. The embed used to be a hand-written script
 * inside a server-rendered string: same idea, different code, and every fix since had to be made
 * twice -- the app learned to use the relay's resolved direct address and the embed did not, so one
 * played and the other sat on "connecting" for the same channel.
 *
 * What is left here is only the part an embed needs and a page does not: resolving a channel from a
 * bare id (a number, a key, a `tg:` id) and saying why when it cannot. The chrome -- picture,
 * transport bar, mark -- is `LivePlayerStage`, shared with `/live/<channel>` and `/watch/<channel>`.
 * If those ever look different, that is a bug in one file, not in two.
 *
 * The order matters and is deliberate: **resolve, then mount**. Asking the relay who the channel is
 * warms the catalogue that the player's first probe is about to read, and it hands the engine the
 * direct address and the ClearKey up front. Mounting on the raw id first looked like a head start
 * and cost the stream: the probe ran against a cold catalogue, was answered with a `504` that
 * carries no direct-play recipe, and the frame sat on "Connecting to …" with nothing left to try.
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

  const stage: StageChannel | null = channel
    ? {
        id: channel.id,
        name: channel.name,
        number: channel.number ?? undefined,
        source: "tgtv",
        directUrl: directUrl ?? undefined,
        drm: drm && drm.keys.length ? drm : null,
        container: channel.container ?? "hls",
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
      {!problem && (
        <LivePlayerStage
          channel={stage}
          variant="fill"
          reloadNonce={reloadNonce}
          onReload={() => setReloadNonce((n) => n + 1)}
          watermark={{ href: watchHref, title: `Watch ${channel?.name ?? "this channel"} on STREAMR` }}
        />
      )}

      {/* A frame that says what it is doing, rather than an unexplained black rectangle. */}
      {!problem && !stage && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black">
          <p className="text-xs font-semibold text-muted-foreground">Tuning {decodeURIComponent(rawId)}…</p>
        </div>
      )}

      {problem && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90 p-6 text-center">
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
    </div>
  );
}
